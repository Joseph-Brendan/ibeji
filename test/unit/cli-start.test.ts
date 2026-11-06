import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { runStart, type StartCliOptions } from "../../src/cli/start.js";
import { sessionPath } from "../../src/control/paths.js";
import type { RunningSession } from "../../src/control/session.js";
import type { IbejiError } from "../../src/core/errors.js";

type Capture = {
  readonly stdout: string[];
  readonly stderr: string[];
};

type StartResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly session: RunningSession | undefined;
  readonly opened: readonly string[];
};

function capture(): Capture {
  return { stdout: [], stderr: [] };
}

async function runStartTest(
  args: readonly string[],
  options: {
    readonly home?: string;
    readonly cwd?: string;
    readonly openBrowser?: (url: string) => Promise<unknown>;
    readonly waitForShutdown?: boolean;
    readonly waitForStop?: () => Promise<void>;
  } = {},
): Promise<StartResult> {
  const home = options.home ?? (await mkdtemp(join(tmpdir(), "ibeji-start-")));
  const cwd = options.cwd ?? home;
  const output = capture();
  const opened: string[] = [];
  let session: RunningSession | undefined;

  const startOptions: StartCliOptions = {
    home,
    cwd,
    stdout: (text) => output.stdout.push(text),
    stderr: (text) => output.stderr.push(text),
    openBrowser:
      options.openBrowser ??
      (async (url) => {
        opened.push(url);
      }),
    onStarted: (value) => {
      session = value;
    },
    waitForStop: options.waitForStop ?? (async () => undefined),
    ...(options.waitForShutdown === undefined ? {} : { waitForShutdown: options.waitForShutdown }),
  };

  const code = await runStart(args, startOptions);
  return {
    code,
    stdout: output.stdout.join(""),
    stderr: output.stderr.join(""),
    session,
    opened,
  };
}

async function stop(session: RunningSession | undefined): Promise<void> {
  if (session !== undefined) {
    await session.stop();
  }
}

function errorCode(error: unknown): string {
  return (error as IbejiError).code;
}

function baseArgs(): readonly string[] {
  return ["--port", "0", "--twin-port", "paystack=0", "--no-open"];
}

describe("T10 CLI start", () => {
  it("T10: starts chosen twins and prints JSON with only the running twins", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-start-cwd-"));
    let result: StartResult | undefined;
    try {
      await writeFile(
        join(cwd, "ibeji.config.json"),
        JSON.stringify({
          webhookUrls: {
            paystack: "http://127.0.0.1:1/a",
            flutterwave: "http://127.0.0.1:1/b",
          },
        }),
        "utf8",
      );
      result = await runStartTest(["--twins", "paystack", "--seed", "7", "--json", ...baseArgs()], {
        home,
        cwd,
      });
      expect(result.code).toBe(0);
      const body = JSON.parse(result.stdout) as {
        seed: number;
        addresses: { twins: Record<string, unknown> };
        credentials: Record<string, unknown>;
        webhookUrls: Record<string, unknown>;
        launchLink: string;
      };
      expect(body.seed).toBe(7);
      expect(Object.keys(body.addresses.twins)).toEqual(["paystack"]);
      expect(Object.keys(body.credentials)).toEqual(["paystack"]);
      expect(Object.keys(body.webhookUrls)).toEqual(["paystack"]);
      expect(body.launchLink).toContain("/_ibeji/?launch=");
      expect(result.opened).toEqual([]);
    } finally {
      await stop(result?.session);
      await rm(home, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("T10: loads config, prints the human block and opens the dashboard", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-start-cwd-"));
    let result: StartResult | undefined;
    try {
      await writeFile(
        join(cwd, "ibeji.config.json"),
        JSON.stringify({
          twins: ["paystack"],
          seed: 11,
          open: true,
          webhookUrls: { paystack: "http://127.0.0.1:1/hook" },
        }),
        "utf8",
      );
      result = await runStartTest(["--port", "0", "--twin-port", "paystack=0"], {
        home,
        cwd,
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Ibeji is running.");
      expect(result.stdout).toContain("Paystack");
      expect(result.stdout).toContain("Base URL:");
      expect(result.stdout).toContain("Webhook URL: http://127.0.0.1:1/hook");
      expect(result.stdout).toContain("Seed: 11");
      expect(result.stdout).toContain("Dashboard link:");
      expect(result.stdout).toContain("ibeji open");
      expect(result.stdout).toContain("Stop with: Control and C");
      expect(result.opened).toHaveLength(1);
      expect(result.opened[0]).toContain("/_ibeji/?launch=");
    } finally {
      await stop(result?.session);
      await rm(home, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("T10: a browser failure does not fail start", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    let result: StartResult | undefined;
    try {
      result = await runStartTest(
        ["--twins", "paystack", ...baseArgs().filter((arg) => arg !== "--no-open")],
        {
          home,
          openBrowser: async () => {
            throw new Error("no browser");
          },
        },
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("The browser could not be opened.");
    } finally {
      await stop(result?.session);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: warns about public webhooks and notes a stale session", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    let result: StartResult | undefined;
    try {
      await mkdir(join(home, ".ibeji"), { recursive: true, mode: 0o700 });
      await writeFile(sessionPath(home), "{bad", { mode: 0o600 });
      result = await runStartTest(
        ["--twins", "paystack", "--allow-public-webhooks", ...baseArgs()],
        { home },
      );
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("Warning: public webhook addresses are allowed.");
      expect(result.stderr).toContain("Removed an invalid session file.");
    } finally {
      await stop(result?.session);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: runCli dispatches start and returns when shutdown is not awaited", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    let session: RunningSession | undefined;
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const code = await runCli(
        [
          "start",
          "--twins",
          "paystack",
          "--json",
          "--port",
          "0",
          "--twin-port",
          "paystack=0",
          "--no-open",
        ],
        {
          home,
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
          openBrowser: async () => undefined,
          waitForShutdown: false,
          onStarted: (value) => {
            session = value;
          },
        },
      );
      expect(code).toBe(0);
      expect(stdout.join("")).toContain('"ok":true');
      expect(stderr.join("")).toBe("");
      expect(session).toBeDefined();
    } finally {
      await stop(session);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: waitForShutdown false returns without waiting", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    let result: StartResult | undefined;
    try {
      result = await runStartTest(["--twins", "paystack", "--json", ...baseArgs()], {
        home,
        waitForShutdown: false,
      });
      expect(result.code).toBe(0);
      expect(result.session).toBeDefined();
    } finally {
      await stop(result?.session);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: start validates every flag before creating a session", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-start-"));
    try {
      await writeFile(join(home, "bad-config.json"), "{bad json", "utf8");
      const cases: readonly (readonly string[])[] = [
        ["--twins", "unknown"],
        ["--twins", ""],
        ["--port", "99999"],
        ["--seed", "4294967296"],
        ["--twin-port", "paystack"],
        ["--twin-port", "unknown=1234"],
        ["--twin-port", "paystack=1", "--twin-port", "paystack=2"],
        ["--scenario", "not-a-scenario"],
        ["--config", "missing-config.json"],
        ["--config", "bad-config.json"],
      ];

      for (const args of cases) {
        try {
          await runStartTest(args, { home });
          throw new Error(`the invalid start was accepted: ${args.join(" ")}`);
        } catch (error) {
          expect(["CONFIG_INVALID", "BAD_REQUEST"]).toContain(errorCode(error));
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
