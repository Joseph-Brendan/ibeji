import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RunningSession,
  type StartSessionOptions,
  startSession,
} from "../../src/control/session.js";
import { FakeClock } from "../../src/core/clock.js";
import { Logger } from "../../src/core/logger.js";
import { registry } from "../../src/twins/registry.js";

export type ControlSessionHarness = {
  readonly session: RunningSession;
  readonly home: string;
  readonly clock: FakeClock;
  readonly logs: string[];
  cleanup: () => Promise<void>;
};

export type StartControlSessionOptions = Omit<
  StartSessionOptions,
  "home" | "clock" | "logger" | "handleSignals" | "ports"
> & {
  readonly clock?: FakeClock;
  readonly ports?: Readonly<Record<string, number>>;
};

function defaultPorts(): Record<string, number> {
  const ports: Record<string, number> = { control: 0 };
  for (const definition of registry.list()) {
    ports[definition.id] = 0;
  }
  return ports;
}

export async function startControlSession(
  options: StartControlSessionOptions = {},
): Promise<ControlSessionHarness> {
  const home = await mkdtemp(join(tmpdir(), "ibeji-control-"));
  const clock = options.clock ?? new FakeClock(1_700_000_000_000);
  const logs: string[] = [];
  const logger = new Logger({ level: "debug", write: (line) => logs.push(line) });

  try {
    const session = await startSession({
      ...options,
      home,
      clock,
      logger,
      handleSignals: false,
      ports: options.ports ?? defaultPorts(),
    });
    return {
      session,
      home,
      clock,
      logs,
      cleanup: async () => {
        try {
          await session.stop();
        } finally {
          await rm(home, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}

export async function withControlSession(
  options: StartControlSessionOptions,
  run: (harness: ControlSessionHarness) => Promise<void>,
): Promise<void> {
  const harness = await startControlSession(options);
  try {
    await run(harness);
  } finally {
    await harness.cleanup();
  }
}

export function apiUrl(session: RunningSession, path: string): string {
  return `${session.addresses.control.url}/_ibeji/api/v1${path}`;
}

export function authHeaders(session: RunningSession): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

export function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null || header === undefined) {
    throw new Error("expected a Set-Cookie header");
  }
  const first = header.split(";")[0];
  if (first === undefined || !first.startsWith("ibeji_ui=")) {
    throw new Error("expected the ibeji_ui cookie");
  }
  return first;
}

export async function exchangeCode(session: RunningSession, code: string): Promise<Response> {
  return fetch(apiUrl(session, "/auth/exchange"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}
