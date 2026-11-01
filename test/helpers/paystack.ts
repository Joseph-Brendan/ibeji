import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";
import { RuleStore } from "../../src/core/failures/rules.js";
import type { WebhookDispatcher } from "../../src/core/webhooks/dispatcher.js";
import { type RunningTwin, startTwin } from "../../src/twins/framework/server.js";
import { FrameworkStateStore } from "../../src/twins/framework/state.js";
import type { TwinCredentials, TwinWebhookDraft } from "../../src/twins/framework/types.js";
import { paystackTwin } from "../../src/twins/paystack/definition.js";
import { paystackTransactionSchema } from "../../src/twins/paystack/state.js";

export const PAYSTACK_TEST_CREDENTIALS: TwinCredentials = {
  public: "pk_test_ibeji_fixture_public_0001",
  secret: "sk_test_ibeji_fixture_secret_0001",
};

export type PaystackHarness = {
  readonly running: RunningTwin;
  readonly events: EventLog;
  readonly rules: RuleStore;
  readonly clock: FakeClock;
  readonly state: FrameworkStateStore;
  readonly drafts: readonly TwinWebhookDraft[];
};

export type StartPaystackOptions = {
  readonly credentials?: TwinCredentials;
  readonly clock?: FakeClock;
  readonly dispatcher?: WebhookDispatcher;
  readonly webhookUrl?: () => string | undefined;
  readonly onWebhookDraft?: (draft: TwinWebhookDraft) => void;
};

export async function startPaystack(options: StartPaystackOptions = {}): Promise<PaystackHarness> {
  const clock = options.clock ?? new FakeClock(1_700_000_000_000);
  const events = new EventLog(clock);
  const rules = new RuleStore({
    twins: [
      {
        id: paystackTwin.id,
        actions: paystackTwin.actions.map((action) => action.id),
        failures: paystackTwin.failures.support,
      },
    ],
    events,
  });
  const state = new FrameworkStateStore(paystackTwin.id, paystackTwin.state.collections);
  const drafts: TwinWebhookDraft[] = [];
  const running = await startTwin(paystackTwin, {
    credentials: options.credentials ?? PAYSTACK_TEST_CREDENTIALS,
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
  credentials: TwinCredentials = PAYSTACK_TEST_CREDENTIALS,
): Record<string, string> {
  return {
    authorization: `Bearer ${credentials.secret}`,
    "content-type": "application/json",
  };
}

export async function initialize(
  harness: PaystackHarness,
  body: Record<string, unknown>,
  headers: Record<string, string> = authorizationHeader(),
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/transaction/initialize`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function verify(
  harness: PaystackHarness,
  reference: string,
  headers: Record<string, string> = authorizationHeader(),
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers },
  );
}

export async function fetchTransaction(harness: PaystackHarness, id: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/transaction/${encodeURIComponent(id)}`, {
    headers: authorizationHeader(),
  });
}

export async function listTransactions(harness: PaystackHarness, query = ""): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/transaction${query}`, {
    headers: authorizationHeader(),
  });
}

export async function checkout(
  harness: PaystackHarness,
  reference: string,
  outcome: "success" | "declined" | "abandoned",
): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/checkout/${encodeURIComponent(reference)}`,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: `http://127.0.0.1:${harness.running.port}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `outcome=${outcome}`,
    },
  );
}

export async function checkoutPage(harness: PaystackHarness, reference: string): Promise<Response> {
  return fetch(
    `http://127.0.0.1:${harness.running.port}/checkout/${encodeURIComponent(reference)}`,
  );
}

export async function createRefund(
  harness: PaystackHarness,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/refund`, {
    method: "POST",
    headers: authorizationHeader(),
    body: JSON.stringify(body),
  });
}

export async function fetchRefund(harness: PaystackHarness, id: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/refund/${encodeURIComponent(id)}`, {
    headers: authorizationHeader(),
  });
}

export async function listRefunds(harness: PaystackHarness, query = ""): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.running.port}/refund${query}`, {
    headers: authorizationHeader(),
  });
}

export async function seedSuccessfulTransaction(
  harness: PaystackHarness,
  reference: string,
  amount = 10_000,
  email = "customer.one@example.com",
): Promise<void> {
  const initialized = await initialize(harness, {
    amount: String(amount),
    email,
    currency: "NGN",
    reference,
    metadata: JSON.stringify({ recorder: "ibeji" }),
  });
  if (initialized.status !== 200) {
    throw new Error(`initialize failed with ${initialized.status}`);
  }
  const paid = await checkout(harness, reference, "success");
  if (paid.status !== 200) {
    throw new Error(`checkout failed with ${paid.status}`);
  }
}

export async function transactionRecord(harness: PaystackHarness, reference: string) {
  return harness.state.read("transactions", reference, paystackTransactionSchema);
}
