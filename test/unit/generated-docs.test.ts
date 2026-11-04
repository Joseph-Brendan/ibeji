import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("C19 generated documentation", () => {
  it("C19: committed docs match the catalog and scenario files", () => {
    const output = execFileSync(process.execPath, ["scripts/generate-docs.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });

    expect(output).toContain("Docs match the failure catalog and scenario files.");
  });
});
