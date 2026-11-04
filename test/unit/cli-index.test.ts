import { describe, expect, it } from "vitest";

describe("T10 CLI entry point", () => {
  it("T10: the entry point runs the CLI and sets an exit code", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const originalWrite = process.stdout.write;
    const writes: string[] = [];

    process.argv = ["node", "ibeji", "--help"];
    process.exitCode = undefined;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const entry = await import("../../src/cli/index.js");
      expect(writes.join("")).toContain("Ibeji runs local twins");
      expect(process.exitCode ?? 0).toBe(0);

      process.exitCode = 5;
      entry.applyExitCode(1);
      expect(process.exitCode).toBe(5);
      process.exitCode = undefined;
      entry.applyExitCode(1);
      expect(process.exitCode).toBe(1);

      const originalError = process.stderr.write;
      process.stderr.write = (() => true) as typeof process.stderr.write;
      try {
        entry.reportUnhandled(new Error("boom"));
      } finally {
        process.stderr.write = originalError;
      }
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      process.stdout.write = originalWrite;
    }
  });
});
