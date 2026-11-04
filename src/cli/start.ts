import { join } from "node:path";
import type { RunningSession } from "../control/session.js";
import { type StartSessionOptions, startSession } from "../control/session.js";
import { createDefaultConfig, MAX_SEED, mergeConfig } from "../core/config.js";
import { IbejiError } from "../core/errors.js";
import type { TwinDefinition } from "../twins/framework/types.js";
import { booleanValue, CliUsageError, listOf, listValue, parseCli, stringValue } from "./args.js";
import { type Writer, writeLine, writeWrapped } from "./output.js";
import { loadProject, readConfigFile } from "./project.js";

const START_OPTIONS = {
  twins: { type: "string" },
  port: { type: "string" },
  "twin-port": { type: "string", multiple: true },
  seed: { type: "string" },
  scenario: { type: "string" },
  "no-open": { type: "boolean" },
  "allow-private-webhooks": { type: "boolean" },
  "allow-public-webhooks": { type: "boolean" },
  config: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

export type StartCliOptions = {
  readonly home: string;
  readonly cwd: string;
  readonly stdout: Writer;
  readonly stderr: Writer;
  readonly openBrowser: (url: string) => Promise<unknown>;
  readonly waitForShutdown?: boolean;
  readonly waitForStop?: () => Promise<void>;
  readonly onStarted?: (session: RunningSession) => void;
};

function usage(what: string, why: string, fix: string): CliUsageError {
  return new CliUsageError({ what, why, fix });
}

function integerFlag(value: string, flag: string, min: number, max: number): number {
  if (!/^\d+$/u.test(value)) {
    throw usage(
      `The ${flag} value is not a whole number.`,
      `The value is "${value}".`,
      `Use a whole number from ${min} to ${max}.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw usage(
      `The ${flag} value is out of range.`,
      `The value is ${parsed}.`,
      `Use a whole number from ${min} to ${max}.`,
    );
  }
  return parsed;
}

function twinPorts(raw: readonly string[], twinIds: readonly string[]): Record<string, number> {
  const ports: Record<string, number> = {};

  for (const entry of raw) {
    const equals = entry.indexOf("=");
    if (equals <= 0 || equals === entry.length - 1) {
      throw usage(
        "A --twin-port value is not valid.",
        `The value is "${entry}".`,
        "Use --twin-port <twin>=<port>, for example --twin-port <twin>=4401.",
      );
    }
    const twinId = entry.slice(0, equals);
    const rawPort = entry.slice(equals + 1);
    if (!twinIds.includes(twinId)) {
      throw usage(
        "A --twin-port value names an unknown twin.",
        `"${twinId}" is not a registered twin id. Registered twins: ${twinIds.join(", ")}.`,
        "Use a twin id shown by ibeji start --help.",
      );
    }
    if (ports[twinId] !== undefined) {
      throw usage(
        "A twin port was given more than once.",
        `The twin "${twinId}" has more than one --twin-port value.`,
        "Give each twin exactly one port.",
      );
    }
    ports[twinId] = integerFlag(rawPort, `--twin-port ${twinId}`, 0, 65_535);
  }

  return ports;
}

function validateTwinList(twins: readonly string[], twinIds: readonly string[]): void {
  const unknown = twins.filter((twinId) => !twinIds.includes(twinId));
  if (unknown.length > 0) {
    throw new IbejiError("CONFIG_INVALID", {
      what: "The chosen twin list is not valid.",
      why: `These twin ids are unknown: ${unknown.join(", ")}. Registered twins: ${twinIds.join(", ")}.`,
      fix: "Use twin ids shown by ibeji start --help.",
    });
  }
}

function credentialLine(writer: Writer, label: string, value: string): void {
  const prefix = `  ${label}: `;
  if (prefix.length + value.length <= 80) {
    writeLine(writer, `${prefix}${value}`);
    return;
  }
  writeLine(writer, `  ${label}:`);
  writeLine(writer, `    ${value}`);
}

function printTwin(
  writer: Writer,
  definition: TwinDefinition,
  session: RunningSession,
  webhookUrl: string | undefined,
): void {
  writeLine(writer, definition.displayName);
  writeLine(writer, `  Base URL: ${session.addresses.twins[definition.id]?.url ?? ""}`);

  const values = session.credentials[definition.id] ?? {};
  for (const spec of definition.credentials) {
    credentialLine(writer, spec.label, values[spec.id] ?? "");
  }

  if (webhookUrl !== undefined) {
    writeWrapped(writer, `  Webhook URL: ${webhookUrl}`, "  ");
  } else {
    writeLine(writer, "  Webhook URL: not set");
  }
  writeLine(writer);
}

function waitForStopSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.removeListener("SIGINT", done);
      process.removeListener("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

export async function runStart(args: readonly string[], options: StartCliOptions): Promise<number> {
  const parsed = parseCli(args, START_OPTIONS);
  if (parsed.positionals.length > 0) {
    throw usage(
      "The start command does not take an argument.",
      `Unexpected arguments: ${parsed.positionals.join(" ")}.`,
      "Run ibeji start --help to see the flags.",
    );
  }

  const project = await loadProject();
  const twinIds = project.definitions.map((definition) => definition.id);
  const configPath = stringValue(parsed.values, "config");
  const file = await readConfigFile(project, options.cwd, configPath);
  const defaults = createDefaultConfig(project.configContext);

  const flagTwinsRaw = stringValue(parsed.values, "twins");
  const flagTwins = flagTwinsRaw === undefined ? undefined : listOf(flagTwinsRaw);
  if (flagTwins !== undefined) {
    validateTwinList(flagTwins, twinIds);
    if (flagTwins.length === 0) {
      throw usage(
        "The --twins value is empty.",
        "The list has no twin ids.",
        "Use a comma-separated list, for example --twins <twin>.",
      );
    }
  }

  const controlPortRaw = stringValue(parsed.values, "port");
  const seedRaw = stringValue(parsed.values, "seed");
  const flags = {
    ...(flagTwins === undefined ? {} : { twins: flagTwins }),
    ports: {
      ...(controlPortRaw === undefined
        ? {}
        : { control: integerFlag(controlPortRaw, "--port", 0, 65_535) }),
      ...twinPorts(listValue(parsed.values, "twin-port"), twinIds),
    },
    ...(seedRaw === undefined ? {} : { seed: integerFlag(seedRaw, "--seed", 0, MAX_SEED) }),
    ...(stringValue(parsed.values, "scenario") === undefined
      ? {}
      : { scenario: stringValue(parsed.values, "scenario") as string }),
    ...(booleanValue(parsed.values, "no-open") ? { open: false } : {}),
    ...(booleanValue(parsed.values, "allow-private-webhooks")
      ? { allowPrivateWebhooks: true }
      : {}),
    ...(booleanValue(parsed.values, "allow-public-webhooks") ? { allowPublicWebhooks: true } : {}),
  };

  const config = mergeConfig(defaults, file?.overrides ?? {}, flags);
  validateTwinList(config.twins, twinIds);

  if (config.scenario !== undefined) {
    if (!(config.scenario in project.scenarioTwins)) {
      throw new IbejiError("CONFIG_INVALID", {
        what: "The chosen scenario is not known.",
        why: `"${config.scenario}" is not a built-in scenario.`,
        fix: "Use a scenario id shown by ibeji scenario list.",
      });
    }
    const supported = project.scenarioTwins[config.scenario] ?? [];
    if (!supported.some((twinId) => config.twins.includes(twinId))) {
      throw new IbejiError("CONFIG_INVALID", {
        what: "The chosen scenario does not support the chosen twins.",
        why: `The scenario supports: ${supported.join(", ")}.`,
        fix: "Choose one of the scenario's twins with --twins.",
      });
    }
  }

  if (config.allowPublicWebhooks) {
    writeLine(
      options.stderr,
      "Warning: public webhook addresses are allowed. A fake payment message could reach a real server.",
    );
  }

  const startOptions: StartSessionOptions = {
    home: options.home,
    twins: config.twins,
    ports: config.ports,
    webhookUrls: config.webhookUrls,
    scenarios: project.scenarios,
    allowPrivateWebhooks: config.allowPrivateWebhooks,
    allowPublicWebhooks: config.allowPublicWebhooks,
    version: project.packageInfo.version,
    uiRoot: join(project.root, "dist", "ui"),
    ...(config.seed === undefined ? {} : { seed: config.seed }),
  };

  const session = await startSession(startOptions);

  if (config.scenario !== undefined) {
    try {
      session.scenarios.start(config.scenario);
    } catch (error) {
      await session.stop();
      throw error;
    }
  }

  options.onStarted?.(session);

  for (const note of session.notes) {
    writeLine(options.stderr, `Note: ${note}`);
  }

  if (booleanValue(parsed.values, "json")) {
    const runningIds = new Set(session.twins.keys());
    const runningCredentials = Object.fromEntries(
      Object.entries(session.credentials).filter(([twinId]) => runningIds.has(twinId)),
    );
    const runningWebhookUrls = Object.fromEntries(
      Object.entries(config.webhookUrls).filter(([twinId]) => runningIds.has(twinId)),
    );
    writeLine(
      options.stdout,
      JSON.stringify({
        ok: true,
        version: session.version,
        instance: session.instanceId,
        seed: session.seed,
        startTime: session.startTime,
        addresses: session.addresses,
        credentials: runningCredentials,
        webhookUrls: runningWebhookUrls,
        scenario: config.scenario ?? null,
        launchLink: session.launchLink,
        notes: session.notes,
      }),
    );
  } else {
    writeLine(options.stdout, "Ibeji is running.");
    writeLine(options.stdout);
    for (const sessionTwin of session.twins.values()) {
      printTwin(
        options.stdout,
        sessionTwin.definition,
        session,
        config.webhookUrls[sessionTwin.definition.id],
      );
    }
    writeLine(options.stdout, `Seed: ${session.seed}`);
    writeLine(options.stdout, "Dashboard link:");
    writeWrapped(options.stdout, session.launchLink, "  ");
    writeLine(options.stdout);
    writeLine(options.stdout, "Open a new dashboard link with: ibeji open");
    writeLine(options.stdout, "Stop with: Control and C");
  }

  if (config.open) {
    try {
      await options.openBrowser(session.launchLink);
    } catch {
      writeLine(
        options.stderr,
        "The browser could not be opened. The dashboard link is printed above.",
      );
    }
  }

  if (options.waitForShutdown ?? true) {
    await (options.waitForStop ?? waitForStopSignal)();
    return 0;
  }

  return 0;
}
