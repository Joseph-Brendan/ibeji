import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const CHECKED_SURFACES = [
  "request field",
  "event",
  "log",
  "error",
  "export",
  "control API response",
  "CLI output",
  "MCP result",
  "dashboard",
] as const;

const SAFETY_PROMISE =
  "- A live key never appears in full in a request field, an event, a log, an error, an export, a control API response, CLI output, an MCP result or the dashboard. When a live key arrives in a header, query value or body value, Ibeji replaces it with `[live key removed: <fingerprint>]` before the twin handles the request, records a warning, and scans every output again. Only the first eight hexadecimal characters of its SHA-256 hash are shown.";

describe("D51 live-key safety page", () => {
  it("D51 states exactly the surfaces the T6 output test checks", async () => {
    const safety = await readFile("docs/safety.md", "utf8");
    const section = safety.split("## Files and local data")[1]?.split("\n## ")[0] ?? "";
    const promises = section.split("\n").filter((line) => line.startsWith("- A live key"));
    expect(promises).toEqual([SAFETY_PROMISE]);
    const liveKeyLines = section.split("\n").filter((line) => /live key|fingerprint/iu.test(line));
    expect(liveKeyLines).toHaveLength(2);
    expect(liveKeyLines).toContain(SAFETY_PROMISE);
    for (const surface of CHECKED_SURFACES) {
      expect(SAFETY_PROMISE).toContain(surface);
    }
  });
});
