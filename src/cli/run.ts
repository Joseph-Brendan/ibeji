import open from "open";

import type { RunningSession } from "../control/session.js";
import type { IbejiError } from "../core/errors.js";
import { createLiveKeyScanner } from "../shared/live-key-scanner.js";
import { liveKeyPatterns } from "../twins/registry.js";
import { booleanValue, CliUsageError, firstPositional, parseCli, stringValue } from "./args.js";
import {
  type CliRuntime,
  runClear,
  runEvents,
  runExport,
  runFail,
  runKeys,
  runMcp,
  runOpen,
  runResend,
  runReset,
  runScenario,
  runStatus,
  runWebhookUrl,
} from "./commands.js";
import { doctorErrorCount, printDoctor, runDoctor } from "./doctor.js";
import { commandHelp, failHelp, generalHelp } from "./help.js";
import { asIbejiError, errorBody, type Writer, writeHumanError, writeLine } from "./output.js";
import { loadProject } from "./project.js";
import { cliHome } from "./session.js";
import { runStart } from "./start.js";

export type RunCliOptions = {
  readonly home?: string;
  readonly cwd?: string;
  readonly stdout?: Writer;
  readonly stderr?: Writer;
  readonly openBrowser?: (url: string) => Promise<unknown>;
  readonly followSignal?: AbortSignal;
  readonly waitForShutdown?: boolean;
  readonly confirmReset?: (question: string) => Promise<boolean>;
  readonly onStarted?: (session: RunningSession) => void;
};

const DOCTOR_OPTIONS = {
  config: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
} as const;

function wantsHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function unknownCommand(command: string): CliUsageError {
  return new CliUsageError({
    what: "The command is not known.",
    why: `"${command}" is not an Ibeji command.`,
    fix: "Run ibeji --help for the list of commands.",
  });
}

function outputError(error: IbejiError, json: boolean, stdout: Writer, stderr: Writer): number {
  if (json) {
    writeLine(stdout, JSON.stringify(errorBody(error)));
  } else {
    writeHumanError(stderr, error);
  }
  return error instanceof CliUsageError ? 2 : 1;
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const outputScanner = createLiveKeyScanner(liveKeyPatterns());
  const baseStdout = options.stdout ?? ((text: string) => process.stdout.write(text));
  const baseStderr = options.stderr ?? ((text: string) => process.stderr.write(text));
  const stdout = (text: string) => baseStdout(outputScanner.scanText(text).value);
  const stderr = (text: string) => baseStderr(outputScanner.scanText(text).value);
  const home = options.home ?? cliHome();
  const cwd = options.cwd ?? process.cwd();
  const openBrowser = options.openBrowser ?? ((url: string) => open(url));
  const jsonRequested = argv.some((arg) => arg === "--json" || arg.startsWith("--json="));
  const runtime: CliRuntime = {
    home,
    cwd,
    stdout,
    stderr,
    openBrowser,
    ...(options.followSignal === undefined ? {} : { followSignal: options.followSignal }),
    ...(options.confirmReset === undefined ? {} : { confirmReset: options.confirmReset }),
  };

  const command = argv[0];
  if (command === undefined) {
    stdout(generalHelp());
    return 0;
  }
  if (command === "--help" || command === "-h") {
    stdout(generalHelp());
    return 0;
  }
  if (command === "--version" || command === "-v") {
    try {
      const project = await loadProject();
      writeLine(stdout, project.packageInfo.version);
      return 0;
    } catch (error) {
      return outputError(asIbejiError(error), jsonRequested, stdout, stderr);
    }
  }

  const args = argv.slice(1);
  const help = wantsHelp(args);

  try {
    if (help) {
      if (command === "fail") {
        const failureId = firstPositional(args);
        stdout(failHelp(failureId));
        return 0;
      }
      if (command === "scenario") {
        stdout(commandHelp("scenario", args[0]));
        return 0;
      }
      stdout(commandHelp(command));
      return 0;
    }

    switch (command) {
      case "start":
        return await runStart(args, {
          home,
          cwd,
          stdout,
          stderr,
          openBrowser,
          ...(options.waitForShutdown === undefined
            ? {}
            : { waitForShutdown: options.waitForShutdown }),
          ...(options.onStarted === undefined ? {} : { onStarted: options.onStarted }),
        });
      case "open":
        return await runOpen(args, runtime);
      case "status":
        return await runStatus(args, runtime);
      case "fail":
        return await runFail(args, runtime);
      case "clear":
        return await runClear(args, runtime);
      case "scenario":
        return await runScenario(args, runtime);
      case "webhook-url":
        return await runWebhookUrl(args, runtime);
      case "keys":
        return await runKeys(args, runtime);
      case "events":
        return await runEvents(args, runtime);
      case "resend":
        return await runResend(args, runtime);
      case "reset":
        return await runReset(args, runtime);
      case "export":
        return await runExport(args, runtime);
      case "mcp":
        return await runMcp(args, runtime);
      case "doctor":
        return await runDoctorCommand(args, runtime);
      default:
        throw unknownCommand(command);
    }
  } catch (error) {
    return outputError(asIbejiError(error), jsonRequested, stdout, stderr);
  }
}

async function runDoctorCommand(args: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseCli(args, DOCTOR_OPTIONS);
  if (parsed.positionals.length > 0) {
    throw new CliUsageError({
      what: "The doctor command does not take an argument.",
      why: `Unexpected arguments: ${parsed.positionals.join(" ")}.`,
      fix: "Run ibeji doctor --help to see the flags.",
    });
  }

  const project = await loadProject();
  const result = await runDoctor({
    home: runtime.home,
    cwd: runtime.cwd,
    configPath: stringValue(parsed.values, "config"),
    project,
  });

  if (booleanValue(parsed.values, "json")) {
    writeLine(runtime.stdout, JSON.stringify(result));
  } else {
    printDoctor(result, runtime.stdout);
  }

  return doctorErrorCount(result) === 0 ? 0 : 1;
}
