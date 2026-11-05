# Stripe and Ibeji

This page compares Stripe's own testing tools with the Stripe twin planned for Ibeji version 0.2.0. It uses only `research/stripe.md`, researched on 28 October 2026.

The Stripe twin is not built or registered in version 0.1.0. This page describes the planned 0.2.0 scope. Do not read it as a description of a tool that exists in 0.1.0.

## What Stripe already provides

### Test mode

Stripe test mode already provides:

- Test API keys and sandboxes. No real funds move.
- Test cards for success by brand and country, declines, fraud and Radar outcomes, disputes, refunds and 3DS.
- Test PaymentMethod IDs such as `pm_card_visa` and decline variants.
- Test clocks for advancing time.
- Test-mode webhook delivery through the Dashboard and the Stripe CLI.

### Stripe CLI

The Stripe CLI is official and includes:

- `stripe trigger <event>` creates the real API objects needed for an event and triggers the event. Stripe warns that this creates objects and may trigger related events.
- `stripe listen --forward-to localhost:4242/webhook` receives events and forwards them to a local address. It prints a `whsec_` signing secret.
- `stripe listen --latest` receives events in the latest API version.
- `stripe events resend <event_id> --webhook-endpoint=we_...` resends an event for up to 30 days.
- `stripe logs tail` shows API request logs in a sandbox.
- `stripe get`, resource commands and HTTP commands work with API objects.

The CLI can trigger events and create real test-mode objects. It is not a stateful failure-injection server. It cannot make an arbitrary API request hang, drop a connection after the action is performed, duplicate a webhook on a custom schedule, or keep local state across Paystack, Flutterwave and Stripe.

### stripe-mock

Stripe's official `stripe-mock` server:

- Accepts the same request shapes as Stripe and validates parameters against Stripe's OpenAPI schema.
- Does not try to reproduce the behaviour of the real Stripe API.
- Returns hardcoded fixtures with correct types. The fixtures are not necessarily realistic responses.
- Is stateless: data sent on `POST` is validated but not kept for later requests.
- Is locked to the latest Stripe API version and does not support older versions.
- Does not support testing for specific responses and errors. It returns success instead of the error you may want.
- Is intended for basic SDK sanity checks, not sophisticated testing.
- Uses HTTP port 12111 and HTTPS port 12112 by default.

## What Ibeji adds

The planned Stripe twin adds a local Stripe-shaped API that keeps records across requests for the life of a session. It also adds the failure library, scenarios and one dashboard for Paystack, Flutterwave and Stripe.

The parts that are genuinely different from Stripe's own tools are:

- **Stateful local records without a Stripe account.** A PaymentIntent, Checkout Session or Refund created in one request can be retrieved and listed in later requests. Stripe test mode also keeps records, but it is Stripe's remote service. `stripe-mock` is stateless by design.
- **Failure injection.** Ibeji can add a slow response, a connection reset after the action is performed, a delayed first webhook, duplicate webhook copies, out-of-order webhooks, a missing webhook or a forged webhook. Stripe test mode does not provide arbitrary versions of these failures.
- **Scenarios.** A scenario switches on several failures with fixed settings and tells a story, such as a slow Friday or a lost refund reply.
- **One dashboard for three services.** The same controls and event log cover Paystack and Flutterwave in 0.1.0 and Stripe in 0.2.0.
- **No real service contact.** The twins run on your computer. You do not need a Stripe account or a network connection.

## What Ibeji does not add

Ibeji does not replace Stripe's own tools, and it does not claim to be better at everything:

- It does not provide real card network behaviour, real disputes, real Radar rules, real payouts, real Connect transfers or a real hosted Checkout page.
- It does not support every Stripe API version. The twin serves only `2026-09-30.endive`.
- It does not support every Stripe event or every optional Checkout field.
- It does not make a real Stripe account safer. It is a local test tool.
- It does not remove the need to test against Stripe test mode. Use Stripe test mode for Stripe's own card and account behaviour. Use Ibeji for failure scenarios and cross-service testing.

## Side-by-side

| Need | Stripe test mode | Stripe CLI | stripe-mock | Ibeji Stripe twin, 0.2.0 |
|---|---|---|---|---|
| Test keys and no real funds | Yes | Uses test mode | No real Stripe account | Yes, local fake keys |
| Test cards, declines, 3DS | Yes | Can trigger events | No | Yes, local checkout outcomes based on Stripe's documented test outcomes |
| Test clocks | Yes | No | No | No |
| Webhook forwarding | Dashboard and CLI | `stripe listen` | No | Local webhook deliveries, with address rules |
| Trigger a named event | No | `stripe trigger` | No | No direct trigger command. Create the resource through the local API. |
| Stateful records across requests | Yes, in Stripe | Yes, in Stripe | No | Yes, in the local twin |
| Arbitrary slow response | No | No | No | Yes |
| Connection drop after the action | No | No | No | Yes |
| Duplicate webhook on a custom schedule | No | No | No | Yes |
| Out-of-order webhooks | No | No | No | Yes |
| Missing webhook | No | No | No | Yes |
| Forged webhook | No | No | No | Yes |
| One dashboard for Paystack, Flutterwave and Stripe | No | No | No | Yes, in 0.2.0 |

"Stripe test mode" and the "Stripe CLI" columns describe Stripe's documented tools, not a claim that Stripe cannot do more. Stripe's documentation is the authority for its own tools.

## The honest summary

Stripe already has a strong test mode, an official CLI and an official mock server. Ibeji does not pretend those do not exist.

Ibeji's difference is a local, stateful API that keeps records across requests and can inject the kinds of failure that test mode does not produce. It also puts Paystack, Flutterwave and Stripe behind one dashboard. That is the gap Ibeji fills.

## Sources

- `research/stripe.md` section 22: test mode cards, declines and 3DS.
- `research/stripe.md` section 25: Stripe test mode, the Stripe CLI and `stripe-mock`.
- `research/stripe.md` section 26: which failures Stripe's documentation supports.

Research date: 28 October 2026.

## Related pages

- [Limits](limits.md)
- [Connect your app](connect-your-app.md)
- [Safety](safety.md)
