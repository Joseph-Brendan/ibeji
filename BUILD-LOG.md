# Phase 1, Step 1.1: Kickoff review

Date: 27 October 2026. Review only: no project code, `package.json`, lockfile, or commit was created. The only file added is this one. Dependency checks ran in `/tmp/ibeji-check`, which was removed afterwards.

## Sources read

- `AGENTS.md`, in full.
- `SPEC.md`, in full: Parts A, B1-B5, C1-C21, E, F.
- npm README and type definitions for `hono` 4.13.14, `@hono/node-server` 2.1.5, and `@modelcontextprotocol/server` 2.4.0.
- npm registry metadata, versions, engines, dependencies, optional dependencies, and install scripts on 27 October 2026.

`research/` and `fixtures/` do not exist yet. No Paystack, Flutterwave, or Stripe behaviour can be confirmed at kickoff. Any service fact below is marked "needs research", not "confirmed".

## Blocking findings

1. **C1's "no native add-ons" rule does not match the stack C1 chooses.** The published runtime can probably be pure JavaScript, but the development/build toolchain for the chosen latest versions installs prebuilt native `.node` addons and native executables. See the native check below. The rule must be split into a runtime rule and a development-tool rule, or the tools must be changed.
2. **C8/C10's session-token design is incomplete for SSE and leaks the token through URLs unless it is fixed.** `EventSource` cannot set an `Authorization` header, and a token in the URL can leak through history, referrers, logs, screenshots, and copied bug reports. The spec needs a one-time ticket, a cookie, or a fetch-based stream.
3. **C5's per-twin failure matrix cannot be signed off yet.** `research/` and `fixtures/` do not exist. The table is a target, not a verified fact. Two entries are already under-specified: `payment-declined` does not cover Stripe's third checkout outcome (`requires extra authentication`), and `webhook-bad-signature` is not a signature for services that use a shared-secret header.

## Findings by area

### Ports, control API, session, token

1. **Fixed ports contradict configurable ports and random test ports (C3.3, C8, C14, C17).** C3 says 4400-4403 and "all configurable"; C8 says the control API is "on port 4400"; C14 allows ports; C17 requires every test that starts a server to use a random free port. Fix: make 4400-4403 defaults only. The runtime port is the source of truth in the session, UI URL, Host check, checkout URLs, and status output. Change C8 to "default port 4400". Tests use port 0 or another free port.
2. **The session token is placed in a URL (C8.2, C10).** URLs end up in browser history, referrers, logs, screenshots, and bug reports. The UI also loses the token on reload or in a second tab. Fix: put a short-lived one-time code in the URL, exchange it same-origin for an in-memory token or a `HttpOnly`, `SameSite=Strict` cookie, remove it with `history.replaceState`, send `Referrer-Policy: no-referrer`, and never put the token in logs, events, exports, or error text.
3. **SSE authentication and reconnection are not defined (C8, C10).** C8 requires every control API request to carry the token, but browser `EventSource` cannot add an `Authorization` header. Putting the token in the SSE query string leaks it. Fix: define a one-time SSE ticket, a same-origin cookie, or use `fetch` with a streaming body and an `Authorization` header. Define heartbeat, `Last-Event-ID`, and reconnect after session restart.
4. **"Sends no permissive CORS headers" does not reject cross-origin requests (C8.4).** CORS only stops a browser reading a cross-origin response. A simple cross-origin form or `no-cors` request is still sent. Fix: explicitly allow only the UI origin (`http://127.0.0.1:<port>` and/or `http://localhost:<port>`), reject other `Origin` values on state-changing routes, reject missing or foreign `Origin` where relevant, require the token in a header/body rather than a query string, and consider `Sec-Fetch-Site`. Hono 4.13.14 has `csrf()` and `bearer-auth` middleware that can help; do not use `cors()` with its default `origin: '*'`.
5. **The Host-header rule needs exact details (C8.3, C13.4).** The actual port may be configurable, `localhost` may resolve to IPv6 `::1` while the server binds IPv4, and Host comparison can be case-sensitive or include a trailing dot. Fix: compare against the actual bound port, allow exactly `127.0.0.1:<port>` and `localhost:<port>` (and define IPv6 policy), generate `127.0.0.1` URLs, and reject unknown hosts. Apply the same Host check to twin and checkout servers, not only the control server.
6. **Twin and checkout ports are unauthenticated by design, but the consequences are not stated (C8, C10, C13).** Any local website can send requests to the twin ports; CORS may stop it reading the response but does not stop the request. Checkout pages can be framed or driven by another origin. Fix: document this explicitly. Add `frame-ancestors 'none'`/`X-Frame-Options`, make checkout confirmation a POST with Origin/Referer checks, rate-limit and cap bodies, and decide per service what CORS behaviour a real app needs. Do not rely on "localhost only" as the whole defence.
7. **"The control API is the only way to change the twins" is misleading (C8).** App requests to twin endpoints create payments, refunds, recipients, and transfers; checkout pages also change state. Fix: say the control API is the only way to change rules, configuration, sessions, and scenarios; business records change through the twin's own API.
8. **Session-file lifetime and multiple sessions are undefined (C9).** The file holds the token and ports, must be user-only, is removed on clean shutdown, and a stale file is ignored, but there is no rule for two `ibeji start` processes, Windows ACLs, atomic writes, or how staleness is detected. Fix: allow one session per user (or explicit session directories), write atomically with user-only permissions, include a random instance id plus PID and health check, refuse to overwrite a live session, and define stale detection.
9. **The control API has no route contract (C8).** The spec lists capabilities but not paths, methods, headers, request bodies, response bodies, error bodies, or SSE event names. The CLI, UI, and MCP server cannot be built consistently without it. Fix: define a route table or OpenAPI/Zod contract early, including the token header name, SSE format, pagination/filtering, and version prefix.
10. **Token generation and comparison are unspecified (C8).** Fix: use a CSPRNG with at least 256 bits, compare in constant time, rotate per session, redact everywhere, and document the header name (for example `Authorization: Bearer` or `X-Ibeji-Token`).
11. **Test keys are not defined as static or per-session (C2, C4, C7, C9, C10).** C2 says Ibeji "issues" test keys; C7 says webhook secrets are per session; C9 and C10 show tests keys again; C4 requires service-format keys for official library compatibility. Fix: decide static, format-correct fake keys versus per-session generated keys. If per-session, the app must be reconfigured each run; if static, document that they are public fake keys. Ensure live-key rejection is unaffected.
12. **Session export can leak secrets (C8, C9, C12).** "Saves the session to a JSON file, for bug reports" could include the token, test keys, webhook secrets, live-key echoes, webhook URLs, and personal data. Fix: define the export schema and redact the token, all keys/secrets, live keys, and sensitive headers; make the file user-only; document what is included.
13. **The UI token and "kept only in memory" conflict with reload and second tabs (C8.2, C10).** Fix: define the exchange/cookie/streaming approach and what happens on a hard reload, a second tab, and a session restart.
14. **Port conflicts and partial startup are undefined (C3, C9, C14).** Fix: preflight all requested ports before starting any server; fail with what/why/fix and do not leave a half-started session.
15. **`ibeji start` browser opening is not robust (C9, C1).** `open` may fail on headless/SSH/unsupported systems. Fix: always print the URL, fall back to printing it if opening fails, keep `--no-open`, and never print the token in a log.

### Twin framework and core

16. **Service-specific error shapes are required inside a core that must not contain service code (C3.1-2, C5, AGENTS 5).** `server-error` and `rate-limited` must respond in each service's own error shape, but the failure engine is core. Fix: keep the engine pure and abstract. It returns a decision; the twin's own response builder renders the service-specific error.
17. **The pure failure engine cannot itself perform side effects (C3.5, C5).** Delays, dropped connections, webhook ordering, retries, and state changes need a clock, a dispatcher, and randomness. Fix: define a deterministic "failure plan" output and let the core dispatcher and the injected clock apply it.
18. **The twin definition includes a port (C2).** That conflicts with configurable ports and random test ports. Fix: make it a default port or remove it; the core assigns the runtime port and reports it.
19. **C3's "adding a fourth twin needs no change to core, CLI, UI, or MCP server" is contradicted by hardcoded lists (B3.7, C4, C5, C6, C10, C11, C16).** The UI switcher names three twins, MCP tools and docs may use three-value enums, C5 and C6 list twins per failure/scenario, C16 fixes three folders, and C10 assigns per-twin label colours. Fix: make twin discovery metadata-driven. Twins declare id, name, default port, actions, failures, scenarios, checkout handlers, and display token. CLI/UI/MCP read the control API. Do not use static unions or `z.enum(['paystack','flutterwave','stripe'])` in generic code. The spec may still list v1 twins, but code must not branch on them.
20. **Action ids and action selectors are inconsistent (C2, C9).** C2 uses ids such as `paystack.refund.create`; C9 uses `--on refund`. Fix: define the action registry, the selector grammar (`refund`, `refund.create`, full id), aliases, and validation. Decide whether `--on refund` means all refund actions.
21. **Every event is required to name its twin (C2).** Session start/stop, config errors, scenario start/finish, UI connection, and server errors have no twin. Fix: allow an optional twin or add a core/session event scope rather than a fake twin.
22. **The conformance suite needs a way to know which failures apply (T14, C5).** Fix: each twin declares its supported failures and actions; T14 reads that declaration and asserts the shared behaviour. Do not hardcode a failure-twin matrix in the conformance test.
23. **"One twin framework" must allow the services to differ (C3.2, C4).** JSON versus form-encoded requests, nested parameters, error shapes, idempotency, auth formats, signature methods, and checkout outcomes are service-specific. Fix: define capability hooks and twin-owned request parsers, response builders, error renderers, and signers. The core only orchestrates. A single rigid router would force service logic into the core.
24. **Twin registration is not defined (C3, B3.7).** Fix: one exported twin definition per folder, loaded by a small registry; no core edit needed for a fourth twin.
25. **Checkout pages are part of the twin definition but the UI is shared (C2, C10).** Fix: the twin declares checkout outcome handlers and state transitions; the shared UI renders the page. No service-specific branch in the UI.

