import { afterEach, describe, expect, it, vi } from "vitest";

import { Logger } from "../../src/core/logger.js";

describe("C12 logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("C12: writes nothing to stdout at any level", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new Logger({ level: "debug" });

    logger.error("error message");
    logger.warn("warn message");
    logger.info("info message");
    logger.debug("debug message");

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(4);
  });

  it("C12: writes each level to the provided writer", () => {
    const lines: string[] = [];
    const logger = new Logger({ level: "debug", write: (line) => lines.push(line) });

    logger.error("error message", { code: 1 });
    logger.warn("warn message");
    logger.info("info message", { code: 3 });
    logger.debug("debug message");

    expect(lines).toEqual([
      'error: error message {"code":1}',
      "warn: warn message",
      'info: info message {"code":3}',
      "debug: debug message",
    ]);
  });

  it("C12: suppresses messages below the configured level", () => {
    const lines: string[] = [];
    const logger = new Logger({ level: "info", write: (line) => lines.push(line) });

    logger.debug("hidden");
    logger.info("shown");

    expect(lines).toEqual(["info: shown"]);
  });

  it("C12: defaults to info and stderr", () => {
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const logger = new Logger();

    logger.debug("hidden");
    logger.info("shown");

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["info: shown\n"]);
  });
});
