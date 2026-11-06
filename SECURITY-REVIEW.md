# Ibeji security review

Date: 6 November 2026
Version reviewed: 0.1.0
Commit reviewed: `9d04517`
Reviewer: independent review. No product code was changed.

## Release recommendation

I would block the release until problem 1 is fixed. A live key placed in an ordinary request field is copied in full into the event log, the twin state, the webhook body, the export, the dashboard and the MCP results. The safety page says this can never happen.

The remote website attacks failed. A website cannot read Ibeji data or change Ibeji state. The remaining problems are local confidentiality and defense-in-depth issues, plus one outbound request path in `ibeji doctor`.

## Scope and method

I read `AGENTS.md`, `BUILD-LOG.md`, the three research files, and SPEC.md C3, C4, C8, C11, C12, C13 and C15. I reviewed every file under `src/` and `scripts/`, then wrote temporary attack scripts against real sessions. The scripts were deleted before the commit, so this review is the only committed file.

The checks used:

- A real `ibeji start` session with the Paystack and Flutterwave twins on random ports.
- Raw HTTP requests for Host, Origin, cookie and form attacks.
- Playwright with Chromium for the browser attacks on a real page served from an unrelated origin.
- `ibeji export`, `ibeji events`, the MCP stdio server, and the example app.
- The project test suite, including the T7 network block in `test/setup/t7-network.ts`.
- `pnpm audit` and `pnpm audit --prod`.

The attack script reported 114 of 120 checks passed. The six failures are the live-key leak described in check 4. The browser script passed 7 of 7 checks. The focused security tests passed 45 of 45.

## Check 1: can a website read Ibeji data or change its state?

Verdict: **Safe**.

| Attack | Result |
|---|---|
| Control API request with no token | HTTP 401 |
| Control API request with a guessed token | HTTP 401 |
| Launch code used once | HTTP 200, then HTTP 401 on reuse |
| Launch code after 121 seconds | HTTP 401 |
| Cookie change without `X-Ibeji-Request: 1` | HTTP 403 `FORBIDDEN_ORIGIN` |
| Cookie change with `Origin: http://evil.example` | HTTP 403 `FORBIDDEN_ORIGIN` |
| Cookie change with the correct Origin and request header | HTTP 200 |
| Bearer request without browser headers | HTTP 200, as intended for the CLI |
| Host `evil.example:<control port>` on the control server | HTTP 403 `FORBIDDEN_HOST` |
| Host `127.0.0.1:<wrong port>` on the control server | HTTP 403 `FORBIDDEN_HOST` |
| Host `localhost:<control port>` on the control server | HTTP 200 |
| Host `evil.example:<twin port>` on the Paystack twin | HTTP 403 |
| Host `evil.example:<twin port>` on the Flutterwave twin | HTTP 403 |
| Cross-site form POST to a Paystack checkout page | HTTP 403 `FORBIDDEN_ORIGIN` |
| Checkout POST with no Origin header | HTTP 403 |
| Checkout POST from the checkout page's own origin | HTTP 200 |
| Static path traversal `/../package.json` and three variants | HTTP 404, no package contents |
| Control page framing | `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'` |
| Checkout page framing | The same `frame-ancestors 'none'` policy |
| Browser `fetch` from `http://evil.test` to the control API | Blocked by CORS; the site could not read the response |
| Browser top-level navigation from `http://evil.test` to the control page | The initial request had no `Cookie` header; the `SameSite=Strict` cookie was not sent |
| Browser attempt to read the opened dashboard DOM | `SecurityError` from cross-origin DOM access |
| Browser cross-site form POST to a checkout page | `FORBIDDEN_ORIGIN` response |
| Browser cross-site form POST to the control API | `UNAUTHORIZED` response |

The code evidence is in `src/control/app.ts` lines 356 to 401 for the Host check and sign-in middleware, lines 413 to 425 for the launch-code exchange and cookie, and `src/twins/framework/server.ts` lines 464 to 476 for the twin Host check and lines 593 to 599 for the checkout Origin check. The browser tests show that a website can open the static dashboard page, but it cannot read the page, cannot read the API, and cannot send a state-changing request.

