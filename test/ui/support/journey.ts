import type { RunningSession } from "../../../src/control/session.js";

export type PaymentHandle = {
  readonly reference: string;
  readonly checkoutUrl: string;
  readonly amountMinor: number;
};

export type TwinDriver = {
  readonly id: string;
  readonly displayName: string;
  readonly checkoutSuccessLabel: string;
  readonly eventText: string;
  readonly webhookEventText: string;
  createPayment: (
    session: RunningSession,
    reference: string,
    callbackUrl: string | undefined,
  ) => Promise<PaymentHandle>;
};

function twinAddress(session: RunningSession, twinId: string): string {
  const address = session.addresses.twins[twinId];
  if (address === undefined) {
    throw new Error(`The ${twinId} twin is not running.`);
  }
  return address.url;
}

function twinSecret(session: RunningSession, twinId: string): string {
  const secret = session.credentials[twinId]?.secret;
  if (secret === undefined) {
    throw new Error(`The ${twinId} twin has no secret credential.`);
  }
  return secret;
}

async function jsonResponse(response: Response, action: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const amountMinor = 12_500;
const email = "journey@example.com";

const paystack: TwinDriver = {
  id: "paystack",
  displayName: "Paystack",
  checkoutSuccessLabel: "Pay successfully",
  eventText: "charge succeeded",
  webhookEventText: "Charge success",
  createPayment: async (session, reference, callbackUrl) => {
    const body = {
      amount: String(amountMinor),
      email,
      currency: "NGN",
      reference,
      ...(callbackUrl === undefined ? {} : { callback_url: callbackUrl }),
    };
    const response = await fetch(`${twinAddress(session, "paystack")}/transaction/initialize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${twinSecret(session, "paystack")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const parsed = (await jsonResponse(response, "Paystack initialize")) as {
      readonly data: { readonly authorization_url: string; readonly reference: string };
    };
    return {
      reference: parsed.data.reference,
      checkoutUrl: parsed.data.authorization_url,
      amountMinor,
    };
  },
};

const flutterwave: TwinDriver = {
  id: "flutterwave",
  displayName: "Flutterwave",
  checkoutSuccessLabel: "Pay successfully",
  eventText: "payment successful",
  webhookEventText: "Charge completed",
  createPayment: async (session, reference, callbackUrl) => {
    const body = {
      amount: amountMinor,
      tx_ref: reference,
      currency: "NGN",
      redirect_url: callbackUrl ?? "http://127.0.0.1:1/ibeji-callback",
      customer: { email },
    };
    const response = await fetch(`${twinAddress(session, "flutterwave")}/v3/payments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${twinSecret(session, "flutterwave")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const parsed = (await jsonResponse(response, "Flutterwave payment create")) as {
      readonly data: { readonly link: string };
    };
    return {
      reference,
      checkoutUrl: parsed.data.link,
      amountMinor,
    };
  },
};

const DRIVERS: Readonly<Record<string, TwinDriver>> = {
  [paystack.id]: paystack,
  [flutterwave.id]: flutterwave,
};

export function driverFor(twinId: string): TwinDriver {
  const driver = DRIVERS[twinId];
  if (driver === undefined) {
    throw new Error(
      `No UI journey driver is defined for the registered twin "${twinId}". Add one before running the per-twin journey.`,
    );
  }
  return driver;
}

export async function completeCheckoutInNode(
  session: RunningSession,
  twinId: string,
  checkoutUrl: string,
  outcome: "success" | "declined" | "abandoned" | "failed" | "cancelled",
): Promise<void> {
  const response = await fetch(checkoutUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: twinAddress(session, twinId),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `outcome=${outcome}`,
  });
  if (response.status !== 200 && response.status !== 303) {
    throw new Error(`The ${twinId} checkout failed with HTTP ${response.status}.`);
  }
}

export async function seedPayment(
  session: RunningSession,
  twinId: string,
  reference: string,
): Promise<PaymentHandle> {
  const driver = driverFor(twinId);
  const payment = await driver.createPayment(session, reference, undefined);
  await completeCheckoutInNode(session, twinId, payment.checkoutUrl, "success");
  return payment;
}
