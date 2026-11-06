import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { CREDENTIAL_MASK, captureScreenshot } from "../../scripts/screenshots.mjs";

describe("D50 screenshot credentials", () => {
  it("D50 masks credentials before the screenshot is taken", async () => {
    const calls: string[] = [];
    const page = {
      locator: () => ({
        evaluateAll: async (_callback: unknown, mask: string) => {
          calls.push(`mask:${mask}`);
        },
      }),
      screenshot: async () => {
        calls.push("screenshot");
      },
    } as unknown as Page;

    await captureScreenshot(page, "image.png", {});

    expect(calls).toEqual([`mask:${CREDENTIAL_MASK}`, "screenshot"]);
  });

  it("D50 sends both documentation images through the masking capture path", async () => {
    const source = await readFile("scripts/screenshots.mjs", "utf8");
    expect(source.match(/await captureScreenshot\(page/gu)).toHaveLength(2);
    expect(source).toContain('join(OUTPUT, "home.png")');
    expect(source).toContain('join(OUTPUT, "failures.png")');
  });
});
