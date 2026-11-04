import { describe, expect, it } from "vitest";

import {
  defaultSettingsValues,
  parseSettingsSchema,
  settingsFromValues,
  validateSettings,
} from "../../ui/src/failure-settings.js";

const SCHEMA = {
  type: "object",
  properties: {
    times: {
      default: 3,
      anyOf: [{ type: "integer", minimum: 1, maximum: 10_000 }, { type: "null" }],
    },
    status: { type: "integer", minimum: 500, maximum: 599, default: 500 },
    mode: { type: "string", enum: ["hang", "reset"], default: "hang" },
    twins: { type: "array", items: { type: "string" } },
    actions: { anyOf: [{ type: "string" }, { type: "array" }] },
  },
  required: ["times", "status", "mode"],
  additionalProperties: false,
} as const;

describe("T8 UI failure settings", () => {
  it("T8: builds labelled fields with schema limits and defaults", () => {
    const fields = parseSettingsSchema(SCHEMA, "server-error");
    expect(fields.map((field) => field.key)).toEqual(["times", "status", "mode"]);
    expect(fields[0]).toMatchObject({
      label: "Number of times",
      kind: "number",
      nullable: true,
      min: 1,
      max: 10_000,
      defaultValue: 3,
    });
    expect(fields[1]).toMatchObject({
      label: "HTTP status",
      min: 500,
      max: 599,
      defaultValue: 500,
    });
    expect(fields[2]).toMatchObject({
      label: "Connection end",
      kind: "select",
      defaultValue: "hang",
    });
    expect(defaultSettingsValues(fields)).toEqual({
      times: "3",
      status: "500",
      mode: "hang",
    });
  });

  it("T8: reports missing, out-of-range and invalid choices", () => {
    const fields = parseSettingsSchema(SCHEMA, "server-error");
    const errors = validateSettings(fields, {
      times: "0",
      status: "400",
      mode: "wrong",
    });
    expect(errors.times).toBe("Enter a number from 1 to 10000.");
    expect(errors.status).toBe("Enter a number from 500 to 599.");
    expect(errors.mode).toBe("Choose one of the options.");

    const empty = validateSettings(fields, { times: "", status: "", mode: "" });
    expect(empty.status).toBe("Enter a value.");
    expect(empty.mode).toBe("Enter a value.");
    expect(empty.times).toBeUndefined();
  });

  it("T8: filters select options to the schema enum", () => {
    const fields = parseSettingsSchema(
      {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["error", "timeout"], default: "error" },
        },
        required: ["mode"],
      },
      "bank-resolve-fails",
    );
    expect(fields[0]?.options).toEqual([
      { value: "error", label: "Return an error" },
      { value: "timeout", label: "Wait until it times out" },
    ]);
  });

  it("T8: turns blank optional numbers into null and keeps required values", () => {
    const fields = parseSettingsSchema(SCHEMA, "server-error");
    expect(settingsFromValues(fields, { times: "", status: "503", mode: "reset" })).toEqual({
      times: null,
      status: 503,
      mode: "reset",
    });
  });
});
