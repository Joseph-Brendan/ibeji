import { type ErrorCode, IbejiError, isIbejiError } from "../core/errors.js";

export type Writer = (text: string) => void;

export function writeLine(writer: Writer, text = ""): void {
  writer(`${text}\n`);
}

export function wrapText(text: string, width = 78, indent = ""): readonly string[] {
  const limit = Math.max(20, width - indent.length);
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(`${indent}${current}`);
    current = word;
  }

  if (current.length > 0) {
    lines.push(`${indent}${current}`);
  }

  return lines;
}

export function writeWrapped(writer: Writer, text: string, indent = ""): void {
  for (const line of wrapText(text, 78, indent)) {
    writeLine(writer, line);
  }
}

export function errorBody(error: IbejiError): {
  readonly error: {
    readonly code: ErrorCode;
    readonly what: string;
    readonly why: string;
    readonly fix: string;
  };
} {
  return {
    error: {
      code: error.code,
      what: error.what,
      why: error.why,
      fix: error.fix,
    },
  };
}

export function writeHumanError(writer: Writer, error: IbejiError): void {
  writeWrapped(writer, `What happened: ${error.what}`);
  writeWrapped(writer, `Why: ${error.why}`);
  writeWrapped(writer, `Fix: ${error.fix}`);
}
export function asIbejiError(error: unknown): IbejiError {
  if (isIbejiError(error)) {
    return error;
  }
  return new IbejiError("INTERNAL", {
    what: "The command could not finish.",
    why: error instanceof Error ? error.message : String(error),
    fix: "Try again. If the problem continues, report it with the steps that caused it.",
    cause: error,
  });
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value);
}
export function formatTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString();
}
