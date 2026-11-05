import { z } from "zod";

import {
  eventsQuerySchema,
  idSchema,
  ruleBodySchema,
  scopeQuerySchema,
  twinIdSchema,
  webhooksQuerySchema,
  webhookUrlBodySchema,
} from "../control/schemas.js";

/**
 * The control API owns these shapes. The MCP server only swaps the API's
 * `scope`/`twins` selectors for the one optional `twin` string that C11
 * defines, so a fourth twin still needs no MCP change.
 */
export const optionalTwinInputSchema = scopeQuerySchema
  .omit({ scope: true })
  .extend({ twin: twinIdSchema.optional() });

export const listEventsInputSchema = eventsQuerySchema
  .omit({ scope: true })
  .extend({ twin: twinIdSchema.optional() });

export const listWebhooksInputSchema = webhooksQuerySchema;

export const enableFailureInputSchema = ruleBodySchema
  .omit({ twins: true })
  .extend({ twin: twinIdSchema.optional() });

export const clearFailuresInputSchema = optionalTwinInputSchema;

export const runScenarioInputSchema = z.strictObject({
  scenario: idSchema,
  twin: twinIdSchema.optional(),
});

export const setWebhookUrlInputSchema = webhookUrlBodySchema.extend({
  twin: twinIdSchema.optional(),
});

export const resendWebhookInputSchema = z.strictObject({
  deliveryId: idSchema,
});

export const connectionGuideInputSchema = z.strictObject({
  twin: twinIdSchema.optional(),
});

export type OptionalTwinInput = z.infer<typeof optionalTwinInputSchema>;
export type ListEventsInput = z.infer<typeof listEventsInputSchema>;
export type ListWebhooksInput = z.infer<typeof listWebhooksInputSchema>;
export type EnableFailureInput = z.infer<typeof enableFailureInputSchema>;
export type RunScenarioInput = z.infer<typeof runScenarioInputSchema>;
export type SetWebhookUrlInput = z.infer<typeof setWebhookUrlInputSchema>;
export type ResendWebhookInput = z.infer<typeof resendWebhookInputSchema>;
export type ConnectionGuideInput = z.infer<typeof connectionGuideInputSchema>;
