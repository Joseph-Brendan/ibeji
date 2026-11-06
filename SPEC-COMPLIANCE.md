# Ibeji SPEC compliance review

Date: 6 November 2026
Version reviewed: 0.1.0
Code reviewed after fixes: `5b72a9c`
Spec reviewed: `SPEC.md` v1.6 at `f483f7c`, including C21 D52 to D62
Reviewer: strict outside review. The first pass changed no product code; this update records the fixes made afterward.

## Scope and method

I read `AGENTS.md`, all of `SPEC.md`, all of `BUILD-LOG.md`, and all of `SECURITY-REVIEW.md`. I then inspected the source, tests, scripts, fixtures, docs, package metadata and CI configuration. I ran every C18 gate after each fix group, the UI suite twice per group, the smoke test in every group, and both audit views.

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
| B3, goals | met | `src/twins/registry.ts:50-53`; `test/conformance/twin-conformance.test.ts`; T4 parity test at `test/ui/failures-scenarios.spec.ts` and `test/integration/mcp.test.ts:798`; T8 and T10 suites. | The three failures are proven through the CLI, MCP, UI and control API by the T4 parity test. |
| B4, non-goals | met | `src/twins/registry.ts`; `ui/src`; `docs/limits.md`; `examples/school-fees-app`. | No cloud, other services, browser widgets, user scenarios, accounts or live keys are present. |
| B5, name and packages | met | `package.json:2-5`, `64-98`; `pnpm check:package` output. | Package name, bin, repository and no-exports rule are correct. The package is still `0.0.0` and `private: true`; that release state is recorded under C16, not as a B5 failure. |
| C1, stack and dependency rules | met | `package.json:64-98`; `pnpm list --prod --depth 0`; `biome.json`; `tsconfig.json`; `ui/tsconfig.json`; C21 D56; gate output. | Runtime and development dependencies match. D56 approves `@modelcontextprotocol/client` 2.x for T11 and the prebuilt `esbuild` install script. |
| C2, core concepts | met | `src/twins/registry.ts`; `src/twins/framework/types.ts:336-354`; `src/core/failures/*`; `src/core/scenarios/*`; T1/T14 tests. | Registry, definitions, action ids, sessions, rules, events and fixtures are implemented. |
| C3, architecture | met | `src/control/server.ts:31`; `src/twins/framework/server.ts:400-412` and `771`; `src/core/failures/engine.ts`; `test/unit/twin-list-scripts.test.ts`; `test/integration/t7-network.test.ts`. | Product code has no fixed twin list. D59 makes smoke and screenshot read the twin list from the running session; recorder, docs and banned-library scripts may name services. |
| C4, twin scopes and common rules | partly met | C4a and C4b rows below; C4c rows below; `src/twins/registry.ts:50-53`. | The two 0.1.0 twins are implemented. C4c is deliberately deferred. Documentation-only actions are listed in `docs/limits.md`, and Flutterwave fees are illustrative under D52. |
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
| C4b payment.create | met | `src/twins/flutterwave/payments.ts:612`; `T3 payment-create-success`, `-for-failed-checkout`, `-unpaid`, `-invalid-request`; `C4 creates a hosted payment link...`. | Fixture-backed. Fee fields are illustrative under D52. |
| C4b payment.verify | met | `src/twins/flutterwave/payments.ts:621`; `T3 payment-verify-success`, `-invalid-request`; `C4/C10 success...`. | Verify by id is also fetch (D32). Fees are illustrative under D52. |
| C4b payment.verify_by_reference | met | `src/twins/flutterwave/payments.ts:629`; `T3 payment-verify-by-reference-success`, `-failed`, `-unpaid`, `-invalid-request`; `D52 returns the recorded failed-payment fee and card`. | The failed fixture now returns `app_fee: 285` with card `514301/9965`, and a D52 test checks it. Other amounts keep the documented illustrative formula. |
| C4b payment.list | met | `src/twins/flutterwave/payments.ts:637`; `T3 payment-list-success`, `-lenient-input`; `docs/limits.md:103`. | List envelope and empty list are fixture-backed; the non-empty item shape is documentation-only. Fees are illustrative. |
| C4b checkout.open | met | `src/twins/flutterwave/checkout.ts:125`; `test/integration/flutterwave.test.ts:113-173`; T8 journey and T10/UI tests. | Opens the local Flutterwave test checkout. |
| C4b checkout.submit | met | `src/twins/flutterwave/checkout.ts:133`; `test/integration/flutterwave.test.ts:113-173`; T8 journey and T10/UI tests. | Success, failed and cancelled map to v3 results; C21 D36. |
| C4b refund.create | met | `src/twins/flutterwave/refunds.ts:366`; `T3 refund-create-success`, `-invalid-request`; `C4 creates a partial refund...`; Kola timeout test. | Partial, duplicate-processing and minimum-limit cases are covered. |
| C4b refund.fetch | met | `src/twins/flutterwave/refunds.ts:375`; `T3 refund-fetch-success`, `-invalid-request`; integration fetch tests. | Fixture-backed. |
| C4b refund.list | met | `src/twins/flutterwave/refunds.ts:383`; `T3 refund-list-success`, `-lenient-input`; integration list tests. | Fixture-backed. |
| C4b transfer.create | met | `src/twins/flutterwave/transfers.ts:444`; `test/integration/flutterwave-transfers.test.ts:160-295`; `docs/limits.md:96`. | D60 accepts the documentation-only shape. The transfer `fee` is illustrative under D52 and the failed-transfer message is a labelled placeholder. |
| C4b transfer.fetch | met | `src/twins/flutterwave/transfers.ts:453`; `test/integration/flutterwave-transfers.test.ts:182-295`; `T3 transfer-fetch-lenient-input`; `docs/limits.md:97`. | The recorded invalid fetch was HTML; the twin uses the documented JSON error. The transfer fee is illustrative. |
| C4b transfer.list | met | `src/twins/flutterwave/transfers.ts:461`; `T3 transfer-list-success`, `-invalid-request`; `test/integration/flutterwave-transfers.test.ts:295`. | The recorded list is empty; the non-empty item shape is documentation-only. The transfer fee is illustrative. |
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
| C8, control API | met | `src/control/app.ts`; `test/integration/control-security.test.ts`; `test/integration/control-routes.test.ts`; `test/integration/control-sse.test.ts`; `test/integration/ui-serving.test.ts`. | Sign-in, token, cookie, Host, Origin, CORS, body limit, routes, SSE and reset scope pass. D54 approves same-origin checkout headers; D55 approves `/auth/launch`, `port`, `connectionGuide` and the rotate button, and removes the `launchCode` alias. |
| C9, CLI | met | `src/cli/*`; `test/integration/cli.test.ts`; `test/unit/cli-start.test.ts`; `test/unit/control-session-file.test.ts`; `test/integration/doctor-policy-session.test.ts`; `test/unit/compliance-d61.test.ts`. | All commands, help, JSON, exit codes, session-file atomicity, permissions, export scope and doctor checks are covered. The default fix texts now name real commands. |
| C10, web dashboard | met | `ui/src`; `test/ui/*.spec.ts`; `test/integration/ui-serving.test.ts`; `test/unit/ui-tokens.test.ts`; `test/unit/ui-api.test.ts`; `test/integration/checkout-assets.test.ts`. | All seven pages, twin switcher, checkout pages, local fonts, cache rules, keyboard, axe, widths, offline mode, error states and copy actions are covered. |
| C11, MCP server | met | `src/mcp/*`; `test/integration/mcp.test.ts`; `test/unit/mcp-output.test.ts`. | All 13 tools, annotations, schemas, session re-read, stdio discipline, error results, restart and T4 CLI/MCP/control parity are covered. |
| C12, errors and secrets | met | `src/core/errors.ts`; `src/control/redact.ts`; `src/shared/live-key-scanner.ts`; `test/unit/core-errors.test.ts`; `test/unit/core-logger.test.ts`; `test/unit/control-redact-export.test.ts`; `test/integration/live-key-removal.test.ts`; `test/unit/compliance-d61.test.ts`. | Stable codes, fields, no empty catch, no `any`, no floating promises and live-key redaction pass. D61 corrects the five default fix texts and a test checks every command they name exists. |
| C13, safety | met | `test/integration/t7-network.test.ts`; `test/unit/webhooks-address.test.ts`; `test/integration/control-security.test.ts`; `test/integration/live-key-removal.test.ts`; `test/unit/control-session-file.test.ts`; `scripts/check-package.mjs`. | Loopback-only tests, network block, live-key refusal, broadcast and embedded IPv4, local-only doctor, file modes and recorder exclusion pass. |
| C14, configuration | met | `src/core/config.ts`; `test/unit/core-config.test.ts`; `test/integration/cli.test.ts`; `docs/cli.md`. | Strict fields, unknown values, duplicate and clashing ports, secret detection, scenario compatibility and precedence are tested. |
| C15, recorder and fixtures | met | `scripts/record-fixtures.mjs`; `scripts/recorder/*`; `test/unit/recorder-keys.test.ts`; `test/unit/recorder-failures.test.ts`; `test/unit/fixture-privacy.test.ts`; `fixtures/`. | Stripe is refused, shared `sk_test_` prefix asks for service confirmation, wrong/empty answers send nothing, Flutterwave does not ask, fixtures are redacted and T13 passes. |
| C16, repository layout and published files | met | `ls scripts`; `package.json:36-43`; `pnpm check:package`; `README.md`; `CHANGELOG.md`; C21 D57 and D61. | The packed list matches C16 and the required folders and scripts exist. D57 makes version 0.1.0, `private` removal, `CHANGELOG.md` generation and `publish-release.mjs` Phase 10 work. D61 removes the dead placeholder module. |
| C17 T1, Unit | met | 790 Vitest tests in 84 files; `test/unit/`. | Every module group has unit tests and the suite passes twice. |
| C17 T2, Property | met | `test/unit/failures-engine.test.ts`; `test/unit/flutterwave-money.test.ts`; `test/unit/ui-money.test.ts`; `test/unit/core-redact.test.ts`; `test/unit/webhook-signature-property.test.ts`. | D60 adds 1,000 random sign/verify cases per twin. Paystack rejects every changed body; Flutterwave checks its shared `verif-hash` and canonical JSON, matching v3. Form encoding moves to Stripe 0.2.0. |
| C17 T3, Contract | met | `test/contract/*`; `test/conformance/paystack-conformance.test.ts`; `test/conformance/flutterwave-conformance.test.ts`; `fixtures/paystack`; `fixtures/flutterwave`; `docs/limits.md`. | Recorded fixtures cover the shipped twins; skipped transfer fixtures are not used. D60 accepts the documentation-only actions listed in `docs/limits.md`; Stripe fixtures remain 0.2.0. |
| C17 T4, Failure behaviour | met | `test/unit/failures-engine.test.ts`; `test/integration/paystack.test.ts`; `test/integration/flutterwave.test.ts`; `test/integration/twin-webhook-failures.test.ts`; `test/integration/mcp.test.ts:798`; `test/ui/failures-scenarios.spec.ts`. | Every failure, its order and the control API path are tested. D58 adds the UI leg; the three parity failures produce the same rule through UI, CLI, MCP and control API. |
| C17 T5, Webhooks | met | `test/unit/paystack-webhooks.test.ts`; `test/unit/flutterwave-webhooks.test.ts`; `test/unit/webhooks-dispatcher.test.ts`; `test/integration/twin-webhook-failures.test.ts`; `test/integration/control-routes.test.ts:587`. | Signing, verification, eight statuses, retries, duplicates, delays, ordering, resends, 4 KB cap, redirect refusal and address rules are covered. |
| C17 T6, Security | met | `test/integration/control-security.test.ts`; `test/integration/twin-framework.test.ts`; `test/integration/control-session.test.ts`; `test/unit/webhooks-address.test.ts`; `test/integration/live-key-removal.test.ts`. | Bearer, cookie path, launch codes, Host/Origin, CORS, headers, body limit, live keys, session repair and 127.0.0.1 binding are covered. |
| C17 T7, No outside network | met | `test/setup/t7-network.ts`; `test/integration/t7-network.test.ts`; full `pnpm test`. | The suite runs with proxy variables removed and non-loopback sockets blocked. |
| C17 T8, UI | met | `test/ui/*.spec.ts`; 97 Playwright tests. | Every page, twin switcher, checkout page, journey, state, width and copy action is covered, including the T4 parity leg. |
| C17 T9, Accessibility | met | `test/ui/t9-accessibility.spec.ts`; axe tests; keyboard tests. | Zero serious or critical axe findings and keyboard coverage passed twice. |
| C17 T10, CLI | met | `test/integration/cli.test.ts`; `test/unit/cli-*.test.ts`. | Help, success, JSON, errors, exit codes, no-session and stale-session paths are covered. |
| C17 T11, MCP | met | `test/integration/mcp.test.ts`; `test/unit/mcp-output.test.ts`. | Every tool over stdio and in process, annotations, no-session errors, restart, parity and stdout discipline are covered. |
| C17 T12, Smoke | met | `pnpm test:smoke` run after each fix group. | The packed install, path with a space and non-English letter, native scan, every registered twin, duplicate webhooks, MCP stdout and cleanup pass. D59 reads twins from the session. |
| C17 T13, Fixture privacy | met | `test/unit/fixture-privacy.test.ts`; `fixtures/`. | The test scans bodies, headers, paths and queries and rejects non-fake private values. |
| C17 T14, Twin conformance | met | `test/conformance/paystack-conformance.test.ts`; `test/conformance/flutterwave-conformance.test.ts`; `test/conformance/twin-conformance.test.ts`; `test/integration/twin-framework.test.ts`. | Every registered twin passes the shared suite; Stripe is not registered by C21 D42. |
| C17 T15, Official library compatibility | met | `test/compat/flutterwave-official-library.test.ts:102`; `docs/limits.md` official-library table. | The Flutterwave library performs verify and refund; hosted create uses plain HTTP because the library has no method, exactly as C17 and D60 allow. Paystack cannot be pointed at a twin and Stripe is 0.2.0; both are documented. |
| C18, quality gates | met | Gate output below; CI matrix `.github/workflows/ci.yml`. | All gates pass. The audit gate is now part of `check:package`. |
| C19, documentation | met | `README.md:38`; `docs/*.md`; `test/unit/generated-docs.test.ts`; `test/unit/documentation-dashes.test.ts`; `test/unit/compliance-d52-d62.test.ts`. | The README not-affiliated line names only Paystack and Flutterwave. D53 warns about fake customer data and webhook secrets; D52 labels fees illustrative; the library table is present. |
| C20, branding and legal | met | `research/paystack.md:1`; `research/flutterwave.md:1`; `research/stripe.md:1`; `ui/src/styles.css`; `test/unit/ui-tokens.test.ts`; `test/unit/framework-html.test.ts`. | Trademark lines exist, no service branding or colours are used, checkout pages say they are Ibeji and no real money moves, and no real-story source is used. |
| C21, decisions log | met | `SPEC.md` C21 D1-D62; `src/control/app.ts`; `src/twins/framework/types.ts:353`; `src/twins/framework/http-security.ts:55-58`. | D52 to D62 are approved and implemented: fee labels, customer-data docs, checkout same-origin, API approvals, dependency approvals, Phase 10 deferral, UI parity, twin-list scripts, test wording, fix texts and library limits. |
| Part E, coding-agent rules | met | `AGENTS.md`; lint/typecheck; test scan. | No `any`, `@ts-ignore`, non-null assertions, empty catches or skipped tests were found. |
| Part F, risks and open questions | met | `SPEC.md` Part F; `docs/limits.md`; `docs/safety.md`; `STORIES.md` absent; no `real-story` source. | D62 closes the official-library question. The story-approval question remains open, but no `real-story` source is used, so no code depends on it. |

