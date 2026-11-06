import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { type Clock, realClock } from "../core/clock.js";
import { DEFAULT_CONTROL_PORT, MAX_SEED } from "../core/config.js";
import { IbejiError, isIbejiError } from "../core/errors.js";
import { EventLog } from "../core/events.js";
import { RuleStore } from "../core/failures/rules.js";
import { Logger } from "../core/logger.js";
import { SeededRandom } from "../core/random.js";
import { ScenarioRunner } from "../core/scenarios/runner.js";
import type { Scenario } from "../core/scenarios/schema.js";
import { type AddressPolicy, resolveAllowedWebhookUrl } from "../core/webhooks/address.js";
import { WebhookDispatcher } from "../core/webhooks/dispatcher.js";
import { createLiveKeyScanner } from "../shared/live-key-scanner.js";
import { type RunningTwin, startTwin } from "../twins/framework/server.js";
import { FrameworkStateStore } from "../twins/framework/state.js";
import type { TwinDefinition } from "../twins/framework/types.js";
import { liveKeyPatterns, registry } from "../twins/registry.js";
import { CredentialsStore } from "./credentials.js";
import { isMissingFile, sessionPath } from "./paths.js";
import { type ByteSource, SessionSecrets } from "./secrets.js";
import { type RunningControlServer, startControlServer } from "./server.js";
import {
  type HealthCheck,
  readSessionFile,
  removeSessionFile,
  sessionFileIsLive,
  writeSessionFile,
} from "./session-file.js";
import type { BoundAddress, ControlDependencies } from "./types.js";

export const IBEJI_VERSION = "0.0.0";
const DISPATCH_INTERVAL_MS = 250;

export type StartSessionOptions = {
  readonly home: string;
  readonly twins?: readonly string[] | undefined;
  readonly ports?: Readonly<Record<string, number>> | undefined;
  readonly webhookUrls?: Readonly<Record<string, string>> | undefined;
  readonly seed?: number | undefined;
  readonly scenarios?: readonly Scenario[] | undefined;
  readonly allowPrivateWebhooks?: boolean | undefined;
  readonly allowPublicWebhooks?: boolean | undefined;
  readonly clock?: Clock | undefined;
  readonly logger?: Logger | undefined;
  readonly version?: string | undefined;
  readonly handleSignals?: boolean | undefined;
  readonly instanceId?: string | undefined;
  readonly bytes?: ByteSource | undefined;
  readonly healthCheck?: HealthCheck | undefined;
  readonly uiRoot?: string | undefined;
};

export type SessionTwin = {
  readonly definition: TwinDefinition;
  readonly running: RunningTwin;
  readonly address: BoundAddress;
};

export type RunningSession = {
  readonly instanceId: string;
  readonly version: string;
  readonly seed: number;
  readonly token: string;
  readonly startTime: string;
  readonly home: string;
  readonly notes: readonly string[];
  readonly control: RunningControlServer;
  readonly twins: ReadonlyMap<string, SessionTwin>;
  readonly addresses: {
    readonly control: BoundAddress;
    readonly twins: Readonly<Record<string, BoundAddress>>;
  };
  readonly credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly launchCode: string;
  readonly launchLink: string;
  readonly events: EventLog;
  readonly rules: RuleStore;
  readonly dispatcher: WebhookDispatcher;
  readonly scenarios: ScenarioRunner;
  readonly credentialsStore: CredentialsStore;
  readonly clock: Clock;
  createLaunchCode: () => string;
  createLaunchLink: () => string;
  stop: () => Promise<void>;
};

type RequestedPort = {
  readonly name: string;
  readonly port: number;
  readonly fixFlag: string;
};

function portInUse(port: number, fixFlag: string): IbejiError {
  return new IbejiError("PORT_IN_USE", {
    what: `Port ${port} is already in use.`,
    why: "Another program, or another Ibeji session, is listening on that port.",
    fix: `Stop the other program or choose a different port with ${fixFlag}.`,
  });
}

function invalidStart(what: string, why: string, fix: string): IbejiError {
  return new IbejiError("BAD_REQUEST", { what, why, fix });
}

function assertPort(port: number, name: string): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw invalidStart(
      "A port in the session is not valid.",
      `${name} has the value ${String(port)}, which is not a whole number from 0 to 65535.`,
      "Use port 0 for a free port, or a whole number from 1 to 65535.",
    );
  }
}

function isAddressInUse(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "EADDRINUSE"
  );
}

