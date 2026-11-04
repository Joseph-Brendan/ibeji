import type { TwinDefinition } from "../framework/types.js";
import { flutterwaveAuth } from "./auth.js";
import { bankActions } from "./bank.js";
import { checkoutActions, flutterwaveCheckout } from "./checkout.js";
import { flutterwaveCredentialSpecs } from "./credentials.js";
import { flutterwaveFailures } from "./failures.js";
import { flutterwaveConnectionGuide } from "./guide.js";
import { flutterwaveMoney } from "./money.js";
import { paymentActions } from "./payments.js";
import { refundActions } from "./refunds.js";
import { flutterwaveResponses } from "./responses.js";
import { flutterwaveRetrySchedule } from "./retry.js";
import { flutterwaveState } from "./state.js";
import { transferActions } from "./transfers.js";
import { flutterwaveWebhooks } from "./webhooks.js";

const actions = [
  ...paymentActions,
  ...refundActions,
  ...transferActions,
  ...bankActions,
  ...checkoutActions,
];

export const flutterwaveTwin: TwinDefinition = {
  id: "flutterwave",
  displayName: "Flutterwave",
  defaultPort: 4402,
  actions,
  state: flutterwaveState,
  auth: flutterwaveAuth,
  idempotency: { mode: "none" },
  routes: (router) => {
    for (const action of actions) {
      router.add(action);
    }
  },
  responses: flutterwaveResponses,
  failures: flutterwaveFailures,
  webhooks: flutterwaveWebhooks,
  checkout: flutterwaveCheckout,
  credentials: flutterwaveCredentialSpecs,
  money: flutterwaveMoney,
  retry: flutterwaveRetrySchedule,
  connectionGuide: flutterwaveConnectionGuide,
};