## 3a. What the code does that SPEC.md does not describe

1. **`data-credential-value` DOM attribute** (`ui/src/components/HomePage.tsx:318`). This is a screenshot-test hook. It is not a user-facing feature in SPEC.md, but it changes no API or visible text.

The launch route, `port`, optional `connectionGuide`, the "Replace test keys" button and checkout `same-origin` were approved by C21 D54 and D55. The `launchCode` alias was removed. The extra scripts are now in C16, and the dead placeholder module and client method were removed by D61.

## 3b. TODO, FIXME, skipped test, ts-ignore, any type, non-null assertion

The full source scan found **none** of the following in `src/`, `ui/`, `scripts/` or `test/`:

- `TODO`, `FIXME`, `XXX` or `HACK`
- `.skip`, `.only` or `.todo` on a test
- `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`
- the `any` type
- a non-null assertion (`value!`) used to silence the type checker

The only `skip` hits are product recorder calls such as `ctx.skip(...)` and `.skipped.json` fixture names. They are recording outcomes, not skipped tests. `noExplicitAny` and `noFloatingPromises` are enabled in `biome.json`, and both `pnpm lint` and `pnpm typecheck` pass.

## 3c. Every catch block

This is a scan of product code in `src/`, `ui/` and `scripts/`. It found 124 catch sites. The 24 catch sites in `test/` are test harness code, not product surfaces; they are not part of C12's user-facing error path.

