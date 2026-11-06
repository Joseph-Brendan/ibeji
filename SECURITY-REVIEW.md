# Ibeji security review

Date: 6 November 2026
Version reviewed: 0.1.0
Commit reviewed: `3139b33`
Spec reviewed: the working tree's `SPEC.md` v1.5, including the uncommitted D43 to D51 entries
Reviewer: independent review. No product code was changed.

## Release recommendation

I would block the release. The working SPEC now records the agreed fixes as C21 D43 to D51, but the code at `3139b33` does not implement them. A live key placed in an ordinary request field is still copied in full into the event log, twin state, webhook body, export, dashboard and MCP results. The dashboard is still mounted at `/`, so its cookie still has `Path=/` and is sent to other apps on `127.0.0.1`. A permissive session file is still used without repair.

The remote website attacks failed. A website cannot read Ibeji data or change Ibeji state. The remaining failures are implementation gaps against the new SPEC and local defense-in-depth issues.

## Scope and method

I read `AGENTS.md`, `BUILD-LOG.md`, `research/paystack.md`, `research/flutterwave.md`, and SPEC.md C3, C4, C8, C11, C12, C13 and C15. I reviewed every file under `src/` and `scripts/`, then ran a temporary attack script against a real session. The script was deleted before this commit.

The checks used:

- A real `ibeji start` session with the Paystack and Flutterwave twins on random ports.
- Raw HTTP requests for Host, Origin, cookie and form attacks.
- Playwright with Chromium for the browser attacks on `http://evil.test`.
- `ibeji export`, `ibeji events`, `ibeji doctor`, and a loopback webhook receiver.
- The project test suite, including the T7 network block in `test/setup/t7-network.ts`.
- A temporary D47 unit test, deleted after it ran.
- `pnpm audit` and `pnpm audit --prod`.

Current attack script result: 27 of 39 checks passed. The 12 failures are D43 live-key leaks, D44 dashboard/cookie paths, and D46 session-file repair. The browser cross-site checks passed. The D47 temporary test failed all three cases.

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
| Host `evil.example:<control port>` on the control server | HTTP 403 `FORBIDDEN_HOST` |
| Host `127.0.0.1:<wrong port>` on the control server | HTTP 403 `FORBIDDEN_HOST` |
| Host `localhost:<control port>` on the control server | HTTP 200 |
| Host `evil.example:<twin port>` on the Paystack twin | HTTP 403 |
| Host `evil.example:<twin port>` on the Flutterwave twin | HTTP 403 |
| Cross-site form POST to a Paystack checkout page | HTTP 403 `FORBIDDEN_ORIGIN` |
| Checkout POST with no Origin header | HTTP 403 |
| Checkout POST from the checkout page's own origin | HTTP 200 |
| Control page framing | `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'` |
| Checkout page framing | The same `frame-ancestors 'none'` policy |
| Browser `fetch` from `http://evil.test` to the control API | Blocked by CORS |
| Browser attempt to read the opened dashboard DOM | `SecurityError` from cross-origin DOM access |

The code evidence is in `src/control/app.ts` lines 356 to 401 for the Host check and sign-in middleware, lines 413 to 425 for the launch-code exchange and cookie, and `src/twins/framework/server.ts` lines 464 to 476 for the twin Host check and lines 593 to 599 for the checkout Origin check.

The existing `test/integration/control-security.test.ts` suite passed all 45 tests, including the Host, token, cookie, CORS, body-limit, launch-link and stale-cookie tests. The browser checks from the attack script also passed: the cross-site API read was blocked, the cross-site DOM read raised `SecurityError`, the cross-site checkout form received `FORBIDDEN_ORIGIN`, and the cross-site control form received `UNAUTHORIZED`.

The D44 dashboard path and cookie failures are in check 9, not in this remote-website check.

## Check 2: do the servers listen on 127.0.0.1 only?

Verdict: **Safe** for the two registered twins. The Stripe twin is not part of version 0.1.0, so there is no Stripe server to test.

