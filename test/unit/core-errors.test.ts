import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ERROR_DEFINITIONS,
  type ErrorCode,
  IbejiError,
  isIbejiError,
  zodProblemsToError,
} from "../../src/core/errors.js";

const codes = Object.keys(ERROR_DEFINITIONS) as ErrorCode[];

describe("C12 errors", () => {
  it("C12: every error code has non-empty what, why and fix, and the documented status", () => {
    for (const code of codes) {
      const error = new IbejiError(code);
      const definition = ERROR_DEFINITIONS[code];

      expect(error.code).toBe(code);
      expect(error.what.length).toBeGreaterThan(0);
      expect(error.why.length).toBeGreaterThan(0);
      expect(error.fix.length).toBeGreaterThan(0);
      expect(error.status).toBe(definition.status);
      expect(error.message).toBe(`${error.what}\n${error.why}\n${error.fix}`);
    }
  });

  it("C12: toJSON returns everything except the stack", () => {
    const error = new IbejiError("BAD_REQUEST", {
      what: "A custom what.",
      why: "A custom why.",
      fix: "A custom fix.",
      cause: new Error("the cause"),
    });
    const json = error.toJSON();

    expect(json).toEqual({
      name: "IbejiError",
      code: "BAD_REQUEST",
      what: "A custom what.",
      why: "A custom why.",
      fix: "A custom fix.",
      message: error.message,
      status: 400,
      cause: error.cause,
    });
    expect("stack" in json).toBe(false);
    expect(JSON.stringify(json)).not.toContain("stack");
  });

  it("C12: keeps a cause only when one is supplied", () => {
    const withoutCause = new IbejiError("INTERNAL");
    const withCause = new IbejiError("INTERNAL", { cause: "the cause" });

    expect(withoutCause.cause).toBeUndefined();
    expect(withCause.cause).toBe("the cause");
    expect("cause" in JSON.parse(JSON.stringify(withoutCause.toJSON()))).toBe(false);
    expect("cause" in JSON.parse(JSON.stringify(withCause.toJSON()))).toBe(true);
  });

  it("C12: isIbejiError recognises Ibeji errors and rejects other values", () => {
    expect(isIbejiError(new IbejiError("NOT_FOUND"))).toBe(true);
    expect(isIbejiError(new Error("not Ibeji"))).toBe(false);
    expect(isIbejiError("not an error")).toBe(false);
  });

  it("C12: turns every Zod problem into one error listing each field", () => {
    const schema = z.strictObject({
      twins: z.array(z.string()).min(1),
      seed: z.number().int(),
    });
    const result = schema.safeParse({ twins: [], seed: "not a number" });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("the test schema unexpectedly accepted invalid input");
    }

    const problem = zodProblemsToError("CONFIG_INVALID", result.error.issues);
    expect(problem).toBeInstanceOf(IbejiError);
    expect(problem.code).toBe("CONFIG_INVALID");
    expect(problem.why).toContain("twins");
    expect(problem.why).toContain("seed");
    expect(problem.why).toContain(";");
  });

  it("C12: names a root-level Zod problem and falls back to defaults for an empty list", () => {
    const root = zodProblemsToError("BAD_REQUEST", [
      { path: [], message: "A root problem." },
      { path: ["twins", 0], message: "A nested problem." },
    ]);
    expect(root.why).toContain("(root): A root problem.");
    expect(root.why).toContain("twins.0: A nested problem.");

    const empty = zodProblemsToError("BAD_REQUEST", []);
    expect(empty.why).toBe(ERROR_DEFINITIONS.BAD_REQUEST.why);
  });
});