C12 verdicts use these meanings:

- **C12 yes** means the catch produces or preserves a stable Ibeji error, or a C12 surface renders it.
- **C12 n/a** means the catch is a deliberate parse/cleanup/script/test fallback and does not produce an Ibeji error. A catch marked n/a is not an empty catch.
- **C12 deferred** means the catch rethrows and a caller supplies the C12 error.

| Catch site | Verdict |
|---|---|
| `src/cli/args.ts:55` | C12 deferred: rethrown for the caller to surface. |
| `src/cli/commands.ts:207` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/cli/commands.ts:861` | C12 yes: creates or preserves a what/why/fix error. |
| `src/cli/commands.ts:871` | C12 deferred: rethrown for the caller to surface. |
| `src/cli/commands.ts:1005` | C12 yes: creates or preserves a what/why/fix error. |
| `src/cli/doctor.ts:197` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/cli/doctor.ts:268` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:300` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:343` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:364` | C12 yes: converted to the interface error shape. |
| `src/cli/doctor.ts:390` | C12 yes: converted to the interface error shape. |
| `src/cli/project.ts:53` | C12 yes: creates or preserves a what/why/fix error. |
| `src/cli/project.ts:143` | C12 yes: creates or preserves a what/why/fix error. |
| `src/cli/project.ts:157` | C12 yes: creates or preserves a what/why/fix error. |
| `src/cli/run.ts:106` | C12 yes: converted to the interface error shape. |
| `src/cli/run.ts:171` | C12 yes: converted to the interface error shape. |
| `src/cli/start.ts:244` | C12 deferred: rethrown for the caller to surface. |
| `src/cli/start.ts:302` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/control/app.ts:78` | C12 yes: creates or preserves a what/why/fix error. |
| `src/control/app.ts:107` | C12 yes: creates or preserves a what/why/fix error. |
| `src/control/client.ts:88` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/client.ts:127` | C12 yes: creates or preserves a what/why/fix error. |
| `src/control/paths.ts:80` | C12 yes: creates or preserves a what/why/fix error. |
| `src/control/paths.ts:94` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session-file.ts:68` | C12 yes: creates or preserves a what/why/fix error. |
| `src/control/session-file.ts:91` | C12 yes: creates or preserves a what/why/fix error. |
| `src/control/session-file.ts:126` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session-file.ts:148` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session-file.ts:159` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/control/session.ts:206` | C12 n/a: logged by the core logger; no raw request or key is included. |
| `src/control/session.ts:482` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/control/session.ts:488` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/control/session.ts:516` | C12 n/a: logged by the core logger; no raw request or key is included. |
| `src/control/session.ts:527` | C12 n/a: logged by the core logger; no raw request or key is included. |
| `src/control/session.ts:577` | C12 n/a: logged by the core logger; no raw request or key is included. |
| `src/control/session.ts:584` | C12 n/a: logged by the core logger; no raw request or key is included. |
| `src/control/session.ts:593` | C12 n/a: logged by the core logger; no raw request or key is included. |
| `src/control/sse.ts:47` | C12 n/a: cleanup path; no error is surfaced. |
| `src/core/scenarios/schema.ts:137` | C12 yes: creates or preserves a what/why/fix error. |
| `src/core/webhooks/address.ts:239` | C12 yes: creates or preserves a what/why/fix error. |
| `src/core/webhooks/address.ts:307` | C12 yes: creates or preserves a what/why/fix error. |
| `src/core/webhooks/dispatcher.ts:406` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/core/webhooks/dispatcher.ts:797` | C12 n/a: cleanup path; no error is surfaced. |
| `src/mcp/session.ts:17` | C12 yes: converted to the interface error shape. |
| `src/mcp/tools.ts:64` | C12 yes: converted to the interface error shape. |
| `src/twins/flutterwave/checkout.ts:66` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/payments.ts:49` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/payments.ts:109` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/payments.ts:460` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/payments.ts:486` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/refunds.ts:197` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/refunds.ts:251` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/transfers.ts:291` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/transfers.ts:326` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/flutterwave/webhooks.ts:58` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/flutterwave/webhooks.ts:90` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `src/twins/framework/conformance.ts:1105` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `src/twins/framework/contract.ts:187` | C12 yes: creates or preserves a what/why/fix error. |
| `src/twins/framework/contract.ts:216` | C12 yes: creates or preserves a what/why/fix error. |
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
| `scripts/check-package.mjs:141` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/check-package.mjs:152` | C12 deferred: rethrown for the caller to surface. |
| `scripts/check-package.mjs:187` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/check-package.mjs:200` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/generate-docs.mjs:287` | C12 deferred: rethrown for the caller to surface. |
| `scripts/generate-docs.mjs:327` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/recorder/cli.mjs:220` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/recorder/paystack.mjs:205` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:594` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/recorder/shared.mjs:608` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `scripts/recorder/shared.mjs:788` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:942` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `scripts/recorder/shared.mjs:1301` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:1324` | C12 deferred: rethrown for the caller to surface. |
| `scripts/recorder/shared.mjs:1339` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/screenshots.mjs:39` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/screenshots.mjs:101` | C12 deferred: rethrown for the caller to surface. |
| `scripts/screenshots.mjs:120` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:71` | C12 n/a: safe parse or optional fallback; no error is produced. |
| `scripts/smoke.mjs:185` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:270` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:554` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:629` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:680` | C12 deferred: rethrown for the caller to surface. |
| `scripts/smoke.mjs:698` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/smoke.mjs:706` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/smoke.mjs:734` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/smoke.mjs:748` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/smoke.mjs:755` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/smoke.mjs:772` | C12 n/a: CLI/script report; the user sees the failure text. |
| `scripts/smoke.mjs:971` | C12 n/a: handled locally; no empty catch and no secret is exposed. |
| `scripts/smoke.mjs:979` | C12 n/a: CLI/script report; the user sees the failure text. |


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
| Control API state, events, webhooks and export | Customer email, state records, webhook request and response bodies, and event summaries. | `SecretRedactor` removes tokens, credentials and live keys, but it does not mask personal details. Export file is mode 600. D53 says to use fake customer data only, and `docs/safety.md` and `docs/connect-your-app.md` say so. |
| `~/.ibeji/export` and `ibeji export` file | State, deliveries, events, up to 5,000 events, webhook response bodies and emails. | Mode 600; full credentials are fingerprints; tokens and live keys are removed; personal details remain. |
| CLI `events` and `status` output | Event summaries, including customer emails from twin events; status has no emails. | The CLI output scanner removes tokens and live keys, not personal details. |
| MCP `ibeji_list_events` and `ibeji_list_webhooks` | Event summaries, state-adjacent event details and webhook bodies. | The shared scanner removes tokens and live keys, not personal details. |
| UI Live activity, Home activity, Data and Webhooks pages | Customer emails in event summaries, state records and webhook response bodies. | The UI never shows a live key (tests), but it does show ordinary personal data from the app under test. |
| UI Home and Connect pages | Full fake test keys and webhook hash. | Expected C10/C12 copy surfaces. |
| Webhook URL fields and `ibeji doctor` | A user-supplied secret in the URL path or query. | The URL is stored per twin, shown on Home and Webhooks, included in export, and printed in doctor's unreachable message. It is the address the app must receive, not an Ibeji credential. D53 tells people never to put a secret in a webhook URL. |
| `ibeji.config.json` | Webhook URLs and any secret-like value. | Zod validates the fields; strings matching a known key/token pattern are refused with `CONFIG_HAS_SECRET`. A user-chosen webhook token that does not match those patterns is still allowed, and the file is meant to be committed. |
| Logger output | Fixed error messages and error codes; no request bodies. | `Logger` writes to stderr and the session logger sanitizes live keys (`src/core/logger.ts`, `src/control/session.ts:242-245`). No token or credential is logged. |
| Recorder console and fixtures | Request paths, queries, redacted bodies, redacted response bodies, key length and fingerprint. | `scripts/recorder/shared.mjs` redacts keys, personal values and headers; live and invalid keys are never printed. Fixtures use fixed fake data and T13 passes. |
| Recorder environment | The real test key from `PAYSTACK_TEST_SECRET_KEY`, `FLUTTERWAVE_TEST_SECRET_KEY` or `STRIPE_TEST_SECRET_KEY`. | Read into memory only; Stripe is refused before reading; errors print length and SHA-256 prefix, never the key. |
| Example app | Environment test keys and in-memory student names. | It rejects live keys and never prints credentials; it is a local example, not part of the package. |
| Screenshots | Credentials visible on Home. | D50 masks every `[data-credential-value]` before capture; OCR found `[credential masked]` five times and no key-like value. |
| Fixtures and docs | Fake keys, fake names, fake emails, test accounts. | T13 fixture privacy test passes; docs use placeholders. No real key or token was found. |

Verdict: no Ibeji credential was found on an untested surface, and the D43-D51 tests pass. Customer data is kept as sent and webhook URLs are shown, both accepted by D53 with an explicit warning to use fake data and to keep secrets out of webhook URLs. I found no real payment-service key or Ibeji session token in the repository.

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
| `@modelcontextprotocol/client` | 2.4.0 | Development MCP client used by T11. D56 approves it for T11 only. |
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

`pnpm.onlyBuiltDependencies` approves `esbuild` 0.28.2, a transitive build tool. D56 approves it because tsup uses it and it downloads a prebuilt binary; it compiles nothing. There is no runtime native add-on in the published package.

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

The development scripts contain the following service names:

- `scripts/smoke.mjs` reads `addresses.twins` from the running session, maps each credential role to the example app's environment, and lists banned payment libraries. It no longer passes fixed `--twin-port` values or switches on a service id.
- `scripts/screenshots.mjs` reads `addresses.twins` from the running session and waits for each `twin-card-<id>`.
- `scripts/check-package.mjs` names paystack, flutterwave and stripe in its expected keywords and banned-library list.
- `scripts/generate-docs.mjs` names the Paystack and Flutterwave data files it copies.

D59 allows the recorder, docs generation and banned-library list to name services. The smoke and screenshot scripts now read the twin list from the running session, so a new twin is covered without editing them. The product layers still contain no service-specific twin list.

## 3g. Documentation-only actions and fixture dates

| Twin | Documentation-only actions or behaviour | Fixture date(s) |
|---|---|---|
| Paystack | `transfer.create`, `transfer.fetch`, `transfer.verify`, the `authorization_code` variant of `transfer_recipient.create`, and the `transfer.failed` and `transfer.reversed` webhook payloads. `docs/limits.md:52-63`. | 30 fixture files, recorded 28 October 2026. README says 28 October 2026. |
| Flutterwave | `transfer.create`, `transfer.fetch` (documented JSON error instead of the recorded HTML), `transfer.list` with non-empty items, non-empty `payment.list` item shape, the full `transfer.completed` payload, the documented `_PMCK` / `_PMCK_ST_F` / `DU_n` transfer timings, duplicate-transfer-reference behaviour, the `callback_url` and `meta[]` per-transfer fields, and the v3 refund webhook event name. `docs/limits.md:104-116`. | 28 fixture files, recorded 28 October 2026. README says 28 October 2026. |
| Stripe | All C4c actions are documentation-only because the twin is 0.2.0. No fixtures have been recorded. `docs/limits.md:168-181`. | None. Research date 28 October 2026. |

D52 now labels the fee fields illustrative and `docs/limits.md` says they must not be used to test fee arithmetic. The failed-payment fixture is matched exactly: the twin returns `app_fee: 285` for 7,500 NGN on the failed card, and a regression test checks it. The transfer `fee` formula and the failed-transfer message remain local placeholders, now named in `docs/limits.md`. T3 and T15 accept the documentation-only actions under D60, exactly as listed in `docs/limits.md`.

## 4. Gate output

The gates were run in C18 order after the security group and after the spec-compliance group. The final group is shown here.

```text
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 321ms using pnpm v10.34.9
```

```text
$ pnpm typecheck
tsc --noEmit && tsc -p ui/tsconfig.json --noEmit
```

```text
$ pnpm lint
Checked 344 files in 269ms. No fixes applied.
```

```text
$ pnpm build
ESM dist/cli.js 600.90 KB
dist/ui/index.html                   0.61 kB
dist/ui/assets/index-BQTdrcKW.js   317.65 kB
✓ built in 59ms
```

```text
$ pnpm test
Test Files  84 passed (84)
Tests       790 passed (790)
Statements  : 96.17% ( 5478/5696 )
Branches    : 90.36% ( 3114/3446 )
Functions   : 97.11% ( 1244/1281 )
Lines       : 96.20% ( 5355/5566 )

