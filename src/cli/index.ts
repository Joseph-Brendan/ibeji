import { asIbejiError, writeHumanError } from "./output.js";
import { runCli } from "./run.js";

export function reportUnhandled(reason: unknown): void {
  const error = asIbejiError(reason);
  writeHumanError((text) => process.stderr.write(text), error);
  process.exitCode = 1;
}

export function applyExitCode(exitCode: number): void {
  if (process.exitCode === undefined) {
    process.exitCode = exitCode;
  }
}

process.on("unhandledRejection", reportUnhandled);

const exitCode = await runCli(process.argv.slice(2));
applyExitCode(exitCode);
