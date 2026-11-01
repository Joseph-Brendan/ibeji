import { z } from "zod";

import type {
  CollectionDefinition,
  JsonValue,
  TwinState,
  TwinStateDefinition,
} from "../framework/types.js";

const logHistorySchema = z.object({
  type: z.string(),
  message: z.string(),
  time: z.number(),
});

const logSchema = z.object({
  start_time: z.number(),
  time_spent: z.number(),
  attempts: z.number(),
  errors: z.number(),
  success: z.boolean(),
  mobile: z.boolean(),
  input: z.array(z.unknown()),
  history: z.array(logHistorySchema),
});

export type PaystackLog = z.infer<typeof logSchema>;

export const paystackTransactionSchema = z.object({
  id: z.string(),
  transactionId: z.number().int(),
  domain: z.literal("test"),
  status: z.enum(["pending", "success", "failed", "abandoned"]),
  reference: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  email: z.string(),
  metadata: z.json().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  accessCode: z.string(),
  customerId: z.number().int(),
  customerCode: z.string(),
  authorizationCode: z.string(),
  signature: z.string(),
  fees: z.number().int().nullable(),
  log: logSchema.nullable(),
});

export type PaystackTransaction = z.infer<typeof paystackTransactionSchema>;

export const paystackRefundSchema = z.object({
  id: z.string(),
  refundId: z.number().int(),
  transactionId: z.number().int(),
  transactionReference: z.string(),
  transactionAmount: z.number().int(),
  transactionPaidAt: z.string(),
  transactionMetadata: z.string().nullable(),
  currency: z.string(),
  email: z.string(),
  customerId: z.number().int(),
  customerCode: z.string(),
  amount: z.number().int(),
  status: z.enum(["pending", "processing", "needs-attention", "failed", "processed"]),
  createdAt: z.string(),
  expectedAt: z.string(),
  refundedAt: z.string().nullable(),
  customerNote: z.string(),
  merchantNote: z.string(),
  reason: z.string(),
});

export type PaystackRefund = z.infer<typeof paystackRefundSchema>;

export const paystackCollections: readonly CollectionDefinition[] = [
  {
    id: "transactions",
    label: "Transactions",
    columns: [
      { key: "reference", label: "Reference", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "email", label: "Customer email", kind: "text" },
      { key: "createdAt", label: "Created", kind: "date" },
    ],
  },
  {
    id: "refunds",
    label: "Refunds",
    columns: [
      { key: "refundId", label: "Refund ID", kind: "text" },
      { key: "transactionReference", label: "Transaction", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "createdAt", label: "Created", kind: "date" },
    ],
  },
];

const stateSchema = z.record(z.string(), z.json()) as unknown as TwinStateDefinition["schema"];

export const paystackState: TwinStateDefinition = {
  schema: stateSchema,
  initial: () => ({}) as TwinState,
  collections: paystackCollections,
};

export type MetadataValue = JsonValue | null;