function portFromError(error: unknown): number | undefined {
  if (error instanceof Error && "port" in error && typeof error.port === "number") {
    return error.port;
  }
  return undefined;
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: unknown) => {
      if (isAddressInUse(error)) {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => {
        if (error === undefined) {
          resolve(true);
        } else {
          reject(error);
        }
      });
    });
  });
}

async function checkPorts(requests: readonly RequestedPort[]): Promise<void> {
  const owners = new Map<number, RequestedPort>();
  for (const request of requests) {
    if (request.port === 0) {
      continue;
    }
    const owner = owners.get(request.port);
    if (owner !== undefined) {
      throw new IbejiError("PORT_IN_USE", {
        what: `Port ${request.port} is requested twice.`,
        why: `Both ${owner.name} and ${request.name} want the same port.`,
        fix: `Give ${request.name} a different port with ${request.fixFlag}.`,
      });
    }
    owners.set(request.port, request);

    if (!(await portIsFree(request.port))) {
      throw portInUse(request.port, request.fixFlag);
    }
  }
}

function addressesOf(twins: ReadonlyMap<string, RunningTwin>): Record<string, BoundAddress> {
  const result: Record<string, BoundAddress> = {};
  for (const [twinId, running] of twins) {
    result[twinId] = {
      hostname: "127.0.0.1",
      address: running.address,
      port: running.port,
      url: `http://127.0.0.1:${running.port}`,
    };
  }
  return result;
}

function startDispatchLoop(
  dispatcher: WebhookDispatcher,
  clock: Clock,
  logger: Logger,
): () => void {
  let stopped = false;
  let handle: number | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      await dispatcher.dispatchDue();
    } catch (error) {
      logger.error("Webhook dispatch failed.", {
        code: isIbejiError(error) ? error.code : "INTERNAL",
      });
    } finally {
      if (!stopped) {
        handle = clock.setTimeout(() => {
          void tick();
        }, DISPATCH_INTERVAL_MS);
      }
    }
  };

  handle = clock.setTimeout(() => {
    void tick();
  }, DISPATCH_INTERVAL_MS);

  return () => {
    stopped = true;
    if (handle !== undefined) {
      clock.clearTimeout(handle);
      handle = undefined;
    }
  };
}

/**
 * Start one Ibeji session. Ports are checked before any server starts, a live
 * session file refuses a second start, credentials are loaded or created, the
 * chosen twins start from the registry, and only then does the control server
 * bind and the session file appear.
 */