$ pnpm test
Test Files  84 passed (84)
Tests       790 passed (790)
Statements  : 96.17% ( 5478/5696 )
Branches    : 90.36% ( 3114/3446 )
Functions   : 97.11% ( 1244/1281 )
Lines       : 96.20% ( 5355/5566 )
```

```text
$ pnpm test:ui
Running 97 tests using 1 worker
97 passed (1.1m)

$ pnpm test:ui
Running 97 tests using 1 worker
97 passed (1.2m)
```

```text
$ pnpm check:package
Running publint v0.3.25 for ibeji...
All good!
PASS: pnpm audit --prod found no advisories.
PASS: package fields, publint and the packed file list match SPEC.md C16.
```

```text
$ pnpm test:smoke
PASS build and pack
PASS fresh temporary folder with a space and a non-English letter
PASS npm init and install the packed file
PASS installed tree has no native code or payment libraries
PASS npx ibeji --help
Started twins: paystack, flutterwave
PASS start Ibeji on free ports
PASS dashboard and its sign-in refusal
PASS payment through paystack
PASS payment through flutterwave
PASS payments through every registered twin
PASS safe app ignores duplicate webhooks
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

The seven development advisories are accepted by D49. `check:package` fails on any production advisory.

### Focused fail-before and pass-after runs