### Per-twin checkout pages

26. **Checkout links must respect the actual host and port (C4, C10).** The twin binds `127.0.0.1`; a URL built with `localhost` may resolve to `::1` and fail. Ports are configurable. Fix: build checkout URLs from the actual bound address and port, using `127.0.0.1`. Document that a Docker/VM/remote customer cannot reach a local-only checkout in v1.
27. **The tester's checkout choice conflicts with active failures (C4, C5, C6, C10).** If `payment-declined` or the `checkout-declines` scenario is active, does the page still let the tester pick success? Fix: define precedence. A failure should override the tester's choice, or apply a percentage with a seeded decision, and the page must explain why the chosen outcome was overridden.
28. **Stripe's "requires extra authentication" outcome is under-specified (C4c, C5).** It is a third outcome, not a decline, and it affects PaymentIntent status, Checkout Session status, events, and webhooks. Fix: research Stripe's documented test cards/3DS outcomes, define the page flow and resulting states, and decide whether a separate failure is needed.
29. **Checkout state, expiry, abandonment, and webhooks are not defined (C4, C7, C10).** Fix: for each twin and outcome, define the record status, whether/when it expires, which events/webhooks are emitted, and what the UI shows. Include `abandoned` for Paystack and `cancelled` for Flutterwave without treating those words as interchangeable with Stripe outcomes.
30. **Checkout pages are unauthenticated and can be framed (C10, C13).** Fix: `frame-ancestors 'none'`, POST-only confirmation, Origin/Referer checks, body limits, rate limits, and a clear "no real money" notice. Do not accept arbitrary amounts or customer data beyond what the checkout needs.
31. **Checkout pages must be tested as UI (C10, T8, T9).** Fix: include them in Playwright, axe, and keyboard-only tests; T14's "serves checkout page" is not enough.

### C5 failure library and the per-twin lists

32. **The C5 twin matrix cannot be confirmed yet.** The table is a scope target. C5 also says a failure is only offered when that twin's research supports it, so "All" is provisional. Fix: add a per-twin applicability and `source` matrix after Phase 2 research, mark unverified entries, and record approved changes in C21. Do not treat the current table as a service fact.
33. **`payment-declined` is incomplete for Stripe (C5, C4c).** C4c has success, card declined, and requires extra authentication. C5 only says "declined". Fix: define the full per-twin outcome matrix and decide whether the failure forces only declines or all non-success outcomes.
34. **`transfer-stuck-pending` and `transfer-reversed` list Paystack and Flutterwave only (C5, C4c).** This is consistent with C4c excluding Stripe payouts and Connect transfers, not proof that either service supports the exact status or reversal behaviour. Fix: research the real transfer statuses and reversal rules; if Stripe payouts are added later, update through C21.
35. **`bank-resolve-fails` lists Paystack and Flutterwave only (C5, C4c).** This is consistent with C4c having no Stripe bank-name-resolution action. Fix: keep it, but confirm the real failure mode and error shape in research.
36. **`webhook-bad-signature` does not fit every service (C5).** Not every service uses a cryptographic signature; some use a shared-secret header or hash. Fix: rename to `webhook-verification-fails` or define the per-twin invalid method (bad signature, wrong hash, missing header). Research decides.
37. **Failure settings have no schema (C5).** Delay seconds, repeat count, percentage, "forever", mode (hang versus reset), action scope, and seeding are all undefined. Fix: one Zod schema per failure with defaults, ranges, and a JSON Schema for the UI/MCP. Validate before applying; reject invalid settings.
38. **Multiple active failures have no composition or precedence rule (C5).** Delayed + duplicated + out-of-order + never-sent + bad-signature interact; so do timeout-after-commit + payment-declined, and flaky-network + everything. Fix: define a deterministic pipeline or priority order, document it, and test every combination the library allows. Important: `webhook-never-sent` must beat duplicate/delay if it wins, and idempotent retries must not duplicate a committed side effect.
39. **`timeout-after-commit` and `timeout-before-commit` are ambiguous (C5).** "Never replies or drops the connection" are different wire behaviours. Fix: add a `mode` setting (`hang`, `reset`, `close`), a default, client-timeout guidance, and explicit idempotency behaviour.
40. **`server-error` and `rate-limited` have undefined scope and counters (C5).** Is "a set number of times" per action, per route, per twin, or per session? Which 5xx? What happens after the count? Fix: define counters, scope, the exact status/code, and whether the failure auto-disables or just stops firing.
41. **`flaky-network` does not say whether the drop happens before or after commit (C5).** A drop after commit creates duplicates; before commit does not. Fix: define a setting/default, scope (twin API only, checkout, webhooks, or all), and per-attempt seeded decision.
42. **Webhook failure details are missing (C5, C7).** Delay: initial send only or retries too? Duplicate: how many, at what interval, same event id? Out-of-order: which pairs, and what ordering guarantee? Never-sent: what status is shown? Bad signature: wrong secret, corrupted signature, or missing header? Fix: settings and a per-twin delivery queue.
43. **`bank-resolve-fails` is "fails or times out" (C5).** Fix: make the mode a setting with a default and a defined error/timeout wire response.
44. **`source: assumed` conflicts with "only offered when research supports it" (C5).** Fix: either do not offer assumed failures, or offer them with a visible "assumed" label and a clear warning. Record the choice in C21.
45. **C5 has no action-level applicability table (C5, C9).** The metadata mentions actions, but the table only lists twins. Fix: define which actions each failure applies to and what `--on`/MCP/UI selectors mean. Decide whether a failure applies to control/UI/checkout routes.
46. **C5's "may never remove a failure" versus research narrowing is unclear (C5, C21).** Removing a failure for one twin is not the same as deleting the failure id. Fix: state that failures are stable ids; per-twin support may be added or removed only by an approved C21 entry.
47. **C5's "All" is static in a project whose goal is a fourth twin (C5, B3.7).** Fix: define "All" as all twins that declare support at runtime, and keep the v1 table as the current target only.

### Scenarios

48. **Scenario schema, loading, and validation location are undefined (C6, C16).** Fix: define the JSON schema, built-in versus user scenario directories, id collision rules, search order, and whether user files extend or replace built-ins.
49. **Scenario twin selection and running-twin behaviour are undefined (C6, C9, C11).** "Default every supported twin that is running" is clear; what if the user explicitly selects a twin that is off? Fix: return an Ibeji error with a fix, or skip with an explicit warning. Add a twin selector to the UI and MCP schema.
50. **The shipped scenarios lack exact settings (C6).** "1 to 3 minutes", "2 minutes", "10 minutes", "half", "some out of order", and "every webhook twice" need concrete values, ranges, and seed rules. Fix: write them down and validate them.
51. **Scenario lifecycle conflicts are undefined (C6, C9).** What happens when a scenario runs while another runs, when `clear` removes a rule the scenario owns, when `reset` runs, or when a twin stops? Fix: define start/replace/queue, ownership, cancellation, and reset behaviour.
52. **Timed scenarios conflict with "no test uses real time" (C6, C17).** Fix: make the scenario clock injectable; unit/integration tests use fake timers. Playwright and smoke tests may use bounded real time, but must not retry.

### Webhooks

53. **The webhook-secret model is not service-accurate yet (C7, C4, C9, C10).** C7 says Ibeji generates a secret per session for each twin. Some services sign with the API secret key, some use an endpoint secret, and some use a shared hash. Fix: research each service. The UI/CLI must show the actual value the app needs, labelled correctly, and must not invent a separate secret where the service does not use one.
54. **The webhook status model is incomplete (C7).** `sent`, `delivered`, `failed`, and `unreachable` do not cover queued, scheduled, retrying, skipped because no URL, or abandoned because the session stopped. They also mix an attempt with its final result. Fix: define attempt events and statuses, or add `pending`/`skipped`/`retrying`. Record each attempt immutably.
55. **The retry schedule is undefined when a service does not document one (C7).** Fix: define a default (for example exponential backoff with jitter), maximum attempts, timeout, concurrency, and stop conditions; mark it `assumed` in research; make it testable with the injected clock.
56. **Webhook SSRF and the public-URL policy are under-specified (C13.5, C9, C14).** The `--allow-public-webhooks` flag is not in C9 or C14, and "private-network addresses" includes LAN addresses, link-local `169.254.0.0/16` (including cloud metadata), and IPv6 variants. DNS can resolve to a different address after validation, and redirects can escape. Fix: add the flag to start, config, control API, MCP, and UI; default to loopback only or explicitly document private-network risk; allow only `http`/`https`; resolve and pin the address; reject link-local/metadata/multicast/unspecified; no redirects; re-check on every attempt; cap response size and time; warn and confirm for public URLs.
57. **Resend and queue behaviour are undefined (C7, C5).** Which URL does Resend use if the webhook URL changed? Does it re-sign? Is it a new event or a duplicate? What happens to queued deliveries when the session stops? Fix: define current-URL policy, re-signing, event identity, and queue shutdown.
58. **Webhook storage and privacy are undefined (C7, C10, C12).** The UI shows the app's response; how much of the body/headers are stored, for how long, and are secrets redacted? Fix: cap and redact; never store authorization headers.
59. **The "no URL" case has no status (C7).** Fix: add `not-sent`/`skipped` and show it in the UI; still record the logical event.

