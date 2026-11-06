# Ibeji SPEC compliance review

Date: 6 November 2026
Version reviewed: 0.1.0
Commit reviewed: `dfb3c4f`
Spec reviewed: `SPEC.md` v1.5 at `a5a08cc`
Reviewer: strict outside review. No product code was changed in this task.

## Scope and method

I read `AGENTS.md`, all of `SPEC.md`, all of `BUILD-LOG.md`, and all of `SECURITY-REVIEW.md`. I then inspected the source, tests, scripts, fixtures, docs, package metadata and CI configuration. I ran every C18 gate, the UI suite twice, the smoke test three times, and both audit views.

Status meanings:

- **met**: every mandatory sentence in the item is supported by code, a passing test, or a real gate run.
- **partly met**: the main implementation exists, but at least one mandatory sentence is missing, unproven, or contradicted.
- **not met**: a required behaviour is absent. A deliberate deferral is still marked not met and explained in the notes.

`C4c` is version 0.2.0 and is deliberately not built or registered in 0.1.0 (C21 D42). Its rows are marked not met because no C4c code exists, not because the 0.1.0 deferral is wrong.

## Section-by-section compliance

| Item | Status | Evidence | Notes |
|---|---|---|---|
| Part A, how to use this file | met | `AGENTS.md`; `BUILD-LOG.md`; `SECURITY-REVIEW.md`; this review records the sources read. | The project and review both follow the single-source-of-truth rule. |
| B1, the problem | met | `README.md:5-19`; `SPEC.md` B1. | The Musa story and the test-mode gap are present in the README. |
| B2, what Ibeji is | met | `README.md:20-38`; `src/twins/registry.ts:50-53`; C21 D42. | Two twins are registered in 0.1.0; Stripe is explicitly 0.2.0. |
| B3, goals | partly met | `src/twins/registry.ts:50-53`; `test/conformance/twin-conformance.test.ts`; T4 parity test at `test/integration/mcp.test.ts:798`; T8 and T10 suites. | The features exist, but the required three-surface parity proof is incomplete because the parity test does not exercise the UI. |
| B4, non-goals | met | `src/twins/registry.ts`; `ui/src`; `docs/limits.md`; `examples/school-fees-app`. | No cloud, other services, browser widgets, user scenarios, accounts or live keys are present. |
| B5, name and packages | met | `package.json:2-5`, `64-98`; `pnpm check:package` output. | Package name, bin, repository and no-exports rule are correct. The package is still `0.0.0` and `private: true`; that release state is recorded under C16, not as a B5 failure. |
| C1, stack and dependency rules | partly met | `package.json:64-98`; `pnpm list --prod --depth 0`; `biome.json`; `tsconfig.json`; `ui/tsconfig.json`; gate output. | Runtime dependencies and Node/pnpm versions match. `@modelcontextprotocol/client@2.4.0` is a dev dependency not in the C1 table and has no C21 entry. `pnpm.onlyBuiltDependencies` contains `esbuild`; the BUILD-LOG entry for it is still marked as a proposed C21 decision, not an applied one. |
| C2, core concepts | met | `src/twins/registry.ts`; `src/twins/framework/types.ts:336-354`; `src/core/failures/*`; `src/core/scenarios/*`; T1/T14 tests. | Registry, definitions, action ids, sessions, rules, events and fixtures are implemented. |
| C3, architecture | partly met | `src/control/server.ts:31`; `src/twins/framework/server.ts:400-412` and `771`; `src/core/failures/engine.ts`; `test/integration/control-security.test.ts:93`; `test/integration/t7-network.test.ts`; 3f script scan. | One core, one framework, bound ports, loopback binding, a pure engine and the injected clock pass. The product layers have no hard-coded twin list, but `scripts/smoke.mjs` and `scripts/screenshots.mjs` repeat the two twin ids, so the "only registry lists twins" rule is not true of the whole repository. |
| C4, twin scopes and common rules | partly met | C4a and C4b rows below; C4c rows below; `src/twins/registry.ts:50-53`. | The two 0.1.0 twins are implemented. C4c is deliberately deferred. Some C4a/C4b actions are documentation-only and have no recorded success fixture, and two Flutterwave fee values use local formulas. |
| C4 money rule | met | `test/unit/paystack-responses-money-auth.test.ts`; `test/unit/flutterwave-money.test.ts`; `test/integration/paystack.test.ts`; `test/integration/flutterwave.test.ts`; C4/T2 tests. | Paystack stores integer minor units; Flutterwave parses main-unit text without floating-point arithmetic. Stripe is C4c. |
| C4 issued credentials and live keys | met | `test/integration/paystack.test.ts:60`; `test/integration/flutterwave.test.ts:30`; `test/integration/live-key-removal.test.ts:51`; `src/twins/paystack/auth.ts`; `src/twins/flutterwave/auth.ts`; `src/shared/live-key-scanner.ts`. | All registered twins refuse wrong, live and missing keys; live keys in fields are removed. Stripe patterns are scanned although the twin is not registered. |
| C4 Host, body, CORS, checkout and webhooks | met | `test/integration/control-security.test.ts`; `test/integration/twin-framework.test.ts`; `test/unit/paystack-webhooks.test.ts`; `test/unit/flutterwave-webhooks.test.ts`; T5/T6/T14 tests. | Host, 1 MB limit, no CORS, checkout page, signing and delivery are covered. |
| C4 idempotency | met | `src/twins/paystack/definition.ts:35`; `src/twins/flutterwave/definition.ts:34`; T14 idempotency check. | Both registered twins declare `idempotency: none`; research records no documented key rule for the actions in scope. Stripe is deferred. |
| C4a transaction.initialize | met | `src/twins/paystack/transactions.ts:699`; `T3 transaction-initialize-success`, `-declined`, `-unpaid`, `-invalid-request`; `C4 pays, declines, and abandons through the checkout form`. | Request and response shapes are fixture-backed. |
| C4a transaction.verify | met | `src/twins/paystack/transactions.ts:708`; `T3 transaction-verify-success`, `-failed`, `-abandoned`, `-invalid-request`; integration checkout tests. | Covers success, failed and abandoned states. |
| C4a transaction.fetch | met | `src/twins/paystack/transactions.ts:716`; `T3 transaction-fetch-success`, `-invalid-request`. | Fetch shape is fixture-backed. |
| C4a transaction.list | met | `src/twins/paystack/transactions.ts:724`; `T3 transaction-list-success`, `-lenient-input`; `C4 lists...` integration tests. | List metadata and item shape are fixture-backed. |
| C4a checkout.open | met | `src/twins/paystack/transactions.ts:732`; `test/integration/paystack.test.ts:152`; T8 journey and T10/UI checkout tests. | Opens the local Paystack test checkout. |
| C4a checkout.submit | met | `src/twins/paystack/transactions.ts:740`; `test/integration/paystack.test.ts:152`; T8 journey and T10/UI checkout tests. | Success, declined and abandoned are implemented. |
| C4a refund.create | met | `src/twins/paystack/refunds.ts:448`; `T3 refund-create-success`, `-invalid-request`; `C4 supports partial refunds...`; Kola timeout test. | Partial limits, webhook and lost-reply case are covered. |
| C4a refund.fetch | met | `src/twins/paystack/refunds.ts:457`; `T3 refund-fetch-success`, `-invalid-request`; integration fetch/list tests. | Fixture-backed. |
| C4a refund.list | met | `src/twins/paystack/refunds.ts:465`; `T3 refund-list-success`, `-lenient-input`; integration list tests. | Fixture-backed. |
| C4a transfer_recipient.create | met | `src/twins/paystack/recipients.ts:165`; `T3 transfer-recipient-create-success`, `-invalid-request`; `C4 creates recipients...`. | Authorization-code variant is documentation-only and exercised by integration test. |
| C4a transfer.create | met | `src/twins/paystack/transfers.ts:411`; `test/integration/paystack-transfers.test.ts:179-270`; `docs/limits.md:46-51`. | No successful recorded fixture exists because the recorder account is limited; the action and its failures are tested. |
| C4a transfer.fetch | met | `src/twins/paystack/transfers.ts:428`; `test/integration/paystack-transfers.test.ts:201`, `299-300`; `docs/limits.md:47`. | Documentation-only shape; no successful fixture. |
| C4a transfer.verify | met | `src/twins/paystack/transfers.ts:420`; `test/integration/paystack-transfers.test.ts:223`; `docs/limits.md:48`. | Documentation-only shape; no successful fixture. |
| C4a bank.list | met | `src/twins/paystack/bank.ts:47`; `T3 bank-list-success`, `-lenient-input`, `-invalid-key`; `C4 returns the recorded bank list...`. | 292 banks are covered. |
| C4a bank.resolve | met | `src/twins/paystack/bank.ts:55`; `T3 bank-resolve-success`, `-invalid-request`; integration resolve tests. | Fictional name list is covered. |
| C4a webhooks | met | `src/twins/paystack/webhooks.ts`; `test/unit/paystack-webhooks.test.ts`; `test/integration/paystack.test.ts:213-255`; T5/T14. | Charge success, refund and transfer webhooks are covered; transfer.failed/reversed payloads are documentation-only. |
| C4b payment.create | met | `src/twins/flutterwave/payments.ts:534`; `T3 payment-create-success`, `-for-failed-checkout`, `-unpaid`, `-invalid-request`; `C4 creates a hosted payment link...`. | Fixture-backed. |
| C4b payment.verify | met | `src/twins/flutterwave/payments.ts:543`; `T3 payment-verify-success`, `-invalid-request`; `C4/C10 success...`. | Verify by id is also fetch (D32). |
| C4b payment.verify_by_reference | partly met | `src/twins/flutterwave/payments.ts:551`; `T3 payment-verify-by-reference-success`, `-failed`, `-unpaid`, `-invalid-request`; integration unpaid test. | Covers the documented no-transaction 400. The failed fixture records `app_fee: 285` for 7,500 NGN, while the twin returns the 1.4% formula's 105; T3 compares shape only. See the service-fidelity finding below. |
| C4b payment.list | met | `src/twins/flutterwave/payments.ts:559`; `T3 payment-list-success`, `-lenient-input`; `C4 lists only transactions...`; `docs/limits.md:103`. | The list envelope and empty list are fixture-backed; the non-empty item shape is documentation-only. |
| C4b checkout.open | met | `src/twins/flutterwave/checkout.ts:125`; `test/integration/flutterwave.test.ts:113-173`; T8 journey and T10/UI tests. | Opens the local Flutterwave test checkout. |
| C4b checkout.submit | met | `src/twins/flutterwave/checkout.ts:133`; `test/integration/flutterwave.test.ts:113-173`; T8 journey and T10/UI tests. | Success, failed and cancelled map to v3 results; C21 D36. |
| C4b refund.create | met | `src/twins/flutterwave/refunds.ts:366`; `T3 refund-create-success`, `-invalid-request`; `C4 creates a partial refund...`; Kola timeout test. | Partial, duplicate-processing and minimum-limit cases are covered. |
| C4b refund.fetch | met | `src/twins/flutterwave/refunds.ts:375`; `T3 refund-fetch-success`, `-invalid-request`; integration fetch tests. | Fixture-backed. |
| C4b refund.list | met | `src/twins/flutterwave/refunds.ts:383`; `T3 refund-list-success`, `-lenient-input`; integration list tests. | Fixture-backed. |
| C4b transfer.create | partly met | `src/twins/flutterwave/transfers.ts:444`; `test/integration/flutterwave-transfers.test.ts:160-295`; `docs/limits.md:96`. | No successful recorded transfer.create fixture; the twin follows the documented NEW shape. The `fee` value uses a local 0.8% formula, not a documented Flutterwave rule. |
| C4b transfer.fetch | partly met | `src/twins/flutterwave/transfers.ts:453`; `test/integration/flutterwave-transfers.test.ts:182-295`; `T3 transfer-fetch-lenient-input`; `docs/limits.md:97`. | The recorded invalid fetch was HTML; the twin uses the documented JSON error. `fee` has the same local formula. |
| C4b transfer.list | partly met | `src/twins/flutterwave/transfers.ts:461`; `T3 transfer-list-success`, `-invalid-request`; `test/integration/flutterwave-transfers.test.ts:295`. | Non-empty item shape is documentation-only; the recorded list is empty. `fee` has the same local formula. |
| C4b bank.list | met | `src/twins/flutterwave/bank.ts:50`; `T3 bank-list-success`, `-invalid-request`, `-invalid-key`; `C4 lists the recorded NG banks...`. | Fixture-backed. |
| C4b bank.resolve | met | `src/twins/flutterwave/bank.ts:58`; `T3 bank-resolve-success`, `-invalid-request`; integration resolve tests. | Fixture-backed. |
| C4b webhooks | met | `src/twins/flutterwave/webhooks.ts`; `test/unit/flutterwave-webhooks.test.ts`; `test/integration/flutterwave.test.ts:131-207`; T5/T14. | charge.completed and refund payloads covered; full transfer.completed payload is documentation-only. |
| C4c payment_intent.create | not met | `src/twins/registry.ts:50-53`; `src/twins/stripe/live-keys.ts`; C21 D42. | No Stripe twin code exists in 0.1.0. This is the approved 0.2.0 deferral. |
| C4c payment_intent.retrieve | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c payment_intent.confirm | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c payment_intent.cancel | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c payment_intent.list | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c checkout_session.create | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c checkout_session.retrieve | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c checkout_session.list | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c checkout outcomes | not met | `src/twins/registry.ts:50-53`; C21 D42. | No local Stripe checkout page in 0.1.0. |
| C4c refund.create | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c refund.retrieve | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c refund.list | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c event.retrieve | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c event.list | not met | `src/twins/registry.ts:50-53`; C21 D42. | Deferred to 0.2.0. |
| C4c Stripe webhooks | not met | `src/twins/registry.ts:50-53`; C21 D42 (D34 and D37 remain approved for 0.2.0). | Deferred. |
| C4c Stripe-Version handling | not met | `src/twins/registry.ts:50-53`; research/stripe.md; C21 D37. | Deferred. |
| C4c charge.refunded Charge object | not met | `src/twins/registry.ts:50-53`; C21 D34. | Deferred. |
| C5, failure library | met | `src/core/failures/catalog.ts`; `src/twins/paystack/failures.ts`; `src/twins/flutterwave/failures.ts`; `test/unit/failure-library.test.ts`; `test/unit/failures-catalog.test.ts`; `test/unit/failures-rules.test.ts`; `test/integration/paystack.test.ts`; `test/integration/flutterwave.test.ts`; `test/integration/twin-webhook-failures.test.ts`. | All 16 catalog entries exist; the D31 matrix, sources, settings, order, counters, webhook order and checkout override are tested. `authentication-required` remains hidden because only the deferred Stripe twin supports it. |
| C6, scenarios | met | `scenarios/*.json`; `src/core/scenarios/schema.ts`; `src/core/scenarios/loader.ts`; `src/core/scenarios/runner.ts`; `test/unit/scenario-library.test.ts`; `test/unit/failures-scenarios.test.ts`. | The six exact scenarios, validation, defaults, timed steps and lifecycle are covered. |
| C7, webhooks and credentials | met | `src/control/credentials.ts`; `src/core/webhooks/dispatcher.ts`; `src/twins/paystack/retry.ts`; `src/twins/flutterwave/retry.ts`; `test/unit/control-credentials.test.ts`; `test/unit/webhooks-dispatcher.test.ts`; `test/unit/paystack-webhooks.test.ts`; `test/unit/flutterwave-webhooks.test.ts`; T5 tests. | Credential persistence, per-twin URLs, eight statuses, immutable attempts, retry schedules, 4 KB cap, resend and signature methods are covered. |
| C8, control API | partly met | `src/control/app.ts`; `test/integration/control-security.test.ts`; `test/integration/control-routes.test.ts`; `test/integration/control-sse.test.ts`; `test/integration/ui-serving.test.ts`. | Sign-in, token, cookie, Host, Origin, CORS, body limit, routes, SSE and reset scope pass. Two mandatory gaps: `POST /_ibeji/api/v1/auth/launch` is not in the C8 route table, and checkout HTML sends `Referrer-Policy: same-origin` (`src/twins/framework/http-security.ts:55-58`) where C8 requires `no-referrer` for HTML. |
| C9, CLI | met | `src/cli/*`; `test/integration/cli.test.ts`; `test/unit/cli-start.test.ts`; `test/unit/control-session-file.test.ts`; `test/integration/doctor-policy-session.test.ts`. | All commands, help, JSON, exit codes, session-file atomicity, permissions, export scope and doctor checks are covered. The default C12 fix texts contain wrong command names; that is recorded under C12, not as a missing CLI command. |
| C10, web dashboard | met | `ui/src`; `test/ui/*.spec.ts`; `test/integration/ui-serving.test.ts`; `test/unit/ui-tokens.test.ts`; `test/unit/ui-api.test.ts`; `test/integration/checkout-assets.test.ts`. | All seven pages, twin switcher, checkout pages, local fonts, cache rules, keyboard, axe, widths, offline mode, error states and copy actions are covered. |
| C11, MCP server | met | `src/mcp/*`; `test/integration/mcp.test.ts`; `test/unit/mcp-output.test.ts`. | All 13 tools, annotations, schemas, session re-read, stdio discipline, error results, restart and T4 CLI/MCP/control parity are covered. |
| C12, errors and secrets | partly met | `src/core/errors.ts`; `src/control/redact.ts`; `src/shared/live-key-scanner.ts`; `test/unit/core-errors.test.ts`; `test/unit/core-logger.test.ts`; `test/unit/control-redact-export.test.ts`; `test/integration/live-key-removal.test.ts`. | Stable codes, fields, no empty catch, no `any`, no floating promises and live-key redaction pass. Five default fix texts are wrong: `SESSION_STALE` and `SESSION_ALREADY_RUNNING` name a nonexistent `ibeji stop`; `UNAUTHORIZED` says the session token is printed by `ibeji start`; `UNKNOWN_TWIN` names a nonexistent `ibeji twins`; `WEBHOOK_URL_NOT_ALLOWED` names a nonexistent `ibeji webhooks`. |
| C13, safety | met | `test/integration/t7-network.test.ts`; `test/unit/webhooks-address.test.ts`; `test/integration/control-security.test.ts`; `test/integration/live-key-removal.test.ts`; `test/unit/control-session-file.test.ts`; `scripts/check-package.mjs`. | Loopback-only tests, network block, live-key refusal, broadcast and embedded IPv4, local-only doctor, file modes and recorder exclusion pass. |
| C14, configuration | met | `src/core/config.ts`; `test/unit/core-config.test.ts`; `test/integration/cli.test.ts`; `docs/cli.md`. | Strict fields, unknown values, duplicate and clashing ports, secret detection, scenario compatibility and precedence are tested. |
| C15, recorder and fixtures | met | `scripts/record-fixtures.mjs`; `scripts/recorder/*`; `test/unit/recorder-keys.test.ts`; `test/unit/recorder-failures.test.ts`; `test/unit/fixture-privacy.test.ts`; `fixtures/`. | Stripe is refused, shared `sk_test_` prefix asks for service confirmation, wrong/empty answers send nothing, Flutterwave does not ask, fixtures are redacted and T13 passes. |
| C16, repository layout and published files | partly met | `ls scripts`; `package.json:36-43`; `pnpm check:package`; `README.md`; `CHANGELOG.md`; `src/core/placeholder.ts`. | The packed file list matches C16 and the required folders exist. `scripts/publish-release.mjs` is missing; `CHANGELOG.md` is still the 0.0.0 starter rather than a Changesets-generated 0.1.0 changelog; and the dead `src/core/placeholder.ts` module is outside the C16 core list. |
| C17 T1, Unit | met | 779 Vitest tests in 81 files; `test/unit/`. | Every module group has unit tests and the suite passes twice. |
| C17 T2, Property | partly met | `test/unit/failures-engine.test.ts`; `test/unit/flutterwave-money.test.ts`; `test/unit/ui-money.test.ts`; `test/unit/core-redact.test.ts`; `test/unit/core-random.test.ts`. | Fast-check covers the failure engine, money formatting, redaction and randomness. No property test covers form encoding or webhook signatures, both named in T2. |
| C17 T3, Contract | partly met | `test/contract/*`; `test/conformance/paystack-conformance.test.ts`; `test/conformance/flutterwave-conformance.test.ts`; `fixtures/paystack`; `fixtures/flutterwave`. | Recorded fixtures cover the shipped twins and many actions, and the skipped transfer fixtures are not used. No Stripe fixtures exist (deferred); Paystack transfer create/fetch/verify and Flutterwave transfer create/fetch/non-empty list and non-empty payment list shapes are documentation-only. |
| C17 T4, Failure behaviour | partly met | `test/unit/failures-engine.test.ts`; `test/integration/paystack.test.ts`; `test/integration/flutterwave.test.ts`; `test/integration/twin-webhook-failures.test.ts`; `test/integration/mcp.test.ts:798`. | Every failure, its order and the control API path are tested. The required parity test covers CLI, MCP and the control API, but not the UI leg named in C17. |
| C17 T5, Webhooks | met | `test/unit/paystack-webhooks.test.ts`; `test/unit/flutterwave-webhooks.test.ts`; `test/unit/webhooks-dispatcher.test.ts`; `test/integration/twin-webhook-failures.test.ts`; `test/integration/control-routes.test.ts:587`. | Signing, verification, eight statuses, retries, duplicates, delays, ordering, resends, 4 KB cap, redirect refusal and address rules are covered. |
| C17 T6, Security | met | `test/integration/control-security.test.ts`; `test/integration/twin-framework.test.ts`; `test/integration/control-session.test.ts`; `test/unit/webhooks-address.test.ts`; `test/integration/live-key-removal.test.ts`. | Bearer, cookie path, launch codes, Host/Origin, CORS, headers, body limit, live keys, session repair and 127.0.0.1 binding are covered. |
| C17 T7, No outside network | met | `test/setup/t7-network.ts`; `test/integration/t7-network.test.ts`; full `pnpm test`. | The suite runs with proxy variables removed and non-loopback sockets blocked. |
| C17 T8, UI | met | `test/ui/*.spec.ts`; 96 Playwright tests. | All pages, twin switcher, checkout pages, journeys, states, widths and copy actions are covered. |
| C17 T9, Accessibility | met | `test/ui/t9-accessibility.spec.ts`; axe tests; keyboard tests. | Zero serious or critical axe findings and keyboard coverage passed twice. |
| C17 T10, CLI | met | `test/integration/cli.test.ts`; `test/unit/cli-*.test.ts`. | Help, success, JSON, errors, exit codes, no-session and stale-session paths are covered. |
| C17 T11, MCP | met | `test/integration/mcp.test.ts`; `test/unit/mcp-output.test.ts`. | Every tool over stdio and in process, annotations, no-session errors, restart, parity and stdout discipline are covered. |
| C17 T12, Smoke | met | `pnpm test:smoke` run three times. | Packed install, path with space and non-English letter, native scan, both twins, duplicate webhooks, MCP stdout and cleanup passed each time. |
| C17 T13, Fixture privacy | met | `test/unit/fixture-privacy.test.ts`; `fixtures/`. | The test scans bodies, headers, paths and queries and rejects non-fake private values. |
| C17 T14, Twin conformance | met | `test/conformance/paystack-conformance.test.ts`; `test/conformance/flutterwave-conformance.test.ts`; `test/conformance/twin-conformance.test.ts`; `test/integration/twin-framework.test.ts`. | Every registered twin passes the shared suite; Stripe is not registered by C21 D42. |
| C17 T15, Official library compatibility | partly met | `test/compat/flutterwave-official-library.test.ts:102`; `docs/limits.md:65-67`, `110-117`. | The Flutterwave library verifies and refunds a payment, but the hosted payment itself is created with `fetch` because the official library has no `/v3/payments` method. Paystack cannot be pointed at a twin and that is documented. Stripe is deferred. |
| C18, quality gates | met | Gate output below; CI matrix `.github/workflows/ci.yml`. | All gates pass. The audit gate is now part of `check:package`. |
| C19, documentation | partly met | `README.md`; `docs/*.md`; `test/unit/generated-docs.test.ts`; `test/unit/documentation-dashes.test.ts`. | All required docs exist and generated docs match. `README.md:38` says the not-affiliated line for Paystack, Flutterwave and Stripe, but C19 requires the 0.1.0 line to name only Paystack and Flutterwave. |
| C20, branding and legal | met | `research/paystack.md:1`; `research/flutterwave.md:1`; `research/stripe.md:1`; `ui/src/styles.css`; `test/unit/ui-tokens.test.ts`; `test/unit/framework-html.test.ts`. | Trademark lines exist, no service branding or colours are used, checkout pages say they are Ibeji and no real money moves, and no real-story source is used. |
| C21, decisions log | partly met | `SPEC.md` C21; `BUILD-LOG.md:1665`, `1685-1687`, `1967-1969`, `2024-2026`; `src/control/app.ts:445`; `src/twins/framework/types.ts:353`; `src/twins/framework/http-security.ts:55-58`. | D43 to D51 are applied. Three implemented behaviours are still only BUILD-LOG proposals: `POST /auth/launch`, the optional `connectionGuide` field, and checkout `Referrer-Policy: same-origin`. |
| Part E, coding-agent rules | met | `AGENTS.md`; lint/typecheck; test scan. | No `any`, `@ts-ignore`, non-null assertions, empty catches or skipped tests were found. |
| Part F, risks and open questions | partly met | `SPEC.md` Part F; `docs/limits.md`; `docs/safety.md`; `STORIES.md` absent; no `real-story` source. | The risk table is documented. The story-approval question remains open, but no `real-story` source is used, so the code does not depend on an unapproved story. |

