export type SettingsFieldKind = "number" | "select" | "text";

export type SettingsOption = {
  readonly value: string;
  readonly label: string;
};

export type SettingsField = {
  readonly key: string;
  readonly label: string;
  readonly kind: SettingsFieldKind;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly defaultValue: number | string | null | undefined;
  readonly options: readonly SettingsOption[];
  readonly help: string;
};

type JsonSchemaProperty = {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly anyOf?: readonly JsonSchemaProperty[];
  readonly items?: JsonSchemaProperty;
};

type JsonSchema = {
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
};

const FIELD_LABELS = new Map<string, string>([
  ["seconds", "Seconds"],
  ["mode", "Connection end"],
  ["times", "Number of times"],
  ["status", "HTTP status"],
  ["percent", "Share of requests"],
  ["when", "When to drop it"],
  ["jitterSeconds", "Extra random delay"],
  ["copies", "Copies"],
  ["gapSeconds", "Seconds between copies"],
  ["windowSeconds", "Hold window"],
  ["method", "Verification failure"],
  ["then", "If the customer finishes"],
  ["thenFailPercent", "Share that fail"],
  ["afterSeconds", "Seconds before reversal"],
]);

const OPTION_LABELS = new Map<string, readonly SettingsOption[]>([
  [
    "mode",
    [
      { value: "hang", label: "Keep the connection open" },
      { value: "reset", label: "Drop it at once" },
      { value: "error", label: "Return an error" },
      { value: "timeout", label: "Wait until it times out" },
    ],
  ],
  [
    "when",
    [
      { value: "before", label: "Before the action" },
      { value: "after", label: "After the action" },
    ],
  ],
  [
    "then",
    [
      { value: "succeed", label: "Succeed" },
      { value: "fail", label: "Fail" },
    ],
  ],
  [
    "method",
    [
      { value: "wrong-secret", label: "Wrong secret" },
      { value: "corrupted", label: "Corrupted signature" },
      { value: "missing", label: "Missing signature" },
    ],
  ],
]);

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNullBranch(property: JsonSchemaProperty): {
  readonly schema: JsonSchemaProperty;
  readonly nullable: boolean;
} {
  if (property.anyOf === undefined) {
    return { schema: property, nullable: false };
  }
  const nullable = property.anyOf.some((branch) => branch.type === "null");
  const schema = property.anyOf.find((branch) => branch.type !== "null") ?? property;
  return { schema, nullable };
}

function labelFor(key: string, failureId: string): string {
  if (key === "mode" && failureId === "bank-resolve-fails") {
    return "How the lookup should fail";
  }
  if (key === "seconds" && failureId === "transfer-stuck-pending") {
    return "Seconds before the transfer ends";
  }
  return FIELD_LABELS.get(key) ?? key;
}

function helpFor(field: {
  readonly key: string;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly defaultValue: unknown;
  readonly nullable: boolean;
  readonly kind: SettingsFieldKind;
}): string {
  if (field.key === "times" && field.nullable) {
    return "Leave empty to fire every time while the rule is on.";
  }
  if (field.key === "seconds" && field.nullable) {
    return "Leave empty to stay pending until the rule is switched off.";
  }
  if (field.kind === "select") {
    return "Choose one of the options.";
  }
  if (field.kind === "text") {
    return "Enter a value.";
  }
  if (field.min !== undefined && field.max !== undefined) {
    const defaultValue =
      field.defaultValue === null || field.defaultValue === undefined
        ? "empty"
        : String(field.defaultValue);
    return `From ${field.min} to ${field.max}. Default: ${defaultValue}.`;
  }
  return "Enter a whole number.";
}

export function parseSettingsSchema(schema: unknown, failureId: string): readonly SettingsField[] {
  const root = asRecord(schema) as JsonSchema | undefined;
  const properties = root?.properties;
  if (properties === undefined) {
    return [];
  }
  const required = new Set(root?.required ?? []);
  const fields: SettingsField[] = [];

  for (const [key, rawProperty] of Object.entries(properties)) {
    if (key === "twins" || key === "actions") {
      continue;
    }
    const property = rawProperty as JsonSchemaProperty;
    const { schema: base, nullable } = nonNullBranch(property);
    const options = OPTION_LABELS.get(key);
    const enumValues =
      base.enum ?? (options === undefined ? undefined : options.map((item) => item.value));
    const optionList =
      options ?? enumValues?.map((value) => ({ value: String(value), label: String(value) }));
    const selectOptions =
      enumValues === undefined
        ? (optionList ?? [])
        : (optionList ?? []).filter((option) => enumValues.includes(option.value));
    const kind: SettingsFieldKind =
      base.type === "integer" || base.type === "number"
        ? "number"
        : enumValues !== undefined
          ? "select"
          : "text";
    const min = asNumber(base.minimum);
    const max = asNumber(base.maximum);
    const defaultValue = property.default ?? base.default;
    const field: SettingsField = {
      key,
      label: labelFor(key, failureId),
      kind,
      required: required.has(key),
      nullable,
      min,
      max,
      defaultValue:
        typeof defaultValue === "number" ||
        typeof defaultValue === "string" ||
        defaultValue === null
          ? defaultValue
          : undefined,
      options: kind === "select" ? selectOptions : [],
      help: helpFor({
        key,
        min,
        max,
        defaultValue,
        nullable,
        kind,
      }),
    };
    fields.push(field);
  }

  return fields;
}

export function defaultSettingsValues(
  fields: readonly SettingsField[],
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.key] =
      field.defaultValue === null || field.defaultValue === undefined
        ? ""
        : String(field.defaultValue);
  }
  return values;
}

export function settingsValuesFromRule(
  fields: readonly SettingsField[],
  settings: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = settings[field.key];
    values[field.key] =
      value === null || value === undefined
        ? ""
        : typeof value === "number" || typeof value === "string"
          ? String(value)
          : "";
  }
  return values;
}

export function validateSettings(
  fields: readonly SettingsField[],
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.key]?.trim() ?? "";
    if (raw === "") {
      if (!field.nullable && field.required) {
        errors[field.key] = "Enter a value.";
      }
      continue;
    }
    if (field.kind === "number") {
      if (!/^\d+$/u.test(raw)) {
        errors[field.key] = "Enter a whole number.";
        continue;
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) {
        errors[field.key] = "Enter a smaller whole number.";
        continue;
      }
      if (field.min !== undefined && value < field.min) {
        errors[field.key] = `Enter a number from ${field.min} to ${field.max ?? "∞"}.`;
        continue;
      }
      if (field.max !== undefined && value > field.max) {
        errors[field.key] = `Enter a number from ${field.min ?? "0"} to ${field.max}.`;
      }
    } else if (field.kind === "select") {
      if (!field.options.some((option) => option.value === raw)) {
        errors[field.key] = "Choose one of the options.";
      }
    }
  }
  return errors;
}

export function settingsFromValues(
  fields: readonly SettingsField[],
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  const settings: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key]?.trim() ?? "";
    if (raw === "") {
      if (field.nullable || field.required) {
        settings[field.key] = null;
      }
      continue;
    }
    settings[field.key] = field.kind === "number" ? Number(raw) : raw;
  }
  return settings;
}
