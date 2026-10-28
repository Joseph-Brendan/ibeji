export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export type LogWriter = (line: string) => void;

export type LoggerOptions = {
  readonly level?: LogLevel;
  readonly write?: LogWriter;
};

/**
 * Ibeji's only logger. The default writer is stderr, never stdout; callers can
 * inject a writer in tests, but production code always uses stderr.
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly write: LogWriter;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.write =
      options.write ??
      ((line) => {
        process.stderr.write(`${line}\n`);
      });
  }

  error(message: string, details?: unknown): void {
    this.log("error", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.log("warn", message, details);
  }

  info(message: string, details?: unknown): void {
    this.log("info", message, details);
  }

  debug(message: string, details?: unknown): void {
    this.log("debug", message, details);
  }

  log(level: LogLevel, message: string, details?: unknown): void {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.level]) {
      return;
    }

    const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
    this.write(`${level}: ${message}${suffix}`);
  }
}

export const logger = new Logger();
