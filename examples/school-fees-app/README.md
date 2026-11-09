# School fees example app

A very small Node app for a school's fees desk. It uses Ibeji's Paystack and Flutterwave twins to show two mistakes in Musa's story:

- **Naive mode** marks a student paid as soon as a payment starts, and trusts every webhook.
- **Safe mode** marks a student paid only after a verified webhook confirms success, and ignores duplicate webhooks.

No real money moves. The app uses only Node's built-in modules, so there is no web framework to install.

This guide is written for a person who installed Ibeji from npm. Every Ibeji command below runs the installed copy through `npx`. Run the commands in a terminal from the folder that contains this `README.md`.

**Version 0.1.0 note:** this app supports Paystack and Flutterwave. The Stripe twin is version 0.2.0 and is not part of this release. The app stops with a plain message if `PAYMENT_PROVIDER=stripe`.

## 1. Start Ibeji

Open a terminal in this example folder and run:

```bash
npx ibeji start
```

Ibeji prints a block for Paystack and a block for Flutterwave. Each block shows:

- **Base URL**: the address your app must use
- **Public key**
- **Secret key**
- **Webhook URL** (empty until you set one)

It also prints a seed and a dashboard link, and opens the dashboard in your browser.

Leave this terminal running. Open a second terminal for the next steps.

Never use fixed ports such as 4401 or 4402. Ibeji may choose different ports on your computer. Always copy the base URL that Ibeji prints.

## 2. Copy the test details

In the second terminal, in this example folder, run:

```bash
npx ibeji keys
```

This prints the fake test keys for both twins. To print one twin only, run `npx ibeji keys paystack` or `npx ibeji keys flutterwave`.

To print the addresses again, run:

```bash
npx ibeji status
```

The **Base URL** for each twin is also in the `npx ibeji start` output and on the dashboard's **Connect your app** page.

### Paystack

Copy the values from the Ibeji output into these commands:

```bash
export IBEJI_PAYSTACK_BASE_URL="<Paystack Base URL printed by ibeji start or ibeji status>"
export IBEJI_PAYSTACK_PUBLIC_KEY="<Paystack Public key printed by ibeji keys>"
export IBEJI_PAYSTACK_SECRET_KEY="<Paystack Secret key printed by ibeji keys>"
```

### Flutterwave

```bash
export IBEJI_FLUTTERWAVE_BASE_URL="<Flutterwave Base URL printed by ibeji start or ibeji status>"
export IBEJI_FLUTTERWAVE_PUBLIC_KEY="<Flutterwave Public key printed by ibeji keys>"
export IBEJI_FLUTTERWAVE_SECRET_KEY="<Flutterwave Secret key printed by ibeji keys>"
export IBEJI_FLUTTERWAVE_WEBHOOK_HASH="<Flutterwave Webhook secret hash printed by ibeji keys>"
```

These are Ibeji's fake local test values. Never put a real service key in this app.

On Windows PowerShell, set the same values with `$env:NAME = "value"`, for example:

```powershell
$env:IBEJI_PAYSTACK_BASE_URL = "<Paystack Base URL>"
$env:IBEJI_PAYSTACK_PUBLIC_KEY = "<Paystack Public key>"
$env:IBEJI_PAYSTACK_SECRET_KEY = "<Paystack Secret key>"
```

## 3. Start the app

Use one of these commands. The app prints `School fees app listening on http://127.0.0.1:3000` and the webhook URL it expects.

Paystack, naive mode:

```bash
PAYMENT_PROVIDER=paystack APP_MODE=naive node server.js
```

Paystack, safe mode:

```bash
PAYMENT_PROVIDER=paystack APP_MODE=safe node server.js
```

Flutterwave, naive mode:

```bash
PAYMENT_PROVIDER=flutterwave APP_MODE=naive node server.js
```

Flutterwave, safe mode:

```bash
PAYMENT_PROVIDER=flutterwave APP_MODE=safe node server.js
```

Open the printed address in your browser. To use another port, set `PORT` before the command, for example `PORT=3100 PAYMENT_PROVIDER=paystack APP_MODE=naive node server.js`.

On Windows PowerShell, set the variables first:

```powershell
$env:PAYMENT_PROVIDER = "paystack"
$env:APP_MODE = "naive"
node server.js
```

## 4. Set the webhook URL in Ibeji

The app prints the webhook URL for the provider you started, for example `http://127.0.0.1:3000/webhooks/paystack`. Use the port the app printed.

Choose either way to save it in Ibeji.

**Dashboard:** open the **Webhooks** page, or the **Connect your app** page, and paste the URL into the matching twin's webhook field.

**CLI:** run one of these in a terminal:

```bash
npx ibeji webhook-url paystack http://127.0.0.1:3000/webhooks/paystack
npx ibeji webhook-url flutterwave http://127.0.0.1:3000/webhooks/flutterwave
```

Use the port your app printed if it is not 3000.

The app verifies each webhook the way the service does:

- **Paystack:** `x-paystack-signature`, an HMAC SHA512 of the raw body using the secret key.
- **Flutterwave:** `verif-hash`, compared with the webhook hash.

## 5. See Musa's first bug: paid too early

1. Open `http://127.0.0.1:3000` (or the address the app printed).
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
PAYMENT_PROVIDER=paystack APP_MODE=safe node server.js
```

or:

```bash
PAYMENT_PROVIDER=flutterwave APP_MODE=safe node server.js
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
| Paystack | Naive | `PAYMENT_PROVIDER=paystack APP_MODE=naive node server.js` |
| Paystack | Safe | `PAYMENT_PROVIDER=paystack APP_MODE=safe node server.js` |
| Flutterwave | Naive | `PAYMENT_PROVIDER=flutterwave APP_MODE=naive node server.js` |
| Flutterwave | Safe | `PAYMENT_PROVIDER=flutterwave APP_MODE=safe node server.js` |

Webhook URL commands:

```bash
npx ibeji webhook-url paystack http://127.0.0.1:3000/webhooks/paystack
npx ibeji webhook-url flutterwave http://127.0.0.1:3000/webhooks/flutterwave
```

## How the two providers are called

- **Paystack:** The official Node library hard-codes `https://api.paystack.co` and cannot be pointed at a twin. The app uses `fetch` for `POST /transaction/initialize`, sends the parent to `data.authorization_url`, and verifies `charge.success` with the secret key.
- **Flutterwave:** The official v3 library can point at a twin for verify and refund, but it has no Standard hosted-payment method. Its Charge group calls `/v3/charges`, not `/v3/payments`. Constructing the library also starts telemetry calls to external hosts. The app therefore uses `fetch` for `POST /v3/payments`, sends the parent to `data.link`, and checks the `verif-hash` header.

## Files

- `server.js`: the pages, payment start, return page, webhook checks and student records.
- `providers.js`: the Paystack and Flutterwave request and verification rules.
- `run.js`: the small wrapper used by the four repository-only shortcut scripts.

All student records are in memory. Restarting the app clears them.

## For Ibeji contributors (repository only)

You do not need this section if you installed Ibeji from npm.

Inside the Ibeji repository, the same app can be started with the repository scripts after building:

```bash
pnpm install
pnpm build
pnpm example:paystack:naive
pnpm example:paystack:safe
pnpm example:flutterwave:naive
pnpm example:flutterwave:safe
```

The repository's development commands are:

```bash
node dist/cli.js start
node dist/cli.js keys
```

These commands use the source tree's `dist/` folder and are not part of the installed package.