## 3a. What the code does that SPEC.md does not describe

1. **`POST /_ibeji/api/v1/auth/launch`** (`src/control/app.ts:445-448`). It creates a fresh launch link for `ibeji open`. C8's route table has no such route; BUILD-LOG calls it a proposed C21 decision at `BUILD-LOG.md:1665` and `1685-1687`.
2. **Optional `connectionGuide` on `GET /twins`** (`src/twins/framework/types.ts:353`; `src/control/app.ts` `twinSummary`; `ui/src/components/ConnectPage.tsx`; `src/mcp/tools.ts:391`). C8 does not name this field. BUILD-LOG records it as an unapproved C21 proposal at `BUILD-LOG.md:1967-1969`.
3. **Checkout `Referrer-Policy: same-origin`** (`src/twins/framework/http-security.ts:55-58`). C8 requires `Referrer-Policy: no-referrer` for HTML. BUILD-LOG records the change as an unapproved C21 proposal at `BUILD-LOG.md:2024-2026`.
4. **`port` on each `GET /twins` entry** (`src/control/app.ts`, `twinSummary`). C8 names the address but not a separate port field.
5. **`launchCode` alias in `POST /auth/exchange`** (`src/control/schemas.ts:16-24`). C8 only says "swaps a launch code"; the alias is compatibility behaviour not described by the spec.
6. **"Replace test keys" in the Home UI** (`ui/src/components/HomePage.tsx:355`; `test/ui/dashboard.spec.ts:145`, `:192`). C7 defines `ibeji keys --rotate`; C10 describes copy buttons, not a UI rotate action.
7. **`data-credential-value` DOM attribute** (`ui/src/components/HomePage.tsx:318`). This is a screenshot-test hook; it is not a user-facing feature in SPEC.md.
8. **Extra scripts not named in C16's layout**: `scripts/check-package.mjs`, `scripts/prepare-ui-fonts.mjs` and `scripts/screenshots.mjs`. `check:package` is required by C18, but the C16 layout names only `record-fixtures.mjs`, `recorder/`, `generate-docs.mjs`, `smoke.mjs` and `publish-release.mjs`.
9. **Dead Phase 1 scaffolding.** `src/core/placeholder.ts` exports `placeholderValue()` and is imported only by `test/unit/placeholder.test.ts`; `ControlClient.placeholder()` in `src/control/client.ts:287-296` is called only by `test/unit/cli-client-output.test.ts`. Neither is used by the product or named in C16.

