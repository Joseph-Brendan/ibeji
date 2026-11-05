import { z } from "zod";

import { EVENT_TYPES } from "../core/events.js";
import { actionSelectorSchema } from "../core/failures/catalog.js";
import { WEBHOOK_DELIVERY_STATUSES } from "../core/webhooks/dispatcher.js";

/** One non-empty identifier. */
export const idSchema = z.string().min(1);

/** One twin id, always a plain string so a new twin needs no schema change. */
export const twinIdSchema = idSchema;

export const exchangeBodySchema = z
  .strictObject({
    code: twinIdSchema.optional(),
    launchCode: twinIdSchema.optional(),
  })
  .superRefine((value, context) => {
    const present = Number(value.code !== undefined) + Number(value.launchCode !== undefined);
    if (present !== 1) {
      context.addIssue({
        code: "custom",
        path: ["code"],
        message: "Expected exactly one of code or launchCode.",
        input: value,
      });
    }
  });

export const optionalTwinsSchema = z.strictObject({
  twins: z.array(twinIdSchema).min(1).optional(),
});

export const rotateBodySchema = z.strictObject({
  twin: twinIdSchema.optional(),
});

export const ruleBodySchema = z.strictObject({
  failureId: twinIdSchema,
  twins: z.array(twinIdSchema).min(1).optional(),
  actions: actionSelectorSchema.optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const webhookUrlBodySchema = z.strictObject({
  url: z.string(),
});

export const webhooksQuerySchema = z.strictObject({
  twin: twinIdSchema.optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
});

export const eventsQuerySchema = z.strictObject({
  scope: twinIdSchema.optional(),
  type: z.enum(EVENT_TYPES).optional(),
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

export const scopeQuerySchema = z.strictObject({
  scope: twinIdSchema.optional(),
});

export const rulesQuerySchema = z.strictObject({
  twin: twinIdSchema.optional(),
});
