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
| **It never puts a session token or launch code in a URL after sign-in.** | The dashboard lives under `/_ibeji/` and uses a single-use launch code, then an `HttpOnly`, `SameSite=Strict` cookie whose path is `/_ibeji`. The session token stays out of the browser. |
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

## Customer data and webhook URLs

Use fake customer data only. Events, records, exports and the dashboard keep the customer name, email and phone exactly as your app sent them. That is useful while testing, but it means real customer data would be stored and exported too.

Never put a secret in a webhook URL. Ibeji shows the URL on the dashboard and includes it in an export, so anyone who sees the dashboard or the export can read that secret.

## Flutterwave webhook check

Flutterwave v3 sends a `verif-hash` header. It is a shared secret, so it proves who sent the webhook, not that its body is unchanged. Flutterwave v3 does not sign the body; a changed body with the correct `verif-hash` can still pass. Validate the fields your app relies on instead of treating the hash as a body signature.

## Dashboard sign-in

Ibeji does not use accounts or passwords:

1. `ibeji start` prints a dashboard link with a single-use launch code.
2. The browser exchanges the code for an `HttpOnly`, `SameSite=Strict` cookie.
3. The launch code is removed from the address bar.
4. The browser stores no session token, UI token or launch code in local storage, session storage or IndexedDB.
5. Every request that changes something also sends `X-Ibeji-Request: 1` and the correct `Origin`. Ibeji rejects a request without them.

The cookie path is `/_ibeji`, not `/`. Browsers share cookies between every port on `127.0.0.1`, so this path is what keeps the cookie away from your own app and from other local servers. If the cookie is stale after a restart, the dashboard says so and asks you to use a new link from `ibeji open`.

## What Ibeji protects against

Ibeji is a local development tool. Its threat model has a clear line.

**It protects against websites.** The control API and the twins check the `Host` header, reject cross-site changes, set no CORS headers, refuse to be framed, and keep the UI cookie under `/_ibeji`. A website you visit in the same browser cannot read your Ibeji data or change your Ibeji session. The security review tested this with cross-site requests and a separate browser origin.

**It does not protect against a malicious program already running on your computer as you.** Such a program can read `~/.ibeji/session.json`, which holds the session token and the control port. It can also read your files, your browser data and your test keys. No cookie rule or local API check can stop code that already has your user account's permissions. That is the normal limit of local development tools. Ibeji makes the token and cookie handling safe against websites, not against spyware or another program with your account.

The practical rule: keep your computer account and its software trustworthy, and stop Ibeji when you are not testing.

## Webhook addresses

A webhook URL is the address in your app that receives webhook messages. Ibeji checks every address before it sends anything.

| Address | Default | With `--allow-private-webhooks` | With `--allow-public-webhooks` |
|---|---|---|---|
| This computer (`127.0.0.0/8`, `::1`, `localhost`) | Allowed | Allowed | Allowed |
| Private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) and `host.docker.internal` | Refused | Allowed | Allowed |
| Public internet addresses | Refused | Refused | Allowed, with a warning |
| Unspecified (`0.0.0.0`, `::`), link-local (`169.254.0.0/16`, `fe80::/10`), multicast and broadcast | Refused | Refused | Refused |

Ibeji resolves the host name, checks every address it resolves to, and connects to a checked address. A name cannot change between the check and the connection. Redirects are never followed. Link-local addresses are always refused because they include cloud metadata services. Broadcast means `255.255.255.255` and the directed broadcast address of every IPv4 network this computer is on. IPv4-mapped, NAT64 and 6to4 IPv6 addresses are judged by the IPv4 address inside them.

`ibeji doctor` uses the same address checks. It reads the running session's address policy from `GET /status`, or the config file's policy when no session is running, and says which one it used. It sends a `HEAD` request only when every resolved address is this computer. A private or public webhook URL is reported as "not contacted".

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
- The session file contains the session token, ports and process id. It is removed on clean shutdown. Every read checks its owner and mode. On macOS and Linux, if you own a file that other users can read, Ibeji changes it back to mode `600` and warns you. If another user owns the file, Ibeji refuses to use it and reports `SESSION_STALE`.
- An export replaces the token, UI token, launch codes, credentials, live keys and authorization headers with fingerprints or removes them.
- A live key never appears in full in a request field, an event, a log, an error, an export, a control API response, CLI output, an MCP result or the dashboard. When a live key arrives in a header, query value or body value, Ibeji replaces it with `[live key removed: <fingerprint>]` before the twin handles the request, records a warning, and scans every output again. Only the first eight hexadecimal characters of its SHA-256 hash are shown.

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