## 3b. TODO, FIXME, skipped test, ts-ignore, any type, non-null assertion

The full source scan found **none** of the following in `src/`, `ui/`, `scripts/` or `test/`:

- `TODO`, `FIXME`, `XXX` or `HACK`
- `.skip`, `.only` or `.todo` on a test
- `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`
- the `any` type
- a non-null assertion (`value!`) used to silence the type checker

The only `skip` hits are product recorder calls such as `ctx.skip(...)` and `.skipped.json` fixture names. They are recording outcomes, not skipped tests. `noExplicitAny` and `noFloatingPromises` are enabled in `biome.json`, and both `pnpm lint` and `pnpm typecheck` pass.

## 3c. Every catch block

This is a scan of product code in `src/`, `ui/` and `scripts/`. It found 125 catch sites. The 24 catch sites in `test/` are test harness code, not product surfaces; they are not part of C12's user-facing error path.

C12 verdicts use these meanings:

- **C12 yes** means the catch produces or preserves a stable Ibeji error, or a C12 surface renders it.
- **C12 n/a** means the catch is a deliberate parse/cleanup/script/test fallback and does not produce an Ibeji error. A catch marked n/a is not an empty catch.
- **C12 deferred** means the catch rethrows and a caller supplies the C12 error.

| Catch site | Verdict |
|---|---|
| `src/cli/args.ts:55` | C12 deferred: rethrown for the caller to surface. |
| `src/cli/commands.ts:207` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/cli/commands.ts:861` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/cli/commands.ts:871` | C12 deferred: rethrown for the caller to surface. |
| `src/cli/commands.ts:1005` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/cli/doctor.ts:197` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/cli/doctor.ts:268` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:300` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:343` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:364` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:390` | C12 yes: converted to the interface error shape. |
| `src/cli/project.ts:53` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/cli/project.ts:143` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/cli/project.ts:157` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/cli/run.ts:106` | C12 yes: converted to the interface error shape. |
| `src/cli/run.ts:171` | C12 yes: converted to the interface error shape. |
| `src/cli/start.ts:244` | C12 deferred: rethrown for the caller to surface. |
| `src/cli/start.ts:302` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/control/app.ts:78` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/app.ts:107` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/client.ts:88` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/client.ts:127` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/client.ts:293` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/paths.ts:80` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/paths.ts:94` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session-file.ts:68` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/session-file.ts:91` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/control/session-file.ts:126` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session-file.ts:148` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session-file.ts:159` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session.ts:206` | C12 n/a: logged by the core logger; no raw key or request body is logged. |
| `src/control/session.ts:482` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/control/session.ts:488` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/control/session.ts:516` | C12 n/a: logged by the core logger; no raw key or request body is logged. |
| `src/control/session.ts:527` | C12 n/a: logged by the core logger; no raw key or request body is logged. |
| `src/control/session.ts:577` | C12 n/a: logged by the core logger; no raw key or request body is logged. |
| `src/control/session.ts:584` | C12 n/a: logged by the core logger; no raw key or request body is logged. |
| `src/control/session.ts:593` | C12 n/a: logged by the core logger; no raw key or request body is logged. |
| `src/control/sse.ts:47` | C12 n/a: cleanup path; no error is surfaced. |
| `src/core/scenarios/schema.ts:137` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/core/webhooks/address.ts:239` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/core/webhooks/address.ts:307` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/core/webhooks/dispatcher.ts:406` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/core/webhooks/dispatcher.ts:797` | C12 n/a: cleanup path; no error is surfaced. |
| `src/mcp/session.ts:17` | C12 yes: converted to the interface error shape. |
| `src/mcp/tools.ts:64` | C12 yes: converted to the interface error shape. |
| `src/twins/flutterwave/checkout.ts:66` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/payments.ts:49` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/payments.ts:109` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/payments.ts:382` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/payments.ts:408` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/refunds.ts:197` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/refunds.ts:251` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/transfers.ts:291` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/transfers.ts:326` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/webhooks.ts:58` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/webhooks.ts:90` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/framework/conformance.ts:1105` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/framework/contract.ts:187` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/twins/framework/contract.ts:216` | C12 yes: converted to or preserved as a what/why/fix error. |
| `src/twins/framework/live-keys.ts:86` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/framework/server.ts:539` | C12 yes: explicit 404 response for an unknown checkout request. |
| `src/twins/paystack/transactions.ts:38` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/paystack/transactions.ts:65` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/paystack/transactions.ts:82` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/paystack/transactions.ts:561` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/paystack/transactions.ts:587` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/App.tsx:146` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/App.tsx:176` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/App.tsx:271` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/App.tsx:322` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/api/client.ts:200` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/api/client.ts:209` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/api/sse.ts:129` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/api/sse.ts:185` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/components/ConnectPage.tsx:295` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/CopyButton.tsx:44` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/components/DataPage.tsx:212` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/DataPage.tsx:245` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/FailuresPage.tsx:362` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/components/FailuresPage.tsx:381` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/components/FailuresPage.tsx:635` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/FailuresPage.tsx:718` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/HomePage.tsx:84` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/HomePage.tsx:122` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/ScenariosPage.tsx:129` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/ScenariosPage.tsx:225` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/ScenariosPage.tsx:252` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/WebhookUrlEditor.tsx:37` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/WebhooksPage.tsx:87` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `ui/src/components/WebhooksPage.tsx:255` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `ui/src/components/WebhooksPage.tsx:294` | C12 yes: UI error state; ErrorPanel shows what/why/fix. |
| `scripts/check-package.mjs:58` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/check-package.mjs:141` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/check-package.mjs:152` | C12 deferred: rethrown for the caller to surface. |
| `scripts/check-package.mjs:187` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/check-package.mjs:200` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/generate-docs.mjs:287` | C12 deferred: rethrown for the caller to surface. |
| `scripts/generate-docs.mjs:327` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/recorder/cli.mjs:220` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/recorder/paystack.mjs:205` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:594` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/recorder/shared.mjs:608` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `scripts/recorder/shared.mjs:788` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:942` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `scripts/recorder/shared.mjs:1301` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:1324` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:1339` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/screenshots.mjs:39` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/screenshots.mjs:116` | C12 deferred: rethrown for the caller to surface. |
| `scripts/screenshots.mjs:135` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:71` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/smoke.mjs:185` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:282` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:566` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:641` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:692` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:710` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/smoke.mjs:718` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/smoke.mjs:746` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/smoke.mjs:760` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/smoke.mjs:767` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/smoke.mjs:784` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |
| `scripts/smoke.mjs:984` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `scripts/smoke.mjs:992` | C12 n/a: CLI/script report; the user sees the failure, but this is not an Ibeji API error. |

