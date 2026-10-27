import { describe, expect, it } from "vitest";

import { placeholderValue } from "../../src/core/placeholder.js";

describe("T1 placeholder", () => {
  it("returns the skeleton value", () => {
    expect(placeholderValue()).toBe("ibeji");
  });
});