export async function startSession(options: StartSessionOptions): Promise<RunningSession> {
  const clock = options.clock ?? realClock;
  const patterns = liveKeyPatterns();
  const patternScanner = createLiveKeyScanner(patterns);
  const logger =
    options.logger ??
    new Logger({
      sanitize: (value) => patternScanner.scanValue(value).value,
    });
  const version = options.version ?? IBEJI_VERSION;
  const definitions = registry.list();
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const notes: string[] = [];

  const existing = await readSessionFile(options.home);
  if (existing.kind === "ok") {
    if (await sessionFileIsLive(existing.value, options.healthCheck)) {
      throw new IbejiError("SESSION_ALREADY_RUNNING");
    }
    await removeSessionFile(options.home);
    notes.push("Removed a stale session file.");
    logger.warn("Removed a stale session file.");
  } else if (existing.kind === "invalid") {
    await removeSessionFile(options.home);
    notes.push("Removed an invalid session file.");
    logger.warn("Removed an invalid session file.");
  }

  const requestedTwins = options.twins ?? definitions.map((definition) => definition.id);
  const chosen: TwinDefinition[] = [];
  for (const twinId of requestedTwins) {
    const definition = definitionsById.get(twinId);
    if (definition === undefined) {
      throw new IbejiError("UNKNOWN_TWIN", {
        why: "That twin id is not in the registry.",
      });
    }
    if (!chosen.some((item) => item.id === twinId)) {
      chosen.push(definition);
    }
  }

  for (const key of Object.keys(options.ports ?? {})) {
    if (key !== "control" && !definitionsById.has(key)) {
      throw invalidStart(
        "The port list contains an unknown name.",
        `"${key}" is neither the control server nor a registered twin.`,
        "Use control or a twin id in the ports option.",
      );
    }
  }

  const seed = options.seed ?? randomInt(0, MAX_SEED + 1);
  const random = new SeededRandom(seed);
  const controlPort = options.ports?.control ?? DEFAULT_CONTROL_PORT;
  assertPort(controlPort, "The control server port");
  const twinPorts = new Map<string, number>();
  for (const definition of chosen) {
    const port = options.ports?.[definition.id] ?? definition.defaultPort;
    assertPort(port, `The ${definition.displayName} twin port`);
    twinPorts.set(definition.id, port);
  }

  const portRequests: RequestedPort[] = [
    { name: "the control server", port: controlPort, fixFlag: "--port <n>" },
  ];
  for (const definition of chosen) {
    const port = twinPorts.get(definition.id);
    if (port === undefined) {
      throw new IbejiError("INTERNAL");
    }
    portRequests.push({
      name: `the ${definition.displayName} twin`,
      port,
      fixFlag: `--twin-port ${definition.id}=<n>`,
    });
  }
  await checkPorts(portRequests);

  const addressPolicy: AddressPolicy = {
    allowPrivate: options.allowPrivateWebhooks ?? false,
    allowPublic: options.allowPublicWebhooks ?? false,
  };
  if (addressPolicy.allowPublic) {
    logger.warn(
      "Public webhook addresses are allowed. A fake payment message could reach a real server.",
    );
  }

  const initialWebhookUrls = new Map<string, string>();
  for (const [twinId, url] of Object.entries(options.webhookUrls ?? {})) {
    if (!definitionsById.has(twinId)) {
      throw new IbejiError("UNKNOWN_TWIN", {
        why: "That twin id is not in the registry.",
      });
    }
    await resolveAllowedWebhookUrl(url, addressPolicy);
    initialWebhookUrls.set(twinId, url);
  }

  const credentialsStore = await CredentialsStore.load(
    options.home,
    definitions,
    options.bytes ?? randomBytes,
  );
  const instanceId = options.instanceId ?? randomUUID();
  const startTime = new Date(clock.now()).toISOString();
  const secrets = new SessionSecrets(clock, options.bytes ?? randomBytes);
  const events = new EventLog(clock);
  const runningTwins = new Map<string, RunningTwin>();
  const states = new Map<string, FrameworkStateStore>();
  const webhookUrls = new Map(initialWebhookUrls);

  const rules = new RuleStore({
    twins: definitions.map((definition) => ({
      id: definition.id,
      actions: definition.actions.map((action) => action.id),
      failures: definition.failures.support,
    })),
    events,
    runningTwinIds: () => [...runningTwins.keys()],
  });

  const dispatcher = new WebhookDispatcher({
    clock,
    twins: {},
    random,
    addressPolicy,
  });

  const scenarios = new ScenarioRunner({
    rules,
    clock,
    scenarios: options.scenarios ?? [],
    runningTwinIds: () => [...runningTwins.keys()],
  });

  let control: RunningControlServer | undefined;
  let stopDispatch = (): void => {};

  const fontsDir =
    options.uiRoot === undefined ? undefined : join(options.uiRoot, "assets", "fonts");

  try {
    for (const definition of chosen) {
      const port = twinPorts.get(definition.id);
      if (port === undefined) {
        throw new IbejiError("INTERNAL");
      }
      const state = new FrameworkStateStore(definition.id, definition.state.collections);
      const running = await startTwin(definition, {
        port,
        credentials: () => credentialsStore.get(definition.id),
        events,
        rules,
        clock,
        random,
        state,
        dispatcher,
        webhookUrl: () => webhookUrls.get(definition.id),
        liveKeyPatterns: patterns,
        ...(fontsDir === undefined ? {} : { fontsDir }),
      });
      states.set(definition.id, state);
      runningTwins.set(definition.id, running);
    }

    const controlPortRef = { value: 0 };
    const controlDependencies: ControlDependencies = {
      instanceId,
      version,
      seed,
      startTime,
      clock,
      events,
      rules,
      dispatcher,
      scenarios,
      scenarioDefinitions: options.scenarios ?? [],
      definitions,
      runningTwins,
      states,
      credentials: credentialsStore,
      webhookUrls,
      secrets,
      addressPolicy,
      liveKeyPatterns: patterns,
      logger,
      controlPort: controlPortRef,
      ...(options.uiRoot === undefined ? {} : { uiRoot: options.uiRoot }),
    };

    const startedControl = await startControlServer(controlDependencies, { port: controlPort });
    control = startedControl;
    const firstLaunch = secrets.createLaunchCode();

    await writeSessionFile(options.home, {
      instanceId,
      processId: process.pid,
      ports: {
        control: startedControl.address.port,
        twins: Object.fromEntries(
          [...runningTwins.entries()].map(([twinId, running]) => [twinId, running.port]),
        ),
      },
      token: secrets.token,
      startTime,
      version,
    });

    stopDispatch = startDispatchLoop(dispatcher, clock, logger);

    const sessionAddresses = addressesOf(runningTwins);
    const launchLink = `${startedControl.address.url}/?launch=${encodeURIComponent(firstLaunch.code)}`;
    const sessionTwins = new Map<string, SessionTwin>();
    for (const [twinId, running] of runningTwins) {
      const address = sessionAddresses[twinId];
      if (address === undefined) {
        throw new IbejiError("INTERNAL");
      }
      sessionTwins.set(twinId, {
        definition: running.definition,
        running,
        address,
      });
    }

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;
      stopDispatch();
      scenarios.stop();
      dispatcher.stop();

      let failure: unknown;
      try {
        await startedControl.stop();
      } catch (error) {
        failure = error;
      }
      for (const running of runningTwins.values()) {
        try {
          await running.stop();
        } catch (error) {
          if (failure === undefined) {
            failure = error;
          }
        }
      }

      const current = await readSessionFile(options.home);
      if (current.kind === "ok" && current.value.instanceId === instanceId) {
        await removeSessionFile(options.home);
      }

      if (failure !== undefined) {
        throw failure;
      }
    };

    const exitHandler = (): void => {
      try {
        const raw = JSON.parse(readFileSync(sessionPath(options.home), "utf8")) as unknown;
        if (
          typeof raw === "object" &&
          raw !== null &&
          "instanceId" in raw &&
          raw.instanceId === instanceId
        ) {
          rmSync(sessionPath(options.home), { force: true });
        }
      } catch (error) {
        if (!isMissingFile(error)) {
          logger.warn("Could not check the session file during exit.");
        }
      }
    };
    const signalHandler = (): void => {
      void (async () => {
        try {
          await stop();
          process.exitCode = 0;
        } catch (error) {
          logger.error("Ibeji could not shut down cleanly.", {
            code: isIbejiError(error) ? error.code : "INTERNAL",
          });
          process.exitCode = 1;
        }
      })();
    };

    if (options.handleSignals ?? true) {
      process.once("SIGINT", signalHandler);
      process.once("SIGTERM", signalHandler);
      process.once("exit", exitHandler);
    }

    const originalStop = stop;
    const stopWithHandlers = async (): Promise<void> => {
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
      process.removeListener("exit", exitHandler);
      await originalStop();
    };

    return {
      instanceId,
      version,
      seed,
      token: secrets.token,
      startTime,
      home: options.home,
      notes,
      control: startedControl,
      twins: sessionTwins,
      addresses: {
        control: startedControl.address,
        twins: sessionAddresses,
      },
      credentials: credentialsStore.all(),
      launchCode: firstLaunch.code,
      launchLink,
      events,
      rules,
      dispatcher,
      scenarios,
      credentialsStore,
      clock,
      createLaunchCode: () => secrets.createLaunchCode().code,
      createLaunchLink: () => secrets.createLaunchLink(startedControl.address.url),
      stop: stopWithHandlers,
    };
  } catch (error) {
    stopDispatch();
    scenarios.stop();
    dispatcher.stop();
    if (control !== undefined) {
      try {
        await control.stop();
      } catch (stopError) {
        logger.error("Ibeji could not stop the control server after a failed start.", {
          code: isIbejiError(stopError) ? stopError.code : "INTERNAL",
        });
      }
    }
    for (const running of runningTwins.values()) {
      try {
        await running.stop();
      } catch (stopError) {
        logger.error("Ibeji could not stop a twin server after a failed start.", {
          code: isIbejiError(stopError) ? stopError.code : "INTERNAL",
        });
      }
    }
    const current = await readSessionFile(options.home);
    if (current.kind === "ok" && current.value.instanceId === instanceId) {
      await removeSessionFile(options.home);
    }
    if (isAddressInUse(error)) {
      const port = portFromError(error);
      throw new IbejiError("PORT_IN_USE", {
        what:
          port === undefined
            ? "A port Ibeji needs was taken while it was starting."
            : `Port ${port} is already in use.`,
        why: "Another program took the port after Ibeji checked that it was free.",
        fix: "Try again, or choose different ports with --port for the control server or --twin-port <twin>=<n> for a twin.",
        cause: error,
      });
    }
    throw error;
  }
}