### CLI and configuration

60. **CLI flags and settings syntax are underspecified (C9).** Define exact port flag names, whether `--twin` is repeatable/comma-separated, the settings syntax (`--seconds`, `--percent`, `--times`, `--mode`), `--on` action selectors, `--seed` type, config path, `--json` for `start`, and `--allow-public-webhooks`.
61. **Invalid CLI selections and atomicity are undefined (C9).** If one of several twins/actions is invalid, does the command apply the valid part? Fix: validate everything first, apply nothing on error, and print what/why/fix.
62. **`clear`, `reset`, `export`, and `doctor` scopes are ambiguous (C9).** Does reset clear events, webhook URLs, secrets, queued webhooks, scenarios, and failures? Does export include state/rules/events/config? Fix: define each command's exact scope and make destructive actions confirm.
63. **JSON output and error shape are not defined (C9, C12).** Fix: define stable JSON for data, errors, and `--json`; keep human what/why/fix lines; define exit codes 0/1/2 consistently.
64. **Config fields are incomplete (C14).** Add `allowPublicWebhooks`, no-open, and any initial failure rules if supported. Decide whether the control port and twin ports are all configurable and how they are named. Fix: publish the full Zod schema.
65. **Config validation and precedence are incomplete (C14).** Unknown keys, duplicate twins, empty lists, null values, relative paths, port conflicts, scenario/twin compatibility, and array merge with CLI flags are undefined. Fix: strict schema, collect all problems at once, list field and valid example, then apply defaults < config < flags.
66. **Config must not carry secrets (C14, C13).** Fix: reject keys, tokens, and webhook secrets in the config; keep them in the session only.
67. **Seed type and reproducibility are undefined (C3.6, C14).** Fix: define integer/string seed, default source, and what "same seed" covers (failure choices, scenario timing, checkout outcomes, webhook duplication/order).
68. **`doctor` scope is vague (C9).** Define checks: Node version, all ports, config parse, session file, webhook URL policy, UI build presence, and each twin's webhook URL, with what/why/fix for each failure.

### UI

69. **The UI switcher and per-twin colours are hardcoded (C10, B3.7).** Fix: read twins and display metadata from the control API; "All" is dynamic; off twins are reported; no static three-twin union. Per-twin colours must come from an Ibeji palette token, not service branding.
70. **Token, reload, second tab, and SSE reconnect are not defined (C8, C10).** Fix: as above. Define what the UI shows when the session token changes or the session restarts.
71. **"Pauses when the user scrolls" is an accessibility and usability risk (C10, T9).** Scrolling is not a pause control and can move content unexpectedly. Fix: explicit pause/resume button, queued-count indicator, and `aria-live` behaviour. Follow WCAG 2.2.2.
72. **"Recently" in "Check my connection" is undefined (C10).** Fix: define the time window, what counts as a request, whether a check is active or passive, and how to clear it.
73. **Failure cards lack settings controls and validation (C10, C5).** The spec says cards show settings but not how to edit them. Fix: per-failure forms, defaults, validation, twin/action scope, disabled state when a failure is not applicable.
74. **Scenarios have no twin selector or stop control (C10, C6).** Fix: add the supported/selected twin choice, progress, stop, and conflict handling.
75. **The Webhooks page does not define scheduled, skipped, retrying, or failed attempts (C10, C7).** Fix: show all attempt states, response summary, and resend policy.
76. **The Data page reset scope is undefined (C10, C9).** Fix: say exactly what reset clears (records only? failures? events? webhooks?) and confirm destructive actions.
77. **Fonts are not in the dependency list (C10, C1).** IBM Plex Sans/Mono must be shipped as local assets with their licence, or a font package must be added and approved. Fix: include the files in the package and a licence notice; do not load from a CDN.
78. **The palette and per-twin labels need exact tokens and contrast (C10).** Five named colours must cover three labels, all text, focus states, and disabled states at 4.5:1. Fix: define tokens and test contrast; do not use service colours.
79. **The live-key banner must not echo the key (C10, C12).** Fix: show only a non-secret fingerprint/prefix; never show any part of a live key.
80. **UI serving details are missing (C10, C8).** Define SPA fallback, cache headers for hashed assets, no token on static assets, CSP/frame-ancestors, and the 404 page.

### MCP server

81. **The MCP package and version are correct (C1, C11), but the v2 details must be written down.** `@modelcontextprotocol/server` 2.4.0 is the v2 server package; `@modelcontextprotocol/sdk` 1.32.2 is the old v1 line. Use `@modelcontextprotocol/server/stdio` (`serveStdio` or `StdioServerTransport`). The v2 README requires TypeScript >=6 and `"types": ["node"]` in `tsconfig`, which C18 does not mention. Fix: add that to C18 and use the v2 stdio entry.
82. **MCP tool annotations are not mapped (C11).** The v2 SDK has `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`; all are hints. Fix: set `readOnlyHint: true` for the read tools, and `readOnlyHint: false` + `destructiveHint: true` for `ibeji_reset_state`. Do not treat annotations as enforcement.
83. **Optional `twin` semantics and schemas are undefined (C11, B3.7).** For each tool, say what omitted `twin` means (all running? all supported? error), whether `set_webhook_url` requires a twin, and how actions/settings are encoded. Use a plain string validated against the control API, not a static three-value enum, so a fourth twin needs no MCP change.
84. **Tool input/output schemas are missing (C11).** Fix: define Zod schemas and JSON Schema for failures, settings, scenarios, webhook URLs, and reset scope. Validate with the same core schemas as the CLI/control API.
85. **No-session, session-restart, and stdout rules need detail (C11, C12).** Fix: every tool returns a tool error with `isError: true` and a what/why/fix message when no session is running; re-read the session file after a restart; keep stdout exclusively JSON-RPC; all logs go to stderr.
86. **Tool parity is incomplete (C8, C11).** The control API and UI can resend a webhook and export the session, but MCP has no such tools. This is not required by C5, but decide whether to add them; if not, document the gap.
87. **Secrets over MCP need a safety decision (C11, C13).** `ibeji_get_test_keys` and `ibeji_get_connection_guide` return credentials. Fix: annotate them as sensitive, keep them read-only, and document that MCP clients may log tool results.
88. **MCP protocol version support needs a decision (C11).** v2 implements the 2026-07-28 spec and can serve legacy 2025 openings. Fix: document the default and whether legacy is served or rejected.

### Errors and safety

89. **Stable error codes are not listed (C12).** Fix: define an `IBEJI_*` code registry with what/why/fix, and keep codes stable across releases.
90. **The key-redaction rule is unsafe (C12.5).** "Shortened to the first 12 characters" can reveal part of a live key or webhook secret. Fix: never show any part of a live key; for test keys, show only a known non-secret prefix plus a short fingerprint; redact the token and webhook secrets everywhere (logs, errors, events, UI, export, MCP).
91. **Error formats across CLI/API/MCP/UI are undefined (C12).** Fix: define the JSON/HTTP/tool/UI shapes, how Zod errors are converted, and how twin errors stay service-shaped.
92. **"No console.log" and "no unhandled promises" need enforcement (C12).** Fix: lint rules, a stderr-only logger, and a process-level unhandled-rejection handler that reports an Ibeji error.
93. **C13.1's outbound-network test conflicts with local webhooks (C13, T7).** Blocking all outbound network would also block webhooks to the app and possibly localhost. Fix: block non-loopback egress, allow loopback, strip proxy environment variables, and test that twins cannot reach real service hosts. Consider a runtime socket guard, not only a test-only block.
94. **C13.2 needs public and secret live-key formats and a no-leak test (C13, C4).** Fix: research every live-key format, reject on every route, record a warning event, show a banner without echoing the key, and prove no key reaches logs/events/exports/fixtures.
95. **C13.3 conflicts with Hono's default binding (C13, C3).** `@hono/node-server` 2.1.5 passes `undefined` hostname to `server.listen` when omitted, which bound `::` in a live check; this is not "127.0.0.1 only". Fix: always pass `hostname: '127.0.0.1'` and test the actual bound address. See the library check below.
96. **C13.4 needs Origin/CSRF, not only token and Host (C13, C8).** Fix: add explicit origin rejection, state-changing POST-only routes, token in a header/body, and no wildcard CORS.
97. **C13.5's public-webhook flag is missing from every interface (C13, C9, C14).** Fix: add it to start/config/control/MCP/UI, default to loopback only (or make private-network access opt-in), and add DNS/redirect/link-local/metadata protections. See item 56.
98. **C13.6's recorder exclusion needs a package test (C13, C15).** Fix: list `scripts/` out of the published `files`, and add a packed-tarball test that the recorder is absent and no runtime install script runs.
99. **Safety rules missing from C13.** Add: no telemetry or update checks; no CDN or remote font/asset loading; no real keys in fixtures/logs/screenshots; no real money; no external payment calls from twins; session file user-only; no live key displayed; no `--allow-public-webhooks` without a warning/confirmation.

### Fixtures, layout, docs, tests, quality gates