The control server calls `serve` with `hostname: "127.0.0.1"` at `src/control/server.ts:31`. Each twin does the same at `src/twins/framework/server.ts:771`. The session address builder uses `hostname: "127.0.0.1"` at `src/control/session.ts:182`.

`test/integration/control-security.test.ts` has the test `T6 binds the control server and every twin to 127.0.0.1`. It asserts the bound address of the control server and every running twin. It passed.

`src/twins/registry.ts:48-51` registers only Paystack and Flutterwave. A real `ibeji start --twins stripe` fails with `CONFIG_INVALID` and `These twin ids are unknown: stripe. Registered twins: paystack, flutterwave.` No Stripe listener exists.

## Check 3: session file permissions and edited session files

Verdict: **Risk, low**. Remote redirection is safe. A local process that can write the file can change the port, but the token still goes only to 127.0.0.1. A pre-existing session file with a permissive mode is used without a check or repair.

Measured on macOS from a real session:

- `~/.ibeji/session.json`: mode `600`
- `~/.ibeji`: mode `700`
- `~/.ibeji/credentials.json`: mode `600`

The code sets the folder mode at `src/control/paths.ts:43`, the temporary file mode at `src/control/paths.ts:58` and `:60`, and the existing file mode at `src/control/paths.ts:101`. The same POSIX branches are exercised by `test/integration/control-session.test.ts` and `test/unit/control-session-file.test.ts`, which run on Ubuntu in CI.

The D46 repair is not implemented. I changed a live session file to mode `644` and ran `ibeji status`. The file stayed at mode `644`, and the command exited 0. `readSessionFile` at `src/control/session-file.ts:28-39` does not check the mode or the owner. `doctor` checks only the credentials file at `src/cli/doctor.ts:186-226`. A pre-existing mode `644` file exposes the bearer token to other local users. The approved D46 behaviour is a warning and a repair to `600` on macOS and Linux, and `SESSION_STALE` for a file owned by another user.

The session file schema is a strict object with `instanceId`, `processId`, `ports`, `token`, `startTime` and `version` at `src/control/session-file.ts:6-15`. It has no host or URL field. `ControlClient` builds every request as `http://127.0.0.1:<port>` at `src/control/client.ts:100`, and the health check is hard-coded to 127.0.0.1 at `src/control/session-file.ts:67`. An edited file can change the loopback port but cannot send the token to another host. Adding a host field makes the strict schema fail, and the CLI removes the file.

The MCP server uses the same `requireSession` and `ControlClient` path at `src/mcp/session.ts:13-18`, so it has the same loopback-only behaviour.

## Check 4: live keys

Verdict: **Broken**. No Paystack or Flutterwave live key was accepted as a credential, but a live key placed in an ordinary request field appears in full in events, state, webhooks, the export and the dashboard.

### Credential tests that pass

I sent the Paystack and Flutterwave live formats to both registered twins as `Authorization: Bearer <key>`. Every request was refused with HTTP 401. The full key was not in any response body.

| Key format | Paystack twin | Flutterwave twin |
|---|---|---|
| `pk_live_...` | Refused | Refused |
| `sk_live_...` | Refused | Refused |
| `FLWPUBK-...` | Refused | Refused |
| `FLWSECK-...` | Refused | Refused |

The twin check is at `src/twins/framework/server.ts:642-658`. Paystack recognises `pk_live_` and `sk_live_` at `src/twins/paystack/auth.ts:20-22`. Flutterwave recognises `FLWPUBK-` and `FLWSECK-` at `src/twins/flutterwave/auth.ts:20-22`.

The recorder refused Paystack `sk_live_` and `pk_live_` and Flutterwave `FLWSECK-` and `FLWPUBK-` before making a request. Its messages contained the length and an eight-character fingerprint, never the key. The checks are at `scripts/recorder/paystack.mjs:17-18`, `scripts/recorder/flutterwave.mjs:16-17`, and `scripts/recorder/shared.mjs:124-153`.

