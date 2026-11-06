import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { CredentialsStore } from "../control/credentials.js";
import { writePrivateJson } from "../control/paths.js";
import { formatZodPath, IbejiError } from "../core/errors.js";
import { getFailure } from "../core/failures/catalog.js";
import { serveIbejiMcp } from "../mcp/run.js";
import type { TwinDefinition } from "../twins/framework/types.js";
import {
  booleanValue,
  CliUsageError,
  firstPositional,
  listOf,
  parseCli,
  stringValue,
} from "./args.js";
import type {
  ControlClient,
  EventItem,
  FailureInfo,
  Rule,
  TwinList,
  TwinSummary,
} from "./control-client.js";
import { formatJson, formatTime, type Writer, writeLine, writeWrapped } from "./output.js";
import { loadProject } from "./project.js";
import { requireSession } from "./session.js";

const JSON_HELP = {
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

const STATUS_OPTIONS = JSON_HELP;

const OPEN_OPTIONS = {
  "no-open": { type: "boolean" },
  ...JSON_HELP,
} as const;

const CLEAR_OPTIONS = {
  twin: { type: "string" },
  ...JSON_HELP,
} as const;

const SCENARIO_LIST_OPTIONS = JSON_HELP;

const SCENARIO_RUN_OPTIONS = {
  twin: { type: "string" },
  ...JSON_HELP,
} as const;

const SCENARIO_STOP_OPTIONS = JSON_HELP;

const WEBHOOK_URL_OPTIONS = {
  clear: { type: "boolean" },
  ...JSON_HELP,
} as const;

const KEYS_OPTIONS = {
  rotate: { type: "boolean" },
  ...JSON_HELP,
} as const;

const EVENTS_OPTIONS = {
  follow: { type: "boolean" },
  twin: { type: "string" },
  ...JSON_HELP,
} as const;

const RESEND_OPTIONS = JSON_HELP;
const RESET_OPTIONS = {
  twin: { type: "string" },
  yes: { type: "boolean" },
  ...JSON_HELP,
} as const;
const EXPORT_OPTIONS = JSON_HELP;
const MCP_OPTIONS = {
  help: { type: "boolean" },
} as const;

export type CliRuntime = {
  readonly home: string;
  readonly cwd: string;
  readonly stdout: Writer;
  readonly stderr: Writer;
  readonly openBrowser: (url: string) => Promise<unknown>;
  readonly followSignal?: AbortSignal;
  readonly confirmReset?: (question: string) => Promise<boolean>;
};

function usage(what: string, why: string, fix: string): CliUsageError {
  return new CliUsageError({ what, why, fix });
}

function noPositionals(positionals: readonly string[], command: string): void {
  if (positionals.length > 0) {
    throw usage(
      `The ${command} command does not take an argument.`,
      `Unexpected arguments: ${positionals.join(" ")}.`,
      `Run ibeji ${command} --help to see the flags.`,
    );
  }
}

function printJson(writer: Writer, value: unknown): void {
  writeLine(writer, formatJson(value));
}

function twinFrom(list: TwinList, twinId: string): TwinSummary | undefined {
  return list.twins.find((twin) => twin.id === twinId);
}

function requireTwin(list: TwinList, twinId: string, running: boolean): TwinSummary {
  const twin = twinFrom(list, twinId);
  if (twin === undefined) {
    throw new IbejiError("UNKNOWN_TWIN", {
      why: `"${twinId}" is not a registered twin. Registered twins: ${list.twins
        .map((item) => item.id)
        .join(", ")}.`,
    });
  }
  if (running && !twin.running) {
    throw new IbejiError("TWIN_NOT_RUNNING", {
      what: `The ${twin.displayName} twin is not running.`,
      why: "The action needs a twin that is part of the current session.",
      fix: "Start the twin with ibeji start --twins and try again.",
    });
  }
  return twin;
}

function displayNames(ids: readonly string[], list: TwinList): string {
  return ids.map((id) => twinFrom(list, id)?.displayName ?? id).join(", ");
}

function formatSettings(settings: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return "defaults";
  }
  return entries
    .map(([key, value]) => `${key}=${value === null ? "empty" : String(value)}`)
    .join(", ");
}