No empty catch block was found.

The 24 catch sites in the test harness are: `test/ui/support/session.ts:56`, `test/unit/core-config.test.ts:27`, `:158`, `:175`, `:191`, `:209`, `test/unit/cli-start.test.ts:280`, `test/unit/ui-api.test.ts:156`, `test/unit/failures-scenarios.test.ts:81`, `:94`, `:128`, `test/unit/failures-rules.test.ts:141`, `:152`, `:169`, `:183`, `:214`, `:230`, `:466`, `:495`, `test/unit/recorder-failures.test.ts:1327`, `test/integration/flutterwave-refunds.test.ts:231`, `test/integration/paystack-refunds.test.ts:189`, `test/integration/control-sse.test.ts:60`, and `test/helpers/control.ts:74`. Each is test harness code that captures an expected failure or cleans up a test resource; none is a product C12 surface.

## 3d. Places a key, token or personal detail could reach a log, error, file or UI

| Surface | What can reach it | Protection and verdict |
|---|---|---|
| `~/.ibeji/session.json` | The full session bearer token. | Mode 600 on macOS/Linux; folder mode 700; read checks repair permissions and refuse another owner (`src/control/session-file.ts`). Expected C9 storage. |
| Dashboard sign-in URL and browser history | The single-use launch code, then the `ibeji_ui` cookie. | The code is 30 bytes, single-use and expires after 2 minutes; it is exchanged at `POST /auth/exchange` and removed from the address bar. The cookie is `HttpOnly`, `SameSite=Strict` and `Path=/_ibeji`. Tokens never appear in logs, events, errors, exports or UI text. |
| `~/.ibeji/credentials.json` | Full fake Ibeji test keys and the Flutterwave webhook hash. | Mode 600; folder 700 (`src/control/credentials.ts`, `src/control/paths.ts`). Expected C7 storage. |
| `ibeji start` output | The launch link and full fake test keys. | Allowed by C12; launch code is single-use and expires. The session bearer token is not printed. |
| `ibeji keys` output | Full fake test keys. | Allowed by C12. |
| MCP `ibeji_get_test_keys` and `ibeji_get_connection_guide` | Full fake test keys. | Allowed by C11/C12; descriptions warn that MCP clients may log results. |
| `GET /twins/:twin/credentials` | Full fake credentials to an authenticated CLI, UI or MCP caller. | C8 specifies the route; it is the source for Home/Connect and the MCP tools and is bearer/cookie protected. C12 lists the pages, not this internal route, as the allowed copy surfaces. |
| Control API error responses | What/why/fix text and service-shaped errors. | `sanitizeError` and the output scanner remove tokens and live keys (`src/control/app.ts:286-298`, `src/control/redact.ts`). |
| Control API state, events, webhooks and export | Customer email, state records, webhook request and response bodies, and event summaries. | `SecretRedactor` removes tokens, credentials and live keys, but it does not mask personal details. Export file is mode 600. This is a real privacy surface if a user sends real customer data. |
| `~/.ibeji/export` and `ibeji export` file | State, deliveries, events, up to 5,000 events, webhook response bodies and emails. | Mode 600; full credentials are fingerprints; tokens and live keys are removed; personal details remain. |
| CLI `events` and `status` output | Event summaries, including customer emails from twin events; status has no emails. | The CLI output scanner removes tokens and live keys, not personal details. |
| MCP `ibeji_list_events` and `ibeji_list_webhooks` | Event summaries, state-adjacent event details and webhook bodies. | The shared scanner removes tokens and live keys, not personal details. |
| UI Live activity, Home activity, Data and Webhooks pages | Customer emails in event summaries, state records and webhook response bodies. | The UI never shows a live key (tests), but it does show ordinary personal data from the app under test. |
| UI Home and Connect pages | Full fake test keys and webhook hash. | Expected C10/C12 copy surfaces. |
| Webhook URL fields and `ibeji doctor` | A user-supplied secret in the URL path or query. | The URL is stored per twin, shown on Home and Webhooks, included in export, and printed in doctor's unreachable message. It is the address the app must receive, not an Ibeji credential, and the credential redactor does not mask it. |
| `ibeji.config.json` | Webhook URLs and any secret-like value. | Zod validates the fields; strings matching a known key/token pattern are refused with `CONFIG_HAS_SECRET`. A user-chosen webhook token that does not match those patterns is still allowed, and the file is meant to be committed. |
| Logger output | Fixed error messages and error codes; no request bodies. | `Logger` writes to stderr and the session logger sanitizes live keys (`src/core/logger.ts`, `src/control/session.ts:242-245`). No token or credential is logged. |
| Recorder console and fixtures | Request paths, queries, redacted bodies, redacted response bodies, key length and fingerprint. | `scripts/recorder/shared.mjs` redacts keys, personal values and headers; live and invalid keys are never printed. Fixtures use fixed fake data and T13 passes. |
| Recorder environment | The real test key from `PAYSTACK_TEST_SECRET_KEY`, `FLUTTERWAVE_TEST_SECRET_KEY` or `STRIPE_TEST_SECRET_KEY`. | Read into memory only; Stripe is refused before reading; errors print length and SHA-256 prefix, never the key. |
| Example app | Environment test keys and in-memory student names. | It rejects live keys and never prints credentials; it is a local example, not part of the package. |
| Screenshots | Credentials visible on Home. | D50 masks every `[data-credential-value]` before capture; OCR found `[credential masked]` five times and no key-like value. |
| Fixtures and docs | Fake keys, fake names, fake emails, test accounts. | T13 fixture privacy test passes; docs use placeholders. No real key or token was found. |

