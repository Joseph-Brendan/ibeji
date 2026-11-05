import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
// Generated build and test-output folders can contain Markdown from failures.
// The documents this test owns are outside them.
const SKIP = new Set([
  "node_modules",
  ".git",
  "coverage",
  "dist",
  "test-results",
  "playwright-report",
  "blob-report",
]);

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

describe("C19 documentation", () => {
  it("C19 no Markdown file outside node_modules contains an em dash or en dash", async () => {
    const files = await markdownFiles(ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.includes("\u2014") || line.includes("\u2013")) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