function printRule(writer: Writer, rule: Rule): void {
  writeLine(writer, `Rule ${rule.id}: ${rule.failureId}`);
  writeWrapped(
    writer,
    `  Twins: ${rule.twins.join(", ")}. Actions: ${rule.actions ?? "all supported"}. Settings: ${formatSettings(rule.settings)}.`,
    "  ",
  );
}

export async function runStatus(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, STATUS_OPTIONS);
  noPositionals(parsed.positionals, "status");
  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const status = await client.status;

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, status);
    return 0;
  }

  writeLine(runtime.stdout, "Ibeji is running.");
  writeLine(runtime.stdout, `Version: ${status.version}`);
  writeLine(runtime.stdout, `Seed: ${status.seed}`);
  writeLine(runtime.stdout, `Started: ${formatTime(status.startTime)}`);
  writeLine(runtime.stdout, `Scenario: ${status.scenario ?? "none"}`);
  writeLine(runtime.stdout);
  writeLine(runtime.stdout, "Twins:");
  for (const twin of status.twins) {
    writeWrapped(
      runtime.stdout,
      `  ${twin.displayName}: ${twin.running ? (twin.address ?? "running") : "not running"}`,
    );
  }
  writeLine(runtime.stdout);
  writeLine(runtime.stdout, `Active rules: ${status.rules.length}`);
  for (const rule of status.rules) {
    printRule(runtime.stdout, rule);
  }
  return 0;
}

export async function runOpen(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, OPEN_OPTIONS);
  noPositionals(parsed.positionals, "open");
  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const link = await client.launchLink();

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, link);
  } else {
    writeWrapped(runtime.stdout, `Dashboard: ${link.url}`);
  }

  if (!booleanValue(parsed.values, "no-open")) {
    try {
      await runtime.openBrowser(link.url);
    } catch {
      writeLine(
        runtime.stderr,
        "The browser could not be opened. The dashboard link is printed above.",
      );
    }
  }
  return 0;
}

function nullableSettingNames(failure: FailureInfo): ReadonlySet<string> {
  const schema = failure.settingsSchema;
  if (typeof schema !== "object" || schema === null || !("properties" in schema)) {
    return new Set();
  }
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) {
    return new Set();
  }
  const names = new Set<string>();
  for (const [name, value] of Object.entries(properties)) {
    if (typeof value !== "object" || value === null || !("anyOf" in value)) {
      continue;
    }
    if (
      Array.isArray(value.anyOf) &&
      value.anyOf.some(
        (part: unknown) =>
          typeof part === "object" && part !== null && "type" in part && part.type === "null",
      )
    ) {
      names.add(name);
    }
  }
  return names;
}

function normaliseNullableFlags(
  args: readonly string[],
  names: ReadonlySet<string>,
): readonly string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const name = arg.startsWith("--") ? arg.slice(2) : "";
    if (names.has(name)) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) {
        result.push(`${arg}=null`);
        continue;
      }
    }
    result.push(arg);
  }
  return result;
}

function settingValue(raw: string, schema: unknown): unknown {
  if (raw === "null" || raw === "") {
    return null;
  }
  if (typeof schema !== "object" || schema === null) {
    return raw;
  }
  const hasNumber =
    ("type" in schema && (schema.type === "integer" || schema.type === "number")) ||
    ("anyOf" in schema &&
      Array.isArray(schema.anyOf) &&
      schema.anyOf.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part.type === "integer" || part.type === "number"),
      ));
  return hasNumber ? Number(raw) : raw;
}

function failureSettings(
  failure: FailureInfo,
  values: Readonly<Record<string, string | boolean | readonly string[] | undefined>>,
): {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly problems: readonly string[];
} {
  const properties =
    typeof failure.settingsSchema === "object" &&
    failure.settingsSchema !== null &&
    "properties" in failure.settingsSchema &&
    typeof failure.settingsSchema.properties === "object" &&
    failure.settingsSchema.properties !== null
      ? failure.settingsSchema.properties
      : {};
  const settings: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(properties)) {
    if (name === "twins" || name === "actions") {
      continue;
    }
    const value = values[name];
    if (typeof value === "string") {
      settings[name] = settingValue(value, schema);
    }
  }

  const definition = getFailure(failure.id);
  if (definition === undefined) {
    return { settings, problems: [] };
  }
  const parsed = definition.failureSettingsSchema.safeParse(settings);
  if (parsed.success) {
    return { settings: parsed.data, problems: [] };
  }
  return {
    settings,
    problems: parsed.error.issues.map((issue) => `${formatZodPath(issue.path)}: ${issue.message}`),
  };
}

