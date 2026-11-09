import { describe, expect, it } from "vitest";

import { registry } from "../../src/twins/registry.js";
import {
  createPayment,
  checkoutPage as flutterwaveCheckoutPage,
  startFlutterwave,
} from "../helpers/flutterwave.js";
import {
  initialize,
  checkoutPage as paystackCheckoutPage,
  startPaystack,
} from "../helpers/paystack.js";

function amountIn(text: string): string | undefined {
  return /₦[\d,]+\.\d{2}/u.exec(text)?.[0];
}

describe("C21 D66 one amount format", () => {
  it("C21 D66 shows the same payment text for both twins on summaries and checkout pages", async () => {
    const paystack = await startPaystack();
    const flutterwave = await startFlutterwave();
    try {
      await initialize(paystack, {
        amount: "1250000",
        email: "same.payment@example.com",
        currency: "NGN",
        reference: "same-payment",
      });
      await createPayment(flutterwave, {
        amount: 12_500,
        tx_ref: "same-payment",
        currency: "NGN",
        redirect_url: "https://example.com/ibeji/flutterwave",
        customer: { email: "same.payment@example.com" },
      });

      const paystackEvent = paystack.events
        .after(0)
        .find(
          (event) =>
            event.type === "request" && event.details.actionId === "transaction.initialize",
        );
      const flutterwaveEvent = flutterwave.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "payment.create");
      expect(paystackEvent).toBeDefined();
      expect(flutterwaveEvent).toBeDefined();

      const paystackAmount = amountIn(paystackEvent?.summary ?? "");
      const flutterwaveAmount = amountIn(flutterwaveEvent?.summary ?? "");
      expect(paystackAmount).toBe("₦12,500.00");
      expect(flutterwaveAmount).toBe(paystackAmount);

      const paystackPage = await paystackCheckoutPage(paystack, "same-payment");
      const flutterwavePage = await flutterwaveCheckoutPage(flutterwave, "same-payment");
      expect(await paystackPage.text()).toContain(paystackAmount ?? "");
      expect(await flutterwavePage.text()).toContain(flutterwaveAmount ?? "");
    } finally {
      await paystack.running.stop();
      await flutterwave.running.stop();
    }
  });

  it("C21 D66 both registered twins use the shared display formatter", () => {
    for (const twin of registry.list()) {
      expect(twin.money.formatDisplay(1_250_000, "NGN"), twin.id).toBe("₦12,500.00");
    }
  });
});