The example app refused Paystack `pk_live_` and `sk_live_` and Flutterwave `FLWPUBK-` and `FLWSECK-` before listening. It did not print the key. The checks are at `examples/school-fees-app/providers.js:113-123` and `:189-201`.

The working SPEC D43 also requires Stripe patterns from an unreleased service folder. There is no `src/twins/stripe/live-keys.ts`; `src/twins/stripe/` contains only `.gitkeep`. The registry has no pattern export. This part of D43 is also missing, although the Stripe twin is correctly not registered.

### The failure

I authorised a Paystack transaction with the correct fake Ibeji test secret key and put a fake `sk_live_...` value in the customer `email` field. The twin accepted the request, because the live key was ordinary data, and wrote this event summary:

```text
Your app started a Paystack payment of NGN 100 for [FULL LIVE KEY]
```

The same happened with a Flutterwave `FLWSECK-...` value in `customer.email`. I also placed `pk_live_...` and `FLWPUBK-...` values in request fields. All four formats appeared in the events response, so the leak is not limited to secret-key prefixes. The full values appeared in all of these surfaces:

- `GET /_ibeji/api/v1/events`
- `GET /_ibeji/api/v1/twins/paystack/state`
- `GET /_ibeji/api/v1/webhooks`
- `GET /_ibeji/api/v1/export`
- the file written by `ibeji export`
- `ibeji events --json`
- the dashboard's Live activity and Data pages
- the MCP `ibeji_list_events` and `ibeji_list_webhooks` results

The current attack script failed these checks: events, state, webhooks, export API or file, and `ibeji events`. The focused earlier run printed `state status 200 contains live true`, `webhooks status 200 contains live true`, and `export status 200 contains live true`.

The cause is:

- The Paystack event summary includes the email address at `src/twins/paystack/transactions.ts:545-560`.
- The Flutterwave event summary includes the email address at `src/twins/flutterwave/payments.ts:366-381`.
- The framework publishes that summary as an event at `src/twins/framework/server.ts:421-437`.
- The runtime redactor replaces a live key only when the whole string is a live key. It does not scan for a live key inside a longer string. See `src/control/redact.ts:84-103`.
- The state and webhook routes return raw records and raw webhook bodies without a redactor at `src/control/app.ts:471-478` and `:632-645`.
- The dashboard renders the summary and raw state at `ui/src/components/LivePage.tsx:111`, `ui/src/components/HomePage.tsx:223` and `ui/src/components/DataPage.tsx:69-109`.
- The MCP list-events and list-webhooks tools return the full event and delivery objects at `src/mcp/tools.ts:281-337`.

`docs/safety.md:77` still says: "A live key never appears in an event, a log, an error, an export or the dashboard." That statement is false for a live key placed in a request field. D51 is not implemented.

## Check 5: can any code path contact the internet during normal use?

Verdict: **Risk**. The twins, control server, CLI and MCP server are loopback only. The full suite passes under the T7 network block. `ibeji doctor` still makes an extra outbound GET to the configured webhook URL and has no session address policy.

The full `pnpm test` suite runs with `test/setup/t7-network.ts` loaded. That setup throws on any `net.Socket.prototype.connect` to a host outside `127.0.0.1`, `::1` and `localhost`. The T7 test `T7 blocks a connection to an outside address` passed in the prior review run and the suite still passes.

The normal runtime paths are:

- `ControlClient` and the SSE client: 127.0.0.1 only, at `src/control/client.ts:100` and `:105`.
- The health check: 127.0.0.1 only, at `src/control/session-file.ts:67`.
- The webhook dispatcher: a resolved and checked address, with redirects disabled, at `src/core/webhooks/dispatcher.ts:472-488` and `:654-700`.
- The UI: local CSS, JavaScript and fonts only.
- The example app: its base URL must be `127.0.0.1` or `localhost` at `examples/school-fees-app/providers.js:16-31`.