function failOptions(
  failure: FailureInfo,
): Record<string, { readonly type: "string" | "boolean" }> {
  const options: Record<string, { readonly type: "string" | "boolean" }> = {
    twin: { type: "string" },
    on: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  };
  const properties =
    typeof failure.settingsSchema === "object" &&
    failure.settingsSchema !== null &&
    "properties" in failure.settingsSchema &&
    typeof failure.settingsSchema.properties === "object" &&
    failure.settingsSchema.properties !== null
      ? failure.settingsSchema.properties
      : {};
  for (const name of Object.keys(properties)) {
    if (name !== "twins" && name !== "actions") {
      options[name] = { type: "string" };
    }
  }
  return options;
}

function unsupportedFailure(failure: FailureInfo, twinId: string, list: TwinList): IbejiError {
  const supporting = failure.support.map((item) => item.twin);
  return new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
    what: `The ${twinFrom(list, twinId)?.displayName ?? twinId} twin does not support this failure.`,
    why: `The twins that support it: ${displayNames(supporting, list) || "none in this version"}.`,
    fix: "Choose a twin that supports the failure, as shown by ibeji fail --help.",
  });
}

export async function runFail(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const failureId = firstPositional(args);
  if (failureId === undefined) {
    throw usage(
      "The fail command needs a failure id.",
      "No failure id was given.",
      "Run ibeji fail --help for the list, for example ibeji fail slow-response.",
    );
  }

  const local = getFailure(failureId);
  if (local === undefined) {
    throw new IbejiError("UNKNOWN_FAILURE", {
      why: `"${failureId}" is not a failure id in the catalog.`,
      fix: "Run ibeji fail --help for the list of failure ids.",
    });
  }

  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const [twinList, failureList] = await Promise.all([client.twins, client.failures]);
  const failure = failureList.failures.find((item) => item.id === failureId);

  if (failure === undefined || failure.support.length === 0) {
    throw new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
      what: "No registered twin supports this failure.",
      why: "The failure is in the catalog, but no twin in this version declares support for it.",
      fix: "Choose a failure shown by ibeji fail --help.",
    });
  }

  const normalised = normaliseNullableFlags(args, nullableSettingNames(failure));
  const parsed = parseCli(normalised, failOptions(failure));
  const extra = parsed.positionals.filter((item) => item !== failureId);
  if (extra.length > 0) {
    throw usage(
      "The fail command received extra arguments.",
      `Unexpected arguments: ${extra.join(" ")}.`,
      "Put settings in flags, for example --seconds 8.",
    );
  }

  const settingsResult = failureSettings(failure, parsed.values);
  const rawTwins = stringValue(parsed.values, "twin");
  const requestedTwins = listOf(rawTwins);
  const action = stringValue(parsed.values, "on");
  if (action !== undefined && action.trim().length === 0) {
    throw usage(
      "The --on value is empty.",
      "The action selector has no text.",
      "Use a resource, a local action id, or a full action id.",
    );
  }

  const problems: string[] = [...settingsResult.problems];
  const unknownTwins: string[] = [];
  const stoppedTwins: string[] = [];
  const unsupportedTwins: string[] = [];

  for (const twinId of requestedTwins) {
    const twin = twinFrom(twinList, twinId);
    if (twin === undefined) {
      unknownTwins.push(twinId);
      continue;
    }
    if (!twin.running) {
      stoppedTwins.push(twinId);
      continue;
    }
    if (!failure.support.some((item) => item.twin === twinId)) {
      unsupportedTwins.push(twinId);
    }
  }

  if (requestedTwins.length > 0 && unknownTwins.length > 0) {
    throw new IbejiError("UNKNOWN_TWIN", {
      why: `These twin ids are not registered: ${unknownTwins.join(", ")}. Registered twins: ${twinList.twins
        .map((item) => item.id)
        .join(", ")}.`,
    });
  }
  if (requestedTwins.length > 0 && stoppedTwins.length > 0) {
    throw new IbejiError("TWIN_NOT_RUNNING", {
      what: "A chosen twin is not running.",
      why: `Not running: ${displayNames(stoppedTwins, twinList)}.`,
      fix: "Start the twin with ibeji start --twins and try again.",
    });
  }
  if (requestedTwins.length > 0 && unsupportedTwins.length > 0) {
    const first = unsupportedTwins[0] as string;
    const error = unsupportedFailure(failure, first, twinList);
    if (problems.length > 0) {
      throw new IbejiError("INVALID_RULE", {
        why: `${error.why} ${problems.join("; ")}.`,
      });
    }
    throw error;
  }

  if (requestedTwins.length === 0) {
    const supportedRunning = failure.support.filter(
      (item) => twinFrom(twinList, item.twin)?.running === true,
    );
    if (supportedRunning.length === 0) {
      throw new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
        what: "No running twin supports this failure.",
        why: `The twins that support it: ${displayNames(
          failure.support.map((item) => item.twin),
          twinList,
        )}.`,
        fix: "Start one of those twins with ibeji start --twins.",
      });
    }
  }

  if (problems.length > 0) {
    throw new IbejiError("INVALID_RULE", {
      why: `The rule settings are invalid: ${problems.join("; ")}.`,
      fix: "Correct every setting named in the error and try again.",
    });
  }

  const result = await client.addRule({
    failureId,
    settings: settingsResult.settings,
    ...(requestedTwins.length === 0 ? {} : { twins: requestedTwins }),
    ...(action === undefined ? {} : { actions: action }),
  });

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, result);
    return 0;
  }

  writeLine(runtime.stdout, `Added the ${failure.name} failure.`);
  printRule(runtime.stdout, result.rule);
  return 0;
}

