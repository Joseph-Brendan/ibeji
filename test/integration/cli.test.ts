import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { type RunCliOptions, runCli } from "../../src/cli/run.js";
import { credentialsPath, sessionPath } from "../../src/control/paths.js";
import { loadScenarios } from "../../src/core/scenarios/loader.js";
import { type ControlSessionHarness, startControlSession } from "../helpers/control.js";

type Capture = {
  readonly stdout: string[];
  readonly stderr: string[];
};

type RunResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

const ROOT = process.cwd();
const CLI = join(ROOT, "dist", "cli.js");

function capture(): Capture {
  return { stdout: [], stderr: [] };
}

async function run(
  argv: readonly string[],
  home: string,
  options: Partial<RunCliOptions> = {},
): Promise<RunResult> {
  const output = capture();
  const code = await runCli(argv, {
    home,
    cwd: options.cwd ?? ROOT,
    stdout: (text) => output.stdout.push(text),
    stderr: (text) => output.stderr.push(text),
    openBrowser: options.openBrowser ?? (async () => undefined),
    ...(options.followSignal === undefined ? {} : { followSignal: options.followSignal }),
    ...(options.waitForShutdown === undefined ? {} : { waitForShutdown: options.waitForShutdown }),
    ...(options.confirmReset === undefined ? {} : { confirmReset: options.confirmReset }),
  });
  return {
    code,
    stdout: output.stdout.join(""),
    stderr: output.stderr.join(""),
  };
}

function json<T>(text: string): T {
  return JSON.parse(text) as T;
}

function errorCode(text: string): string {
  return json<{ error: { code: string } }>(text).error.code;
}

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ibeji-cli-"));
}

function childEnv(home: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home, USERPROFILE: home };
}

function runProcess(args: readonly string[], home: string, cwd = ROOT): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: childEnv(home),
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

type ChildOutput = {
  stdout: string;
  stderr: string;
};

type Waitable = ChildOutput & {
  waitFor: (predicate: (output: ChildOutput) => boolean, timeoutMs?: number) => Promise<void>;
};

