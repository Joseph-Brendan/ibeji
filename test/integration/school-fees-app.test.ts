import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RunningSession } from "../../src/control/session.js";
import type { WebhookDelivery } from "../../src/shared/control.js";
import { apiUrl, authHeaders, withControlSession } from "../helpers/control.js";

const ROOT = process.cwd();
const APP = join(ROOT, "examples", "school-fees-app", "server.js");
const TEST_TIMEOUT = 30_000;

type Provider = "paystack" | "flutterwave";
type Mode = "naive" | "safe";

type AppStudent = {
  readonly id: string;
  readonly name: string;
  readonly form: string;
  readonly fee: number;
  readonly paid: boolean;
  readonly payments: readonly {
    readonly provider: string;
    readonly reference: string;
    readonly status: string;
    readonly success: boolean;
    readonly receivedAt: string;
  }[];
};

type AppState = {
  readonly provider: string;
  readonly mode: string;
  readonly students: readonly AppStudent[];
};

type ExampleApp = {
  readonly url: string;
  readonly child: ChildProcess;
  stop: () => Promise<void>;
};

type ScenarioOptions = {
  readonly provider: Provider;
  readonly mode: Mode;
  readonly outcome: "success" | "failed";
  readonly failure?: {
    readonly id: string;
    readonly settings: Readonly<Record<string, unknown>>;
  };
};

type ScenarioResult = {
  readonly afterStart: AppState;
  readonly afterCheckout: AppState;
  readonly afterWebhook: AppState;
  readonly dispatched: readonly WebhookDelivery[];
};

const PROVIDERS: readonly Provider[] = ["paystack", "flutterwave"];

function providerEnv(
  session: RunningSession,
  provider: Provider,
): Readonly<Record<string, string>> {
  const address = session.addresses.twins[provider];
  const credentials = session.credentials[provider];
  if (address === undefined || credentials === undefined) {
    throw new Error(`the session has no ${provider} twin or credentials`);
  }

  if (provider === "paystack") {
    return {
      IBEJI_PAYSTACK_BASE_URL: address.url,
      IBEJI_PAYSTACK_PUBLIC_KEY: credentials.public ?? "",
      IBEJI_PAYSTACK_SECRET_KEY: credentials.secret ?? "",
    };
  }
  return {
    IBEJI_FLUTTERWAVE_BASE_URL: address.url,
    IBEJI_FLUTTERWAVE_PUBLIC_KEY: credentials.public ?? "",
    IBEJI_FLUTTERWAVE_SECRET_KEY: credentials.secret ?? "",
    IBEJI_FLUTTERWAVE_WEBHOOK_HASH: credentials.webhook ?? "",
  };
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function startExampleApp(
  session: RunningSession,
  provider: Provider,
  mode: Mode,
): Promise<ExampleApp> {
  const env = {
    ...process.env,
    PAYMENT_PROVIDER: provider,
    APP_MODE: mode,
    PORT: "0",
    ...providerEnv(session, provider),
  };
  const child = spawn(process.execPath, [APP], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];

  if (child.stdout === null || child.stderr === null) {
    child.kill();
    throw new Error("the example app did not expose its output streams");
  }
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr.push(chunk);
  });

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(
          new Error(`the example app did not start within 10 seconds. stderr: ${stderr.join("")}`),
        );
      });
    }, 10_000);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(() => {
        reject(
          new Error(
            `the example app exited during startup (code ${String(code)}, signal ${String(
              signal,
            )}). stderr: ${stderr.join("")}`,
          ),
        );
      });
    };
    child.once("exit", onExit);
    const check = (): void => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(stdout.join(""));
      if (match?.[1] !== undefined) {
        finish(() => resolve(`http://127.0.0.1:${match[1]}`));
      }
    };
    child.stdout.on("data", check);
    check();
  });

  return {
    url,
    child,
    stop: async () => {
      await waitForExit(child);
    },
  };
}

