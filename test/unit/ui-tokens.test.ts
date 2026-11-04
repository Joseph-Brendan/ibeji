import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const EXPECTED = {
  white: "#ffffff",
  black: "#111111",
  purple: "#6b4fa1",
  darkGrey: "#3a3a3a",
  darkPurple: "#2f1b45",
  red: "#8f1d21",
} as const;

function luminance(hex: string): number {
  const value = hex.slice(1);
  const channels = value.match(/../gu);
  if (channels === null) {
    throw new Error(`Invalid colour ${hex}`);
  }
  const numbers = channels.map((channel) => {
    const parsed = Number.parseInt(channel, 16) / 255;
    return parsed <= 0.03928 ? parsed / 12.92 : ((parsed + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (numbers[0] as number) +
    0.7152 * (numbers[1] as number) +
    0.0722 * (numbers[2] as number)
  );
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("T8 UI design tokens", () => {
  it("T8: all design colours live in the token file", async () => {
    const files = (await readdir("ui/src", { recursive: true })) as string[];
    const cssFiles = files.filter((file) => file.endsWith(".css"));
    expect(cssFiles).toEqual(["styles.css"]);

    const css = await readFile("ui/src/styles.css", "utf8");
    const rootEnd = css.indexOf("}");
    expect(rootEnd).toBeGreaterThan(0);
    const outsideRoot = css.slice(rootEnd + 1);
    expect(outsideRoot).not.toMatch(/#[0-9a-f]{3,8}\b/iu);

    for (const [name, value] of Object.entries(EXPECTED)) {
      expect(css).toContain(
        `--ibeji-${name === "darkGrey" ? "dark-grey" : name === "darkPurple" ? "dark-purple" : name}: ${value};`,
      );
    }
  });

  it("T8: every text and background pair passes 4.5 to 1", () => {
    const pairs: readonly (readonly [string, string])[] = [
      [EXPECTED.black, EXPECTED.white],
      [EXPECTED.darkGrey, EXPECTED.white],
      [EXPECTED.purple, EXPECTED.white],
      [EXPECTED.darkPurple, EXPECTED.white],
      [EXPECTED.white, EXPECTED.black],
      [EXPECTED.white, EXPECTED.purple],
      [EXPECTED.white, EXPECTED.darkGrey],
      [EXPECTED.white, EXPECTED.darkPurple],
      [EXPECTED.white, EXPECTED.red],
    ];

    for (const [text, background] of pairs) {
      expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("T8: no service id or browser storage appears in UI source", async () => {
    const files = (await readdir("ui/src", { recursive: true })) as string[];
    const sourceFiles = files.filter((file) => /\.(?:ts|tsx|css)$/u.test(file));
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const file of sourceFiles) {
      const text = await readFile(`ui/src/${file}`, "utf8");
      expect(text, file).not.toMatch(/paystack|flutterwave|stripe/iu);
      expect(text, file).not.toMatch(/localStorage|sessionStorage|indexedDB/iu);
    }
  });

  it("T8: the visual style uses no shadows or gradients", async () => {
    const css = await readFile("ui/src/styles.css", "utf8");
    expect(css).not.toMatch(/gradient\(/iu);
    expect(css).not.toMatch(/drop-shadow/iu);
    const shadowDeclarations = css.match(/(?:box|text)-shadow\s*:[^;]+;/gu) ?? [];
    expect(shadowDeclarations).toEqual(["box-shadow: none;"]);
  });

  it("T8: fonts load from local files and no address leaves the computer", async () => {
    const css = await readFile("ui/src/styles.css", "utf8");
    expect(css).toContain('url("/assets/fonts/ibm-plex-sans-latin-400-normal.woff2")');
    expect(css).toContain('url("/assets/fonts/ibm-plex-mono-latin-400-normal.woff2")');
    expect(css).not.toContain("http://");
    expect(css).not.toContain("https://");

    const main = await readFile("ui/src/main.tsx", "utf8");
    expect(main).not.toContain("http://");
    expect(main).not.toContain("https://");
  });
});
