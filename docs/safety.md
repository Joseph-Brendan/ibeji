# Safety

Ibeji is a local test tool. It is built to keep test payments away from real money, real customers and real payment services. This page explains what Ibeji will not do, and why each rule matters.

## What Ibeji never does

| Rule | Why it matters |
|---|---|
| **It never touches real money.** | A twin records payments, refunds and transfers in its own local state. The test checkout page says no real money moves. Ibeji cannot charge a card or send a payout. |
| **It never contacts a payment service.** | The twins answer on your computer. The only outbound connections Ibeji makes at runtime are webhook deliveries, and those follow the address rules below. There are no telemetry calls, update checks, remote fonts, remote scripts or remote images. The hand-run fixture recorder is a separate development tool, is not part of the published package, and refuses live keys. |
| **It never accepts a live key.** | A live key can move real money. Every twin recognises its service's live key formats, refuses the request, records only a fingerprint, and shows a red warning banner. |
| **It never listens beyond your computer.** | Every server binds to `127.0.0.1`. Other computers on your network cannot reach the dashboard, the control API, a twin or a test checkout page. |
| **It never sends fake webhooks to public servers by default.** | A fake "payment succeeded" message sent to a real public server could change a real order. Ibeji allows this computer by default and refuses public addresses unless you pass an explicit flag. |
| **It never puts a session token or launch code in a URL after sign-in.** | The dashboard uses a single-use launch code, then an `HttpOnly`, `SameSite=Strict` cookie. The session token stays out of the browser. |
| **It never loads code, fonts or images from the internet.** | The dashboard works offline and cannot be changed by a remote file. |

## The live-key rule

Each service has test keys and live keys. A test key works only in that service's test mode. A live key can move real money.

Ibeji recognises the live formats it knows:

- **Paystack:** keys that start with `pk_live_` or `sk_live_`.
- **Flutterwave:** keys in the live families, such as `FLWPUBK-...` or `FLWSECK-...`, without `_TEST`.
- **Stripe:** keys that start with `sk_live_` or `rk_live_`.

When a request reaches a twin with a live key, the twin refuses it with that service's error shape. It records a warning event. The event and the dashboard banner contain only a fingerprint: the first 8 hexadecimal characters of the SHA-256 hash of the key. They never contain the key, any part of it, or a value that can be used to rebuild it.

### A short scenario

A developer copies a real `sk_live_...` key into a test `.env` file by mistake. Their app still points at Ibeji, so the request reaches the Paystack twin. The twin sees the live format and refuses the request. The dashboard shows the red live-key banner, and the event contains only the fingerprint. Ibeji never sends the request to Paystack.

If the app had still pointed at the real Paystack address, the same mistake could have moved real money. The live-key warning catches the mistake while the app is pointed at Ibeji. It is a warning, not a guarantee: always check your app's base URL as well as its keys.

## Dashboard sign-in

Ibeji does not use accounts or passwords:

1. `ibeji start` prints a dashboard link with a single-use launch code.
2. The browser exchanges the code for an `HttpOnly`, `SameSite=Strict` cookie.
3. The launch code is removed from the address bar.
4. The browser stores no session token, UI token or launch code in local storage, session storage or IndexedDB.
5. Every request that changes something also sends `X-Ibeji-Request: 1` and the correct `Origin`. Ibeji rejects a request without them.

If the cookie is stale after a restart, the dashboard says so and asks you to use a new link from `ibeji open`.

## Webhook addresses

A webhook URL is the address in your app that receives webhook messages. Ibeji checks every address before it sends anything.

| Address | Default | With `--allow-private-webhooks` | With `--allow-public-webhooks` |
|---|---|---|---|
| This computer (`127.0.0.0/8`, `::1`, `localhost`) | Allowed | Allowed | Allowed |
| Private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) and `host.docker.internal` | Refused | Allowed | Allowed |
| Public internet addresses | Refused | Refused | Allowed, with a warning |
| Unspecified (`0.0.0.0`, `::`), link-local (`169.254.0.0/16`, `fe80::/10`), multicast and broadcast | Refused | Refused | Refused |

Ibeji resolves the host name, checks every address it resolves to, and connects to a checked address. A name cannot change between the check and the connection. Redirects are never followed. Link-local addresses are always refused because they include cloud metadata services.

The public flag prints a warning at start and shows it in the dashboard. Use it only when you understand that a twin can send fake payment messages to a real server.

## Test checkout pages

Each twin serves its own test checkout page on its own port. The page:

- says it is an Ibeji test checkout and no real money moves
- uses Ibeji's own look, not the payment service's branding
- shows only the amount, currency, customer email and reference from the twin's own record
- records the tester's choice with a POST form and checks the twin's own `Origin`
- explains when a failure rule changed the result

## Files and local data

- `~/.ibeji` is readable only by your user. On macOS and Linux the folder uses mode `700` and the files use mode `600`. On Windows the folder inherits your user profile's access control.
- The session file contains the session token, ports and process id. It is removed on clean shutdown.
- An export replaces the token, UI token, launch codes, credentials, live keys and authorization headers with fingerprints or removes them.
- A live key never appears in an event, a log, an error, an export or the dashboard.

## What Ibeji cannot protect you from

Ibeji cannot stop a mistake outside its own process:

- If you point your app at the real payment service, Ibeji is not in the path.
- If you pass `--allow-public-webhooks`, a twin can send fake messages to a public server.
- If you share your screen, terminal or `.env` file, another person may see your test details.
- If another person can use your operating system account, they can read your local files.
- If you paste a live key into a test setting, stop and rotate that key at the service. Ibeji refused it, but the key may already have been copied somewhere else.

The safest habit is simple: point the app at the twin, use only the keys shown by the dashboard, and keep the default webhook rules.

## Related pages

- [Connect your app](connect-your-app.md)
- [Limits](limits.md)
- [CLI](cli.md)