async function controlJson<T>(
  session: RunningSession,
  path: string,
  options: { readonly method?: "GET" | "POST" | "PUT"; readonly body?: unknown } = {},
): Promise<T> {
  const response = await fetch(apiUrl(session, path), {
    method: options.method ?? "GET",
    headers: {
      ...authHeaders(session),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`the control API answered HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function setWebhookUrl(
  session: RunningSession,
  provider: Provider,
  url: string,
): Promise<void> {
  await controlJson(session, `/twins/${provider}/webhook-url`, {
    method: "PUT",
    body: { url },
  });
}

async function addFailureRule(
  session: RunningSession,
  provider: Provider,
  failure: { readonly id: string; readonly settings: Readonly<Record<string, unknown>> },
): Promise<void> {
  await controlJson(session, "/rules", {
    method: "POST",
    body: {
      failureId: failure.id,
      twins: [provider],
      actions: "checkout.submit",
      settings: failure.settings,
    },
  });
}

async function appState(app: ExampleApp): Promise<AppState> {
  const response = await fetch(`${app.url}/state`);
  expect(response.status).toBe(200);
  return (await response.json()) as AppState;
}

function studentOf(state: AppState, id = "amina"): AppStudent {
  const student = state.students.find((item) => item.id === id);
  if (student === undefined) {
    throw new Error(`the app did not return student ${id}`);
  }
  return student;
}

async function startPayment(app: ExampleApp, studentId = "amina"): Promise<URL> {
  const response = await fetch(`${app.url}/pay/${encodeURIComponent(studentId)}`, {
    method: "POST",
    redirect: "manual",
  });
  if (response.status !== 303) {
    throw new Error(
      `starting the payment answered HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("the example app did not return a checkout link");
  }
  return new URL(location);
}

async function completeCheckout(
  checkout: URL,
  outcome: "success" | "failed",
): Promise<{ readonly status: number; readonly location: URL | undefined }> {
  const response = await fetch(checkout, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: checkout.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `outcome=${outcome}`,
  });
  await response.text();
  if (response.status !== 200 && response.status !== 303) {
    throw new Error(`the Ibeji checkout answered HTTP ${response.status}`);
  }
  const header = response.headers.get("location");
  return {
    status: response.status,
    location: header === null ? undefined : new URL(header),
  };
}

async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  let result: ScenarioResult | undefined;
  await withControlSession({}, async (harness) => {
    const { session } = harness;
    const app = await startExampleApp(session, options.provider, options.mode);
    try {
      const path = options.provider === "paystack" ? "/webhooks/paystack" : "/webhooks/flutterwave";
      await setWebhookUrl(session, options.provider, `${app.url}${path}`);
      if (options.failure !== undefined) {
        await addFailureRule(session, options.provider, options.failure);
      }

      const checkout = await startPayment(app);
      const afterStart = await appState(app);
      const completed = await completeCheckout(checkout, options.outcome);
      if (completed.location !== undefined) {
        const returned = await fetch(completed.location);
        expect(returned.status).toBe(200);
        await returned.text();
      }
      const afterCheckout = await appState(app);
      const dispatched = await session.dispatcher.dispatchDue();
      const afterWebhook = await appState(app);

      result = { afterStart, afterCheckout, afterWebhook, dispatched };
    } finally {
      await app.stop();
    }
  });

  if (result === undefined) {
    throw new Error("the example app scenario did not run");
  }
  return result;
}

describe("T8 school fees example app", () => {
  for (const provider of PROVIDERS) {
    it(
      `T8 example ${provider}: naive payment-declined leaves the student paid; safe mode does not`,
      async () => {
        const failure = { id: "payment-declined", settings: { percent: 100 } };
        const naive = await runScenario({
          provider,
          mode: "naive",
          outcome: "success",
          failure,
        });
        const safe = await runScenario({
          provider,
          mode: "safe",
          outcome: "success",
          failure,
        });

        expect(studentOf(naive.afterStart).paid).toBe(true);
        expect(studentOf(naive.afterCheckout).paid).toBe(true);
        expect(studentOf(naive.afterWebhook).paid).toBe(true);
        expect(studentOf(safe.afterStart).paid).toBe(false);
        expect(studentOf(safe.afterCheckout).paid).toBe(false);
        expect(studentOf(safe.afterWebhook).paid).toBe(false);
        expect(studentOf(safe.afterWebhook).payments).toHaveLength(0);
      },
      TEST_TIMEOUT,
    );

    it(
      `T8 example ${provider}: naive duplicate webhooks create two records; safe mode keeps one`,
      async () => {
        const failure = {
          id: "webhook-duplicated",
          settings: { copies: 2, gapSeconds: 0 },
        };
        const naive = await runScenario({
          provider,
          mode: "naive",
          outcome: "success",
          failure,
        });
        const safe = await runScenario({
          provider,
          mode: "safe",
          outcome: "success",
          failure,
        });

        expect(studentOf(naive.afterCheckout).paid).toBe(true);
        expect(studentOf(naive.afterWebhook).paid).toBe(true);
        expect(studentOf(naive.afterWebhook).payments).toHaveLength(2);
        expect(studentOf(safe.afterCheckout).paid).toBe(false);
        expect(studentOf(safe.afterWebhook).paid).toBe(true);
        expect(studentOf(safe.afterWebhook).payments).toHaveLength(1);
        expect(naive.dispatched.length).toBe(2);
        expect(safe.dispatched.length).toBe(2);
      },
      TEST_TIMEOUT,
    );

    it(
      `T8 example ${provider}: safe mode rejects a forged webhook`,
      async () => {
        const result = await runScenario({
          provider,
          mode: "safe",
          outcome: "success",
          failure: {
            id: "webhook-verification-fails",
            settings: { method: "wrong-secret" },
          },
        });

        expect(studentOf(result.afterCheckout).paid).toBe(false);
        expect(studentOf(result.afterWebhook).paid).toBe(false);
        expect(studentOf(result.afterWebhook).payments).toHaveLength(0);
        expect(result.dispatched).toHaveLength(1);
        expect(result.dispatched[0]?.attempts[0]?.responseStatus).toBe(401);
      },
      TEST_TIMEOUT,
    );
  }

  it("T8 school fees example app stops with a plain message for Stripe in 0.1.0", async () => {
    const child = spawn(process.execPath, [APP], {
      cwd: ROOT,
      env: {
        ...process.env,
        PAYMENT_PROVIDER: "stripe",
        APP_MODE: "safe",
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr: string[] = [];
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr.push(chunk);
    });
    await once(child, "exit");
    expect(stderr.join("")).toContain("Stripe is version 0.2.0");
  });
});