export async function runClear(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, CLEAR_OPTIONS);
  if (parsed.positionals.length > 1) {
    throw usage(
      "The clear command takes at most one failure id.",
      `Unexpected arguments: ${parsed.positionals.slice(1).join(" ")}.`,
      "Run ibeji clear [failure] --help.",
    );
  }
  const failureId = parsed.positionals[0];
  if (failureId !== undefined) {
    const failure = getFailure(failureId);
    if (failure === undefined) {
      throw new IbejiError("UNKNOWN_FAILURE", {
        why: `"${failureId}" is not a failure id in the catalog.`,
        fix: "Run ibeji fail --help for the list of failure ids.",
      });
    }
  }

  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const twinId = stringValue(parsed.values, "twin");
  const twinList = await client.twins;
  if (twinId !== undefined) {
    requireTwin(twinList, twinId, true);
  }

  let removed = 0;
  if (failureId === undefined) {
    const result = await client.clearRules(twinId);
    removed = result.removed;
  } else {
    const rules = await client.rules;
    const matching = rules.rules.filter(
      (rule) =>
        rule.failureId === failureId && (twinId === undefined || rule.twins.includes(twinId)),
    );
    for (const rule of matching) {
      await client.removeRule(rule.id);
    }
    removed = matching.length;
  }

  await client.stopScenario();

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, { ok: true, removed });
    return 0;
  }

  writeLine(runtime.stdout, `Removed ${removed} rule${removed === 1 ? "" : "s"}.`);
  return 0;
}

function scenarioTwinNames(scenarioTwins: readonly string[], list: TwinList): string {
  return displayNames(scenarioTwins, list);
}

