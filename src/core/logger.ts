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
  readonly sanitize?: (value: unknown) => unknown;
};

/**
 * Ibeji's only logger. The default writer is stderr, never stdout; callers can
 * inject a writer in tests, but production code always uses stderr.
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly write: LogWriter;
  private readonly sanitize: ((value: unknown) => unknown) | undefined;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.sanitize = options.sanitize;
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

    const sanitize = this.sanitize;
    const safeMessage = sanitize === undefined ? message : String(sanitize(message));
    const safeDetails =
      details === undefined || sanitize === undefined ? details : sanitize(details);
    const suffix = safeDetails === undefined ? "" : ` ${JSON.stringify(safeDetails)}`;
    this.write(`${level}: ${safeMessage}${suffix}`);
  }
}

export const logger = new Logger();