100. **The fixture schema and normalisation are undefined (C15, T3).** Fix: define request/response/status/headers, stable fake ids and timestamps, ordering, pagination, and per-fixture "last recorded" metadata. Distinguish a recorded response from a skipped/account-limited step; T3 must not demand a twin reproduce an account-specific error.
101. **The fixture privacy scan will have false positives and negatives (C15, T13).** Stable fake emails/phones can look real; real merchant names and bank details may pass a simple scan. Fix: use an allowlist for known fake values and scan headers/URLs/query strings as well as bodies.
102. **Recorder packaging and environment rules need detail (C15, C16).** Fix: define env var names, live-key refusal formats, no key logging, test-mode-only, fixed action order, and a packed-package test that excludes the recorder.
103. **C16 omits `docs/`, which C19 requires (C16, C19).** Fix: add `docs/` to the layout. Also decide whether to commit `dist/`, `coverage/`, `pnpm-lock.yaml`, `.gitignore`, and `CHANGELOG.md` and how the published `files` list is built.
104. **The published package contents are undefined (C15, C16).** Fix: specify what ships (CLI/server JS, UI `dist/ui`, fonts, scenarios, docs, licence, fixtures?) and what does not (recorder, tests, examples, dev tooling). Add a packed-tarball test.
105. **"No test uses real time" is impossible for Playwright and smoke tests (C17).** Fix: scope the injected-clock rule to deterministic unit/integration tests; allow bounded real time in browser/smoke tests; keep the no-retry rule.
106. **"No test touches the real network" conflicts with local webhooks and package installation (C17, T7, T12).** Fix: allow loopback, use a local tarball for smoke installation, and block only external egress.
107. **T4's "from CLI, control API, and MCP server" matrix is unclear (C17).** Does every failure need testing through all three interfaces and all applicable twins? Clarify the matrix, or define a smaller contract that proves each interface can enable/observe the same failure.
108. **T9 says zero "serious" axe problems, but critical is worse (C17).** Fix: require zero serious and zero critical problems.
109. **T15 may be impossible for some official libraries (C17, Part F).** Official libraries may not allow a custom base URL, may require HTTPS, or may validate keys in ways a local twin cannot satisfy. Fix: research each library first; define what "compatible" means when custom base URLs are impossible; record limits in `docs/limits.md`.
110. **100% branch coverage for core and framework is a high bar and needs a definition (C17).** Fix: name the coverage provider, include/exclude patterns, generated/type-only files, and whether the target is per-task or global. Keep it if deliberate; otherwise lower it before it forces contrived tests.
111. **Node version support is broader than the toolchain allows (C1, C18).** Latest `tsup` 9 requires `^22.18 || ^24.11`; latest `vitest` 5 requires `^22.12 || ^24`; latest `@axe-core/playwright` requires `>=22.12`; Vite 8 requires `>=22.12`; Changesets requires `^22.11 || ^24`. Fix: state minimum patch versions (22.23.4 and 24.22.1 are the current latest) or pin older tools. CI should use those exact lines.
112. **Playwright browsers are not installed by `pnpm install` (C18).** The `playwright` package has no install script in 1.64.1; browsers need `pnpm exec playwright install`. Fix: add an explicit setup/CI step and document it; `test:ui` otherwise fails.
113. **C1 omits packages needed to build and test the chosen stack (C1).** At minimum: `react-dom`, `@vitejs/plugin-react` (6.x requires Vite 8), `@playwright/test`, `@vitest/coverage-v8`, `@types/node`, `@types/react`, `@types/react-dom`. Fix: list them and their versions; ask before adding any that are not essential.
114. **TypeScript settings need MCP v2's `types: ["node"]` (C18, MCP README).** The v2 package references `Buffer`; TypeScript >=6 no longer auto-includes `@types/*`. Fix: add `"types": ["node"]` (and the UI's DOM lib/types) to the relevant tsconfigs.
115. **The quality-gate order needs the browser install and session-file implications (C18).** Fix: define setup before `test:ui` and `test:smoke`, and run the gates on Windows, macOS, and Linux with the exact Node lines.

### Research choices and open questions

116. **Flutterwave's "most used API version" is not measurable from documentation (C4b).** Fix: choose a specific documented version supported by the official Node library, record the evidence and date in `research/flutterwave.md`, and approve it in C21 before Phase 2.
117. **Stripe's API version headers need a defined behaviour (C4c).** Decide which Stripe API version the twin imitates, what it does with other `Stripe-Version` values, and how it parses form-encoded nested parameters (`metadata[key]`, arrays). Fix in research and C21.
118. **C4's action lists are unverified (C4a-c).** Do not treat them as complete or correct until Phase 2 research checks each action against official docs and fixtures. Fix: record each action, path, method, auth, request/response, and unsupported cases in `research/<twin>.md`.
119. **Part F's release-scope question is unresolved (Part F).** All three twins in 0.1.0 vs Paystack + Flutterwave first changes phases, tests, docs, and package size. Fix: decide before Phase 2.
120. **Part F's real-story permission question is unresolved (Part F, C5).** `source: real-story` needs consent and credit. Fix: use `docs`/`assumed` until stories are cleared.
121. **B2 "same responses" versus B4 "no full copy" is ambiguous (B2, B4).** Fix: say "same responses for the actions in C4 only".
122. **The npm name was unclaimed at check time (B5).** `npm view ibeji` returned 404 on 27 October 2026, so the name appeared available, but it is not reserved. The `ibeji` npm organisation was not checked. Fix: reserve the name and org before publishing.
123. **"One command install" versus browser/native setup (B3.6, C1).** The published package may install with pure-JS runtime dependencies, but development/CI needs prebuilt native dev tools and a separate Playwright browser install. Fix: state the distinction in the README and safety docs.

## C5 per-twin applicability at kickoff

This is a scope check, not a service-fact confirmation. Research and fixtures are still required.

| Failure | Listed twins | Kickoff verdict |
|---|---|---|
| `slow-response` | All | Scope-consistent; no service fact. |
| `timeout-after-commit` | All | Scope-consistent; hang/reset mode and idempotency need defining. |
| `timeout-before-commit` | All | Scope-consistent; same. |
| `server-error` | All | Unverified: each service's 5xx shape needs research. |
| `rate-limited` | All | Unverified: each service's 429 shape needs research. |
| `flaky-network` | All | Scope-consistent; before/after commit needs defining. |
| `webhook-delayed` | All | Scope-consistent; initial send vs retries needs defining. |
| `webhook-duplicated` | All | Scope-consistent; count/interval/event id need defining. |
| `webhook-out-of-order` | All | Scope-consistent; ordering pairs/queue need defining. |
| `webhook-never-sent` | All | Scope-consistent; missing "not sent" status. |
| `webhook-bad-signature` | All | Naming does not fit services that use a shared secret rather than a signature. |
| `payment-declined` | All | Incomplete for Stripe: C4c also has "requires extra authentication". |
| `transfer-stuck-pending` | Paystack, Flutterwave | Consistent with C4c's out-of-scope Stripe payouts/Connect; real statuses need research. |
| `transfer-reversed` | Paystack, Flutterwave | Same scope note; real reversal/failed behaviour needs research. |
| `bank-resolve-fails` | Paystack, Flutterwave | Consistent with C4c's lack of a Stripe bank-resolve action; error/timeout mode needs defining. |

Conclusion: the twin columns are plausible for the v1 action scope, but **not verified**, and two rows need wording/outcome changes. Do not claim the table is correct until Phase 2 research is recorded and approved in C21.

## Dependency versions checked with npm (27 October 2026)

| Spec item | Package | Latest version | Notes |
|---|---|---|---|
| TypeScript | `typescript` | 7.0.2 | Latest stable. |
| Node 22 | `node@22` | 22.23.4 | Latest patch in the 22 line. |
| Node 24 | `node@24` | 24.22.1 | Latest patch in the 24 line. |
| pnpm | `pnpm` | 12.15.0 | Spec pins 10.x; latest 10.x is 10.34.9. |
| Hono | `hono` | 4.13.14 | Zero runtime dependencies. |
| Node adapter | `@hono/node-server` | 2.1.5 | Peer `hono ^4 || ^5.0.0-0`. |
| React | `react` | 19.3.1 | Needs `react-dom` 19.3.1, not listed in C1. |
| Vite | `vite` | 8.3.5 | Uses Rolldown/lightningcss; see native check. |
| React plugin | `@vitejs/plugin-react` | 6.1.2 | Peer Vite `^8.0.0`; not listed in C1. |
| Zod | `zod` | 4.6.7 | Compatible with the MCP v2 dependency `^4.2.0`. |
| Vitest | `vitest` | 5.0.5 | Peer Vite `^6.4 || ^7 || ^8`; Node `^22.12 || ^24`. |
| Coverage | `@vitest/coverage-v8` | 5.0.5 | Needed for coverage; not listed in C1. |
| fast-check | `fast-check` | 4.10.2 | Pure JS. |
| Playwright | `playwright` | 1.64.1 | Browsers need a separate install. |
| Playwright test | `@playwright/test` | 1.64.1 | Test runner; not listed in C1. |
| axe | `@axe-core/playwright` | 4.14.0 | Node >=22.12. |
| MCP v2 | `@modelcontextprotocol/server` | 2.4.0 | Correct v2 package; Node >=20. |
| Old MCP SDK | `@modelcontextprotocol/sdk` | 1.32.2 | v1 line; do not use for this spec. |
| tsup | `tsup` | 9.0.0 | Node `^22.18 || ^24.11`. |
| Biome | `@biomejs/biome` | 2.6.3 | Native platform CLI. |
| Changesets | `@changesets/cli` | 3.0.3 | Node `^22.11 || ^24`; pnpm >=10. |
| publint | `publint` | 0.3.25 | Node >=18. |
| arethetypeswrong | `@arethetypeswrong/cli` | 0.18.5 | Node >=20. |
| open | `open` | 11.0.4 | Node >=20. |
| Types | `@types/node` | 26.6.5 | Latest; pin 22.20.5 or 24.19.2 to match the supported runtime line. |
| Types | `@types/react` | 19.3.0 | Needed; not listed in C1. |
| Types | `@types/react-dom` | 19.3.0 | Needed; not listed in C1. |
| npm name | `ibeji` | 404 | Appeared available at check time; not reserved. |