```text
D52 before: expected 105 to be 285
D52 after:  Test Files 1 passed (1); Tests 22 passed (22)

D55 before: expected 200 to be 400
D55 after:  Test Files 1 passed (1); Tests 18 passed (18)

D59 before: Test Files 1 failed (1); Tests 2 failed (2)
D59 after:  Test Files 1 passed (1); Tests 2 passed (2)

D61 before: Test Files 1 failed (1); Tests 3 failed (3)
D61 after:  Test Files 2 passed (2); Tests 9 passed (9)

T4 UI parity: 1 passed
T2 signature properties: 2 passed (1,000 cases per twin)
```

T2 and T4 were missing proofs rather than product defects, so their new tests pass on the first run. D52, D55, D59 and D61 failed before their fixes, as shown above.

## 5. Status of the review's problems

Every security finding is fixed. Every spec-compliance finding is either fixed by C21 D52 to D62 or explicitly deferred by an approved decision. No open key, token or real-server issue remains.

### Security findings

| # | Original problem | Current status | Evidence |
|---|---|---|---|
| 1 | Live keys in request fields leaked in full. | Fixed (D43) | `test/integration/live-key-removal.test.ts:51`; `test/unit/live-key-scanner.test.ts`; `src/twins/stripe/live-keys.ts`. |
| 2 | Dashboard and UI cookie were not under `/_ibeji/`. | Fixed (D44) | `test/ui/dashboard-cookie.spec.ts`; `test/integration/control-security.test.ts:178`. |
| 3 | `doctor` made an unpinned GET with the config policy. | Fixed (D45) | `test/integration/doctor-policy-session.test.ts:35`, `:69`; `test/unit/webhooks-dispatcher.test.ts:1118`. |
| 4 | A permissive session file was used without repair. | Fixed (D46) | `test/unit/control-session-file.test.ts:212`; `test/integration/doctor-policy-session.test.ts:156`, `:192`. |
| 5 | Directed broadcast, NAT64 and 6to4 addresses were allowed. | Fixed (D47) | `test/unit/webhooks-address.test.ts:124` and the embedded-IPv4 cases. |
| 6 | The recorder accepted a shared `sk_test_` key under the wrong service. | Fixed (D48) | `test/unit/recorder-keys.test.ts:133`, `:175`, `:219`, `:255`. |
| 7 | `check:package` did not gate production advisories. | Fixed (D49) | `scripts/check-package.mjs`; `pnpm check:package` prints `PASS: pnpm audit --prod found no advisories.` |
| 8 | Screenshots showed fake credentials. | Fixed (D50) | `test/unit/screenshot-script.test.ts`; `test/ui/screenshot-masking.spec.ts`; OCR finds five masks and no key. |
| 9 | The safety page made a promise with no output-surface test. | Fixed (D51) | `test/unit/live-key-safety-docs.test.ts`; `test/integration/live-key-removal.test.ts`. |