The D45 gap is current. `GET /status` returns `version, instance, seed, startTime, twins, rules, scenario` and no address policy. `src/control/app.ts:426-442` does not expose the policy. `ibeji doctor` calls `fetch(url, { method: "GET", redirect: "manual" })` at `src/cli/doctor.ts:246-257` after `resolveAllowedWebhookUrl` at `:287`. A loopback receiver received `GET /hook` when I ran `ibeji doctor` with that webhook URL. The request is not a `HEAD`, it is not through the dispatcher's checked-address path, and the policy comes from the current config file rather than the running session at `src/cli/doctor.ts:344-362`. D45 is not implemented.

The recorder is a deliberate exception: it is the only code that talks to real services, it refuses live keys, and it is not in the published package. `scripts/smoke.mjs` and `scripts/check-package.mjs` use npm and pnpm as development tools.

## Check 6: webhook addresses

Verdict: **Risk**. The tested C13 cases pass, but D47 is not implemented. A private-range directed broadcast is allowed, and NAT64 and 6to4 addresses are treated as public.

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

`test/unit/webhooks-address.test.ts` passed all 13 tests, including mixed DNS results, `host.docker.internal`, empty DNS and IPv4-mapped link-local addresses.

A real Paystack webhook was sent to a receiver that answered HTTP 302 with a `Location` header. The delivery recorded `responseStatus: 302`, was not marked delivered, and the redirect target received zero requests. A real Flutterwave webhook used the Flutterwave `verif-hash` and no Paystack signature.

D47 is not implemented. I ran a temporary test against `isWebhookAddressAllowed`:

```text
D47 refuses a private /24 broadcast: expected true to be false
D47 refuses NAT64 metadata: expected true to be false
D47 refuses 6to4 metadata: expected true to be false
```

The three failures mean `192.168.1.255` is allowed with the private flag, `64:ff9b::a9fe:a9fe` is allowed with the public flag, and `2002:a9fe:a9fe::` is allowed with the public flag. `src/core/webhooks/address.ts:38-46` lists only `255.255.255.255/32` and has no interface list parameter, no IPv4 extraction for mapped, NAT64 or 6to4 addresses.

## Check 7: the recorder and the published package

Verdict: **Risk, low**. The recorder refuses live keys and is not published, but D48 is not implemented. It still accepts a Paystack test key under the Stripe service name, and the reverse, because both use the `sk_test_` prefix.

The recorder refused every live key I tried and printed only a fingerprint. It is excluded from the package by `package.json:36-43`; the packed file list contains no `scripts/` or `fixtures/`, and `pnpm check:package` passed.

A direct call to `validateKey` still shows:

```text
paystack key under stripe: ok=true code=valid
stripe key under paystack: ok=true code=valid
flutterwave key under stripe: ok=false code=wrong-format
stripe key under flutterwave: ok=false code=wrong-format
```

The checks are at `scripts/recorder/paystack.mjs:17` and `scripts/recorder/stripe.mjs:13`. D48 requires each module to check the full service test-key format from its research file, including length and allowed characters after the prefix, before any request.

## Check 8: fixtures, scenarios, docs and the published package

Verdict: **Risk, low**. No real personal data or real keys were found, but D50 is not implemented and the screenshots still show full fake Ibeji test keys.

`test/unit/fixture-privacy.test.ts` passed all three tests. It scans every fixture service directory and rejects real-looking keys, emails, phone numbers, account numbers and names. The fixtures use `customer.one@example.com` through `customer.ten@example.com`, `+15550000001`, `Test Name N`, `0000000001` and redacted authorization codes. The bank list is public bank data.

The scenarios use fictional names and businesses. The docs use placeholders such as `sk_test_ibeji_...` and `FLWSECK_TEST-ibeji-...`. A scan of the repository outside `node_modules`, `.git` and `dist` found only fixed fake values.

The current screenshot OCR still finds full ephemeral Ibeji test keys in `docs/images/home.png`:

