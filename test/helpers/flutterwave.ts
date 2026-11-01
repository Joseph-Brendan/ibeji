import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";
import { RuleStore } from "../../src/core/failures/rules.js";
import type { WebhookDispatcher } from "../../src/core/webhooks/dispatcher.js";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import type {
  FlutterwavePayment,
  FlutterwaveRefund,
  FlutterwaveTransfer,
} from "../../src/twins/flutterwave/state.js";
import {
  flutterwavePaymentSchema,
  flutterwaveRefundSchema,
  flutterwaveTransferSchema,
} from "../../src/twins/flutterwave/state.js";
import { type RunningTwin, startTwin } from "../../src/twins/framework/server.js";
import { FrameworkStateStore } from "../../src/twins/framework/state.js";
import type { TwinCredentials, TwinWebhookDraft } from "../../src/twins/framework/types.js";

export const FLUTTERWAVE_TEST_CREDENTIALS: TwinCredentials = {
  public: "FLWPUBK_TEST-ibeji_fixture_public_0001",
  secret: "FLWSECK_TEST-ibeji_fixture_secret_0001",
  webhook: "ibeji_fixture_webhook_0001",
};

export type FlutterwaveHarness = {
  readonly running: RunningTwin;
  readonly events: EventLog;
  readonly rules: RuleStore;
  readonly clock: FakeClock;
  readonly state: FrameworkStateStore;
  readonly drafts: readonly TwinWebhookDraft[];
};

export type StartFlutterwaveOptions = {
  readonly credentials?: TwinCredentials;
  readonly clock?: FakeClock;
  readonly dispatcher?: WebhookDispatcher;
  readonly webhookUrl?: () => string | undefined;
  readonly onWebhookDraft?: (draft: TwinWebhookDraft) => void;
};

export async function startFlutterwave(
  options: StartFlutterwaveOptions = {},
): Promise<FlutterwaveHarness> {
  const clock = options.clock ?? new FakeClock(1_700_000_000_000);
  const events = new EventLog(clock);
  const rules = new RuleStore({
    twins: [
      {
        id: flutterwaveTwin.id,
        actions: flutterwaveTwin.actions.map((action) => action.id),
        failures: flutterwaveTwin.failures.support,
      },
    ],
    events,
  });
  const state = new FrameworkStateStore(flutterwaveTwin.id, flutterwaveTwin.state.collections);
  const drafts: TwinWebhookDraft[] = [];
  const running = await startTwin(flutterwaveTwin, {
    credentials: options.credentials ?? FLUTTERWAVE_TEST_CREDENTIALS,
    events,
    rules,
    clock,
    state,
    ...(options.dispatcher === undefined ? {} : { dispatcher: options.dispatcher }),
    ...(options.webhookUrl === undefined ? {} : { webhookUrl: options.webhookUrl }),
    onWebhookDraft: (draft) => {
      drafts.push(draft);
      options.onWebhookDraft?.(draft);
    },
  });
  return { running, events, rules, clock, state, drafts };
}

export function authorizationHeader(
  credentials: TwinCredentials = FLUTTERWAVE_TEST_CREDENTIALS,
): Record<string, string> {
  return {
    authorization: `Bearer ${credentials.secret}`,
    "content-type": "application/json",
  };
}

export async function createPayment(
  harness: FlutterwaveHarness,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/payments`, {
    method: "POST",
    headers: authorizationHeader(),
    body: JSON.stringify(body),
  });
}

export async function verifyPayment(
  harness: FlutterwaveHarness,
  id: string | number,
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/v3/transactions/${encodeURIComponent(String(id))}/verify`,
    { headers: authorizationHeader() },
  );
}

export async function verifyPaymentByReference(
  harness: FlutterwaveHarness,
  txRef: string,
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
    { headers: authorizationHeader() },
  );
}