Verdict: no Ibeji credential was found on an untested surface, and the D43-D51 tests pass. The remaining exposures are ordinary customer data in the app under test and user-supplied secrets in webhook URLs, both stored and shown by design. I found no real payment-service key or Ibeji session token in the repository.

## 3e. Dependencies and why they are needed

| Package | Version | Why it is needed |
|---|---|---|
| `@hono/node-server` | 2.1.5 | Runtime adapter that runs Hono on Node. |
| `@modelcontextprotocol/server` | 2.4.0 | Runtime MCP SDK v2 server and stdio transport. |
| `hono` | 4.13.14 | Runtime HTTP server for the control API and twins. |
| `open` | 11.0.4 | Opens the dashboard in the user's browser. |
| `zod` | 4.6.7 | Runtime validation of requests, config and scenarios. |
| `@axe-core/playwright` | 4.14.0 | Accessibility checks in the UI suite. |
| `@biomejs/biome` | 2.6.3 | Lint and format gate. |
| `@changesets/cli` | 3.0.3 | Versioning and changelog workflow. |
| `@fontsource/ibm-plex-mono` | 5.3.0 | Local font files for the UI. |
| `@fontsource/ibm-plex-sans` | 5.3.0 | Local font files for the UI and checkout pages. |
| `@modelcontextprotocol/client` | 2.4.0 | Development MCP client used by T11. It is not in the C1 table and has no C21 entry. |
| `@playwright/test` | 1.64.1 | T8/T9 browser tests. |
| `@types/node` | 22.20.5 | Node type definitions for the lowest supported line. |
| `@types/react` | 19.3.0 | React type definitions. |
| `@types/react-dom` | 19.3.0 | React DOM type definitions. |
| `@vitejs/plugin-react` | 6.1.2 | React support in the Vite build. |
| `@vitest/coverage-v8` | 5.1.0 | Coverage provider and C17 thresholds. |
| `fast-check` | 4.10.2 | Property tests for T2. |
| `flutterwave-node-v3` | 1.4.1 | T15 compatibility test only; dev dependency, not published. It brings the `joi` advisories. |
| `publint` | 0.3.25 | Packed-package correctness in `check:package`. |
| `react` | 19.3.1 | Dashboard UI. |
| `react-dom` | 19.3.1 | Dashboard UI. |
| `tsup` | 9.0.0 | Builds `dist/cli.js`. |
| `typescript` | 7.0.2 | Type checking. |
| `vite` | 8.3.5 | Builds the UI. |
| `vitest` | 5.1.0 | Unit and integration tests. |

