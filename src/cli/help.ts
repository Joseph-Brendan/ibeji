import { FAILURE_CATALOG, getFailure } from "../core/failures/catalog.js";
import { registry } from "../twins/registry.js";
import { wrapText } from "./output.js";

function exampleTwin(): string {
  return registry.list()[0]?.id ?? "twin";
}

const GENERAL = `Ibeji runs local twins of payment services.

Usage:
  ibeji <command> [options]

Commands:
  start          Start twins, the control API and the dashboard
  open           Print and open a fresh dashboard link
  status         Show the running session, seed and active rules
  fail           Switch on a failure
  clear          Remove failure rules
  scenario       List, run or stop a scenario
  webhook-url    Show or set a twin's webhook URL
  keys           Print or rotate test credentials
  events         Print events, or follow them live
  resend         Resend one webhook delivery
  reset          Reset one twin or all twin records
  export         Save the session to a JSON file
  mcp            Run the MCP server over stdio
  doctor         Check the setup and explain problems

Every command has --help.
Example: ibeji start --twins ${exampleTwin()} --no-open
`;

const START = `Usage:
  ibeji start [options]

Starts the chosen twins, the control API and the dashboard. It prints each
twin's base URL and test credentials, the seed and the dashboard link.

Options:
  --twins <ids>                 Comma-separated twin ids. Default: all twins.
  --port <n>                    Control API port. Default: 4400.
  --twin-port <twin>=<n>        Twin port. Repeat for more than one twin.
  --seed <n>                    Whole number from 0 to 4294967295.
  --scenario <id>               Run a scenario after the session starts.
  --no-open                     Do not open the dashboard in a browser.
  --allow-private-webhooks      Allow private network webhook addresses.
  --allow-public-webhooks       Allow public webhook addresses.
  --config <file>               Use this config file instead.
  --json                        Print one JSON object.
  --help                        Show this help.

Example: ibeji start --twins ${exampleTwin()} --no-open
`;

const OPEN = `Usage:
  ibeji open [options]

Prints a fresh dashboard link for the running session and opens it.

Options:
  --no-open     Print the link but do not open a browser.
  --json        Print one JSON object.
  --help        Show this help.

Example: ibeji open --no-open
`;

const STATUS = `Usage:
  ibeji status [options]

Shows the running session, each twin, the seed and every active rule.

Options:
  --json     Print one JSON object.
  --help     Show this help.

Example: ibeji status --json
`;

const CLEAR = `Usage:
  ibeji clear [failure] [options]

Removes one failure's rules, or every rule. It also stops a running scenario.

Options:
  --twin <ids>   Comma-separated twin ids.
  --json         Print one JSON object.
  --help         Show this help.

Example: ibeji clear webhook-delayed --twin ${exampleTwin()}
`;

const SCENARIO = `Usage:
  ibeji scenario <list|run|stop> [options]

Commands:
  list                 List every scenario and its twins.
  run <id>             Run a scenario.
  stop                 Stop the running scenario.

Options for run:
  --twin <ids>         Comma-separated twin ids the scenario supports.
  --json               Print one JSON object.
  --help               Show this help.

Example: ibeji scenario run slow-friday --twin ${exampleTwin()}
`;

const SCENARIO_LIST = `Usage:
  ibeji scenario list [options]

Lists every scenario, its twins and whether it is running.

Options:
  --json     Print one JSON object.
  --help     Show this help.

Example: ibeji scenario list --json
`;

const SCENARIO_RUN = `Usage:
  ibeji scenario run <id> [options]

Runs one scenario. The default is every supported twin that is running.

Options:
  --twin <ids>   Comma-separated twin ids.
  --json         Print one JSON object.
  --help         Show this help.

Example: ibeji scenario run kola-case --twin ${exampleTwin()}
`;

const SCENARIO_STOP = `Usage:
  ibeji scenario stop [options]

Stops the running scenario and removes the rules it owns.

Options:
  --json     Print one JSON object.
  --help     Show this help.

Example: ibeji scenario stop --json
`;

const WEBHOOK_URL = `Usage:
  ibeji webhook-url <twin> [url] [options]

Shows where one twin sends webhooks, or sets that URL.

Options:
  --clear     Remove the URL.
  --json      Print one JSON object.
  --help      Show this help.

Example: ibeji webhook-url ${exampleTwin()} http://127.0.0.1:3000/webhook
`;

const KEYS = `Usage:
  ibeji keys [twin] [options]

Prints the stored test credentials. This works without a running session.

Options:
  --rotate     Replace the credentials for one twin, or for all twins.
  --json       Print one JSON object.
  --help       Show this help.

Example: ibeji keys ${exampleTwin()} --rotate
`;

const EVENTS = `Usage:
  ibeji events [options]

Prints the newest events, or follows new events until you press Control and C.

Options:
  --follow       Keep the connection open and print new events.
  --twin <id>    Show only one twin's events.
  --json         Print one JSON object, or one event per line with --follow.
  --help         Show this help.

Example: ibeji events --twin ${exampleTwin()} --json
`;