export async function listPayments(harness: FlutterwaveHarness, query = ""): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/transactions${query}`, {
    headers: authorizationHeader(),
  });
}

export async function checkout(
  harness: FlutterwaveHarness,
  txRef: string,
  outcome: "success" | "failed" | "cancelled",
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/checkout/${encodeURIComponent(txRef)}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: `http://127.0.0.1:${harness.running.port}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `outcome=${outcome}`,
  });
}

export async function checkoutPage(harness: FlutterwaveHarness, txRef: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/checkout/${encodeURIComponent(txRef)}`);
}

export async function createRefund(
  harness: FlutterwaveHarness,
  transactionId: string | number,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/v3/transactions/${encodeURIComponent(String(transactionId))}/refund`,
    {
      method: "POST",
      headers: authorizationHeader(),
      body: JSON.stringify(body),
    },
  );
}

export async function fetchRefund(
  harness: FlutterwaveHarness,
  id: string | number,
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/v3/refunds/${encodeURIComponent(String(id))}`,
    { headers: authorizationHeader() },
  );
}

export async function listRefunds(harness: FlutterwaveHarness, query = ""): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/refunds${query}`, {
    headers: authorizationHeader(),
  });
}

export async function listBanks(harness: FlutterwaveHarness, country = "NG"): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/banks/${encodeURIComponent(country)}`, {
    headers: authorizationHeader(),
  });
}

export async function resolveAccount(
  harness: FlutterwaveHarness,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/accounts/resolve`, {
    method: "POST",
    headers: authorizationHeader(),
    body: JSON.stringify(body),
  });
}

export async function createTransfer(
  harness: FlutterwaveHarness,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/transfers`, {
    method: "POST",
    headers: authorizationHeader(),
    body: JSON.stringify(body),
  });
}

export async function fetchTransfer(
  harness: FlutterwaveHarness,
  id: string | number,
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/v3/transfers/${encodeURIComponent(String(id))}`,
    { headers: authorizationHeader() },
  );
}

export async function listTransfers(harness: FlutterwaveHarness, query = ""): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/v3/transfers${query}`, {
    headers: authorizationHeader(),
  });
}

export function paymentRecord(
  harness: FlutterwaveHarness,
  txRef: string,
): FlutterwavePayment | undefined {
  return harness.state.read("payments", txRef, flutterwavePaymentSchema);
}

export function refundRecord(
  harness: FlutterwaveHarness,
  id: string | number,
): FlutterwaveRefund | undefined {
  return harness.state.read("refunds", String(id), flutterwaveRefundSchema);
}

export function transferRecord(
  harness: FlutterwaveHarness,
  id: string | number,
): FlutterwaveTransfer | undefined {
  return harness.state.read("transfers", String(id), flutterwaveTransferSchema);
}

export async function seedPayment(
  harness: FlutterwaveHarness,
  txRef: string,
  options: {
    readonly amount?: string;
    readonly outcome?: "success" | "failed" | "cancelled";
    readonly email?: string;
    readonly redirectUrl?: string;
  } = {},
): Promise<FlutterwavePayment> {
  const amount = options.amount ?? "7500";
  const created = await createPayment(harness, {
    amount,
    tx_ref: txRef,
    currency: "NGN",
    redirect_url: options.redirectUrl ?? "https://example.com/ibeji/flutterwave",
    customer: {
      email: options.email ?? "customer.one@example.com",
      name: "Test Name 1",
      phone_number: "+15550000001",
    },
  });
  if (created.status !== 200) {
    throw new Error(`payment create failed with ${created.status}`);
  }

  if (options.outcome !== undefined) {
    const paid = await checkout(harness, txRef, options.outcome);
    if (paid.status !== 303 && paid.status !== 200) {
      throw new Error(`checkout failed with ${paid.status}`);
    }
  }

  const record = paymentRecord(harness, txRef);
  if (record === undefined) {
    throw new Error("payment was not stored");
  }
  return record;
}