## Library checks

### `hono` 4.13.14

- README and type definitions read. Hono is a Web-Standards framework with zero runtime dependencies and Node >=16.9.0.
- It provides `streamSSE` (`hono/streaming`), `csrf`, `cors`, `bearer-auth`, `body-limit`, `secure-headers`, `request-id`, and `timeout`. SSE is technically supported.
- `cors()` defaults to `origin: '*'`; C8 must not use the default. `csrf()` supports `origin` and `secFetchSite`, which fits C8's cross-origin rejection if configured explicitly.
- Hono has no built-in Zod validator. The spec does not claim one; if `@hono/zod-validator` is wanted, it is an unlisted dependency and must be approved.
- Hono's `parseBody` can handle form-encoded bodies, but Stripe's nested `metadata[key]`/array encoding still needs a twin-specific parser and tests.

### `@hono/node-server` 2.1.5

- README and type definitions read. `serve(options, listener)` takes `fetch`, `port` (default 3000), and `hostname`.
- **Important:** if `hostname` is omitted, `serve` passes `undefined` to `server.listen`. A live check bound to `::` (all interfaces, IPv6 wildcard). This does not satisfy C3.4/C13.3. The implementation must pass `hostname: '127.0.0.1'` explicitly. A live check with that option bound only `127.0.0.1`.
- The adapter exposes `serveStatic` for the built UI and `getRequestListener` for custom servers; no native dependencies.
- The README's `serve(app, callback)` form works structurally because a Hono app has `fetch`, but the documented typed form is the options object. Use the options object so the hostname is explicit.

### `@modelcontextprotocol/server` 2.4.0

- README and type definitions read. This is the v2 stable server SDK for the 2026-07-28 MCP spec; it replaces the v1 `@modelcontextprotocol/sdk` package. C1's package and 2.x rule are correct.
- The stdio entry is `@modelcontextprotocol/server/stdio` with `serveStdio(factory)` or `StdioServerTransport`. C11 should name the v2 entry.
- The README requires TypeScript >=6 and `"types": ["node"]` because the published types reference `Buffer`. C18 does not currently say this; add it.
- Tool annotations exist with `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. They are hints, not enforcement. C11's read-only table should map to `readOnlyHint`; the reset tool needs `destructiveHint: true`.
- `registerTool` accepts Zod/Standard Schema input and output schemas. Use shared Zod schemas; keep `twin` a validated string rather than a static three-value enum if B3.7 is to hold.
- No native dependencies were found in this package or its `zod`/`@modelcontextprotocol/core` dependencies.

## Native-dependency check

Method: installed the C1 packages and the obvious missing build/test packages in `/tmp/ibeji-check`; scanned every installed `package.json` for `preinstall`/`install`/`postinstall`; searched for `binding.gyp`, `node-gyp`, and `*.node` files; inspected optional platform packages; ran the installed CLIs to prove the prebuilt binaries work.

| C1 dependency | Native artifact found? | Compile needed? | How checked |
|---|---|---|---|
| TypeScript 7.0.2 | No | No | Package metadata and install tree; no install script or `.node`. |
| Hono 4.13.14 | No | No | Zero runtime dependencies; no scripts or `.node`. |
| `@hono/node-server` 2.1.5 | No | No | No runtime dependencies; no scripts or `.node`. |
| React 19.3.1 / `react-dom` 19.3.1 | No | No | Pure JS packages. |
| Vite 8.3.5 | Yes, via dependencies | No compiler needed | Tree contains `rolldown` + `@rolldown/binding-darwin-arm64` (`.node`) and `lightningcss` + `lightningcss-darwin-arm64` (`.node`); optional `fsevents` is also native but was not installed. |
| `@vitejs/plugin-react` 6.1.2 | No own native code | No | Small JS package; requires Vite 8, so it inherits Vite's tree. |
| Zod 4.6.7 | No | No | Zero dependencies; pure JS. |
| Vitest 5.0.5 | Yes, through Vite | No compiler needed | Vitest itself is JS; its Vite peer brings Rolldown/lightningcss. |
| `@vitest/coverage-v8` 5.0.5 | No | No | Uses Node's V8 coverage; no native package. |
| fast-check 4.10.2 | No | No | Pure JS; only `pure-rand`. |
| Playwright 1.64.1 / `@playwright/test` 1.64.1 | Browser binaries, no `.node` | No | No install script in 1.64.1; browsers require `playwright install` separately. |
| `@axe-core/playwright` 4.14.0 | No | No | Pure JS + `axe-core`. |
| `@modelcontextprotocol/server` 2.4.0 | No | No | Pure JS; deps `zod` and `@modelcontextprotocol/core`; no scripts or `.node`. |
| tsup 9.0.0 | Yes, through esbuild/Rollup | No compiler needed | Depends on `esbuild` (native executable, postinstall `node install.js`) and `rollup` (optional `@rollup/rollup-darwin-arm64` `.node`). |
| `@biomejs/biome` 2.6.3 | Native CLI binary | No compiler needed | Optional platform package `@biomejs/cli-darwin-arm64`; no `.node`, no install script. |
| `@changesets/cli` 3.0.3 | No | No | JS dependency tree; no `.node`. |
| publint 0.3.25 | No | No | JS dependency tree. |
| `@arethetypeswrong/cli` 0.18.5 | No | No | JS dependency tree. |
| `open` 11.0.4 | No | No | JS dependency tree. |
| pnpm 10.x | Not a project dependency | No | Package manager; spec pins 10.x, latest 10.34.9. |

Result:

- **No dependency needs a C++ compiler or `node-gyp` at install.** No `binding.gyp` or `node-gyp` invocation was found. All native artifacts are prebuilt platform packages or prebuilt executables.
- **The literal "no native add-ons" rule is not met by the chosen latest development stack.** Vite 8/Rolldown, lightningcss, Rollup (via tsup), esbuild, Biome, and Playwright bring native artifacts. Most are dev/build/test tools, not runtime dependencies of the published CLI. The published runtime can probably stay pure JS if the UI is prebuilt and devDependencies are not installed for users.
- `esbuild` has a `postinstall` script. In this npm run it was blocked by the install-scripts policy, but the platform binary package was present and `esbuild --version` worked. pnpm 10's default build-script approval may also block it; add the required `onlyBuiltDependencies`/approval and verify on Windows, macOS, and Linux.
- The spec needs a decision: either (a) redefine the rule as "no package compiles from source; prebuilt platform binaries are allowed; the published runtime dependency tree has no native `.node` addons", or (b) replace the toolchain with pure-JS/WASM alternatives, which is a much larger cost.

## Proposed C21 decisions (not approved)

These are proposals only; no SPEC.md edits were made.

1. Clarify C1's no-native rule: runtime dependencies must be pure JS; development tools may use prebuilt platform binaries but must never compile; add a packed-package/install test.
2. Define the session-token exchange and SSE authentication (one-time code/cookie/fetch stream), Origin checks, and token redaction.
3. Make 4400-4403 defaults, not fixed ports; state the actual Node minima (`22.18+`, `24.11+`) or pin older tools.
4. Add the missing packages to C1 and add `"types": ["node"]` to C18.
5. Make twin registration, failure applicability, scenario twins, UI metadata, and MCP twin inputs dynamic so B3.7 is true.
6. Confirm C5's per-twin matrix, Stripe's extra-authentication outcome, transfer reversal/status facts, and webhook verification method in Phase 2; approve changes in C21.
7. Define failure settings, composition/precedence, webhook status/retry/SSRF policy, and the `--allow-public-webhooks` interface.
8. Decide the test-key model (static fake vs per-session), the webhook-secret model, and the Flutterwave/Stripe API versions.
9. Decide release scope (all three vs Paystack + Flutterwave) and real-story permissions.
10. Add `docs/` to C16, define published package contents, and add Playwright browser setup to C18.

## Later
   # Kickoff review resolved

   SPEC.md v1.2 applies the decisions from the Step 1.1 review. See SPEC.md C21, entries D1 to D30. Where this log's review and SPEC.md disagree, SPEC.md wins.

---

## Phase 1, Step 1.2: Project skeleton

Date: 27 October 2026.

Built the single private `ibeji` package skeleton only. No runtime dependencies, product code, CLI behaviour, UI, twin framework, research, or fixtures were added; those come in later phases.

### What was built

- One package, `ibeji@0.0.0`, `private: true`, MIT, author Joseph Brendan, ESM, Node `^22.18.0 || >=24.11.0`, pinned to pnpm 10.34.9, with the built CLI at `./dist/cli/index.js`.
- No `exports` or `types` field. Published `files` list is the C16 list: `dist/`, `scenarios/`, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES`, `CHANGELOG.md`.
- C1 development dependencies at the latest stable versions, with matching pairs and `@types/node` on the 22 line. No runtime dependencies were installed.
- `tsconfig.json` with the C18 compiler settings and `"types": ["node"]`.
- `biome.json` with the no-`any`, unused-variable/import, floating-promise, and `src/`-only no-console rules, LF formatting, and the repository layout exclusions needed so Biome does not rewrite `SPEC.md` or `BUILD-LOG.md`.
- `vitest.config.ts` with v8 coverage: 100% lines and branches for `src/core/**/*.ts` and `src/twins/framework/**/*.ts` as a whole, and 90% lines and branches for `src/**/*.ts` as a whole.
- C16 folder layout with `.gitkeep` placeholders, plus the CLI entry, a tiny core function, and one T1 unit test.
- `.gitattributes` forcing LF for text files; `.gitignore` for the required generated folders/files.
- GitHub Actions CI on Ubuntu, Windows, and macOS, Node 22 and 24, pnpm 10.34.9, with autocrlf disabled before checkout.
- MIT `LICENSE` and the two-line `README.md`.
- `pnpm-lock.yaml` committed.