const RESEND = `Usage:
  ibeji resend <delivery-id> [options]

Resends one webhook delivery to the twin's current webhook URL.

Options:
  --json     Print one JSON object.
  --help     Show this help.

Example: ibeji resend delivery-1 --json
`;

const RESET = `Usage:
  ibeji reset [options]

Resets one twin's records, or every twin's records. It keeps rules, scenarios,
webhook URLs, credentials and the event log.

Options:
  --twin <id>   Reset only this twin.
  --yes         Do not ask for confirmation.
  --json        Print one JSON object.
  --help        Show this help.

Example: ibeji reset --twin ${exampleTwin()} --yes
`;

const EXPORT = `Usage:
  ibeji export <file> [options]

Saves the session to a JSON file with mode 600. The export removes tokens,
launch codes, full credentials, live keys and authorization headers.

Options:
  --json     Print one JSON object.
  --help     Show this help.

Example: ibeji export ibeji-session.json
`;

const MCP = `Usage:
  ibeji mcp [options]

Runs the MCP server over stdio for an AI coding agent. Start Ibeji with
"ibeji start" first. Only MCP messages go to standard output; logs go to
standard error.

Options:
  --help     Show this help.

Example: ibeji mcp
`;

const DOCTOR = `Usage:
  ibeji doctor [options]

Checks Node, ports, the config file, the session file, credentials file
permissions, the dashboard build and each webhook URL. It prints what, why and
fix for every problem. Exit code 0 means every check passed.

Options:
  --config <file>   Check this config file instead of ibeji.config.json.
  --json            Print one JSON object.
  --help            Show this help.

Example: ibeji doctor --json
`;

export function generalHelp(): string {
  return GENERAL;
}

export function commandHelp(command: string, subcommand?: string): string {
  switch (command) {
    case "start":
      return START;
    case "open":
      return OPEN;
    case "status":
      return STATUS;
    case "fail":
      return failHelp();
    case "clear":
      return CLEAR;
    case "scenario":
      if (subcommand === "list") {
        return SCENARIO_LIST;
      }
      if (subcommand === "run") {
        return SCENARIO_RUN;
      }
      if (subcommand === "stop") {
        return SCENARIO_STOP;
      }
      return SCENARIO;
    case "webhook-url":
      return WEBHOOK_URL;
    case "keys":
      return KEYS;
    case "events":
      return EVENTS;
    case "resend":
      return RESEND;
    case "reset":
      return RESET;
    case "export":
      return EXPORT;
    case "mcp":
      return MCP;
    case "doctor":
      return DOCTOR;
    default:
      return GENERAL;
  }
}

function settingFlag(name: string, schema: unknown): string {
  const value = schema as Readonly<Record<string, unknown>>;
  if (Array.isArray(value.enum)) {
    return `--${name} <${value.enum.join("|")}>`;
  }
  if (Array.isArray(value.anyOf)) {
    return `--${name} <value|empty>`;
  }
  return `--${name} <value>`;
}

export function failHelp(failureId?: string): string {
  if (failureId === undefined) {
    const lines = [
      "Usage:",
      "  ibeji fail <failure> [settings] [options]",
      "",
      "Switches on a failure for one or more twins. Settings are flags named",
      "after the failure's settings.",
      "",
      "Options:",
      "  --twin <ids>   Comma-separated twin ids.",
      "  --on <action>  A resource, a local action id, or a full action id.",
      "  --json         Print one JSON object.",
      "  --help         Show this help.",
      "",
      "Failures:",
    ];

    for (const failure of FAILURE_CATALOG) {
      lines.push(`  ${failure.id.padEnd(26)} ${failure.name}`);
    }
    lines.push("", `Example: ibeji fail slow-response --seconds 8 --twin ${exampleTwin()}`);
    return `${lines.join("\n")}\n`;
  }

  const failure = getFailure(failureId);
  if (failure === undefined) {
    return failHelp();
  }
  const lines = [
    `Usage:`,
    `  ibeji fail ${failure.id} [settings] [options]`,
    "",
    ...wrapText(failure.description.realLife, 78),
    "",
    "Settings:",
  ];

  const properties = failure.settingsJsonSchema.properties ?? {};
  for (const [name, schema] of Object.entries(properties)) {
    if (name === "twins" || name === "actions") {
      continue;
    }
    lines.push(`  ${settingFlag(name, schema)}`);
  }

  lines.push(
    "",
    "Options:",
    "  --twin <ids>   Comma-separated twin ids.",
    "  --on <action>  A resource, a local action id, or a full action id.",
    "  --json         Print one JSON object.",
    "  --help         Show this help.",
    "",
    `Example: ibeji fail ${failure.id} --twin ${exampleTwin()}`,
  );
  return `${lines.join("\n")}\n`;
}
