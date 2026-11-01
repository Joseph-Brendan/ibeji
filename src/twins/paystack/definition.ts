import type { TwinDefinition } from "../framework/types.js";
import { paystackAuth } from "./auth.js";
import { paystackCheckout } from "./checkout.js";
import { paystackCredentialSpecs } from "./credentials.js";
import { paystackFailures } from "./failures.js";
import { paystackMoney } from "./money.js";
import { refundActions } from "./refunds.js";
import { paystackResponses } from "./responses.js";
import { paystackRetrySchedule } from "./retry.js";
import { paystackState } from "./state.js";
import { transactionActions } from "./transactions.js";
import { paystackWebhooks } from "./webhooks.js";

const actions = [...transactionActions, ...refundActions];

export const paystackTwin: TwinDefinition = {
  id: "paystack",
  displayName: "Paystack",
  defaultPort: 4401,
  actions,
  state: paystackState,
  auth: paystackAuth,
  idempotency: { mode: "none" },
  routes: (router) => {
    for (const action of actions) {
      router.add(action);
    }
  },
  responses: paystackResponses,
  failures: paystackFailures,
  webhooks: paystackWebhooks,
  checkout: paystackCheckout,
  credentials: paystackCredentialSpecs,
  money: paystackMoney,
  retry: paystackRetrySchedule,
};