export async function runScenario(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (subcommand === "list") {
    const parsed = parseCli(rest, SCENARIO_LIST_OPTIONS);
    noPositionals(parsed.positionals, "scenario list");
    const { client } = await requireSession(runtime.home, (message) =>
      writeLine(runtime.stderr, message),
    );
    const result = await client.scenarios;

    if (booleanValue(parsed.values, "json")) {
      printJson(runtime.stdout, result);
      return 0;
    }

    for (const scenario of result.scenarios) {
      writeLine(runtime.stdout, `${scenario.name} (${scenario.id})`);
      writeWrapped(
        runtime.stdout,
        `  Twins: ${scenario.twins.join(", ")}. Running: ${scenario.running ? "yes" : "no"}.`,
        "  ",
      );
      writeWrapped(runtime.stdout, `  ${scenario.story}`, "  ");
      writeLine(runtime.stdout);
    }
    return 0;
  }

  if (subcommand === "run") {
    const parsed = parseCli(rest, SCENARIO_RUN_OPTIONS);
    if (parsed.positionals.length !== 1) {
      throw usage(
        "The scenario run command needs one scenario id.",
        `Received ${parsed.positionals.length} positional values.`,
        "Run ibeji scenario run <id>, for example ibeji scenario run kola-case.",
      );
    }
    const scenarioId = parsed.positionals[0] as string;
    const { client } = await requireSession(runtime.home, (message) =>
      writeLine(runtime.stderr, message),
    );
    const [scenarios, twinList] = await Promise.all([client.scenarios, client.twins]);
    const scenario = scenarios.scenarios.find((item) => item.id === scenarioId);
    if (scenario === undefined) {
      throw new IbejiError("UNKNOWN_SCENARIO", {
        why: `"${scenarioId}" is not a loaded scenario.`,
        fix: "Use a scenario id shown by ibeji scenario list.",
      });
    }

    const requested = listOf(stringValue(parsed.values, "twin"));
    for (const twinId of requested) {
      const twin = twinFrom(twinList, twinId);
      if (twin === undefined) {
        throw new IbejiError("UNKNOWN_TWIN", {
          why: `"${twinId}" is not a registered twin.`,
        });
      }
      if (!scenario.twins.includes(twinId)) {
        throw new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
          what: `The ${scenario.name} scenario does not support the ${twin.displayName} twin.`,
          why: `The scenario supports: ${scenarioTwinNames(scenario.twins, twinList)}.`,
          fix: "Choose a twin the scenario supports.",
        });
      }
      if (!twin.running) {
        throw new IbejiError("TWIN_NOT_RUNNING", {
          what: `The ${twin.displayName} twin is not running.`,
          why: "A scenario can only run on a twin in the current session.",
          fix: "Start the twin with ibeji start --twins.",
        });
      }
    }

    const result = await client.runScenario(
      scenarioId,
      requested.length === 0 ? undefined : requested,
    );
    if (booleanValue(parsed.values, "json")) {
      printJson(runtime.stdout, result);
      return 0;
    }
    writeLine(runtime.stdout, `Started ${scenario.name}.`);
    writeLine(runtime.stdout, `Twins: ${result.twins.join(", ")}.`);
    return 0;
  }

  if (subcommand === "stop") {
    const parsed = parseCli(rest, SCENARIO_STOP_OPTIONS);
    noPositionals(parsed.positionals, "scenario stop");
    const { client } = await requireSession(runtime.home, (message) =>
      writeLine(runtime.stderr, message),
    );
    const result = await client.stopScenario();
    if (booleanValue(parsed.values, "json")) {
      printJson(runtime.stdout, result);
      return 0;
    }
    writeLine(
      runtime.stdout,
      result.stopped === null ? "No scenario was running." : "Scenario stopped.",
    );
    return 0;
  }

  throw usage(
    "The scenario command needs list, run or stop.",
    subcommand === undefined
      ? "No scenario command was given."
      : `"${subcommand}" is not a scenario command.`,
    "Run ibeji scenario --help.",
  );
}

