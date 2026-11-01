import { z } from "zod";

import type {
  CollectionDefinition,
  JsonValue,
  TwinState,
  TwinStateDefinition,
} from "../framework/types.js";

export const flutterwavePaymentSchema = z.object({
  id: z.string(),
  transactionId: z.number().int(),
  txRef: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(["unpaid", "successful", "failed"]),
  customerEmail: z.string(),
  customerName: z.string(),
  customerPhone: z.string(),
  customerId: z.number().int(),
  redirectUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  paidAt: z.string().nullable(),
  flwRef: z.string().nullable(),
  appFee: z.number().int(),
  amountSettled: z.number().int(),
  processorResponse: z.string(),
  authModel: z.string(),
  deviceFingerprint: z.string(),
  checkoutInitAddress: z.string(),
  fingerprintScore: z.string(),
  cardFirst6: z.string(),
  cardLast4: z.string(),
  cardIssuer: z.string(),
  cardCountry: z.string(),
  cardType: z.string(),
  cardExpiry: z.string(),
  cardToken: z.string().nullable(),
});

export type FlutterwavePayment = z.infer<typeof flutterwavePaymentSchema>;

export const flutterwaveRefundSchema = z.object({
  id: z.string(),
  refundId: z.number().int(),
  transactionId: z.number().int(),
  txRef: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(["processing", "completed"]),
  flwRef: z.string(),
  destination: z.string(),
  comments: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settlementId: z.string(),
  walletId: z.number().int(),
  accountId: z.number().int(),
  metaSource: z.string(),
  metaIsPartialRefund: z.boolean(),
  metaUniqueReference: z.string(),
});

export type FlutterwaveRefund = z.infer<typeof flutterwaveRefundSchema>;

export const flutterwaveCollections: readonly CollectionDefinition[] = [
  {
    id: "payments",
    label: "Payments",
    columns: [
      { key: "txRef", label: "Transaction reference", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "customerEmail", label: "Customer email", kind: "text" },
      { key: "createdAt", label: "Created", kind: "date" },
    ],
  },
  {
    id: "refunds",
    label: "Refunds",
    columns: [
      { key: "refundId", label: "Refund ID", kind: "text" },
      { key: "txRef", label: "Transaction", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "createdAt", label: "Created", kind: "date" },
    ],
  },
];

const stateSchema = z.record(z.string(), z.json()) as unknown as TwinStateDefinition["schema"];

export const flutterwaveState: TwinStateDefinition = {
  schema: stateSchema,
  initial: () => ({}) as TwinState,
  collections: flutterwaveCollections,
};

export type FlutterwaveMetadata = JsonValue | null;