`pnpm.onlyBuiltDependencies` approves `esbuild` 0.28.2, a transitive build tool. The BUILD-LOG records the approval as a proposed C21 entry, not an applied one. There is no runtime native add-on in the published package.

## 3f. Specific service or field mentions outside `src/twins/<twin>`

The generic production layers do not contain service-specific request fields:

- `src/core/` uses only generic failure ids such as `transfer-stuck-pending` and generic event/state concepts. It has no Paystack, Flutterwave or Stripe path, header or field name.
- `src/control/` has no service-specific request field. `ibeji_ui` is an Ibeji cookie name, not a payment-service field.
- `src/cli/` and `src/mcp/` contain no service name, path, key prefix or field name. The test `T11 the MCP server uses only the v2 package...` enforces the MCP side, and `T8 no service id...` enforces the UI source.
- `ui/src/` uses generic words such as payment, refund and transfer, and the generic failure id `transfer-stuck-pending`; it does not name a service field or endpoint.

The permitted/expected exceptions are:

- `src/twins/registry.ts:3-6`, `50-63`: the one registry imports the two registered twins and the unreleased Stripe live-key patterns. This is the C3 rule 8 exception.
- `src/twins/stripe/live-keys.ts`: service-specific live-key patterns, required by D43.
- `scripts/recorder/paystack.mjs`, `flutterwave.mjs`, `stripe.mjs`, `scripts/recorder/cli.mjs`: recorder modules are intentionally one per service (C15/C16).
- `examples/school-fees-app/`: the example app, its server, providers and README are intentionally provider-specific.
- `scenarios/*.json`: every scenario has `"twins": ["paystack", "flutterwave"]`. This is scenario data required by C6, not a registry substitute.
- `package.json:17-19`, `55-58`, `83`: package keywords, example-app scripts, and the Flutterwave compatibility devDependency. `CITATION.cff:5,16-18`, `.changeset/version-0-1-0.md:5`, and `pnpm-lock.yaml` also name services. These are metadata, docs or the T15 library, not twin logic.
- `research/`, `fixtures/`, `docs/`, `README.md`, `SPEC.md`, `BUILD-LOG.md`, `SECURITY-REVIEW.md`, `AGENTS.md`, `TWIN-DESIGN.md`, `UI-PLAN.md`: service-specific facts and documentation.
- `test/`: service-specific tests, fixtures and contract/conformance checks.

The development scripts also contain service names and twin ids outside the twin folders:

- `scripts/smoke.mjs` passes `paystack=0` and `flutterwave=0` to `ibeji start`, switches on `twinId === "flutterwave"` to pass the webhook hash, rejects any example-app provider other than paystack or flutterwave, lists banned payment libraries, and prints the Stripe 0.2.0 line at `:905`.
- `scripts/screenshots.mjs` passes the same two fixed `--twin-port` values and waits for `twin-card-paystack` and `twin-card-flutterwave`.
- `scripts/check-package.mjs` names paystack, flutterwave and stripe in its expected keywords and banned-library list.
- `scripts/generate-docs.mjs` names the Paystack and Flutterwave data files it copies.

These scripts are development-only and are not published (the packed list has no `scripts/`). They still mean the "only registry lists twins" rule is true of the product layers but not of the whole repository. This is recorded under C3 and in the P3 list.

## 3g. Documentation-only actions and fixture dates