function watchChild(child: ReturnType<typeof spawn>): Waitable {
  const output: ChildOutput = { stdout: "", stderr: "" };
  const waiters: {
    readonly predicate: (value: ChildOutput) => boolean;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
  }[] = [];

  const check = (): void => {
    for (const waiter of [...waiters]) {
      if (waiter.predicate(output)) {
        clearTimeout(waiter.timer);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  child.stdout?.on("data", (chunk: Buffer | string) => {
    output.stdout += String(chunk);
    check();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    output.stderr += String(chunk);
    check();
  });

  return {
    get stdout() {
      return output.stdout;
    },
    get stderr() {
      return output.stderr;
    },
    waitFor(predicate, timeoutMs = 10_000) {
      if (predicate(output)) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(
            new Error(
              `Timed out waiting for the CLI.\nSTDOUT:\n${output.stdout}\nSTDERR:\n${output.stderr}`,
            ),
          );
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
  };
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out waiting for the CLI process to exit."));
    }, 10_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

async function stopStartedCli(child: ReturnType<typeof spawn>, home: string): Promise<void> {
  if (process.platform === "win32") {
    // Windows cannot deliver SIGINT or SIGTERM to another process. Killing is
    // forceful, so the session file is cleaned by the documented stale-session
    // path when the next CLI command looks at it.
    child.kill();
    const exitCode = await waitForExit(child);
    if (exitCode === 0) {
      return;
    }
    const stale = await run(["status", "--json"], home);
    expect(errorCode(stale.stdout)).toBe("SESSION_STALE");
    return;
  }

  child.kill("SIGTERM");
  expect(await waitForExit(child)).toBe(0);
}

async function waitForDashboard(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  expect(response.status).toBe(200);
  return response.text();
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for the CLI test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withSession(
  runTest: (harness: ControlSessionHarness) => Promise<void>,
): Promise<void> {
  const scenarios = await loadScenarios("scenarios");
  const harness = await startControlSession({ scenarios });
  try {
    await runTest(harness);
  } finally {
    await harness.cleanup();
  }
}

describe("T10 CLI help and usage", () => {
  it("T10: every command has help with a real example and lines within 80 characters", async () => {
    const home = await tempHome();
    try {
      const cases: readonly (readonly string[])[] = [
        [],
        ["--help"],
        ["start", "--help"],
        ["open", "--help"],
        ["status", "--help"],
        ["fail", "--help"],
        ["fail", "slow-response", "--help"],
        ["fail", "timeout-after-commit", "--help"],
        ["fail", "server-error", "--help"],
        ["fail", "not-a-failure", "--help"],
        ["not-a-command", "--help"],
        ["clear", "--help"],
        ["scenario", "--help"],
        ["scenario", "list", "--help"],
        ["scenario", "run", "--help"],
        ["scenario", "stop", "--help"],
        ["webhook-url", "--help"],
        ["keys", "--help"],
        ["events", "--help"],
        ["resend", "--help"],
        ["reset", "--help"],
        ["export", "--help"],
        ["mcp", "--help"],
        ["doctor", "--help"],
      ];

      for (const argv of cases) {
        const result = await run(argv, home);
        expect(result.code, argv.join(" ")).toBe(0);
        expect(result.stdout).toContain("Example:");
        for (const line of result.stdout.split("\n")) {
          expect(line.length, `${argv.join(" ")}: ${line}`).toBeLessThanOrEqual(80);
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: bad usage exits 2 and unknown failures exit 1", async () => {
    const home = await tempHome();
    try {
      const unknownCommand = await run(["not-a-command"], home);
      expect(unknownCommand.code).toBe(2);
      expect(unknownCommand.stderr).toContain("What happened:");

      const unknownFlag = await run(["status", "--not-a-flag"], home);
      expect(unknownFlag.code).toBe(2);
      expect(unknownFlag.stderr).toContain("--not-a-flag");

      const unknownFailure = await run(["fail", "not-a-failure"], home);
      expect(unknownFailure.code).toBe(1);
      expect(unknownFailure.stderr).toContain("not-a-failure");

      const missingExport = await run(["export"], home);
      expect(missingExport.code).toBe(2);

      const version = await run(["--version"], home);
      expect(version.code).toBe(0);
      expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/u);

      const doctorExtra = await run(["doctor", "extra"], home);
      expect(doctorExtra.code).toBe(2);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: no session and a stale session are explained and cleaned up", async () => {
    const home = await tempHome();
    try {
      const missing = await run(["status", "--json"], home);
      expect(missing.code).toBe(1);
      expect(errorCode(missing.stdout)).toBe("SESSION_NOT_RUNNING");
      expect(json<{ error: { fix: string } }>(missing.stdout).error.fix).toContain(
        "Run: ibeji start",
      );

      await mkdir(join(home, ".ibeji"), { recursive: true, mode: 0o700 });
      await writeFile(sessionPath(home), "{not json", { mode: 0o600 });
      const invalid = await run(["status", "--json"], home);
      expect(invalid.code).toBe(1);
      expect(errorCode(invalid.stdout)).toBe("SESSION_STALE");
      expect(existsSync(sessionPath(home))).toBe(false);

      await writeFile(
        sessionPath(home),
        JSON.stringify({
          instanceId: "old",
          processId: 999_999_999,
          ports: { control: 1, twins: {} },
          token: "token",
          startTime: new Date(0).toISOString(),
          version: "0.0.0",
        }),
        { mode: 0o600 },
      );
      const stale = await run(["status", "--json"], home);
      expect(stale.code).toBe(1);
      expect(errorCode(stale.stdout)).toBe("SESSION_STALE");
      expect(existsSync(sessionPath(home))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: keys works without a session and rotates credentials", async () => {
    const home = await tempHome();
    try {
      const first = await run(["keys", "--json"], home);
      expect(first.code).toBe(0);
      const firstBody = json<{
        twins: {
          id: string;
          displayName: string;
          credentials: { id: string; label: string; value: string }[];
        }[];
      }>(first.stdout);
      expect(firstBody.twins.map((twin) => twin.id).sort()).toEqual(["flutterwave", "paystack"]);
      const before = firstBody.twins
        .find((twin) => twin.id === "paystack")
        ?.credentials.find((credential) => credential.id === "secret")?.value;
      expect(before).toBeDefined();

      const rotated = await run(["keys", "paystack", "--rotate", "--json"], home);
      expect(rotated.code).toBe(0);
      const rotatedBody = json<{
        twins: { credentials: { id: string; value: string }[] }[];
      }>(rotated.stdout);
      const after = rotatedBody.twins[0]?.credentials.find(
        (credential) => credential.id === "secret",
      )?.value;
      expect(after).toBeDefined();
      expect(after).not.toBe(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("T10 CLI commands against a running session", () => {
  it("T10: status, open, fail, clear, scenarios, webhooks, events, resend and reset", async () => {
    await withSession(async (harness) => {
      const status = await run(["status", "--json"], harness.home);
      expect(status.code).toBe(0);
      const statusBody = json<{ twins: { running: boolean }[]; rules: unknown[] }>(status.stdout);
      expect(statusBody.twins).toHaveLength(2);
      expect(statusBody.twins.every((twin) => twin.running)).toBe(true);

      const unauthorisedLaunch = await fetch(
        `${harness.session.addresses.control.url}/_ibeji/api/v1/auth/launch`,
        { method: "POST" },
      );
      expect(unauthorisedLaunch.status).toBe(401);

      const opened: string[] = [];
      const open = await run(["open", "--json"], harness.home, {
        openBrowser: async (url) => {
          opened.push(url);
        },
      });
      expect(open.code).toBe(0);
      expect(json<{ url: string }>(open.stdout).url).toContain("/_ibeji/?launch=");
      expect(opened).toHaveLength(1);

      const failed = await run(
        ["fail", "slow-response", "--seconds", "9", "--twin", "paystack", "--json"],
        harness.home,
      );
      expect(failed.code).toBe(0);
      expect(
        json<{ rule: { settings: { seconds: number } } }>(failed.stdout).rule.settings,
      ).toEqual({
        seconds: 9,
      });

      const unsupported = await run(
        ["fail", "transfer-reversed", "--twin", "flutterwave", "--json"],
        harness.home,
      );
      expect(unsupported.code).toBe(1);
      expect(errorCode(unsupported.stdout)).toBe("FAILURE_NOT_SUPPORTED_BY_TWIN");
      expect(unsupported.stdout).toContain("Paystack");

      const invalid = await run(
        ["fail", "server-error", "--times", "0", "--status", "999", "--twin", "paystack", "--json"],
        harness.home,
      );
      expect(invalid.code).toBe(1);
      expect(errorCode(invalid.stdout)).toBe("INVALID_RULE");
      expect(invalid.stdout).toContain("times");
      expect(invalid.stdout).toContain("status");

      const unsupportedAndInvalid = await run(
        ["fail", "transfer-reversed", "--afterSeconds", "0", "--twin", "flutterwave", "--json"],
        harness.home,
      );
      expect(unsupportedAndInvalid.code).toBe(1);
      expect(errorCode(unsupportedAndInvalid.stdout)).toBe("INVALID_RULE");
      expect(unsupportedAndInvalid.stdout).toContain("Paystack");

      const events = await run(["events", "--json"], harness.home);
      expect(events.code).toBe(0);
      expect(
        json<{ events: { type: string }[] }>(events.stdout).events.some(
          (event) => event.type === "rule-added",
        ),
      ).toBe(true);

      const unlimited = await run(
        ["fail", "server-error", "--times", "--twin", "paystack", "--json"],
        harness.home,
      );
      expect(unlimited.code).toBe(0);
      expect(
        json<{ rule: { settings: { times: number | null } } }>(unlimited.stdout).rule.settings
          .times,
      ).toBeNull();

      const cleared = await run(["clear", "slow-response", "--json"], harness.home);
      expect(cleared.code).toBe(0);
      expect(json<{ removed: number }>(cleared.stdout).removed).toBe(1);

      const scenarioList = await run(["scenario", "list", "--json"], harness.home);
      expect(scenarioList.code).toBe(0);
      expect(json<{ scenarios: unknown[] }>(scenarioList.stdout).scenarios.length).toBeGreaterThan(
        0,
      );

      const scenarioRun = await run(
        ["scenario", "run", "kola-case", "--twin", "paystack", "--json"],
        harness.home,
      );
      expect(scenarioRun.code).toBe(0);
      const scenarioStatus = await run(["status", "--json"], harness.home);
      expect(json<{ scenario: string | null }>(scenarioStatus.stdout).scenario).toBe("kola-case");

      const scenarioStop = await run(["scenario", "stop", "--json"], harness.home);
      expect(scenarioStop.code).toBe(0);

      const webhookSet = await run(
        ["webhook-url", "paystack", "http://127.0.0.1:1/webhook", "--json"],
        harness.home,
      );
      expect(webhookSet.code).toBe(0);
      expect(json<{ url: string | null }>(webhookSet.stdout).url).toBe(
        "http://127.0.0.1:1/webhook",
      );
      const webhookGet = await run(["webhook-url", "paystack", "--json"], harness.home);
      expect(json<{ url: string | null }>(webhookGet.stdout).url).toBe(
        "http://127.0.0.1:1/webhook",
      );
      const webhookClear = await run(
        ["webhook-url", "paystack", "--clear", "--json"],
        harness.home,
      );
      expect(json<{ url: string | null }>(webhookClear.stdout).url).toBeNull();

      const [delivery] = harness.session.dispatcher.enqueue({
        eventId: "evt-cli-resend",
        twinId: "paystack",
        actionId: "refund.create",
        raw: { body: "{}", contentType: "application/json" },
        plan: {
          send: false,
          notSentReason: "webhook-never-sent",
          deliveries: [],
          firedSteps: [],
          firedRules: [],
        },
      });
      const deliveryId = delivery?.id;
      expect(deliveryId).toBeDefined();
      if (deliveryId === undefined) {
        throw new Error("the test delivery was not created");
      }
      const resent = await run(["resend", deliveryId, "--json"], harness.home);
      expect(resent.code).toBe(0);

      const resetNeedsYes = await run(["reset", "--twin", "paystack", "--json"], harness.home);
      expect(resetNeedsYes.code).toBe(2);

      const resetCancelled = await run(["reset", "--twin", "paystack"], harness.home, {
        confirmReset: async () => false,
      });
      expect(resetCancelled.code).toBe(0);
      expect(resetCancelled.stdout).toContain("Nothing was changed.");

      const resetConfirmed = await run(["reset", "--twin", "paystack"], harness.home, {
        confirmReset: async () => true,
      });
      expect(resetConfirmed.code).toBe(0);
      expect(resetConfirmed.stdout).toContain("Reset Paystack records.");

      const reset = await run(["reset", "--twin", "paystack", "--yes", "--json"], harness.home);
      expect(reset.code).toBe(0);

      const exportFile = join(harness.home, "session-export.json");
      const exported = await run(["export", exportFile, "--json"], harness.home);
      expect(exported.code).toBe(0);
      const exportedText = await readFile(exportFile, "utf8");
      expect(exportedText).not.toContain(harness.session.token);
      if (process.platform !== "win32") {
        const details = await stat(exportFile);
        expect(details.mode & 0o777).toBe(0o600);
      }

      const mcp = await run(["mcp", "--help"], harness.home);
      expect(mcp.code).toBe(0);
      expect(mcp.stdout).toContain("Runs the MCP server over stdio");

      const doctor = await run(["doctor", "--json"], harness.home);
      expect(doctor.code).toBe(0);
      expect(json<{ ok: boolean }>(doctor.stdout).ok).toBe(true);
    });
  });

  it("T10: command error branches and human output", async () => {
    await withSession(async (harness) => {
      const humanStatus = await run(["status"], harness.home);
      expect(humanStatus.code).toBe(0);
      expect(humanStatus.stdout).toContain("Ibeji is running.");

      const humanOpen = await run(["open", "--no-open"], harness.home);
      expect(humanOpen.code).toBe(0);
      expect(humanOpen.stdout).toContain("Dashboard:");

      const openFailure = await run(["open"], harness.home, {
        openBrowser: async () => {
          throw new Error("no browser");
        },
      });
      expect(openFailure.code).toBe(0);
      expect(openFailure.stderr).toContain("The browser could not be opened.");

      const missingFailure = await run(["fail"], harness.home);
      expect(missingFailure.code).toBe(2);
      const extraFailureArg = await run(
        ["fail", "slow-response", "--seconds", "1", "extra", "--twin", "paystack"],
        harness.home,
      );
      expect(extraFailureArg.code).toBe(2);
      const unknownTwin = await run(["fail", "slow-response", "--twin", "unknown"], harness.home);
      expect(unknownTwin.code).toBe(1);
      expect(unknownTwin.stderr).toContain("unknown");
      const emptyOn = await run(
        ["fail", "slow-response", "--on", "", "--twin", "paystack"],
        harness.home,
      );
      expect(emptyOn.code).toBe(2);
      const noSupport = await run(
        ["fail", "authentication-required", "--twin", "paystack", "--json"],
        harness.home,
      );
      expect(noSupport.code).toBe(1);
      expect(errorCode(noSupport.stdout)).toBe("FAILURE_NOT_SUPPORTED_BY_TWIN");

      const humanFail = await run(["fail", "slow-response", "--twin", "paystack"], harness.home);
      expect(humanFail.code).toBe(0);
      expect(humanFail.stdout).toContain("Added the Slow response failure.");

      const clearUnknown = await run(["clear", "not-a-failure"], harness.home);
      expect(clearUnknown.code).toBe(1);
      expect(clearUnknown.stderr).toContain("not-a-failure");
      const clearExtra = await run(["clear", "slow-response", "extra"], harness.home);
      expect(clearExtra.code).toBe(2);
      const clearUnknownTwin = await run(["clear", "--twin", "unknown"], harness.home);
      expect(clearUnknownTwin.code).toBe(1);
      const clearHuman = await run(["clear", "--twin", "paystack"], harness.home);
      expect(clearHuman.code).toBe(0);
      expect(clearHuman.stdout).toContain("Removed");

      const missingScenario = await run(["scenario"], harness.home);
      expect(missingScenario.code).toBe(2);
      const unknownScenarioCommand = await run(["scenario", "nope"], harness.home);
      expect(unknownScenarioCommand.code).toBe(2);
      const missingScenarioId = await run(["scenario", "run"], harness.home);
      expect(missingScenarioId.code).toBe(2);
      const unknownScenario = await run(["scenario", "run", "nope"], harness.home);
      expect(unknownScenario.code).toBe(1);
      expect(unknownScenario.stderr).toContain("nope");
      const unknownScenarioTwin = await run(
        ["scenario", "run", "kola-case", "--twin", "unknown"],
        harness.home,
      );
      expect(unknownScenarioTwin.code).toBe(1);
      const listHuman = await run(["scenario", "list"], harness.home);
      expect(listHuman.code).toBe(0);
      expect(listHuman.stdout).toContain("Slow Friday");
      const stopHuman = await run(["scenario", "stop"], harness.home);
      expect(stopHuman.code).toBe(0);
      expect(stopHuman.stdout).toContain("No scenario was running.");

      const noWebhookArgs = await run(["webhook-url"], harness.home);
      expect(noWebhookArgs.code).toBe(2);
      const manyWebhookArgs = await run(
        ["webhook-url", "paystack", "http://127.0.0.1:1/a", "extra"],
        harness.home,
      );
      expect(manyWebhookArgs.code).toBe(2);
      const webhookConflict = await run(
        ["webhook-url", "paystack", "http://127.0.0.1:1/a", "--clear"],
        harness.home,
      );
      expect(webhookConflict.code).toBe(2);
      const webhookUnknown = await run(
        ["webhook-url", "unknown", "http://127.0.0.1:1/a"],
        harness.home,
      );
      expect(webhookUnknown.code).toBe(1);
      const webhookHuman = await run(
        ["webhook-url", "paystack", "http://127.0.0.1:1/hook"],
        harness.home,
      );
      expect(webhookHuman.code).toBe(0);
      expect(webhookHuman.stdout).toContain("Paystack webhook URL:");
      const webhookGetHuman = await run(["webhook-url", "paystack"], harness.home);
      expect(webhookGetHuman.code).toBe(0);
      const webhookClearHuman = await run(["webhook-url", "paystack", "--clear"], harness.home);
      expect(webhookClearHuman.code).toBe(0);

      const keysUnknown = await run(["keys", "unknown"], harness.home);
      expect(keysUnknown.code).toBe(1);
      const keysExtra = await run(["keys", "paystack", "extra"], harness.home);
      expect(keysExtra.code).toBe(2);
      const keysHuman = await run(["keys"], harness.home);
      expect(keysHuman.code).toBe(0);
      expect(keysHuman.stdout).toContain("Paystack credentials");
      const keysRotateAll = await run(["keys", "--rotate"], harness.home);
      expect(keysRotateAll.code).toBe(0);

      const eventsUnknown = await run(["events", "--twin", "unknown"], harness.home);
      expect(eventsUnknown.code).toBe(1);
      const eventsHuman = await run(["events", "--twin", "paystack"], harness.home);
      expect(eventsHuman.code).toBe(0);
      const aborted = new AbortController();
      aborted.abort();
      const followAborted = await run(["events", "--follow"], harness.home, {
        followSignal: aborted.signal,
      });
      expect(followAborted.code).toBe(0);

      const resendMissing = await run(["resend"], harness.home);
      expect(resendMissing.code).toBe(2);
      const resendUnknown = await run(["resend", "no-such-delivery"], harness.home);
      expect(resendUnknown.code).toBe(1);

      const [delivery] = harness.session.dispatcher.enqueue({
        eventId: "evt-cli-human",
        twinId: "paystack",
        actionId: "refund.create",
        raw: { body: "{}", contentType: "application/json" },
        plan: {
          send: false,
          notSentReason: "webhook-never-sent",
          deliveries: [],
          firedSteps: [],
          firedRules: [],
        },
      });
      const deliveryId = delivery?.id;
      if (deliveryId === undefined) {
        throw new Error("the test delivery was not created");
      }
      const resendHuman = await run(["resend", deliveryId], harness.home);
      expect(resendHuman.code).toBe(0);
      expect(resendHuman.stdout).toContain("Resent webhook delivery");

      const resetAll = await run(["reset", "--yes"], harness.home);
      expect(resetAll.code).toBe(0);
      expect(resetAll.stdout).toContain("Reset all twin records.");

      const exportHuman = await run(
        ["export", join(harness.home, "human-export.json")],
        harness.home,
      );
      expect(exportHuman.code).toBe(0);
      expect(exportHuman.stdout).toContain("Saved the session to");
      const exportFailure = await run(
        ["export", join(harness.home, "missing", "export.json")],
        harness.home,
      );
      expect(exportFailure.code).toBe(1);

      const mcpHelp = await run(["mcp", "--help"], harness.home);
      expect(mcpHelp.code).toBe(0);
      expect(mcpHelp.stdout).toContain("Only MCP messages go to standard output");

      const mcpJson = await run(["mcp", "--json"], harness.home);
      expect(mcpJson.code).toBe(2);
      expect(mcpJson.stdout).toContain("unknown options");

      const doctorHuman = await run(["doctor"], harness.home);
      expect(doctorHuman.code).toBe(0);
      expect(doctorHuman.stdout).toContain("All checks passed.");
    });
  });

  it("T10: events --follow prints new events and stops when aborted", async () => {
    await withSession(async (harness) => {
      const controller = new AbortController();
      const output = capture();
      let resolveSeen: (() => void) | undefined;
      const seen = new Promise<void>((resolve) => {
        resolveSeen = resolve;
      });
      const follow = runCli(["events", "--follow", "--json"], {
        home: harness.home,
        stdout: (text) => {
          output.stdout.push(text);
          if (output.stdout.join("").includes('"type":"rule-added"')) {
            resolveSeen?.();
          }
        },
        stderr: (text) => output.stderr.push(text),
        openBrowser: async () => undefined,
        followSignal: controller.signal,
      });

      await waitForCondition(() => harness.session.events.subscriberCount === 1);
      const added = await run(
        ["fail", "slow-response", "--seconds", "2", "--twin", "paystack"],
        harness.home,
      );
      expect(added.code).toBe(0);
      await Promise.race([
        seen,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("The follow output did not arrive.")), 2_000),
        ),
      ]);
      controller.abort();
      expect(await follow).toBe(0);
      expect(output.stdout.join("")).toContain('"type":"rule-added"');
    });
  });

  it("T10: fail rejects a twin that is not running", async () => {
    const scenarios = await loadScenarios("scenarios");
    const harness = await startControlSession({ twins: ["paystack"], scenarios });
    try {
      const result = await run(
        ["fail", "slow-response", "--twin", "flutterwave", "--json"],
        harness.home,
      );
      expect(result.code).toBe(1);
      expect(errorCode(result.stdout)).toBe("TWIN_NOT_RUNNING");

      const scenarioStopped = await run(
        ["scenario", "run", "kola-case", "--twin", "flutterwave", "--json"],
        harness.home,
      );
      expect(scenarioStopped.code).toBe(1);
      expect(errorCode(scenarioStopped.stdout)).toBe("TWIN_NOT_RUNNING");
    } finally {
      await harness.cleanup();
    }
  });

  it("T10: doctor reports credentials permissions and an unanswered webhook URL", async () => {
    const scenarios = await loadScenarios("scenarios");
    const harness = await startControlSession({ twins: ["paystack"], scenarios });
    try {
      await run(["webhook-url", "paystack", "http://127.0.0.1:1/hook"], harness.home);
      if (process.platform !== "win32") {
        const { chmod } = await import("node:fs/promises");
        await chmod(credentialsPath(harness.home), 0o644);
      }
      const result = await run(["doctor", "--json"], harness.home);
      expect(result.code).toBe(1);
      const body = json<{
        checks: { name: string; problems: { what: string }[] }[];
      }>(result.stdout);
      const credentials = body.checks.find(
        (check) => check.name === "Credentials file permissions",
      );
      const webhooks = body.checks.find((check) => check.name === "Webhook URLs");
      if (process.platform !== "win32") {
        expect(credentials?.problems.length).toBeGreaterThan(0);
      }
      expect(webhooks?.problems.length).toBeGreaterThan(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("T10: doctor reports an invalid config and a stale session file", async () => {
    const home = await tempHome();
    const cwd = await tempHome();
    try {
      await writeFile(
        join(cwd, "ibeji.config.json"),
        JSON.stringify({ twins: ["unknown"] }),
        "utf8",
      );
      await mkdir(join(home, ".ibeji"), { recursive: true, mode: 0o700 });
      await writeFile(sessionPath(home), "{bad", { mode: 0o600 });
      const result = await run(["doctor", "--config", "ibeji.config.json", "--json"], home, {
        cwd,
      });
      expect(result.code).toBe(1);
      const body = json<{
        checks: { name: string; problems: { code: string }[] }[];
      }>(result.stdout);
      expect(body.checks.find((check) => check.name === "Configuration")?.problems[0]?.code).toBe(
        "CONFIG_INVALID",
      );
      expect(body.checks.find((check) => check.name === "Session file")?.problems[0]?.code).toBe(
        "SESSION_STALE",
      );
      expect(existsSync(sessionPath(home))).toBe(false);

      await writeFile(
        sessionPath(home),
        JSON.stringify({
          instanceId: "dead",
          processId: process.pid,
          ports: { control: 1, twins: {} },
          token: "token",
          startTime: new Date(0).toISOString(),
          version: "0.0.0",
        }),
        { mode: 0o600 },
      );
      const dead = await run(["doctor", "--json"], home);
      expect(dead.code).toBe(1);
      expect(
        json<{ checks: { name: string; problems: { code: string }[] }[] }>(dead.stdout).checks.find(
          (check) => check.name === "Session file",
        )?.problems[0]?.code,
      ).toBe("SESSION_STALE");
      expect(existsSync(sessionPath(home))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("T10: doctor accepts a webhook URL that answers", async () => {
    const receiver = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const address = receiver.address();
    if (address === null || typeof address === "string") {
      throw new Error("the webhook receiver did not bind");
    }

    const scenarios = await loadScenarios("scenarios");
    const harness = await startControlSession({ scenarios });
    try {
      await run(["webhook-url", "paystack", `http://127.0.0.1:${address.port}/hook`], harness.home);
      const result = await run(["doctor", "--json"], harness.home);
      expect(result.code).toBe(0);
      expect(json<{ ok: boolean }>(result.stdout).ok).toBe(true);
    } finally {
      await harness.cleanup();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });

  it("T10: a failed follow stream reports an internal error", async () => {
    const home = await tempHome();
    const server = createHttpServer((request, response) => {
      if (request.url === "/_ibeji/api/v1/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, instance: "fake" }));
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { code: "INTERNAL", what: "No stream.", why: "Test.", fix: "Retry." },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the fake control server did not bind");
    }
    try {
      await mkdir(join(home, ".ibeji"), { recursive: true, mode: 0o700 });
      await writeFile(
        sessionPath(home),
        JSON.stringify({
          instanceId: "fake",
          processId: process.pid,
          ports: { control: address.port, twins: {} },
          token: "token",
          startTime: new Date(0).toISOString(),
          version: "0.0.0",
        }),
        { mode: 0o600 },
      );
      const result = await run(["events", "--follow", "--json"], home);
      expect(result.code).toBe(1);
      expect(errorCode(result.stdout)).toBe("INTERNAL");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: doctor reports a port in use", async () => {
    const home = await tempHome();
    const cwd = await tempHome();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the test server did not bind");
    }
    try {
      await writeFile(
        join(cwd, "ibeji.config.json"),
        JSON.stringify({
          ports: { control: address.port },
          webhookUrls: {
            paystack: "http://127.0.0.1:1/hook",
            flutterwave: "http://10.0.0.1/hook",
          },
        }),
        "utf8",
      );
      const result = await run(["doctor", "--config", "ibeji.config.json", "--json"], home, {
        cwd,
      });
      expect(result.code).toBe(1);
      const body = json<{
        ok: boolean;
        checks: { name: string; problems: { code: string; why: string }[] }[];
      }>(result.stdout);
      expect(body.ok).toBe(false);
      const ports = body.checks.find((check) => check.name === "Ports");
      expect(ports?.problems.some((problem) => problem.code === "PORT_IN_USE")).toBe(true);
      const webhooks = body.checks.find((check) => check.name === "Webhook URLs");
      expect(webhooks?.problems.length).toBe(2);

      const human = await run(["doctor", "--config", "ibeji.config.json"], home, { cwd });
      expect(human.code).toBe(1);
      expect(human.stdout).toContain("Doctor found");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("T10 real CLI child process", () => {
  it("T10: the built file has a shebang and bin points at it", async () => {
    const text = await readFile(CLI, "utf8");
    expect(text.split("\n")[0]).toBe("#!/usr/bin/env node");
    const packageJson = json<{ bin: { ibeji: string } }>(
      await readFile(join(ROOT, "package.json"), "utf8"),
    );
    expect(packageJson.bin.ibeji).toBe("./dist/cli.js");
  });

  it("T10: start --no-open prints each twin, serves the dashboard and cleans up on stop", async () => {
    const home = await tempHome();
    const child = spawn(
      process.execPath,
      [
        CLI,
        "start",
        "--no-open",
        "--allow-public-webhooks",
        "--scenario",
        "checkout-declines",
        "--port",
        "0",
        "--twin-port",
        "paystack=0",
        "--twin-port",
        "flutterwave=0",
      ],
      {
        cwd: ROOT,
        env: childEnv(home),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const output = watchChild(child);
    try {
      await output.waitFor((value) => value.stdout.includes("Stop with: Control and C"));
      expect(output.stdout).toContain("Paystack");
      expect(output.stdout).toContain("Flutterwave");
      expect(output.stdout).toContain("Base URL:");
      expect(output.stdout).toContain("Seed:");
      expect(output.stdout).toContain("Dashboard link:");
      expect(output.stdout).toContain("ibeji open");
      expect(output.stderr).toContain("Warning: public webhook addresses are allowed.");

      const dashboard =
        /Dashboard link:\n\s+(http:\/\/127\.0\.0\.1:\d+\/_ibeji\/\?launch=\S+)/u.exec(
          output.stdout,
        )?.[1];
      expect(dashboard).toBeDefined();
      if (dashboard === undefined) {
        throw new Error("the dashboard link was not printed");
      }
      const origin = new URL(dashboard).origin;
      const dashboardHtml = await waitForDashboard(origin);
      expect(dashboardHtml).toContain('<div id="root"></div>');

      const status = runProcess(["status", "--json"], home);
      expect(status.code).toBe(0);
      expect(json<{ scenario: string | null }>(status.stdout).scenario).toBe("checkout-declines");

      for (const line of output.stdout.split("\n")) {
        expect(line.length, line).toBeLessThanOrEqual(80);
      }

      await stopStartedCli(child, home);
      expect(existsSync(sessionPath(home))).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child);
      }
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T10: config is loaded, flags override it, and status, fail and clear run as real processes", async () => {
    const home = await tempHome();
    const cwd = await tempHome();
    await writeFile(
      join(cwd, "ibeji.config.json"),
      JSON.stringify({
        twins: ["paystack"],
        seed: 42,
        open: false,
      }),
      "utf8",
    );

    const child = spawn(
      process.execPath,
      [
        CLI,
        "start",
        "--twins",
        "flutterwave",
        "--twin-port",
        "flutterwave=0",
        "--port",
        "0",
        "--no-open",
        "--json",
      ],
      {
        cwd,
        env: childEnv(home),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const output = watchChild(child);
    try {
      await output.waitFor((value) => value.stdout.includes("\n"));
      const firstLine = output.stdout.split("\n")[0];
      expect(firstLine).toBeDefined();
      if (firstLine === undefined) {
        throw new Error("the start command printed no JSON");
      }
      const started = json<{
        seed: number;
        addresses: { twins: Record<string, unknown> };
      }>(firstLine);
      expect(started.seed).toBe(42);
      expect(Object.keys(started.addresses.twins)).toEqual(["flutterwave"]);

      const status = runProcess(["status", "--json"], home, cwd);
      expect(status.code).toBe(0);
      expect(
        json<{ twins: { id: string; running: boolean }[] }>(status.stdout)
          .twins.filter((twin) => twin.running)
          .map((twin) => twin.id),
      ).toEqual(["flutterwave"]);

      const failed = runProcess(
        ["fail", "slow-response", "--seconds", "7", "--twin", "flutterwave", "--json"],
        home,
        cwd,
      );
      expect(failed.code).toBe(0);
      expect(
        json<{ rule: { settings: { seconds: number } } }>(failed.stdout).rule.settings.seconds,
      ).toBe(7);

      const notRunning = runProcess(
        ["fail", "slow-response", "--twin", "paystack", "--json"],
        home,
        cwd,
      );
      expect(notRunning.code).toBe(1);
      expect(errorCode(notRunning.stdout)).toBe("TWIN_NOT_RUNNING");

      const cleared = runProcess(["clear", "--json"], home, cwd);
      expect(cleared.code).toBe(0);
      expect(json<{ removed: number }>(cleared.stdout).removed).toBe(1);

      await stopStartedCli(child, home);
      expect(existsSync(sessionPath(home))).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child);
      }
      await rm(home, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