export async function runWebhookUrl(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, WEBHOOK_URL_OPTIONS);
  if (parsed.positionals.length < 1 || parsed.positionals.length > 2) {
    throw usage(
      "The webhook-url command needs a twin and an optional URL.",
      `Received ${parsed.positionals.length} positional values.`,
      "Run ibeji webhook-url <twin> [url] --help.",
    );
  }
  const twinId = parsed.positionals[0] as string;
  const url = parsed.positionals[1];
  const clear = booleanValue(parsed.values, "clear");
  if (clear && url !== undefined) {
    throw usage(
      "A URL and --clear cannot be used together.",
      "The command would both set and remove the URL.",
      "Use either a URL or --clear.",
    );
  }

  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const twinList = await client.twins;
  const twin = requireTwin(twinList, twinId, false);

  const result =
    url === undefined && !clear
      ? await client.webhookUrl(twinId)
      : await client.setWebhookUrl(twinId, clear ? "" : (url as string));

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, result);
    return 0;
  }

  if (result.url === null) {
    writeLine(runtime.stdout, `${twin.displayName} webhook URL: not set`);
  } else {
    writeWrapped(runtime.stdout, `${twin.displayName} webhook URL: ${result.url}`);
  }
  return 0;
}

export async function runKeys(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, KEYS_OPTIONS);
  if (parsed.positionals.length > 1) {
    throw usage(
      "The keys command takes at most one twin id.",
      `Unexpected arguments: ${parsed.positionals.slice(1).join(" ")}.`,
      "Run ibeji keys [twin] --help.",
    );
  }

  const project = await loadProject();
  const twinId = parsed.positionals[0];
  let definitions: readonly TwinDefinition[] = project.definitions;
  if (twinId !== undefined) {
    const definition = project.definitions.find((item) => item.id === twinId);
    if (definition === undefined) {
      throw new IbejiError("UNKNOWN_TWIN", {
        why: `"${twinId}" is not a registered twin. Registered twins: ${project.definitions
          .map((item) => item.id)
          .join(", ")}.`,
      });
    }
    definitions = [definition];
  }

  const store = await CredentialsStore.load(runtime.home, project.definitions);
  if (booleanValue(parsed.values, "rotate")) {
    await store.rotate(twinId);
  }

  const twins = definitions.map((definition) => ({
    id: definition.id,
    displayName: definition.displayName,
    credentials: store.views(definition.id).map((credential) => ({
      id: credential.id,
      label: credential.label,
      role: credential.role,
      secret: credential.secret,
      value: credential.value,
    })),
  }));

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, { twins });
    return 0;
  }

  for (const [index, twin] of twins.entries()) {
    if (index > 0) {
      writeLine(runtime.stdout);
    }
    writeLine(runtime.stdout, `${twin.displayName} credentials`);
    for (const credential of twin.credentials) {
      const prefix = `  ${credential.label}: `;
      if (prefix.length + credential.value.length <= 80) {
        writeLine(runtime.stdout, `${prefix}${credential.value}`);
      } else {
        writeLine(runtime.stdout, `  ${credential.label}:`);
        writeLine(runtime.stdout, `    ${credential.value}`);
      }
    }
  }
  return 0;
}

function printEvent(writer: Writer, event: EventItem, json: boolean): void {
  if (json) {
    printJson(writer, event);
    return;
  }
  writeWrapped(writer, `#${event.id} ${formatTime(event.time)} [${event.scope}] ${event.type}`);
  writeWrapped(writer, event.summary, "  ");
}

