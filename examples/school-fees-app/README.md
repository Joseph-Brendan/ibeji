# School fees example app

A very small Node app for a school's fees desk. It uses Ibeji's Paystack and Flutterwave twins to show two mistakes in Musa's story:

- **Naive mode** marks a student paid as soon as a payment starts, and trusts every webhook.
- **Safe mode** marks a student paid only after a verified webhook confirms success, and ignores duplicate webhooks.

No real money moves. The app uses only Node's built-in modules, so there is no web framework to install.

**Version 0.1.0 note:** this app supports Paystack and Flutterwave. The Stripe twin is version 0.2.0 and is not part of this release. The app stops with a plain message if `PAYMENT_PROVIDER=stripe`.

## 1. Start Ibeji

From the repository root:

```bash
pnpm install
pnpm build
node dist/cli.js start
```

The dashboard opens in your browser. If you installed Ibeji globally, `ibeji start` does the same thing.

Leave this terminal running.

## 2. Copy the test details

Open the **Connect your app** page in the dashboard, or run `node dist/cli.js keys paystack` or `node dist/cli.js keys flutterwave`. Copy the address and test keys into your terminal.

### Paystack

```bash
export IBEJI_PAYSTACK_BASE_URL="http://127.0.0.1:4401"
export IBEJI_PAYSTACK_PUBLIC_KEY="pk_test_..."
export IBEJI_PAYSTACK_SECRET_KEY="sk_test_..."
```

### Flutterwave

```bash
export IBEJI_FLUTTERWAVE_BASE_URL="http://127.0.0.1:4402"
export IBEJI_FLUTTERWAVE_PUBLIC_KEY="FLWPUBK_TEST-..."
export IBEJI_FLUTTERWAVE_SECRET_KEY="FLWSECK_TEST-..."
export IBEJI_FLUTTERWAVE_WEBHOOK_HASH="ibeji_..."
```

These are Ibeji's fake local test values. Never put a live key in this app.

## 3. Start the app

Choose one command:

```bash
pnpm example:paystack:naive
pnpm example:paystack:safe
pnpm example:flutterwave:naive
pnpm example:flutterwave:safe
```

The app prints:

```text
School fees app listening on http://127.0.0.1:3000
```

Open that address. To use another port, set `PORT` before the command, for example `PORT=3100 pnpm example:paystack:naive`.

## 4. Set the webhook URL in Ibeji

In the dashboard, open **Webhooks** or **Connect your app**:

- Paystack: set the webhook URL to `http://127.0.0.1:3000/webhooks/paystack`
- Flutterwave: set the webhook URL to `http://127.0.0.1:3000/webhooks/flutterwave`

If you changed `PORT`, use that port in the URL.

The app verifies each webhook the way the service does:

- Paystack: `x-paystack-signature`, an HMAC SHA512 of the raw body using the secret key.
- Flutterwave: `verif-hash`, compared with the webhook hash.

## 5. See Musa's first bug: paid too early

1. Open `http://127.0.0.1:3000`.
2. Click **Pay fees** next to Amina Bello.
3. Click **Start payment**.
4. Choose **Pay successfully** on the Ibeji checkout page.

The student is already marked **Paid** when you return, even before the webhook arrives. In fact, naive mode marked the student paid before you chose a result. That is Musa's bug.

## 6. See the declined payment bug

1. In the dashboard, open **Failures**.
2. Find **Declined payment** (`payment-declined`).
3. Choose your provider, switch it on, and save.
4. In the app, pay another student and choose **Pay successfully**.
5. The Ibeji checkout says the payment was declined.
6. The app still shows the student as **Paid** in naive mode.

Switch the failure off before the next step.

In safe mode, the same declined payment leaves the student **Not paid**, because no verified success webhook arrives.

## 7. See the duplicate webhook bug

1. In the dashboard, open **Failures**.
2. Find **Duplicate webhook** (`webhook-duplicated`).
3. Choose your provider, switch it on, and save.
4. Pay another student and choose **Pay successfully**.
5. Open the student details in the app.

Naive mode shows **2 payment records** for one payment. It trusted the same event twice. Safe mode records it once and ignores the duplicate.

Switch the failure off before the next step.

## 8. See safe mode work

Stop the app with `Ctrl+C`, then start the safe command for the same provider:

```bash
pnpm example:paystack:safe
```

or:

```bash
pnpm example:flutterwave:safe
```

The webhook URL stays saved in Ibeji. Pay another student:

- The return page says the student is **Not paid yet**.
- After the verified webhook arrives, refresh the student list. The student becomes **Paid** with one payment record.
- With **Declined payment** on, the student stays **Not paid**.
- With **Duplicate webhook** on, the student has one payment record, not two.

## 9. Optional: reject a forged webhook

1. Start the app in safe mode.
2. In **Failures**, switch on **Forged webhook** (`webhook-verification-fails`).
3. Pay a student and choose **Pay successfully**.
4. The app rejects the webhook and the student stays **Not paid**.
5. The **Webhooks** page shows the failed delivery with HTTP 401.

## Commands for both providers

| Provider | Mode | Command |
|---|---|---|
| Paystack | Naive | `pnpm example:paystack:naive` |
| Paystack | Safe | `pnpm example:paystack:safe` |
| Flutterwave | Naive | `pnpm example:flutterwave:naive` |
| Flutterwave | Safe | `pnpm example:flutterwave:safe` |

You can also run the app directly on macOS or Linux:

```bash
PAYMENT_PROVIDER=paystack APP_MODE=naive node examples/school-fees-app/server.js
```

On Windows PowerShell, set the variables first:

```powershell
$env:PAYMENT_PROVIDER = "paystack"
$env:APP_MODE = "naive"
node examples/school-fees-app/server.js
```

## How the two providers are called

- **Paystack:** The official Node library hard-codes `https://api.paystack.co` and cannot be pointed at a twin. The app uses `fetch` for `POST /transaction/initialize`, sends the parent to `data.authorization_url`, and verifies `charge.success` with the secret key.
- **Flutterwave:** The official v3 library can point at a twin for verify and refund, but it has no Standard hosted-payment method. Its Charge group calls `/v3/charges`, not `/v3/payments`. Constructing the library also starts telemetry calls to external hosts. The app therefore uses `fetch` for `POST /v3/payments`, sends the parent to `data.link`, and checks the `verif-hash` header.

## Files

- `server.js`: the pages, payment start, return page, webhook checks and student records.
- `providers.js`: the Paystack and Flutterwave request and verification rules.
- `run.js`: the small wrapper used by the four one-command scripts.

All student records are in memory. Restarting the app clears them.
