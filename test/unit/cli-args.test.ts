import { describe, expect, it } from "vitest";

import {
  booleanValue,
  firstPositional,
  listOf,
  listValue,
  parseCli,
  stringValue,
} from "../../src/cli/args.js";

describe("T10 CLI argument helpers", () => {
  it("T10: reads string, boolean and list values safely", () => {
    expect(stringValue({ value: "text" }, "value")).toBe("text");
    expect(stringValue({ value: true }, "value")).toBeUndefined();
    expect(stringValue({}, "value")).toBeUndefined();

    expect(booleanValue({ flag: true }, "flag")).toBe(true);
    expect(booleanValue({ flag: "true" }, "flag")).toBe(false);

    expect(listValue({ item: ["one", "two"] }, "item")).toEqual(["one", "two"]);
    expect(listValue({ item: "one" }, "item")).toEqual(["one"]);
    expect(listValue({}, "item")).toEqual([]);

    expect(listOf(undefined)).toEqual([]);
    expect(listOf(" one, two ,, three ")).toEqual(["one", "two", "three"]);
  });

  it("T10: parses known options and reports every unknown option", () => {
    const parsed = parseCli(["--first", "one", "--second", "two", "name"], {
      first: { type: "string" },
      second: { type: "string" },
    });
    expect(parsed.values.first).toBe("one");
    expect(parsed.values.second).toBe("two");
    expect(parsed.positionals).toEqual(["name"]);

    expect(() =>
      parseCli(["--first", "one", "--unknown-one", "--unknown-two"], {
        first: { type: "string" },
      }),
    ).toThrowError(/unknown-one.*unknown-two/u);
  });

  it("T10: finds the first positional value", () => {
    expect(firstPositional(["--flag", "value", "failure"])).toBe("value");
    expect(firstPositional([])).toBeUndefined();
  });
});