The existing `test/integration/control-security.test.ts` suite also passed all 45 tests, including the Host, token, cookie, CORS, body-limit, launch-link and stale-cookie tests. `test/ui/dashboard.spec.ts` includes the launch-code and web-storage test.

## Check 2: do the servers listen on 127.0.0.1 only?

Verdict: **Safe** for the two registered twins. The Stripe twin is not part of version 0.1.0, so there is no Stripe server to test.

The control server calls `serve` with `hostname: "127.0.0.1"` at `src/control/server.ts:31`. Each twin does the same at `src/twins/framework/server.ts:771`. The session address builder uses `hostname: "127.0.0.1"` at `src/control/session.ts:182`.

`test/integration/control-security.test.ts` has the test `T6 binds the control server and every twin to 127.0.0.1`. It asserts the bound address of the control server and every running twin. It passed.

`src/twins/registry.ts:48-51` registers only Paystack and Flutterwave. A real `ibeji start --twins stripe` fails with `CONFIG_INVALID` and `These twin ids are unknown: stripe. Registered twins: paystack, flutterwave.` No Stripe listener exists.

## Check 3: session file permissions and edited session files

Verdict: **Risk, low**. Remote redirection is safe. A local process that can write the file can change the port, but the token still goes only to 127.0.0.1. A pre-existing session file with a permissive mode is used without a check.

Measured on macOS from a real session:

- `~/.ibeji/session.json`: mode `600`
- `~/.ibeji`: mode `700`
- `~/.ibeji/credentials.json`: mode `600`

The code sets the folder mode at `src/control/paths.ts:43`, the temporary file mode at `src/control/paths.ts:58` and `:60`, and the existing file mode at `src/control/paths.ts:101`. The same POSIX branches are exercised by `test/integration/control-session.test.ts` and `test/unit/control-session-file.test.ts`, which run on Ubuntu in CI.

There is a gap on read. `readSessionFile` at `src/control/session-file.ts:28-39` reads whatever mode the file already has. It does not check or repair the mode. `doctor` checks the credentials file mode at `src/cli/doctor.ts:186-226`, but it does not check `session.json`. A pre-existing `session.json` with mode `644` would still be used, and another local user could read the bearer token. A normal start rewrites the file with mode `600`, but a later permission change is not detected. This is a low-to-medium local risk.

The session file schema is a strict object with `instanceId`, `processId`, `ports`, `token`, `startTime` and `version` at `src/control/session-file.ts:6-15`. It has no host or URL field. `ControlClient` builds every request as `http://127.0.0.1:<port>` at `src/control/client.ts:100`, and the health check is hard-coded to 127.0.0.1 at `src/control/session-file.ts:67`.

I tested three edited files:

- Changing `ports.control` to another loopback port made `ibeji status` send `Authorization: Bearer <token>` to that loopback port. The token did not leave 127.0.0.1.
- Adding a `controlUrl: http://example.com` field made the file invalid. The CLI removed it and stopped with `The saved Ibeji session is no longer running.` No request was sent.
- A file with a dead `processId` was removed without sending a token.

The MCP server uses the same `requireSession` and `ControlClient` path at `src/mcp/session.ts:13-18`, so it has the same loopback-only behaviour. A local attacker who can write the session file can redirect the token to another local port, but only within the same user's loopback and after passing the instance health check. That is a same-user local threat, not a remote one.

## Check 4: live keys

Verdict: **Broken**. No live key was accepted as a credential, but a live key placed in an ordinary request field appears in full in events, the twin state, the webhook body, the export, the dashboard and the MCP event and webhook results.

### Credential tests that pass

I sent every service's live key formats to both registered twins as `Authorization: Bearer <key>`. Every request was refused with HTTP 401. The full key was not in any response body.

| Key format | Paystack twin | Flutterwave twin |
|---|---|---|
| `pk_live_...` | Refused | Refused |
| `sk_live_...` | Refused | Refused |
| `FLWPUBK-...` | Refused | Refused |
| `FLWSECK-...` | Refused | Refused |
| Stripe `pk_live_...` | Refused | Refused |
| Stripe `sk_live_...` | Refused | Refused |
| Stripe `rk_live_...` | Refused | Refused |