```text
pk_test_ibeji_a4f4a49900dc27d2ba53b87d
sk_test_ibeji_1d62cb1a85405ae970c2a776
FLWPUBK_TEST-ibeji-9be7c792df2afeb4adbca6ac
FLWSECK_TEST-ibeji-a914da7d9db679cd2e143d6f
ibeji_194494283d9b40c508594aa8
```

These are not real service keys and stop working when that session ends, but D50 requires every credential to be masked before capture. `scripts/screenshots.mjs` has no masking step; its only screenshot calls are at lines 147 and 157.

The packed file list from `pnpm check:package` contains only `dist/`, `scenarios/`, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES` and `CHANGELOG.md`. It contains no fixtures, recorder, example app or docs folder.

## Check 9: tokens, launch codes and the UI cookie

Verdict: **Risk**. Token and launch-code handling is correct, but D44 is not implemented. The dashboard is still at `/`, the launch link is still `/?launch=<code>`, and the UI cookie still has `Path=/`. A loopback service on another port receives the cookie, and the captured cookie can change state.

What passed:

- After sign-in, the address bar had no `launch` parameter.
- `localStorage`, `sessionStorage` and IndexedDB were empty.
- `document.cookie` was empty because the cookie is `HttpOnly`.
- The cookie was `HttpOnly` and `SameSite=Strict`.
- The session token, UI token and launch code did not appear in events, the export, the export file, the MCP output or the server output.
- The launch code did not appear in the dashboard DOM.
- The session output from `ibeji start` does contain the launch link and the fake test keys, which is the documented C8 behaviour. The session token itself is not printed.

D44 failures from the current attack:

```text
D44 root redirects to /_ibeji/: HTTP 200 location=null
D44 launch link uses /_ibeji/: /
D44 UI cookie path is /_ibeji: ibeji_ui=<redacted>; HttpOnly; SameSite=Strict; Path=/
D44 UI cookie path is /_ibeji in the browser: path=/
D44 another loopback port receives no ibeji_ui cookie: Cookie header received
captured UI cookie can change state: HTTP 200
```

The cookie is set at `src/control/app.ts:413-423`. Browser cookies are not scoped by port. I opened a listener on another `127.0.0.1` port, navigated to it from the dashboard, and it received `Cookie: ibeji_ui=...`. I replayed that cookie to `POST /_ibeji/api/v1/scenarios/stop` with the matching `Origin` and `X-Ibeji-Request: 1`, and the control API answered HTTP 200. D44 is meant to put the dashboard under `/_ibeji/` and set `Path=/_ibeji` so other apps never receive the cookie. That is not in the code.

## Check 10: dependency advisories

Verdict: **Risk, low and development-only**. D49 is not implemented in `check:package`.

`pnpm audit` found seven advisories: two high, three moderate and two low. All are in the development dependency tree:

- `joi` 17.8.3 through `flutterwave-node-v3` 1.4.1: two high, three moderate and two low advisories.
- `minimatch` 10.2.6 through `eslint-config-prettier` and `eslint`: one moderate advisory.

`pnpm audit --prod` found zero advisories in 18 production packages. `flutterwave-node-v3` is a devDependency for compatibility tests and is not packed. The runtime dependencies are `@hono/node-server`, `@modelcontextprotocol/server`, `hono`, `open` and `zod`.

D49 says `pnpm check:package` must fail on any production advisory. `scripts/check-package.mjs` still runs only the package fields, publint and the packed file list. It does not run `pnpm audit --prod`. The current `check:package` passed without an audit.

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

1. **P1, broken: D43 is not implemented. Live keys in request fields leak in full.** A fake `sk_live_` or `FLWSECK-` value in a customer email is copied into the event summary, the state record and the webhook body. It then appears in events, `/twins/:twin/state`, `/webhooks`, the export, the CLI export, the dashboard, and the MCP results. The claim at `docs/safety.md:77` is false, and there is no `src/twins/stripe/live-keys.ts` or registry pattern export. Relevant code: `src/twins/paystack/transactions.ts:545-560`, `src/twins/flutterwave/payments.ts:366-381`, `src/twins/framework/server.ts:421-437`, `src/control/redact.ts:84-103`, `src/control/app.ts:471-478`, `:632-645`, `:660-717`, `ui/src/components/DataPage.tsx:69-109`, `src/mcp/tools.ts:281-337`.

2. **P2, broken: D44 is not implemented. The dashboard and cookie are not under `/_ibeji/`.** `/` returns the UI with HTTP 200 instead of redirecting, the launch link is `/?launch=...`, and the cookie is `Path=/`. Another loopback port receives the cookie, and the captured cookie can change state. Relevant code: `src/control/app.ts:413-423`, `src/control/app.ts:384-401`, `src/control/session.ts:442`, `src/cli/commands.ts:192-195`.

3. **P2, broken: D45 is not implemented. `doctor` still makes an unpinned GET.** `GET /status` has no address policy. Doctor sends a GET to the configured webhook URL, not a HEAD through the dispatcher's checked-address path, and uses the config policy rather than the running session's policy. Relevant code: `src/cli/doctor.ts:246-292`, `:344-362`, `src/control/app.ts:426-442`.

4. **P3, broken: D46 is not implemented. Session file permissions are not checked or repaired.** A live session file at mode `644` stayed at `644` after `ibeji status`, and the command exited 0. Relevant code: `src/control/session-file.ts:28-39`, `src/control/paths.ts:99-103`, `src/cli/doctor.ts:186-226`.

5. **P3, broken: D47 is not implemented. Broadcast, NAT64 and 6to4 addresses are allowed.** The temporary test showed `192.168.1.255`, `64:ff9b::a9fe:a9fe` and `2002:a9fe:a9fe::` all returned true. Relevant code: `src/core/webhooks/address.ts:38-46` and `:88-91`.

6. **P3, risk: D48 is not implemented. The recorder accepts a Paystack test key under the Stripe service name, and the reverse.** Both formats use `sk_test_`; the wrong service rejects the key at preflight, so no fixture is saved, but a test credential is sent to the wrong service. Relevant code: `scripts/recorder/paystack.mjs:17`, `scripts/recorder/stripe.mjs:13`, `scripts/recorder/shared.mjs:124-153`.

7. **P3, risk: D49 is not implemented. `check:package` does not run `pnpm audit --prod`.** Seven development advisories remain, including two high `joi` advisories; production is clean. Relevant code: `scripts/check-package.mjs:116-240`.

8. **P3, broken: D50 is not implemented. Screenshots still show full fake credentials.** The OCR of `docs/images/home.png` found `pk_test_ibeji_...`, `sk_test_ibeji_...`, `FLWPUBK_TEST-ibeji-...`, `FLWSECK_TEST-ibeji-...` and a webhook hash. `scripts/screenshots.mjs` has no masking step.

9. **P3, broken: D51 is not implemented. `docs/safety.md:77` still makes a promise the code does not keep.** There is no test that searches every output surface for a planted live key and holds the safety page to it.

## Gates run

- `pnpm typecheck`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm build`: passed.
- `pnpm test`: 750 tests in 76 files passed twice. Coverage was 96.41% statements, 90.17% branches, 98.10% functions and 96.47% lines.
- `pnpm test:ui`: 93 tests passed twice.
- `pnpm check:package`: passed and matched SPEC.md C16; it did not run an audit.
- `pnpm test:smoke`: passed twice.
- `pnpm audit`: seven development advisories, zero production advisories.
- `pnpm audit --prod`: zero advisories.
- Focused security tests: `test/unit/webhooks-address.test.ts`, `test/unit/paystack-webhooks.test.ts`, `test/unit/flutterwave-webhooks.test.ts`, `test/unit/fixture-privacy.test.ts` and `test/integration/control-security.test.ts`: 45 tests passed.

No test was skipped, weakened or deleted. No product code was changed. This review is the only file committed by this task. The working tree's `SPEC.md` v1.5 changes were present before this review and were not committed.
