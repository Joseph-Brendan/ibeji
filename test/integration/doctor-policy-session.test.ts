import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { type DoctorCheck, runDoctor } from "../../src/cli/doctor.js";
import { loadProject } from "../../src/cli/project.js";
import { runCli } from "../../src/cli/run.js";
import { sessionPath } from "../../src/control/paths.js";
import type { DnsAddress, DnsResolver } from "../../src/core/webhooks/address.js";
import { apiUrl, authHeaders, startControlSession } from "../helpers/control.js";
import { startLocalServer } from "../ui/support/local-server.js";

function webhookCheck(checks: readonly DoctorCheck[]): DoctorCheck {
  const check = checks.find((item) => item.name === "Webhook URLs");
  if (check === undefined) {
    throw new Error("doctor did not return a Webhook URLs check");
  }
  return check;
}

function resolverFor(privateAddress: string, publicAddress: string): DnsResolver {
  return async (hostname: string): Promise<readonly DnsAddress[]> => {
    if (hostname === privateAddress) {
      return [{ address: privateAddress, family: 4 }];
    }
    if (hostname === publicAddress) {
      return [{ address: publicAddress, family: 4 }];
    }
    return [{ address: "127.0.0.1", family: 4 }];
  };
}

describe("D45 doctor webhook address policy", () => {
  it("D45 doctor sends HEAD through the checked address to a local webhook", async () => {
    const harness = await startControlSession({ twins: ["paystack"] });
    const receiver = await startLocalServer();
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-doctor-head-"));
    try {
      const setWebhook = await fetch(apiUrl(harness.session, "/twins/paystack/webhook-url"), {
        method: "PUT",
        headers: { ...authHeaders(harness.session), "content-type": "application/json" },
        body: JSON.stringify({ url: `${receiver.url}/hook` }),
      });
      expect(setWebhook.status).toBe(200);
      const result = await runDoctor({
        home: harness.home,
        cwd,
        configPath: undefined,
        project: await loadProject(),
      });

      expect(result.ok).toBe(true);
      const check = webhookCheck(result.checks);
      expect(check.problems).toEqual([]);
      expect(check.notes?.join(" ")).toContain("running session");

      const request = await receiver.waitForRequest((item) => item.path === "/hook", 5_000);
      expect(request.method).toBe("HEAD");
      expect(request.headers.host).toBe(new URL(receiver.url).host);
      expect(request.body).toBe("");
    } finally {
      await receiver.close();
      await rm(cwd, { recursive: true, force: true });
      await harness.cleanup();
    }
  });

  it("D45 doctor uses the session policy when it differs from the config file", async () => {
    const harness = await startControlSession({
      twins: ["paystack", "flutterwave"],
      allowPrivateWebhooks: true,
      allowPublicWebhooks: true,
    });
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-doctor-policy-"));
    try {
      await writeFile(
        join(cwd, "ibeji.config.json"),
        JSON.stringify({ allowPrivateWebhooks: false, allowPublicWebhooks: false }),
        "utf8",
      );
      for (const [twin, url] of [
        ["paystack", "http://192.168.1.10:1234/hook"],
        ["flutterwave", "http://203.0.113.10/hook"],
      ] as const) {
        const response = await fetch(apiUrl(harness.session, `/twins/${twin}/webhook-url`), {
          method: "PUT",
          headers: { ...authHeaders(harness.session), "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        expect(response.status).toBe(200);
      }

      const statusResponse = await fetch(apiUrl(harness.session, "/status"), {
        headers: authHeaders(harness.session),
      });
      const status = (await statusResponse.json()) as {
        readonly addressPolicy: { readonly allowPrivate: boolean; readonly allowPublic: boolean };
      };
      expect(status.addressPolicy).toEqual({ allowPrivate: true, allowPublic: true });

      const result = await runDoctor({
        home: harness.home,
        cwd,
        configPath: undefined,
        project: await loadProject(),
        dnsResolver: resolverFor("192.168.1.10", "203.0.113.10"),
      });

      expect(result.ok).toBe(true);
      const check = webhookCheck(result.checks);
      expect(check.problems).toEqual([]);
      const notes = check.notes?.join(" ") ?? "";
      expect(notes).toContain("running session");
      expect(notes.match(/not contacted/gu)).toHaveLength(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await harness.cleanup();
    }
  });

  it("D45 doctor uses the config policy and says so when no session runs", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-doctor-config-"));
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-doctor-config-cwd-"));
    try {
      await writeFile(
        join(cwd, "ibeji.config.json"),
        JSON.stringify({
          allowPrivateWebhooks: true,
          webhookUrls: { paystack: "http://192.168.1.10:1234/hook" },
        }),
        "utf8",
      );

      const result = await runDoctor({
        home,
        cwd,
        configPath: undefined,
        project: await loadProject(),
        dnsResolver: resolverFor("192.168.1.10", "203.0.113.10"),
      });

      expect(result.ok).toBe(true);
      const check = webhookCheck(result.checks);
      expect(check.problems).toEqual([]);
      expect(check.notes?.join(" ")).toContain("config file");
      expect(check.notes?.join(" ")).toContain("not contacted");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("D46 session file permissions", () => {
  it("D46 doctor repairs a permissive session file and reports it", async () => {
    if (process.platform === "win32") {
      return;
    }
    const harness = await startControlSession({ twins: ["paystack"] });
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-doctor-session-"));
    try {
      await chmod(sessionPath(harness.home), 0o644);

      const result = await runDoctor({
        home: harness.home,
        cwd,
        configPath: undefined,
        project: await loadProject(),
      });

      expect(result.ok).toBe(false);
      const permissions = result.checks.find((check) => check.name === "Session file permissions");
      expect(permissions?.problems.length).toBe(1);
      expect((await stat(sessionPath(harness.home))).mode & 0o777).toBe(0o600);

      const second = await runDoctor({
        home: harness.home,
        cwd,
        configPath: undefined,
        project: await loadProject(),
      });
      expect(
        second.checks.find((check) => check.name === "Session file permissions")?.problems,
      ).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await harness.cleanup();
    }
  });

  it("D46 a CLI command warns when it repairs the session file", async () => {
    if (process.platform === "win32") {
      return;
    }
    const harness = await startControlSession({ twins: ["paystack"] });
    try {
      await chmod(sessionPath(harness.home), 0o644);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await runCli(["status", "--json"], {
        home: harness.home,
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
        openBrowser: async () => undefined,
      });
      expect(code).toBe(0);
      expect(stderr.join("")).toContain("readable by other users");
      expect((await stat(sessionPath(harness.home))).mode & 0o777).toBe(0o600);
    } finally {
      await harness.cleanup();
    }
  });
});
