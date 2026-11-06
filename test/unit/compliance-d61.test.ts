import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { commandHelp, generalHelp } from "../../src/cli/help.js";
import { ERROR_DEFINITIONS } from "../../src/core/errors.js";

describe("D61 default fix texts", () => {
  it("D61 every ibeji command named in a default fix text exists", () => {
    const commandPattern = /\bibeji ([a-z][a-z-]*)/gu;
    for (const definition of Object.values(ERROR_DEFINITIONS)) {
      for (const match of definition.fix.matchAll(commandPattern)) {
        const command = match[1];
        if (command === undefined) {
          continue;
        }
        expect(
          commandHelp(command),
          `${definition.fix} names the missing command ibeji ${command}`,
        ).not.toBe(generalHelp());
      }
    }
  });

  it("D61 the README not-affiliated line names only the 0.1.0 twins", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain(
      "Ibeji is not affiliated with or endorsed by Paystack or Flutterwave.",
    );
    expect(readme).not.toContain(
      "Ibeji is not affiliated with or endorsed by Paystack, Flutterwave, or Stripe.",
    );
  });
});

describe("D61 dead placeholder scaffolding", () => {
  it("D61 removes the placeholder module, its test and the client method", async () => {
    const coreFiles = await readdir("src/core");
    const unitFiles = await readdir("test/unit");
    const client = await readFile("src/control/client.ts", "utf8");
    expect(coreFiles).not.toContain("placeholder.ts");
    expect(unitFiles).not.toContain("placeholder.test.ts");
    expect(client).not.toContain("async placeholder(");
  });
});