| Twin | Documentation-only actions or behaviour | Fixture date(s) |
|---|---|---|
| Paystack | `transfer.create`, `transfer.fetch`, `transfer.verify`, the `authorization_code` variant of `transfer_recipient.create`, and the `transfer.failed` and `transfer.reversed` webhook payloads. `docs/limits.md:44-51`. | 30 fixture files, recorded 28 October 2026. README says 28 October 2026. |
| Flutterwave | `transfer.create`, `transfer.fetch` (documented JSON error instead of the recorded HTML), `transfer.list` with non-empty items, non-empty `payment.list` item shape, the full `transfer.completed` payload, the documented `_PMCK` / `_PMCK_ST_F` / `DU_n` transfer timings, duplicate-transfer-reference behaviour, the `callback_url` and `meta[]` per-transfer fields, and the v3 refund webhook event name. `docs/limits.md:94-108`. | 28 fixture files, recorded 28 October 2026. README says 28 October 2026. |
| Stripe | All C4c actions are documentation-only because the twin is 0.2.0. No fixtures have been recorded. `docs/limits.md:156-165`. | None. Research date 28 October 2026. |

Two service-fidelity gaps are not named in `docs/limits.md`. Flutterwave's transfer `fee` is the local formula `Math.floor(amountMinor * 8 / 1000)` in `src/twins/flutterwave/transfers.ts:54-58`, and the failed-transfer message at `:145-149` is a local placeholder. Flutterwave's payment `app_fee` is calculated as 1.4% of the amount in `src/twins/flutterwave/payments.ts:260`; the recorded failed fixture has 285 for 7,500 NGN, not 105 (`fixtures/flutterwave/payment-verify-by-reference-failed.json:26`). The code comments call the transfer values local choices, not Flutterwave facts.

## 4. Gate output

The gates were run in C18 order. The full commands were run locally against `dfb3c4f`.

```text
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 407ms using pnpm v10.34.9
```

```text
$ pnpm typecheck
tsc --noEmit && tsc -p ui/tsconfig.json --noEmit
```

```text
$ pnpm lint
Checked 342 files in 275ms. No fixes applied.
```

```text
$ pnpm build
ESM dist/cli.js 600.90 KB
dist/ui/index.html                   0.61 kB
dist/ui/assets/index-BQTdrcKW.js   317.65 kB
✓ built in 79ms
```

```text
$ pnpm test
Test Files  81 passed (81)
Tests       779 passed (779)
Statements  : 96.19% ( 5479/5696 )
Branches    : 90.33% ( 3111/3444 )
Functions   : 97.18% ( 1245/1281 )
Lines       : 96.22% ( 5356/5566 )

$ pnpm test
Test Files  81 passed (81)
Tests       779 passed (779)
Statements  : 96.19% ( 5479/5696 )
Branches    : 90.36% ( 3112/3444 )
Functions   : 97.18% ( 1245/1281 )
Lines       : 96.22% ( 5356/5566 )
```

The branch count differs by one between the two runs (90.33% and 90.36%). Both pass the 90% floor; this is noted as a coverage-report anomaly, not a gate failure.

```text
$ pnpm test:ui
Running 96 tests using 1 worker
...
96 passed (1.2m)

$ pnpm test:ui
Running 96 tests using 1 worker
...
96 passed (1.1m)
```

```text
$ pnpm check:package
> ibeji@0.0.0 check:package /Users/josephbrendan/Downloads/projects/ibeji
> node scripts/check-package.mjs

Running publint v0.3.25 for ibeji...
Packing files with `pnpm pack`...
Linting...
All good!
PASS: pnpm audit --prod found no advisories.
Packed files:
  CHANGELOG.md
  LICENSE
  README.md
  THIRD-PARTY-NOTICES
  dist/cli.js
  dist/ui/THIRD-PARTY-NOTICES.txt
  dist/ui/assets/fonts/LICENSE-IBM-Plex-Mono.txt
  dist/ui/assets/fonts/LICENSE-IBM-Plex-Sans.txt
  dist/ui/assets/fonts/ibm-plex-mono-latin-400-normal.woff2
  dist/ui/assets/fonts/ibm-plex-mono-latin-ext-400-normal.woff2
  dist/ui/assets/fonts/ibm-plex-sans-latin-400-normal.woff2
  dist/ui/assets/fonts/ibm-plex-sans-latin-600-normal.woff2
  dist/ui/assets/fonts/ibm-plex-sans-latin-ext-400-normal.woff2
  dist/ui/assets/fonts/ibm-plex-sans-latin-ext-600-normal.woff2
  dist/ui/assets/index-BQTdrcKW.js
  dist/ui/assets/index-DqmX7meS.css
  dist/ui/index.html
  package.json
  scenarios/bank-outage.json
  scenarios/checkout-declines.json
  scenarios/kola-case.json
  scenarios/slow-friday.json
  scenarios/stuck-payouts.json
  scenarios/webhook-storm.json
PASS: package fields, publint and the packed file list match SPEC.md C16.
```

```text
$ pnpm test:smoke
> ibeji@0.0.0 test:smoke /Users/josephbrendan/Downloads/projects/ibeji
> node scripts/smoke.mjs

PASS build and pack
Smoke folder: /var/folders/8r/t_yqrf2j1kl3mp_9fy09z35c0000gn/T/ibeji smoke é-qD4IIK/project
PASS fresh temporary folder with a space and a non-English letter
PASS npm init and install the packed file
Audited 18 installed package.json files.
PASS installed tree has no native code or payment libraries
PASS npx ibeji --help
Started twins: paystack, flutterwave
PASS start Ibeji on random free ports
PASS dashboard and its sign-in refusal
PASS payment through paystack
PASS payment through flutterwave
Stripe is version 0.2.0 and is not in this 0.1.0 smoke run.
PASS payments through every registered twin
Saw 2 duplicate deliveries for paystack.
PASS safe app ignores duplicate webhooks
Checked 2 stdout lines from the MCP server.
PASS status and MCP stdout
PASS stop, session cleanup and temporary folder removal
PASS smoke test

$ pnpm test:smoke
> ibeji@0.0.0 test:smoke /Users/josephbrendan/Downloads/projects/ibeji
> node scripts/smoke.mjs

PASS build and pack
Smoke folder: /var/folders/8r/t_yqrf2j1kl3mp_9fy09z35c0000gn/T/ibeji smoke é-s5tV58/project
PASS fresh temporary folder with a space and a non-English letter
PASS npm init and install the packed file
Audited 18 installed package.json files.
PASS installed tree has no native code or payment libraries
PASS npx ibeji --help
Started twins: paystack, flutterwave
PASS start Ibeji on random free ports
PASS dashboard and its sign-in refusal
PASS payment through paystack
PASS payment through flutterwave
Stripe is version 0.2.0 and is not in this 0.1.0 smoke run.
PASS payments through every registered twin
Saw 2 duplicate deliveries for paystack.
PASS safe app ignores duplicate webhooks
Checked 2 stdout lines from the MCP server.
PASS status and MCP stdout
PASS stop, session cleanup and temporary folder removal
PASS smoke test

$ pnpm test:smoke
> ibeji@0.0.0 test:smoke /Users/josephbrendan/Downloads/projects/ibeji
> node scripts/smoke.mjs

PASS build and pack
Smoke folder: /var/folders/8r/t_yqrf2j1kl3mp_9fy09z35c0000gn/T/ibeji smoke é-09nahU/project
PASS fresh temporary folder with a space and a non-English letter
PASS npm init and install the packed file
Audited 18 installed package.json files.
PASS installed tree has no native code or payment libraries
PASS npx ibeji --help
Started twins: paystack, flutterwave
PASS start Ibeji on random free ports
PASS dashboard and its sign-in refusal
PASS payment through paystack
PASS payment through flutterwave
Stripe is version 0.2.0 and is not in this 0.1.0 smoke run.
PASS payments through every registered twin
Saw 2 duplicate deliveries for paystack.
PASS safe app ignores duplicate webhooks
Checked 2 stdout lines from the MCP server.
PASS status and MCP stdout
PASS stop, session cleanup and temporary folder removal
PASS smoke test
```