The twin check is at `src/twins/framework/server.ts:642-658`. Paystack recognises `pk_live_` and `sk_live_` at `src/twins/paystack/auth.ts:20-22`. Flutterwave recognises `FLWPUBK-` and `FLWSECK-` at `src/twins/flutterwave/auth.ts:20-22`. The Stripe twin does not exist in 0.1.0, so a Stripe key can only be rejected by the other twins, by the recorder, or by the example app.

The recorder refused every live format before making a request:

- Paystack `sk_live_...` and `pk_live_...`
- Flutterwave `FLWSECK-...` and `FLWPUBK-...`
- Stripe `sk_live_...`, `pk_live_...`, and `rk_live_...`

Its messages contained the length and an eight-character fingerprint, never the key. The checks are at `scripts/recorder/paystack.mjs:17-18`, `scripts/recorder/flutterwave.mjs:16-17`, `scripts/recorder/stripe.mjs:13-14`, and `scripts/recorder/shared.mjs:124-153`.

The example app refused Paystack `pk_live_` and `sk_live_` and Flutterwave `FLWPUBK-` and `FLWSECK-` before listening. It did not print the key. The checks are at `examples/school-fees-app/providers.js:113-123` and `:189-201`. A Stripe `rk_live_` supplied as a Paystack secret was refused as "must be Ibeji test keys", not as a live key, but it was still refused.

### The failure

I authorised a Paystack transaction with the correct fake Ibeji test secret key and put a fake `sk_live_...` value in the customer `email` field. The twin accepted the request, because the live key was ordinary data, and wrote this event summary:

```text
Your app started a Paystack payment of NGN 100 for [FULL LIVE KEY]
```

The same happened with a Flutterwave `FLWSECK-...` value in `customer.email`, and with a Stripe `rk_live_...` value in the Paystack email field. The full values appeared in all of these surfaces:

- `GET /_ibeji/api/v1/events`
- `GET /_ibeji/api/v1/export`
- the file written by `ibeji export`
- `ibeji events --json`
- the dashboard's Live activity page
- the MCP `ibeji_list_events` tool result

A second focused run created a Paystack transaction with a live key as the customer email and then completed checkout. The full key also appeared in:

- `GET /_ibeji/api/v1/twins/paystack/state`, because the state route returns raw records at `src/control/app.ts:471-478`. The Data page renders that raw state at `ui/src/components/DataPage.tsx:69-109`.
- `GET /_ibeji/api/v1/webhooks`, because the webhook route returns `raw.body` and response bodies at `src/control/app.ts:632-645`
- the MCP `ibeji_list_webhooks` result at `src/mcp/tools.ts:312-337`

The focused run printed `state status 200 contains live true`, `webhooks status 200 contains live true`, and `export status 200 contains live true`. The transaction email in the state was exactly the live key, and a webhook raw body contained it.

The cause is:

- The Paystack event summary includes the email address at `src/twins/paystack/transactions.ts:545-560`.
- The Flutterwave event summary includes the email address at `src/twins/flutterwave/payments.ts:366-381`.
- The framework publishes that summary as an event at `src/twins/framework/server.ts:421-437`.
- The runtime redactor replaces a live key only when the whole string is a live key. It does not scan for a live key inside a longer string. See `src/control/redact.ts:84-103`.
- The events and export routes expose the stored summary at `src/control/app.ts:660-717`.
- The state and webhook routes return raw records and raw webhook bodies without a redactor at `src/control/app.ts:471-478` and `:632-645`.
- The dashboard renders the summary and raw state at `ui/src/components/LivePage.tsx:111`, `ui/src/components/HomePage.tsx:223` and `ui/src/components/DataPage.tsx:69-109`.
- The MCP list-events and list-webhooks tools return the full event and delivery objects at `src/mcp/tools.ts:281-337`.
- The CLI prints the summary at `src/cli/commands.ts:888-890` and `:774-775`.

`docs/safety.md:77` says: "A live key never appears in an event, a log, an error, an export or the dashboard." That statement is false for a live key placed in a request field.

This does not move money and does not mean the twin accepted the live key as authentication. It is still a live secret in a local log, a local export file, the dashboard and an MCP result. The export file and MCP result are the most likely places for the value to be copied somewhere else.

## Check 5: can any code path contact the internet during normal use?

Verdict: **Risk**. The twins, control server, CLI and MCP server are loopback only. The full suite passed under the T7 network block. `ibeji doctor` makes an extra outbound GET to the configured webhook URL.