async function followEvents(
  client: ControlClient,
  scope: string | undefined,
  json: boolean,
  runtime: CliRuntime,
): Promise<void> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (runtime.followSignal !== undefined) {
    if (runtime.followSignal.aborted) {
      return;
    }
    runtime.followSignal.addEventListener("abort", abort, { once: true });
  }
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    const response = await fetch(client.eventStreamUrl(scope), {
      headers: {
        authorization: client.authorizationHeader,
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new IbejiError("INTERNAL", {
        what: "The event stream could not be opened.",
        why: `The control API answered with HTTP ${response.status}.`,
        fix: "Try again. If the problem continues, restart Ibeji.",
      });
    }
    if (response.body === null) {
      throw new IbejiError("INTERNAL", {
        what: "The event stream had no body.",
        why: "The control API returned an empty streaming response.",
        fix: "Try again. If the problem continues, restart Ibeji.",
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          break;
        }
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("\n");
        if (data.length === 0) {
          continue;
        }
        try {
          printEvent(runtime.stdout, JSON.parse(data) as EventItem, json);
        } catch (error) {
          throw new IbejiError("INTERNAL", {
            what: "An event message was not valid JSON.",
            why: "The control API sent an event that the CLI could not read.",
            fix: "Try again. If the problem continues, restart Ibeji.",
            cause: error,
          });
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    runtime.followSignal?.removeEventListener("abort", abort);
  }
}

export async function runEvents(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, EVENTS_OPTIONS);
  noPositionals(parsed.positionals, "events");
  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const twinId = stringValue(parsed.values, "twin");
  if (twinId !== undefined) {
    const twinList = await client.twins;
    requireTwin(twinList, twinId, true);
  }
  const json = booleanValue(parsed.values, "json");

  if (booleanValue(parsed.values, "follow")) {
    await followEvents(client, twinId, json, runtime);
    return 0;
  }

  const result = await client.events({ ...(twinId === undefined ? {} : { scope: twinId }) });
  if (json) {
    printJson(runtime.stdout, result);
    return 0;
  }
  for (const event of result.events) {
    printEvent(runtime.stdout, event, false);
  }
  return 0;
}

export async function runResend(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, RESEND_OPTIONS);
  if (parsed.positionals.length !== 1) {
    throw usage(
      "The resend command needs one delivery id.",
      `Received ${parsed.positionals.length} positional values.`,
      "Run ibeji resend <delivery-id> --help.",
    );
  }
  const deliveryId = parsed.positionals[0] as string;
  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const result = await client.resend(deliveryId);

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, result);
    return 0;
  }
  writeLine(runtime.stdout, `Resent webhook delivery ${deliveryId}.`);
  return 0;
}

async function askResetConfirmation(question: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(question);
    return /^(?:y|yes)$/iu.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function runReset(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, RESET_OPTIONS);
  noPositionals(parsed.positionals, "reset");
  const twinId = stringValue(parsed.values, "twin");
  const json = booleanValue(parsed.values, "json");
  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const twinList = await client.twins;
  const twin = twinId === undefined ? undefined : requireTwin(twinList, twinId, true);

  if (!booleanValue(parsed.values, "yes") && !json) {
    const target = twin === undefined ? "all twin records" : `${twin.displayName} records`;
    const confirm = runtime.confirmReset ?? askResetConfirmation;
    const confirmed = await confirm(
      `Reset ${target}? This removes records and abandons queued webhooks. [y/N] `,
    );
    if (!confirmed) {
      writeLine(runtime.stdout, "Nothing was changed.");
      return 0;
    }
  }

  if (!booleanValue(parsed.values, "yes") && json) {
    throw usage(
      "The reset command needs --yes with --json.",
      "A JSON command cannot ask for confirmation.",
      "Add --yes to confirm the reset.",
    );
  }

  const result = await client.reset(twinId);
  if (json) {
    printJson(runtime.stdout, result);
    return 0;
  }
  writeLine(
    runtime.stdout,
    twin === undefined ? "Reset all twin records." : `Reset ${twin.displayName} records.`,
  );
  return 0;
}

export async function runExport(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, EXPORT_OPTIONS);
  if (parsed.positionals.length !== 1) {
    throw usage(
      "The export command needs one file path.",
      `Received ${parsed.positionals.length} positional values.`,
      "Run ibeji export <file>, for example ibeji export ibeji-session.json.",
    );
  }
  const file = resolve(runtime.cwd, parsed.positionals[0] as string);
  const { client } = await requireSession(runtime.home, (message) =>
    writeLine(runtime.stderr, message),
  );
  const value = await client.exportSession();

  try {
    await writePrivateJson(file, value);
  } catch (error) {
    throw new IbejiError("INTERNAL", {
      what: "The export file could not be written.",
      why: `The file at ${file} could not be written.`,
      fix: "Check the folder path and its permissions, then try again.",
      cause: error,
    });
  }

  if (booleanValue(parsed.values, "json")) {
    printJson(runtime.stdout, { ok: true, file });
    return 0;
  }
  writeLine(runtime.stdout, `Saved the session to ${file}.`);
  return 0;
}

export async function runMcp(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, MCP_OPTIONS);
  noPositionals(parsed.positionals, "mcp");
  serveIbejiMcp({ home: runtime.home });
  return 0;
}
