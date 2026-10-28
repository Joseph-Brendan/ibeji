import { z } from "zod";

export const FAILURE_IDS = [
  "slow-response",
  "timeout-after-commit",
  "timeout-before-commit",
  "server-error",
  "rate-limited",
  "flaky-network",
  "webhook-delayed",
  "webhook-duplicated",
  "webhook-out-of-order",
  "webhook-never-sent",
  "webhook-verification-fails",
  "payment-declined",
  "authentication-required",
  "transfer-stuck-pending",
  "transfer-reversed",
  "bank-resolve-fails",
] as const;

export type FailureId = (typeof FAILURE_IDS)[number];

export type FailureDescription = {
  readonly realLife: string;
  readonly whatToCheck: string;
};

export type FailureDefinition = {
  readonly id: FailureId;
  readonly name: string;
  readonly description: FailureDescription;
  /**
   * The full settings schema, including the shared twins and actions settings.
   * The UI and MCP server use this schema and settingsJsonSchema.
   */
  readonly settingsSchema: z.ZodType<Record<string, unknown>>;
  /** The failure-specific part, without twins and actions. Rules use this. */
  readonly failureSettingsSchema: z.ZodType<Record<string, unknown>>;
  /** The same full schema in JSON Schema form, for the UI and MCP server. */
  readonly settingsJsonSchema: z.core.JSONSchema.BaseSchema;
};

export const actionSelectorSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const sharedRuleSettingsSchema = z.strictObject({
  twins: z.array(z.string().min(1)).min(1).optional(),
  actions: actionSelectorSchema.optional(),
});

const timesSchema = z.number().int().min(1).max(10_000).nullable().default(3);

function defineFailure(id: FailureId, name: string, specific: z.ZodRawShape): FailureDefinition {
  const failureSettingsSchema = z.strictObject(specific);
  const settingsSchema = z.strictObject({
    ...specific,
    twins: z.array(z.string().min(1)).min(1).optional(),
    actions: actionSelectorSchema.optional(),
  });

  return {
    id,
    name,
    description: {
      realLife: `Placeholder real-life story for ${name}. Real text arrives in Step 5.2.`,
      whatToCheck: `Placeholder app-check guidance for ${name}. Real text arrives in Step 5.2.`,
    },
    settingsSchema: settingsSchema as z.ZodType<Record<string, unknown>>,
    failureSettingsSchema: failureSettingsSchema as z.ZodType<Record<string, unknown>>,
    settingsJsonSchema: z.toJSONSchema(settingsSchema),
  };
}

const slowResponse = defineFailure("slow-response", "Slow response", {
  seconds: z.number().int().min(1).max(120).default(5),
});

const timeoutAfterCommit = defineFailure("timeout-after-commit", "Success, but the reply is lost", {
  mode: z.enum(["hang", "reset"]).default("hang"),
});

const timeoutBeforeCommit = defineFailure(
  "timeout-before-commit",
  "Failure, and the reply is lost",
  {
    mode: z.enum(["hang", "reset"]).default("hang"),
  },
);

const serverError = defineFailure("server-error", "Server error", {
  times: timesSchema,
  status: z.number().int().min(500).max(599).default(500),
});

const rateLimited = defineFailure("rate-limited", "Too many requests", {
  times: timesSchema,
});

const flakyNetwork = defineFailure("flaky-network", "Unreliable network", {
  percent: z.number().int().min(1).max(100).default(20),
  when: z.enum(["before", "after"]).default("before"),
});

const webhookDelayed = defineFailure("webhook-delayed", "Late webhook", {
  seconds: z.number().int().min(1).max(3_600).default(60),
  jitterSeconds: z.number().int().min(0).max(3_600).default(0),
});

const webhookDuplicated = defineFailure("webhook-duplicated", "Duplicate webhook", {
  copies: z.number().int().min(2).max(5).default(2),
  gapSeconds: z.number().int().min(0).max(300).default(5),
});

const webhookOutOfOrder = defineFailure("webhook-out-of-order", "Webhooks in the wrong order", {
  windowSeconds: z.number().int().min(1).max(300).default(15),
});

const webhookNeverSent = defineFailure("webhook-never-sent", "Missing webhook", {
  percent: z.number().int().min(1).max(100).default(100),
});

const webhookVerificationFails = defineFailure("webhook-verification-fails", "Forged webhook", {
  method: z.string().min(1).default("wrong-secret"),
});

const paymentDeclined = defineFailure("payment-declined", "Declined payment", {
  percent: z.number().int().min(1).max(100).default(100),
});

const authenticationRequired = defineFailure("authentication-required", "Extra check needed", {
  // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
  then: z.enum(["succeed", "fail"]).default("fail"),
});

const transferStuckPending = defineFailure("transfer-stuck-pending", "Stuck transfer", {
  seconds: z.number().int().min(1).max(86_400).nullable().default(null),
  thenFailPercent: z.number().int().min(0).max(100).default(0),
});

const transferReversed = defineFailure("transfer-reversed", "Reversed transfer", {
  afterSeconds: z.number().int().min(1).max(86_400).default(60),
  percent: z.number().int().min(1).max(100).default(100),
});

const bankResolveFails = defineFailure("bank-resolve-fails", "Account lookup fails", {
  mode: z.enum(["error", "timeout"]).default("error"),
});

export const FAILURE_BY_ID: Readonly<Record<FailureId, FailureDefinition>> = {
  "slow-response": slowResponse,
  "timeout-after-commit": timeoutAfterCommit,
  "timeout-before-commit": timeoutBeforeCommit,
  "server-error": serverError,
  "rate-limited": rateLimited,
  "flaky-network": flakyNetwork,
  "webhook-delayed": webhookDelayed,
  "webhook-duplicated": webhookDuplicated,
  "webhook-out-of-order": webhookOutOfOrder,
  "webhook-never-sent": webhookNeverSent,
  "webhook-verification-fails": webhookVerificationFails,
  "payment-declined": paymentDeclined,
  "authentication-required": authenticationRequired,
  "transfer-stuck-pending": transferStuckPending,
  "transfer-reversed": transferReversed,
  "bank-resolve-fails": bankResolveFails,
};

export const FAILURE_CATALOG: readonly FailureDefinition[] = FAILURE_IDS.map(
  (id) => FAILURE_BY_ID[id],
);

export const FAILURE_SETTINGS_JSON_SCHEMAS: Readonly<
  Record<FailureId, z.core.JSONSchema.BaseSchema>
> = Object.fromEntries(
  FAILURE_IDS.map((id) => [id, FAILURE_BY_ID[id].settingsJsonSchema]),
) as Record<FailureId, z.core.JSONSchema.BaseSchema>;

export function getFailure(id: string): FailureDefinition | undefined {
  if (Object.hasOwn(FAILURE_BY_ID, id)) {
    return FAILURE_BY_ID[id as FailureId];
  }
  return undefined;
}