The full `pnpm test` suite ran twice with `test/setup/t7-network.ts` loaded. That setup throws on any `net.Socket.prototype.connect` to a host outside `127.0.0.1`, `::1` and `localhost`. The T7 test `T7 blocks a connection to an outside address` passed. All 750 tests passed in both runs.

The normal runtime paths are:

- `ControlClient` and the SSE client: 127.0.0.1 only, at `src/control/client.ts:100` and `:105`.
- The health check: 127.0.0.1 only, at `src/control/session-file.ts:67`.
- The webhook dispatcher: a resolved and checked address, with redirects disabled, at `src/core/webhooks/dispatcher.ts:472-488` and `:654-700`.
- The UI: local CSS, JavaScript and fonts only. There are no remote font or image URLs in `ui/src`.
- The example app: its base URL must be `127.0.0.1` or `localhost` at `examples/school-fees-app/providers.js:16-31`.

The exception is `ibeji doctor`. `src/cli/doctor.ts:246-257` calls `fetch(url, { method: "GET", redirect: "manual" })` for every configured webhook URL after `resolveAllowedWebhookUrl` at `:287`. A local receiver received `GET /hook` when I ran `ibeji doctor` with that webhook URL. With `--allow-public-webhooks`, the same code can send a GET to a public URL. This is not a webhook delivery, and it does not connect to the address that was checked: it calls `fetch` with the host name again, so DNS can change between the check and the request. Redirects are disabled, which limits the impact.

`doctor` also builds the address policy from the current config file, not from the running session. `src/cli/doctor.ts:344-362` passes `config.allowPrivateWebhooks` and `config.allowPublicWebhooks` to `webhookCheck`, even when a live session is present. The session file does not store the policy, and `/status` does not return it. A session started with one policy and a config file with another can make `doctor` check an address with the wrong policy. In the permissive direction this could allow a GET that the session would refuse. I did not find a path to put a public URL into a default session, but the mismatch is real and should be fixed with the pinned-address check.

The recorder is a deliberate exception: it is the only code that talks to real services, it refuses live keys, and it is not in the published package. `scripts/smoke.mjs` and `scripts/check-package.mjs` use npm and pnpm as development tools; they are not part of the installed runtime.

## Check 6: webhook addresses

Verdict: **Risk, low**. The tested C13 cases pass, but a directed broadcast in a private range is allowed with `--allow-private-webhooks`, and NAT64/6to4 metadata translation is not covered.

I tested a real session and a second session started with both `--allow-private-webhooks` and `--allow-public-webhooks`:

| Address | Default | Both flags |
|---|---|---|
| `http://10.0.0.1:1234/webhook` | Refused, HTTP 400 | Accepted |
| `http://192.0.2.1/webhook` | Refused, HTTP 400 | Accepted |
| `http://169.254.169.254/latest/meta-data` | Refused, HTTP 400 | Refused, HTTP 400 |
| `http://[fe80::1]:1234/webhook` | Refused | Refused, HTTP 400 |
| `http://[::]:1234/webhook` | Refused | Refused, HTTP 400 |
| `http://0.0.0.0:1234/webhook` | Refused | Refused |
| `http://224.0.0.1:1234/webhook` | Refused | Refused, HTTP 400 |
| `http://255.255.255.255:1234/webhook` | Refused | Refused, HTTP 400 |
| `http://metadata.google.internal/latest/meta-data` | Refused | Refused, HTTP 400 |

The tricky loopback names that were accepted without a flag were `http://2130706433:<port>/`, `http://0x7f000001:<port>/`, `http://127.1:<port>/`, `http://127.0.0.1.:<port>/`, `http://localhost:<port>/`, `http://127.0.0.1@127.0.0.1:<port>/` and `http://evil.example@127.0.0.1:<port>/`. Each of these is parsed as a loopback address, so accepting it is correct. `http://127.0.0.1%00.evil.example:<port>/`, `http://127.0.0.1.evil.example:<port>/` and `http://[::ffff:169.254.169.254]:<port>/` were refused.

`test/unit/webhooks-address.test.ts` passed all 13 tests, including:

- A name that resolves to both `127.0.0.1` and `10.0.0.1` is refused.
- A name that resolves to both `127.0.0.1` and `8.8.8.8` is refused.
- `host.docker.internal` needs the private flag.
- An empty DNS answer and a DNS failure are refused.
- IPv4-mapped IPv6 link-local addresses are refused.

A real Paystack webhook was sent to a receiver that answered HTTP 302 with a `Location` header. The delivery recorded `responseStatus: 302`, was not marked delivered, and the redirect target received zero requests. A real Flutterwave webhook used the Flutterwave `verif-hash` and no Paystack signature.

Residual risk: the address policy does not list the NAT64 prefix `64:ff9b::/96` or the 6to4 prefix `2002::/16` as link-local mappings. With `--allow-public-webhooks`, those prefixes are treated as public. On a network with NAT64 or 6to4, they could translate to an IPv4 link-local address. I did not have such a network to test, so this is a residual risk, not a demonstrated bypass.

A directed broadcast is not always refused. `src/core/webhooks/address.ts:38-46` lists only `255.255.255.255/32`. A private-range directed broadcast such as `192.168.1.255` is treated as private and is allowed with `--allow-private-webhooks`. C13 says broadcast is always refused. This is a concrete gap in the rule, although it requires the private flag and a network that forwards directed broadcasts.

## Check 7: the recorder and the published package

Verdict: **Risk, low**. The recorder refuses live keys and is not published, but it accepts a test key from Paystack under the Stripe service name, and the reverse, because both use the `sk_test_` prefix.

The recorder refused every live key I tried, including Stripe restricted keys, and printed only a fingerprint. It is excluded from the package by `package.json:36-43`; the packed file list contains no `scripts/` or `fixtures/`, and `pnpm check:package` passed.

The cross-service test key issue is at `scripts/recorder/paystack.mjs:17` and `scripts/recorder/stripe.mjs:13`. A direct call to `validateKey` showed:

- Paystack metadata accepts a Stripe-looking `sk_test_...` key.
- Stripe metadata accepts a Paystack-looking `sk_test_...` key.

The recorder then sends that test key to the wrong service's preflight endpoint. The service answers HTTP 401 and the recorder stops before saving a fixture. No live key is accepted and no money can move, but a test credential is sent to the wrong service. This is a low-priority isolation defect, not a release blocker.

## Check 8: fixtures, scenarios, docs and the published package

Verdict: **Safe**. No real personal data or real keys were found.

`test/unit/fixture-privacy.test.ts` passed all three tests. It scans every fixture service directory and rejects real-looking keys, emails, phone numbers, account numbers and names. The fixtures use `customer.one@example.com` through `customer.ten@example.com`, `+15550000001`, `Test Name N`, `0000000001` and redacted authorization codes. The bank list is public bank data.

The scenarios use fictional names and businesses. The docs use placeholders such as `sk_test_ibeji_...` and `FLWSECK_TEST-ibeji-...`. A scan of the repository outside `node_modules`, `.git` and `dist` found only fake review strings and the fixtures' fixed fake values.

The documentation screenshots contain full ephemeral Ibeji test keys from the temporary session used to take them: `pk_test_ibeji_...`, `sk_test_ibeji_...`, `FLWPUBK_TEST-ibeji-...` and `FLWSECK_TEST-ibeji-...`. These are not real service keys and stop working when that session ends. They are still visible test credentials in documentation, so the screenshots should be regenerated with masked keys if the project wants to avoid publishing even fake credentials.

