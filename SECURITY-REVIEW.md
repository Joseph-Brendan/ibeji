# Ibeji security review

Original review: 6 November 2026, commit `3139b33`, version 0.1.0
Remediation update: 6 November 2026, verified at commit `f483f7c`, recorded in commit `5106016`, version 0.1.0
Reviewer: independent review. The original review changed no product code.

## Release recommendation

**Security no longer blocks the 0.1.0 release.** All nine findings from the original review are fixed and have regression tests. The remote-website attacks were already safe and still pass. The Stripe twin remains deferred to 0.2.0 by C21 D42.

## Remediation status

| # | Original finding | Original severity | Status | Evidence |
|---|---|---|---|---|
| 1 | A live key placed in an ordinary request field leaked in full into events, state, webhooks, export, the dashboard and MCP results. Stripe live-key patterns were also missing. | P1, broken | Fixed | C21 D43. `test/integration/live-key-removal.test.ts:51` plants every format in headers, query values and nested bodies and checks every output surface. `test/unit/live-key-scanner.test.ts` covers the scanner. `src/twins/stripe/live-keys.ts` and the registry export provide Stripe patterns. Commit `9ac7ab3`. |
| 2 | The dashboard was mounted at `/`, the launch link was `/?launch=...`, and the UI cookie had `Path=/`, so another loopback port received it. | P2, broken | Fixed | C21 D44. `test/ui/dashboard-cookie.spec.ts` proves the cookie path and that another loopback port receives no cookie. `test/integration/control-security.test.ts:178` checks `Path=/_ibeji`; `test/integration/ui-serving.test.ts` checks the root redirect. Commit `d0ccef2`. |
| 3 | `ibeji doctor` made an unpinned GET to the configured webhook URL and used the config policy instead of the running session policy. | P2, broken | Fixed | C21 D45. `test/integration/doctor-policy-session.test.ts:35` proves HEAD through the checked-address path; `:69` proves the session policy wins. `test/unit/webhooks-dispatcher.test.ts:1118` covers private targets as not contacted. Commit `d0ccef2`. |
| 4 | A session file at mode `644` was used without repair, exposing the bearer token to other local users. | P3, broken | Fixed | C21 D46. `test/unit/control-session-file.test.ts:212` proves repair to `600`; `test/integration/doctor-policy-session.test.ts:156` and `:192` cover doctor and the CLI warning. Commit `d0ccef2`; Windows follow-up `45c73f4`. |
| 5 | Directed broadcast addresses, NAT64 and 6to4 addresses were allowed. | P3, broken | Fixed | C21 D47. `test/unit/webhooks-address.test.ts:124` covers every interface broadcast; the embedded-IPv4 cases cover NAT64, 6to4 and IPv4-mapped addresses. Commit `dfb3c4f`. |
| 6 | The recorder accepted a Paystack test key under the Stripe service name and the reverse because both share `sk_test_`. | P3, risk | Fixed | C21 D48. `test/unit/recorder-keys.test.ts:133` proves Stripe is refused before the environment variable is read; `:175` and `:219` prove the shared-prefix confirmation sends nothing on a wrong or empty answer; `:255` proves Flutterwave does not ask. Commit `dfb3c4f`. |
| 7 | `check:package` did not run `pnpm audit --prod`, and development advisories were not gated. | P3, risk | Fixed | C21 D49. `scripts/check-package.mjs` runs `pnpm audit --prod --json` and fails on any production advisory. The gate prints `PASS: pnpm audit --prod found no advisories.` Commit `dfb3c4f`. |
| 8 | Documentation screenshots showed full fake test credentials. | P3, broken | Fixed | C21 D50. `test/unit/screenshot-script.test.ts` proves masking before capture; `test/ui/screenshot-masking.spec.ts` proves the DOM mask. OCR finds `[credential masked]` five times on Home and no key-like value. Commit `dfb3c4f`. |
| 9 | `docs/safety.md` promised that a live key never appears, but no test held every output surface to that promise. | P3, broken | Fixed | C21 D51. `test/unit/live-key-safety-docs.test.ts` reads the safety page and checks the exact surfaces; `test/integration/live-key-removal.test.ts` plants a live key on every surface. Commit `dfb3c4f`. |

## Checks that remain safe

| Check | Current result | Evidence |
|---|---|---|
| Cross-site reads and changes | A website cannot read Ibeji data or change its state. | `test/integration/control-security.test.ts`; `test/ui/dashboard-cookie.spec.ts` |
| Loopback only | The control server and every twin bind to `127.0.0.1`. | `test/integration/control-security.test.ts` |
| Launch codes | Single-use, two-minute expiry, removed from the address bar. | `test/integration/control-security.test.ts`; `test/ui/dashboard.spec.ts` |
| Webhook signing | Paystack HMAC SHA512 and Flutterwave `verif-hash` remain separate. | `test/unit/paystack-webhooks.test.ts`; `test/unit/flutterwave-webhooks.test.ts` |
| No outside network | The full suite passes under the T7 network block. | `test/integration/t7-network.test.ts` |
| Official payment libraries | No payment library is a runtime dependency. | `pnpm list --prod --depth 0`; `pnpm check:package` |

## Remaining data-handling risks

These are accepted by the decisions and are not key or token leaks:

- **Customer data is kept as sent.** Events, records, webhook bodies, exports and the dashboard show the customer name, email and phone from the app under test. C21 D53 tells people to use fake customer data only.
- **A webhook URL is shown and exported.** A user who puts a secret in the URL can expose it. C21 D53 tells people never to do that.
- **A program already running as the same user can read the session file.** C21 D44 records this as the local threat model.
- **Development advisories remain in the dev tree.** They are accepted by C21 D49; `pnpm audit --prod` is clean.

## Verification

Focused security tests:

```text
$ pnpm exec vitest run test/unit/webhooks-address.test.ts test/unit/control-session-file.test.ts test/unit/recorder-keys.test.ts test/unit/screenshot-script.test.ts test/unit/live-key-safety-docs.test.ts test/integration/live-key-removal.test.ts test/integration/control-security.test.ts test/integration/doctor-policy-session.test.ts --coverage=false
```

The full C18 gate output is recorded in `BUILD-LOG.md` for this task. No security test was skipped, weakened or deleted.