### Version and tool decisions

- TypeScript 7.0.2 is installed. `pnpm typecheck` and `pnpm build` both passed with it, so no 6.x fallback was used and no TypeScript C21 entry is needed.
- pnpm 10.34.9 reported exactly one blocked build script: `esbuild@0.28.2`.
- After approval through `pnpm.onlyBuiltDependencies`, the esbuild postinstall ran successfully. No other package was approved.
- `find node_modules -name binding.gyp` returned nothing (0 files); no `node-gyp` directory exists. The development tree has four prebuilt `.node` binaries from Vite/Rolldown, Rollup, lightningcss, and fsevents, but nothing compiles from source.
- The published runtime dependency tree is empty at this phase.

### Versions installed

TypeScript 7.0.2; `@types/node` 22.20.5; React/React DOM 19.3.1; `@types/react`/`@types/react-dom` 19.3.0; Vite 8.3.5; `@vitejs/plugin-react` 6.1.2; `@fontsource/ibm-plex-sans`/`@fontsource/ibm-plex-mono` 5.3.0; Vitest 5.0.5; `@vitest/coverage-v8` 5.0.5; fast-check 4.10.2; `@playwright/test` 1.64.1; `@axe-core/playwright` 4.14.0; tsup 9.0.0; `@biomejs/biome` 2.6.3; `@changesets/cli` 3.0.3; publint 0.3.25.

### Verification

- All C18 gates that exist now passed: frozen install, typecheck, lint, build, test, and the UI placeholder.
- `pnpm test` passed twice. The placeholder test gives 100% coverage.
- A temporary uncovered source file made the run fail with the expected 100% `src/core/**/*.ts` and 90% global threshold errors; it was deleted immediately afterwards.
- A temporary lint probe triggered `noExplicitAny`, `noFloatingPromises`, and the `src/` no-console rule; it was deleted immediately afterwards.
- No test was skipped, weakened, or deleted.

### Proposed C21 entry (not applied to SPEC.md; needs Joseph's approval)

> **27 October 2026: approve the `esbuild` install script.** pnpm 10 reported only `esbuild@0.28.2` as blocked. It is needed because `tsup`/Vite use esbuild, and its postinstall selects and validates the prebuilt platform binary. It does not compile from source. `esbuild` is listed in `pnpm.onlyBuiltDependencies`. No other package was approved.

### Later

- Add runtime dependencies when the first CLI/control/twin task needs them.
- Add the real CLI, UI, Playwright config, twin registry, research, fixtures, scenarios, `THIRD-PARTY-NOTICES`, `CHANGELOG.md`, and docs in their phases.
- Run `test:ui`, `check:package`, and `test:smoke` for real when those phases exist.
---

## Phase 2, Step 2.1: Paystack research

Date: 27 October 2026.

Wrote `research/paystack.md` from Paystack's official documentation only for API facts. The file records all C4a actions, request fields, success shapes, error shapes, documented statuses, webhook events, authentication, signing, retries, idempotency, test data, money rules, library base-URL findings, C5 support, and gaps. A small library-only exception is labelled: section 13 uses the published npm packages because Paystack's docs do not document Node base-URL overrides.

Key findings and decisions:

- The API base URL is `https://api.paystack.co`; every call uses `Authorization: Bearer SECRET_KEY` and HTTPS.
- Webhooks are signed with `x-paystack-signature`, HMAC SHA512 over the raw payload using the secret key, in hex.
- Documented webhook retries: live every 3 minutes for 4 tries then hourly for 72 hours; test hourly for 10 hours; 30-second attempt timeout.
- Paystack documents only successful transaction webhooks. `charge.success` is the only transaction event relevant to C4a; no `charge.failed` or abandoned-payment event is documented.
- Refund events documented: `refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed`, `refund.processed`. Only `refund.pending` has a full payload example.
- Transfer events documented: `transfer.success`, `transfer.failed`, `transfer.reversed`. Only `transfer.success` has a full payload example.
- General idempotency is not documented. Transfer references can be retried, duplicate recipients return the existing record, and webhook resend is explicitly not idempotent.
- The official Node library `@paystack/paystack-sdk` hardcodes `https://api.paystack.co`; it has no documented base-URL override. The most-used community libraries also have no documented override; two have internal mutable settings but they are unsupported.
- C5 support: `server-error`, `rate-limited`, `webhook-verification-fails`, `payment-declined`, `transfer-stuck-pending`, and `transfer-reversed` are supported by docs. The other applicable failures need a real story. `authentication-required` is Stripe-only.
- Every unresolved point is marked **UNCONFIRMED** in `research/paystack.md`; section 15 lists the gaps. No Paystack fact was copied to another service.

No code, runtime dependency, fixture, or twin was written. No SPEC.md section was edited.

### Later

- Record Paystack fixtures in `fixtures/paystack/` when the recorder exists.
- Research Flutterwave and Stripe separately; never reuse Paystack facts.
- Resolve the library base-URL/T15 gap and the UNCONFIRMED webhook payloads in a later phase.

---

## Phase 2, Step 2.2: Flutterwave research

Date: 27 October 2026.

Wrote `research/flutterwave.md` from Flutterwave's official developer documentation. No Paystack research file was read and no Paystack or Stripe fact was used; the only Stripe reference is the C5 note that `authentication-required` is Stripe-only.

### Version decision

- Flutterwave currently documents **v3.0.0** and **v4.0.0**. The older Rave generation is not described by the current docs for these actions.
- v3 uses secret-key bearer authentication, `https://api.flutterwave.com/v3`, the Standard hosted checkout link (`POST /v3/payments` → `data.link`), `verif-hash` webhook checks, and `flutterwave-node-v3` 1.4.1, the official Node library labelled "API v3" in the official SDK directory.
- v4 uses OAuth 2.0, sandbox/production base URLs, `/charges`, `X-Idempotency-Key`, `flutterwave-signature` HMAC webhooks, and has no official Flutterwave Node library at the research date; `flutterwave-node-v4` is explicitly unofficial.
- **Recommendation: imitate v3.0.0.** It is the version of the official Node library and the only documented version with the hosted payment-link flow required by C4b. v3 docs were current and not marked deprecated on the research date.

