import { type ParseArgsConfig, parseArgs } from "node:util";

import { IbejiError, type IbejiErrorOptions } from "../core/errors.js";

export class CliUsageError extends IbejiError {
  readonly usage = true;

  constructor(options: IbejiErrorOptions = {}) {
    super("BAD_REQUEST", options);
  }
}

export type CliValues = Readonly<Record<string, string | boolean | readonly string[] | undefined>>;

export type ParsedCli = {
  readonly values: CliValues;
  readonly positionals: readonly string[];
};

export function parseCli(
  args: readonly string[],
  options: ParseArgsConfig["options"],
  allowPositionals = true,
): ParsedCli {
  try {
    const known = new Set(Object.keys(options ?? {}));
    const loose = parseArgs({
      args: [...args],
      allowPositionals,
      strict: false,
      tokens: true,
    });
    const unknown = loose.tokens
      .filter((token) => token.kind === "option" && !known.has(token.name))
      .map((token) => (token.kind === "option" ? token.rawName : ""));
    if (unknown.length > 0) {
      throw new CliUsageError({
        what: "The command line has unknown options.",
        why: `Unknown options: ${unknown.join(", ")}.`,
        fix: "Run the command with --help to see the expected flags.",
      });
    }

    const parsed = parseArgs({
      args: [...args],
      options,
      allowPositionals,
      strict: true,
      tokens: true,
    });
    return {
      values: parsed.values as CliValues,
      positionals: parsed.positionals,
    };
  } catch (error) {
    if (error instanceof CliUsageError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliUsageError({
      what: "The command line is not valid.",
      why: message,
      fix: "Run the command with --help to see the expected flags.",
      cause: error,
    });
  }
}

export function firstPositional(args: readonly string[]): string | undefined {
  const parsed = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
  return parsed.tokens.find((token) => token.kind === "positional")?.value;
}

export function stringValue(values: CliValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanValue(values: CliValues, name: string): boolean {
  return values[name] === true;
}

export function listValue(values: CliValues, name: string): readonly string[] {
  const value = values[name];
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
}

export function listOf(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