```text
$ pnpm audit --prod
{"info":0,"low":0,"moderate":0,"high":0,"critical":0}

$ pnpm audit
{"info":0,"low":2,"moderate":3,"high":2,"critical":0}
```

The seven development advisories are the accepted D49 dev-only set. `pnpm check:package` fails on any production advisory and passed.

## 5. Priority-ordered problem list

### First: key/token leak, real-server harm, or a twin making a false service claim

I found **no current P1 issue** in these categories. The D43-D51 tests pass:

- live keys in headers, query values, nested bodies and longer strings are removed on arrival and absent from every tested output surface;
- session and UI tokens are not shown in events, errors, exports, CLI output, MCP output or the UI;
- default webhooks and `ibeji doctor` stay on this computer;
- the recorder is the only real-service client, refuses live keys, refuses Stripe in 0.1.0, and is not published;
- the twins do not contact real payment services, and no twin claims a shipped C4c action it does not have.

The closest remaining issues are two service-fidelity gaps and ordinary personal data retention:

1. **P2 service fidelity: Flutterwave's transfer fee is invented.** `src/twins/flutterwave/transfers.ts:54-58` returns `Math.floor(amountMinor * 8 / 1000)` for `fee`; the code comment says the formula is not documented, and `docs/limits.md` does not list it. A failed-transfer message at `:145-149` is also a local placeholder. An app reading the transfer response can therefore see a value that Flutterwave may not produce.
2. **P2 service fidelity: Flutterwave's failed-payment `app_fee` does not match its fixture.** `src/twins/flutterwave/payments.ts:260` calculates `app_fee` as 1.4% of the amount, so a 7,500 NGN payment gets 105. The recorded failed fixture has `app_fee: 285` for the same amount (`fixtures/flutterwave/payment-verify-by-reference-failed.json:26`). T3 compares shape only, so the mismatch passes. The formula is not named as an assumption in `docs/limits.md`.
3. **P2 privacy: real customer data can be retained and exported.** A customer email sent to Paystack or Flutterwave appears in event summaries (`src/twins/paystack/transactions.ts:545-560`, `src/twins/flutterwave/payments.ts:366-381`), state, webhook bodies, export, CLI events, MCP events and the dashboard. The export is mode 600 and test data is expected, but the product does not mask or warn about real personal data. This is local-only, but it is the highest remaining data-handling risk.

### Second: things that break the spec

1. **P2: checkout pages use `Referrer-Policy: same-origin`, not `no-referrer`.** `src/twins/framework/http-security.ts:55-58` contradicts C8's "HTML responses send ... `Referrer-Policy: no-referrer`". The current workaround is an unapproved BUILD-LOG C21 proposal. It does not send a cross-origin referrer, but it is a spec deviation.
2. **P2: the README not-affiliated line names Stripe.** `README.md:38` says "Paystack, Flutterwave, or Stripe". C19 requires the 0.1.0 line to name only Paystack and Flutterwave. This is an exact-text deviation.
3. **P2: five C12 default fix texts are wrong.** `src/core/errors.ts:48`, `:54`, `:60`, `:90` and `:138` tell users to run the nonexistent commands `ibeji stop`, `ibeji twins` or `ibeji webhooks`, or say the session token is printed by `ibeji start`. C12 requires each fix to tell the reader what to do next.
4. **P2: an unrecorded dev dependency and install-script approval.** `package.json:75` adds `@modelcontextprotocol/client@2.4.0`, which is not in C1's dependency table and has no C21 entry. `package.json:64-67` approves `esbuild`'s install script, but the required C21 entry is still only a BUILD-LOG proposal (`BUILD-LOG.md:360-362`).
5. **P2: C16 is incomplete.** `scripts/publish-release.mjs` is required by the C16 layout but is missing. `CHANGELOG.md` is the 0.0.0 starter, not a Changesets-generated 0.1.0 changelog.
6. **P2: the required T4 parity proof is incomplete.** `test/integration/mcp.test.ts:798` proves CLI, MCP and the control API produce the same rule; C17 T4 also names the UI. The UI tests switch failures on but do not compare the resulting rule across the three surfaces.
7. **P2: T2 is incomplete.** The fast-check properties cover the failure engine, money formatting, redaction and randomness. No property test covers form encoding or webhook signatures, both named in T2.
8. **P2: T3 is incomplete.** The contract suite is strong for the shipped fixtures, but there are no recorded fixtures for the documentation-only transfer actions, no non-empty Flutterwave payment-list shape, and no Stripe fixtures. T3's "every twin response" is therefore not fully proven.
9. **P2: T15 is only partly proven.** The official Flutterwave library verifies and refunds a payment, but the hosted payment is created with `fetch`; the test does not use the library for the payment creation step. `docs/limits.md:114` explains why, but the T15 sentence is not literally met.
10. **P2: the 0.1.0 package is not release-identified.** `package.json:3-5` is still `0.0.0` and `private: true`, and `CHANGELOG.md` is 0.0.0. This is expected before Phase 10 but does not satisfy C16 for a published 0.1.0.
11. **P3: development scripts repeat the twin list.** `scripts/smoke.mjs` and `scripts/screenshots.mjs` hard-code `paystack` and `flutterwave` ids and ports; `scripts/check-package.mjs` and `scripts/generate-docs.mjs` also name services. This is a C3 rule 8 deviation outside the product layers. The scripts are not published, but the "only registry lists twins" rule is not literally true of the repository.
12. **P3: C4c is not met by design.** No Stripe twin exists in 0.1.0. It is correctly deferred by C21 D42; this is not a release defect for 0.1.0, but the C4c rows and T3/T15 remain incomplete.

### Third: everything else

1. **P3: `POST /auth/launch`, `connectionGuide` and checkout `same-origin` are unapproved C21 proposals in code.** They are listed in 3a and are the main reason the C21 row is partly met.
2. **P3: extra implementation files and scripts are outside the C16 layout.** `scripts/check-package.mjs`, `scripts/prepare-ui-fonts.mjs` and `scripts/screenshots.mjs` are needed by the gates or documentation but are not named in C16. `src/core/placeholder.ts` and `ControlClient.placeholder()` are dead Phase 1 scaffolding used only by tests.
3. **P3: coverage counts are not deterministic.** The two `pnpm test` runs reported 90.33% and 90.36% branch coverage with no failing tests. This is a small reporting inconsistency, not a gate failure.
4. **P3: the UI has a "Replace test keys" action not described by C10.** It is useful and protected by a confirmation, but it is extra scope.
5. **P3: `GET /twins` includes a `port` field not named in C8.** It is harmless and useful, but it is extra API surface.
6. **P3: a webhook URL can carry a user secret and is not masked.** The URL is shown on Home/Webhooks, included in export, and printed by `ibeji doctor` when unreachable. This is required by C9/C10/C13 and is not an Ibeji credential, but users should not put secrets in a webhook URL.
7. **P3: the C21 log has an open question about which official libraries can point at a twin.** The current implementation and docs answer it for 0.1.0, but the question remains in the spec.

## Final verdict

For the 0.1.0 security objectives, the key/token and local-network controls are in good shape and the tested security surfaces do not show a live-key or token leak. For strict SPEC compliance, the release should not be treated as fully compliant until the two Flutterwave fee-value gaps, the C8 checkout header conflict, the C19 README line, the C12 fix texts, the missing C1/C16 entries, and the T2/T3/T4/T15 proof gaps are resolved or explicitly approved through C21.

No product code was changed in this review. No test was skipped, weakened, or deleted.