### SPEC compliance findings

| # | Original problem | Current status | Evidence |
|---|---|---|---|
| 1 | Flutterwave transfer `fee` was invented. | Fixed (D52) | `docs/limits.md` now labels all fee fields illustrative and the failed-transfer message a placeholder. |
| 2 | Flutterwave failed-payment `app_fee` did not match its fixture. | Fixed (D52) | The twin returns the recorded 285 and failed card; `test/integration/flutterwave.test.ts` D52 test. |
| 3 | Real customer data and webhook URL secrets can be retained. | Accepted and documented (D53) | `docs/safety.md:37-39`; `docs/connect-your-app.md:7`; `test/unit/compliance-d52-d62.test.ts`. |
| 4 | Checkout pages used `same-origin` instead of `no-referrer`. | Fixed by approval (D54) | C8 now documents the checkout exception; existing header tests pass. |
| 5 | Five C12 default fix texts named missing commands or the wrong token source. | Fixed (D61) | `src/core/errors.ts`; `test/unit/compliance-d61.test.ts` checks every named command exists. |
| 6 | README not-affiliated line named Stripe. | Fixed (D61) | `README.md:38`; `test/unit/compliance-d61.test.ts`. |
| 7 | `@modelcontextprotocol/client` and `esbuild` had no C21 entry. | Fixed (D56) | C21 D56; C1 row is met. |
| 8 | C16 release files were missing. | Fixed by deferral (D57) | C21 D57 makes them Phase 10 work; C16 now lists the scripts that exist. |
| 9 | T4 parity omitted the UI. | Fixed (D58) | `test/ui/failures-scenarios.spec.ts` T4 parity test covers UI, CLI, MCP and control API. |
| 10 | T2 had no signature property test. | Fixed (D60) | `test/unit/webhook-signature-property.test.ts` runs 1,000 cases per twin. Form encoding moves to Stripe 0.2.0. |
| 11 | T3 did not cover documentation-only actions. | Fixed by accepted limitation (D60) | `docs/limits.md` lists every action; skipped fixtures are not used. |
| 12 | T15 did not use the library for hosted payment creation. | Fixed by C17 wording and D60 | `docs/limits.md` official-library table; the test uses plain HTTP only where the library has no method. |
| 13 | The package is not release-identified. | Deferred (D57) | Version, `private` removal, CHANGELOG and `publish-release.mjs` are Phase 10 work. |
| 14 | Development scripts repeated the twin list. | Fixed (D59) | Smoke and screenshots read `addresses.twins` from the running session; `test/unit/twin-list-scripts.test.ts`. |
| 15 | C4c Stripe scope is not built. | Deferred (D42) | Not a 0.1.0 defect; the C4c rows remain not met for 0.2.0. |
| 16 | `POST /auth/launch`, `connectionGuide`, `port` and the rotate button were unapproved; `launchCode` alias existed. | Fixed (D55) | C8 approves the API details; `test/integration/control-security.test.ts` rejects the alias. |
| 17 | Extra scripts were outside C16 and dead placeholder code remained. | Fixed (D61) | C16 lists the scripts; `src/core/placeholder.ts` and `ControlClient.placeholder()` are deleted; `test/unit/compliance-d61.test.ts`. |
| 18 | Coverage branch counts varied by one. | Closed | D21 records that both runs pass the floor; the two group-2 runs both report 90.36%. |
| 19 | The official-library question was open. | Closed (D62) | `docs/limits.md` official-library table; C17 T15 wording. |
| 20 | A webhook URL can carry a user secret. | Accepted and documented (D53) | `docs/safety.md:39`; `docs/connect-your-app.md:7`. |

### Residual risks

- **C4c Stripe** is not built in 0.1.0. This is the approved 0.2.0 deferral (D42), not a 0.1.0 regression.
- **Customer data and webhook URL secrets** are kept as sent and shown by design. D53 tells people to use fake customer data and never put a secret in a webhook URL.
- **Local same-user malware** can read the session file. D44 records this as the local threat model.
- **Development advisories** remain accepted under D49; production is clean.

## Final verdict

For version 0.1.0, the security findings are fixed, the spec-compliance findings are fixed or explicitly deferred by C21 D52 to D62, and the full C18 gate suite passes. The only unmet rows are the C4c Stripe actions, which are approved for version 0.2.0. No live key or session token was found in an output surface. No test was skipped or weakened. The placeholder test and the two `ControlClient.placeholder()` assertions were removed with the dead module and method they covered, as D61 requires; no other test changed.

The first review changed no product code. This update records the fixes in commits `5106016` and `5b72a9c`, plus this review-update commit.