Proposed C21 entry (not applied to SPEC.md; needs Joseph's approval):

> **27 October 2026: imitate Flutterwave API v3.0.0.** v3 is the version of the official Node library (`flutterwave-node-v3` 1.4.1, official SDK directory "API v3") and documents the hosted checkout-link flow required by C4b (`POST /v3/payments` → `data.link`). v4 is newer and documented, but its API reference uses `/charges`, switches to OAuth 2.0, has `X-Idempotency-Key`, and has no official Flutterwave Node library at the research date. v3 documentation was current and not marked deprecated on 27 October 2026. The rest of this file is v3-only.

### Key findings

- v3 API base URL: `https://api.flutterwave.com/v3`; `Authorization: Bearer <secret key>`; test keys contain `_TEST`; missing/invalid auth returns `{"status":"error","message":"Authorization required","data":null}` with 401.
- v3 webhook verification uses the `verif-hash` header containing the secret hash. It is a shared-secret comparison, not HMAC. v4 uses `flutterwave-signature` HMAC-SHA256 instead.
- v3 webhook retries: 3 times at 30-minute intervals if enabled in the dashboard; 60-second timeout; exactly HTTP 200 required.
- v3 money in the documented examples is whole currency amount, not minor units. The docs do not use kobo/subunit language; v4 also uses whole-currency decimal amounts.
- v3 test transfers default to `PENDING`; `_PMCK` succeeds after 10 minutes, `_PMCK_ST_F` fails after 10 minutes, and `DU_{minutes}` changes the delay.
- C4b "fetch one transaction" has no distinct v3 endpoint; the closest are verify-by-ID and the filtered transaction list. This is a documented gap.
- v3 refund webhooks are a bare object with no documented event name. v3 has no documented transfer reversal event/status; v4's `transfer.reversal` is not v3.
- The official `flutterwave-node-v3` library can point at a twin with its third constructor argument (base URL ending in `/`), but its `Charge` group uses `v3/charges`, not the Standard `/payments` hosted link, and it contains telemetry calls to external Flutterwave/SigNoz hosts. T15 needs a decision.

No code, runtime dependency, fixture, or twin was written. No SPEC.md section was edited.

### Later

- Record Flutterwave fixtures in `fixtures/flutterwave/` when the recorder exists.
- Resolve the C4b fetch gap, v3 refund event name, transfer reversal, and T15 library mapping decisions.
- Research Stripe separately; never reuse v3 facts.

---

## Phase 2, Step 2.3: Stripe research

Date: 28 October 2026.

Wrote `research/stripe.md` from `docs.stripe.com` and Stripe's API reference. No Paystack or Flutterwave research file was read, and no fact from either was used. The only non-`docs.stripe.com` sources are labelled source exceptions: the official `stripe` Node package 23.0.1 (base-URL options and pinned API version) and the official `stripe-mock` repository README (because `docs.stripe.com` has no stripe-mock page).

### Version decision

- Stripe's current API version is **`2026-09-30.endive`**.
- The official `stripe` Node package 23.0.1 pins `2026-09-30.endive` in `cjs/apiVersion.js`; `stripe-node` v12+ sends the version current at its release.
- **Recommendation: imitate `2026-09-30.endive`.** The twin has only one implementation, so it should pin the version the official library emits.
- Proposed header policy: accept an absent `Stripe-Version` or the exact pinned value; reject any other value with a Stripe-shaped `400 invalid_request_error` and a plain message. Stripe's docs do not document its own response to an unsupported version, so this rejection is a twin policy, not a Stripe fact.
- Webhook snapshot Event objects use `api_version: "2026-09-30.endive"`.

Proposed C21 entry (not applied to SPEC.md; needs Joseph's approval):

> **28 October 2026: imitate Stripe API version `2026-09-30.endive`.** Stripe's current version on the research date is `2026-09-30.endive`, and the official `stripe` Node package 23.0.1 pins the same version. The twin will serve only that version: an absent header or the exact version is accepted; any other `Stripe-Version` value is rejected with a Stripe-shaped `400 invalid_request_error` and a plain message. The docs do not document Stripe's own response to an unsupported version, so the rejection rule is a twin policy, not a claim about Stripe. Webhook Event objects use `api_version: "2026-09-30.endive"`.

### Key findings

- Stripe v1 requests are form-encoded (`application/x-www-form-urlencoded`), not JSON: `metadata[key]=value`, `line_items[0][price]=...`, scalar arrays as `name[]=value`, and `expand[]=...`.
- Base URL `https://api.stripe.com`; HTTP Basic Auth with the secret/restricted key as username and an empty password; bearer auth is also documented.
- Test secret keys start `sk_test_`, live secret `sk_live_`, test restricted `rk_test_`, live restricted `rk_live_`. Publishable keys cannot authenticate server calls.
- Common error envelope is `{ "error": { type, code, message, param, ... } }`; documented types are `api_error`, `card_error`, `idempotency_error`, and `invalid_request_error`.
- Documented HTTP statuses: 200, 400, 401, 402, 403, 404, 409, 424, 429, 500, 502, 503, 504.
- Idempotency keys are up to 255 characters, retained at least 24 hours, return the saved status/body for the same parameters, add `Idempotent-Replayed: true`, and use `409 idempotency_key_in_use` for concurrent same-key requests. The exact status/code for a parameter mismatch is not documented; the twin uses `400 idempotency_error` as its policy.
- Webhook signing uses `Stripe-Signature: t=...,v1=...`; HMAC-SHA256 over `timestamp.rawBody` with the `whsec_` endpoint secret; default tolerance 5 minutes; raw body required.
- Stripe retries webhooks for up to three days with exponential backoff in live mode and three times over a few hours in sandbox; exact delays are not documented.
- Lists use cursor pagination: `limit` 1–100 default 10, `starting_after`/`ending_before`, and `object: "list"`, `data`, `has_more`, `url`.
- Test mode documents success cards, declines, and 3DS cards; the key cards and outcomes are recorded in the research file.
- Money is in the smallest currency unit; zero-decimal currencies are listed, and ISK/UGX use two-decimal representations.
- The official `stripe` Node library can be pointed at a local twin with `host`, `port`, and `protocol` options; `telemetry` defaults to true and must be disabled for local compatibility tests.
- Stripe already provides test mode, the Stripe CLI (`stripe trigger`, `stripe listen`, `stripe events resend`), and the official stateless `stripe-mock`; Ibeji must not claim those do not exist. Ibeji's difference is stateful records, failure injection, scenarios, and one dashboard across all three services.

C4c gaps: `charge.refunded` carries a `charge` object although Charge is outside C4c; some checkout optional fields and `next_action` variants are outside scope; exact Stripe status for unsupported API versions and idempotency parameter mismatch are undocumented; exact webhook retry delays are undocumented; the local checkout page's event order is an Ibeji design decision.

No code, runtime dependency, fixture, or twin was written. No SPEC.md section was edited.

### Later

- Record Stripe fixtures in `fixtures/stripe/` when the recorder exists.
- Resolve the `charge.refunded` payload decision, the local checkout event order, and the T15 Stripe Node compatibility test.
- Re-check the pinned API version before each minor release.

---

## Phase 2, Step 2.4: Twin framework design

Date: 28 October 2026.

Wrote `TWIN-DESIGN.md`. No code, runtime dependency, action implementation, or SPEC.md edit was made.

### What was designed

- A row-by-row comparison of Paystack, Flutterwave, and Stripe with a research-file citation in every cell.
- One `TwinDefinition` interface covering id, display name, default port, action catalog, state schema, authentication and live-key detection, route registration, response/error builders, the shared failure step, webhook building/signing/verification/summaries, checkout outcomes, credentials, money rules, retry schedule, and C5 support.
- Explicit action catalogs for all three twins, including the local `checkout.open` and `checkout.submit` actions.
- A shared failure pipeline in which the core applies the C5 order and each twin shapes the HTTP error or action result.
- A webhook adapter in which the core stores the twin-built body and calls the twin's signer on each attempt, without knowing whether the service uses HMAC-SHA512, `verif-hash`, or `Stripe-Signature`.
- A shared checkout page renderer, with each twin owning the outcome semantics and resulting webhook drafts.
- A shared-versus-twin-only split. Shared code contains only the HTTP/session/state/failure/dispatcher/credentials/control/UI orchestration and the common checkout shell; parsers, envelopes, signatures, money, pagination, idempotency, outcomes, and C5 shaping stay in the twin.
- A T14 conformance suite description covering definition contract, lifecycle, 127 binding, Host checks, 1 MB body limits, no CORS, credentials, missing/wrong/live keys, action/route parity, request events, declared failure support and refusal, failure order, checkout outcomes, webhook signing/verification, verification-failure methods, retry schedules, money rules, idempotency, summaries, and registry extensibility.
- The dispatcher-to-signer design using `registry.require(delivery.twinId)` and the `twin.webhooks.sign` interface.

### Proposed C21 decisions

- Keep the existing open Flutterwave v3 and Stripe `2026-09-30.endive` decisions.
- Adopt the final C5 support matrix in `TWIN-DESIGN.md` §2.11.
- Flutterwave has no separate `payment.fetch`; verify-by-id is the fetch.
- Remove `transfer-reversed` from Flutterwave v3 because v3 has no reversal status or event.
- Stripe may build a minimal `charge` snapshot for `charge.refunded`, without adding a Charge API.
- Use the test-mode retry schedules in `TWIN-DESIGN.md` §2.10; Stripe's exact delays are assumed.
- Flutterwave's local "cancelled" checkout choice maps to the documented failed result.

These are proposed only; SPEC.md is unchanged.

### Later

- The proposed C21 decisions were approved in Phase 2, Step 2.5 (D31 to D41); see below.
- The framework type names and state-store boundaries will be hardened during implementation.
- Write the conformance suite before the first twin implementation.

---

## Phase 2, Step 2.5: Twin design approved

Date: 28 October 2026.

Updated `TWIN-DESIGN.md` to match SPEC.md v1.3 and approved C21 decisions D31 to D41. No code was written.

### What changed

- Added `idempotency` to `TwinDefinition` (D39): a `none` adapter or a header adapter. The core calls `begin` before the failure step, calls `complete` only when the action was performed, and stores nothing when a pre-action failure fired. Paystack and Flutterwave are `none`; Stripe uses `Idempotency-Key` with 255 characters, 24-hour retention, method/path/parameter fingerprinting, saved-response replay, mismatch errors, and `409 idempotency_key_in_use`.
- Split Flutterwave payments into `payment.verify` and `payment.verify_by_reference` (D32). Verify-by-id remains the fetch.
- Replaced the Stripe version rule with D37: no header answers as `2026-09-30.endive`; well-formed versions are accepted with a warning once per version; only malformed values are rejected.
- Updated the money design for D38: every stored amount is a smallest-unit integer, each twin converts at its edge, decimal amounts are parsed from text without floating point, and Flutterwave's missing decimal-place rules are marked **UNCONFIRMED**.
- Updated the approved C5 matrix (D31, D33): `transfer-reversed` is Paystack-only; `transfer-stuck-pending` now carries `thenFailPercent` and resolves transfers as successful or failed after the pending time.
- Updated the Stripe `charge.refunded` design (D34): the Charge is built from the PaymentIntent in the documented Charge shape, with the id matching `latest_charge`; there is no Charge API.
- Marked the C21 section approved and updated it for D31 to D41, including D35 retry schedules, D36 Flutterwave cancellation, D40 Flutterwave v3, and D41 Stripe version.

No SPEC.md edit was made by this task; the v1.3 changes and C21 entries were already present.

### Later

- Proceed to implementation using the approved design.
- Write the conformance suite before the first twin implementation.

---

## Phase 2, Step 2.6: Fixture recorder

Date: 28 October 2026.

Built the hand-run fixture recorder from SPEC.md C15. It was not run against any service; no real key was used and no fixture was created.

### What was built

- `scripts/record-fixtures.mjs` and `scripts/recorder/`:
  - `shared.mjs`: key validation and fingerprints, redaction, fixture saving, prompts, request sending, summary helpers, and the T13 fixture scanner.
  - `cli.mjs`: `--service` parsing, pre-request key refusal, service dispatch, and the summary table.
  - `paystack.mjs`, `flutterwave.mjs`, and `stripe.mjs`: each service's test action order, request shapes, invalid-request cases, prompts, test details, and invalid-key request.
- The recorder uses only Node built-in modules. No dependency was added.
- Redaction covers keys, tokens, authorization and access codes, client secrets, emails, names, phone numbers, account numbers, IP addresses, card numbers, CVCs, expiry values, and card last-4 values. Replacements are stable within one recording.
- T13 scans every JSON fixture under all three service folders and rejects keys, non-Ibeji email domains, non-fake phones, non-fake account numbers, and non-fake names.
- Unit tests cover redaction, key refusal before any request, the `--service` argument, and T13's detector.

### Exact commands to run by hand

Do not put a real key in shell history or source code. Set the variable for the current shell only.

```sh
PAYSTACK_TEST_SECRET_KEY="<paystack-test-secret-key>" node scripts/record-fixtures.mjs --service paystack
FLUTTERWAVE_TEST_SECRET_KEY="<flutterwave-test-secret-key>" node scripts/record-fixtures.mjs --service flutterwave
STRIPE_TEST_SECRET_KEY="<stripe-test-secret-key>" node scripts/record-fixtures.mjs --service stripe
```

The recorder prints the valid choices and exits with code 2 for any other argument. Missing, wrong-format, or live keys exit with code 1 before any request.

### Package proof

`pnpm pack --dry-run` lists no `scripts/` or `scripts/recorder/` files. The current tarball contents are `dist/cli/index.js`, `LICENSE`, `package.json`, `README.md`, and `scenarios/.gitkeep`.

### Later

- Joseph will run the recorder by hand with test credentials.
- Copy any runtime bank data from fixtures into the relevant `src/twins/<twin>/data/` folder.
- T3 will use only recorded, non-skipped fixtures.

---

## Phase 2, Step 2.7: Recorder stops on a rejected key and reports failures

Date: 28 October 2026.

Updated the hand-run recorder from two observed runs: a rejected key was being saved as `invalid-request`, and failed steps printed only `HTTP 400` without the service's message. No real key was used and no fixture was recorded in this task.

### What was built

- **Preflight key check.** Before any recording, the recorder sends one authenticated list request: Paystack `GET /transaction?perPage=50&page=1` (the documented default page size), Stripe `GET /v1/payment_intents?limit=1` (the documented minimum), and Flutterwave `GET /v3/transfers?page=1&page_size=10` (the documented default). A 401 or 403 prints the service's own message and code, says the key was rejected, lists test mode, the dashboard copy button, and the right business or account, then exits 1 without creating fixtures. Other preflight failures also stop before recording.
- **Key handling.** Keys are trimmed before use. Test-key regexes now reject non-printable, whitespace, and non-ASCII characters, so hidden characters from pasting fail before any request. Refusal messages show only the key's length and SHA-256 fingerprint.
- **Mid-run rejection.** A 401 or 403 on any call sent with the valid key stops the run. The failing call is saved as `<action>.skipped.json` for review, never as `invalid-request`; `invalid-key` probes remain the only deliberately wrong-key fixtures.
- **Outcome rules.** `invalid-request` is saved only for a 4xx response to deliberately wrong input sent with a valid key. A 2xx response to that input becomes `lenient-input` with a note. A 401 or 403 never becomes `invalid-request`. A 5xx, redirect, or no response becomes `skipped`.
- **Failure reporting.** Every failed or skipped step gets a `<action>.skipped.json` file with the redacted request, response, status, and reason. The summary table now has service message and code columns, and also shows notes such as a lenient input.
- **Request visibility.** Each request prints its method, redacted query, and redacted body before it is sent, using the same fake personal values as the saved fixtures. A key is never printed.
- **Request audit against research.** Fixed Paystack transaction references to use only the documented characters (`-`, `.`, `=`, alphanumeric) instead of underscores. Fixed the Stripe form encoder so arrays of objects use `line_items[0][field]` instead of `[object Object]`. Removed known-invalid fallback IDs from success paths for Paystack transfers and Stripe refunds; those steps are now skipped when the prerequisite record is missing. Flutterwave requests were checked against `research/flutterwave.md` at the same time.
- **Research note.** `research/paystack.md` now records that `GET /bank` answered 200 with a deliberately wrong key in a recorded run, marked "Observed while recording, needs a fixture to confirm".

### Decisions

- The preflight failure stops the run for any non-2xx, not only 401/403. A 401/403 is reported as a rejected key; other statuses are reported as a failed key-check request. This avoids recording after an unclear authentication result.
- A mid-run 401/403 saves the failing request as a skipped fixture because SPEC C15 point 6 requires every failed step to be reviewable. It is never used as an expected answer and is not an `invalid-request` fixture.
- Key character rules use the same printable key character set as the redaction patterns after the documented prefix. The research files document key prefixes, not full bodies or lengths, so this is a refusal rule for pasted junk, not a claim about the services' key formats.

### Tests

- Added `test/unit/recorder-failures.test.ts`, using a fake HTTP server on `127.0.0.1` port 0 and temporary fixture folders. It covers preflight 401/403, no saved files on preflight rejection, Stripe's `limit=1`, key trimming and hidden characters, mid-run 401, `invalid-request` versus `lenient-input`, wrong-key-only `invalid-key`, summary message/code reporting, skipped files, redacted request printing, and indexed Stripe form encoding.
- Updated the existing key test for the trimmed key returned by `validateKey`.

### Later

- Run the recorder by hand with real test credentials to confirm the bank-list wrong-key observation and create the fixtures.
- T3 must ignore `skipped`, `invalid-request`, `invalid-key`, and `lenient-input` fixtures as expected answers.
- No SPEC.md section was edited; the changes implement C15 and do not change its meaning.

---

## Phase 2, Step 2.8: example.com emails and Paystack 401 input errors

Date: 28 October 2026.

Fixed two problems from the last Paystack recorder run. No real key was used and no fixture was recorded in this task.

### What was built

- **Fake customer emails.** The recorder used `recorder@ibeji.test`. Paystack rejected it with HTTP 400 `invalid_params` and `"email" must be a valid email`, even though `.test` is a reserved domain; its email validator does not accept that address. The recorder now uses a fixed list of reserved `example.com` addresses: `customer.one@example.com`, `customer.two@example.com`, and `customer.three@example.com`. Paystack and Flutterwave send `customer.one@example.com`; Stripe sends no customer email. Redaction draws from the same list, and T13 accepts only addresses on that list. Any other email, including another `example.com` address, is still rejected.
- **Key errors versus input errors.** The preflight request remains the only unconditional key check. During recording, a 401 or 403 stops the run only when that service's own response identifies a key or authorization problem. Otherwise the response continues under its normal label with the note "The service returned 401 for an input error, not a key error." in both the fixture and the summary.
- **Per-service key-error detection.** Paystack matches key/authorization codes or messages such as `invalid_key`, `Invalid key`, `Unauthorized`, or `Authorization required`. Stripe matches the documented `api_key_expired` and `secret_key_required` codes or key messages. Flutterwave matches its documented `Authorization required` message. The exact Paystack invalid-key body is still **UNCONFIRMED** in `research/paystack.md`; the detection is deliberately limited to responses that name a key or authorization problem.
- **Research note.** `research/paystack.md` section 3.2 now records that a non-integer refund id returns HTTP 401 with code `missing_params`, observed while recording on 28 October 2026, and that the twin must copy this behaviour.
- **Fixture notes.** `saveFixture` and `saveSkippedFixture` can now store a `note`. The summary already had a note column, so the 401 input-error note appears in both places.

### Decisions

- A 401 from `refund.fetch` with code `missing_params` and the refund-ID message is an input error. It is saved as `refund-fetch-invalid-request.json`, not as a key rejection, and the run continues to refunds, transfers, and banks.
- A mid-run 401 that names a key or authorization problem still stops the run. This is the only exception to "the preflight decides key rejection"; it is required by point 2b of the task and protects a run whose key stops working mid-way.
- `example.com` addresses are kept in one exported list in `shared.mjs`, so the recorder, redaction, and T13 cannot drift apart.

### Tests

- Added fake-server tests for the Paystack and Flutterwave customer email bodies, the fixed example.com list, and T13 rejecting an `example.com` address that is not on the list.
- Added a fake-server test where Paystack `refund.fetch` returns HTTP 401 `missing_params` for a non-integer id. The run continues to refunds, transfers, and banks, and the fixture and summary carry the input-error note.
- Added a per-service key-error detection test for Paystack, Stripe, and Flutterwave response shapes.

### Later

- When the Paystack twin is built, `refund.fetch` must return the observed HTTP 401 `missing_params` response for a non-integer refund id.
- Any future recorder email field must use `RECORDER_EMAIL` or another address from `FAKE_EMAILS`.
- No SPEC.md section was edited; the changes implement C15 and do not change its meaning.