The packed file list from `pnpm check:package` contains only `dist/`, `scenarios/`, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES` and `CHANGELOG.md`. It contains no fixtures, recorder, example app or docs folder.

## Check 9: tokens, launch codes and the UI cookie

Verdict: **Risk**. The token and launch-code handling is correct, but the UI cookie is host-scoped, not port-scoped, so another HTTP service on `127.0.0.1` can receive it.

What passed:

- After sign-in, the address bar had no `launch` parameter.
- `localStorage`, `sessionStorage` and IndexedDB were empty.
- `document.cookie` was empty because the cookie is `HttpOnly`.
- The cookie was `HttpOnly`, `SameSite=Strict`, `Path=/`, and not `Secure` on HTTP loopback.
- The session token, UI token and launch code did not appear in events, the export, the export file, the MCP output or the server output.
- The launch code did not appear in the dashboard DOM.
- The session output from `ibeji start` does contain the launch link and the fake test keys, which is the documented C8 behaviour. The session token itself is not printed.

The cookie is set at `src/control/app.ts:413-423` with no `Domain` and `Path=/`. Browser cookies are not scoped by port. I opened a listener on another `127.0.0.1` port, navigated to it from the dashboard, and it received `Cookie: ibeji_ui=...`. I then replayed that cookie to `POST /_ibeji/api/v1/scenarios/stop` with the matching `Origin` and `X-Ibeji-Request: 1` headers, and the control API answered HTTP 200. A local service can therefore use a captured UI cookie to change Ibeji state. The cookie acceptance and change checks are at `src/control/app.ts:384-401`.

This is a local threat, not a website-only attack. A cross-site navigation does not send the cookie, as the browser test confirmed. A same-site navigation from the dashboard to another loopback port does send it. The user's own app on `127.0.0.1:3000` receives the cookie when the checkout redirects back to it. A malicious local process or another local user who can get the browser to visit its port can also receive it.

## Check 10: dependency advisories

Verdict: **Risk, low and development-only**.

`pnpm audit` found seven advisories: two high, three moderate and two low. All are in the development dependency tree:

- `joi` 17.8.3 through `flutterwave-node-v3` 1.4.1: two high, three moderate and two low advisories, including regular-expression denial of service and prototype pollution.
- `minimatch` 10.2.6 through `eslint-config-prettier` and `eslint`: one moderate denial-of-service advisory.

`pnpm audit --prod` found zero advisories in 18 production packages. `flutterwave-node-v3` is a devDependency for compatibility tests and is not packed. The runtime dependencies are `@hono/node-server`, `@modelcontextprotocol/server`, `hono`, `open` and `zod`.

## Check 11: webhook signatures across twins

Verdict: **Safe**.

A real Paystack webhook's `x-paystack-signature` matched HMAC-SHA512 with the Paystack secret key and did not match HMAC-SHA512 with the Flutterwave webhook secret. A real Flutterwave webhook carried a `verif-hash` equal to the Flutterwave webhook secret and no `x-paystack-signature`.

`test/unit/paystack-webhooks.test.ts` and `test/unit/flutterwave-webhooks.test.ts` passed. They cover the documented signing method, wrong secrets, corrupted signatures, missing signatures, tampered bodies and the retry schedules.

I also started the example app for each provider and sent it the other twin's signature:

- Paystack mode, HMAC made with the Flutterwave webhook secret: HTTP 401.
- Paystack mode, HMAC made with the Paystack secret: HTTP 200, ignored as an unknown payment.
- Flutterwave mode, `verif-hash` set to the Paystack secret: HTTP 401.
- Flutterwave mode, `verif-hash` set to the Flutterwave webhook secret: HTTP 200, ignored as an unknown payment.

No signer or verifier accepted the other twin's secret.

## Check 12: official payment libraries

Verdict: **Safe**.

`package.json` has five runtime dependencies, none of which is a payment library: `@hono/node-server`, `@modelcontextprotocol/server`, `hono`, `open` and `zod`. `flutterwave-node-v3` 1.4.1 is a devDependency for compatibility tests at `package.json:83`, which SPEC.md T15 allows. There is no Paystack library and no Stripe library.

`pnpm list --prod --depth 0` shows the five runtime dependencies. The packed file list contains no `node_modules`, no `flutterwave-node-v3`, and no other payment library. `pnpm check:package` passed with the C16 file list.

## Priority-ordered problems

1. **P1, broken: live keys in request fields leak in full.** A fake `sk_live_`, `FLWSECK-` or `rk_live_` value in a customer email is copied into the event summary, the state record and the webhook body. It then appears in events, `/twins/:twin/state`, `/webhooks`, the export, the CLI export, the dashboard's Live activity and Data pages, the MCP event and webhook results, and `ibeji events`. The claim at `docs/safety.md:77` is false. Fix by applying a live-key regex to every event summary, event detail, state record, webhook body, export string and error message before storage or return, and add tests for all three services across every surface. Relevant code: `src/twins/paystack/transactions.ts:545-560`, `src/twins/flutterwave/payments.ts:366-381`, `src/twins/framework/server.ts:421-437`, `src/control/redact.ts:84-103`, `src/control/app.ts:471-478`, `:632-645`, `:660-717`, `ui/src/components/DataPage.tsx:69-109`, `src/mcp/tools.ts:281-337`.

2. **P2, risk: the UI cookie is not port-scoped.** A service on another `127.0.0.1` port can receive `ibeji_ui` and replay it to change Ibeji state. The cookie is `HttpOnly` and `SameSite=Strict`, but those flags do not restrict it by port. Fix by moving the dashboard to a unique host name per session, or by requiring a separate per-session header that another local service cannot read, and document the local threat model. Relevant code: `src/control/app.ts:413-423` and `src/control/app.ts:384-401`.

3. **P2, risk: `ibeji doctor` makes an unpinned webhook GET.** It sends a GET to the configured webhook URL after checking a resolved address, but it resolves the host name again for the request. With `--allow-public-webhooks` it can contact a public address. It also uses the current config policy instead of the running session's policy. This is outside the C13 statement that the only outbound connections are webhook deliveries. Fix by removing the network check from `doctor` or by using the dispatcher's checked-address sender and the session policy. Relevant code: `src/cli/doctor.ts:246-292` and `:344-362`.

4. **P3, risk: a pre-existing permissive session file is used without a mode check.** Fresh files are mode `600`, but `readSessionFile` does not check or repair the mode, and `doctor` checks only the credentials file. A mode `644` session file exposes the bearer token to other local users. Fix by calling the private-file check on every session read and by adding a `doctor` check for `session.json`. Relevant code: `src/control/session-file.ts:28-39`, `src/control/paths.ts:99-103`, `src/cli/doctor.ts:186-226`.

5. **P3, risk: directed broadcast addresses are not always refused.** `192.168.1.255` is treated as private and allowed with `--allow-private-webhooks`, while C13 says broadcast is always refused. Fix by rejecting the broadcast address of every allowed subnet, not only `255.255.255.255`. Relevant code: `src/core/webhooks/address.ts:38-46` and `:88-91`.

6. **P3, risk: the recorder accepts a Paystack test key under the Stripe service name, and the reverse.** Both formats use `sk_test_`. The wrong service rejects the key at preflight, so no fixture is saved and no live key is accepted, but a test credential is sent to the wrong service. Fix by adding a service-specific marker or by checking a key fingerprint against the service that issued it. Relevant code: `scripts/recorder/paystack.mjs:17`, `scripts/recorder/stripe.mjs:13`, `scripts/recorder/shared.mjs:124-153`.

7. **P3, risk: development dependency advisories.** Seven advisories, including two high `joi` advisories, are present through `flutterwave-node-v3` and its lint dependency. The published package is not affected and `pnpm audit --prod` is clean. Fix by updating or replacing the compatibility dependency, or record an explicit CI-only acceptance.

8. **P4, residual: NAT64 and 6to4 are not covered by the webhook address policy.** `64:ff9b::/96` and `2002::/16` are treated as public and allowed with `--allow-public-webhooks`. On a NAT64 or 6to4 network they could translate to IPv4 link-local addresses. No such network was available for a test.

9. **P4, note: the documentation screenshots contain ephemeral fake Ibeji test keys.** They are not real service keys and stopped working when the screenshot session ended, but the screenshots should use masked or placeholder values if even fake credentials should not be published.

## Gates run

- `pnpm typecheck`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm build`: passed.
- `pnpm test`: 750 tests in 76 files passed twice. Coverage was 96.41% statements, 90.17% branches, 98.10% functions and 96.47% lines.
- `pnpm test:ui`: 93 tests passed twice.
- `pnpm check:package`: passed and matched SPEC.md C16.
- `pnpm test:smoke`: passed twice.
- `pnpm audit`: seven development advisories, zero production advisories.
- `pnpm audit --prod`: zero advisories.
- Focused security tests: `test/unit/webhooks-address.test.ts`, `test/unit/paystack-webhooks.test.ts`, `test/unit/flutterwave-webhooks.test.ts`, `test/unit/fixture-privacy.test.ts` and `test/integration/control-security.test.ts`: 45 tests passed.

No test was skipped, weakened or deleted. No product code was changed. This review is the only committed file.
