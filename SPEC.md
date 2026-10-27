# Ibeji: Build Specification v1.2

Owner: Joseph Brendan, Dev and Design HQ
Build tool: Antigravity, on a personal Mac
Status: ready to build
Date: 27 October 2026
Change from v1.1: decisions from the Step 1.1 kickoff review are applied throughout and listed in C21 (D1 to D30). The biggest changes: how the dashboard signs in (C8), exact failure settings and the order failures apply in (C5), the webhook address rules (C7, C13), the control API route table (C8), and the split of the "no native code" rule into a runtime rule and a development rule (C1).

This file is the single source of truth for the project. The coding agent reads it before every task. If the code and this file disagree, the agent stops and asks.

---

## Part A. How to use this file

- Save this file as `SPEC.md` in the root of the project folder.
- Every build prompt in the build guide tells the agent to read named sections of this file.
- When a decision changes during the build, it is recorded in section C21 (Decisions log), so this file always matches the code.
- Section numbers such as C5 or T3 are referenced from the prompts. Do not renumber sections.
- Where this file says a fact "comes from research", the agent must not invent it. It waits for the research file.

---

## Part B. The product

### B1. The problem

AI agents now take payments, send refunds, and pay out money through payment services. In Africa that usually means Paystack or Flutterwave. For international customers it often means Stripe. Before an agent does any of that for real, someone must test it.

Today there are two weak options:

1. **Test against the live service.** This risks real money and real customers.
2. **Use the official test mode.** Each service has a test mode, and it is useful. But test modes behave too well. Payments confirm at once, webhooks arrive on time, and transfers rarely get stuck.

A webhook is a message the payment service sends to your app to say "this payment finished" or "this transfer failed".

Real services do not always behave well. Webhooks arrive late or twice. Transfers sit in "pending". Connections drop after the money has already moved. An agent that has only seen test mode has never practised these moments, so it fails in front of customers.

**Scenario.** Musa builds a school-fees agent for a school in Kaduna. In test mode every payment confirms instantly, so his agent marks fees "paid" the moment it starts a payment. In real life, a parent's payment fails ten seconds later, but the student is already marked paid. Musa only finds out when the bursar complains. That is **the gap between test modes and real failures**.

### B2. What Ibeji is

Ibeji is a set of local "twins" of payment services. A twin is a small program that runs on the developer's own computer and answers requests the same way the real service does, for the actions listed in C4: same paths, same request shapes, same responses, same webhooks.

v1 has three twins:

| Twin | Why it is included |
|---|---|
| Paystack | The most used payment service among Nigerian developers |
| Flutterwave | The other major African payment service, used across many African countries |
| Stripe | The main service for international customers and for teams building outside Africa |

The developer points their app or agent at a twin instead of the real service. Then they switch on realistic failures, such as "send this webhook 2 minutes late", and watch how their app copes.

Ibeji has six parts:

| Part | What it is | Main user |
|---|---|---|
| Twins | Local copies of Paystack, Flutterwave, and Stripe | Apps and agents under test |
| Failure library | A named list of realistic failures, each with a plain explanation | Everyone |
| Recorded scenarios | Ready-made stories made of several failures, such as "Slow Friday afternoon" | Everyone |
| CLI | A command-line tool, `ibeji`, to start twins and control failures | Developers |
| Web dashboard (UI) | A browser page that shows what is happening and lets anyone control the twins with buttons | Non-technical builders and vibe coders, and developers too |
| MCP server | Lets an AI coding agent control Ibeji. MCP is the standard way agents use outside tools. | AI coding agents |

The name: Ìbejì is the Yoruba word for twins.

### B3. Goals

1. Each twin matches its real service's responses for every action in C4, checked against recorded real test-mode responses.
2. Every failure in the library can be switched on from the CLI, the UI, and the MCP server, and behaves the same way from all three.
3. A non-technical person can start Ibeji, choose a twin, connect their app, run a test payment, and switch on a failure using only the UI, guided by on-screen help.
4. Twins never touch real money and never contact any real payment service. Only the separate recorder tool, run by hand, ever talks to the real services, and only in test mode.
5. Every error tells the reader what happened, why, and how to fix it.
6. Users install it with one command on Windows, macOS, and Linux. What they install contains no native code and never compiles anything (C1).
7. Adding a fourth twin later needs a new twin folder and one line in the twin registry (`src/twins/registry.ts`). The core, the control API, the CLI, the UI, and the MCP server need no change.

### B4. Non-goals for v1

- No other services yet. NIP bank transfers, M-Pesa, and WhatsApp Business come later, built on the same twin framework.
- No hosted or cloud version. Everything runs on the developer's computer.
- No full copy of any service. Only the actions listed in C4.
- No browser-side payment widgets (for example pop-up checkouts loaded from a service's script). Apps must use the server-side flows in C4. This goes in `docs/limits.md`.
- No apps running in Docker, a virtual machine, or another computer in v1. The twins and checkout pages listen on this computer only.
- No user-written scenario files in v1. Only the built-in scenarios.
- No user accounts or logins in the UI.
- No live or production keys, ever.

### B5. Name and packages

- npm package: `ibeji` (one package that contains all three twins, the CLI, the UI, and the MCP server)
- Command: `ibeji`
- npm organisation to reserve for the future: `ibeji`
- GitHub repository: `ibeji`
- v1 is a command-line tool only. It offers no code for other programs to import, so it publishes no type definitions and has no `exports` field.

**Why one package:** Twiceshy shipped two packages, and publishing them in the wrong order broke installs for several minutes. One package removes that whole class of problem.

---

## Part C. Technical specification

### C1. Stack

**Runtime dependencies.** These are installed on the user's computer. Keep this list short.

| Package | Version rule | Why |
|---|---|---|
| `hono` | 4.x, latest | A small, typed web server for the twins, the control API, and serving the UI |
| `@hono/node-server` | latest | Runs Hono on Node. Always called with `hostname: '127.0.0.1'` (C3). |
| `zod` | 4.x | Checks every request, config file, and scenario file, with clear error messages |
| `@modelcontextprotocol/server` | 2.x | The official MCP SDK, version 2. Never the old `@modelcontextprotocol/sdk` package. |
| `open` | latest | Opens the user's browser on every operating system |

**Development dependencies.** Used only to build and test. Users never install them.

| Package | Version rule | Why |
|---|---|---|
| `typescript` | Latest stable. If any tool in this table fails with it, pin the latest 6.x and record why in C21. | Type checking |
| `@types/node` | Latest 22.x | Matches the lowest supported Node line |
| `react`, `react-dom`, `@types/react`, `@types/react-dom` | Latest stable | The UI, built into plain files at build time |
| `vite`, `@vitejs/plugin-react` | Latest stable, matching each other | Builds the UI |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | Latest stable | Font files, copied into the built UI. Open Font Licence, noted in THIRD-PARTY-NOTICES. |
| `vitest`, `@vitest/coverage-v8` | Latest stable, matching each other | Unit and integration tests, and coverage |
| `fast-check` | Latest stable | Property tests |
| `@playwright/test`, `@axe-core/playwright` | Latest stable | Browser tests and accessibility checks |
| `tsup` | Latest stable | Builds the CLI and server code. Type definition output is off (B5). |
| `@biomejs/biome` | Latest stable | Lint and format |
| `@changesets/cli` | Latest stable | Versions and changelogs |
| `publint` | Latest stable | Checks the package is publishable |

Adding any package not in these two tables needs Joseph's approval and a C21 entry.

| Tool | Rule |
|---|---|
| Node.js | `engines`: `^22.18.0 \|\| >=24.11.0`. Develop on 24. CI runs the latest 22 and the latest 24. |
| pnpm | 10.x, pinned in `packageManager` in package.json. |

**Hard rule: nothing native for users.** The runtime dependency tree must contain no `.node` files, no `binding.gyp`, and no install scripts. A test in the smoke suite (T12) proves this on the installed package.

**Hard rule: nothing compiles for developers.** Development tools may use prebuilt platform binaries (Vite, esbuild, Biome, and Playwright do), but nothing may compile from source. No `node-gyp`. Any package that needs an install script to run must be listed by name in `pnpm.onlyBuiltDependencies` in package.json, with a C21 entry saying why. Twiceshy lost days to a dependency that compiled on Windows.

**Hard rule: no payment-service libraries inside Ibeji.** Ibeji does not depend on the official Paystack, Flutterwave, or Stripe libraries. Twins are built from the documentation and fixtures. The example app and the T15 tests may use the official libraries as development dependencies, as a user's app would, to prove the twins work with them.

**Hard rule: read before writing.** Before using any library, the agent reads the installed package's README and type definitions. It never writes library code from memory, because versions change.

### C2. Core concepts

| Term | Meaning |
|---|---|
| Twin | A local imitation of one real service. v1 has three: `paystack`, `flutterwave`, `stripe`. |
| Twin registry | `src/twins/registry.ts`: the one list of twin definitions. Everything else asks the registry, or the control API, which twins exist. No other code lists twin ids. |
| Twin definition | The single object each twin provides to the core: its id, display name, default port, actions, supported failures, credential rules, live-key detection, request parser, response and error builders, webhook signer, retry schedule, event summaries, checkout outcomes, and currency rules. See C3. |
| Action | One thing a twin can do. Its local id is `<resource>.<verb>`, such as `refund.create`. Its full id is `<twin>.<resource>.<verb>`, such as `paystack.refund.create`. |
| Action selector | How a person chooses actions: a resource (`refund`, meaning every refund action), a local id (`refund.create`), or a full id. Several can be given, separated by commas. |
| Session | One run of Ibeji, from `ibeji start` until it stops. All state lives in the session. Only one session runs per user at a time. |
| Twin state | The payments, refunds, recipients, transfers, and other records created during the session, kept separately for each twin. |
| Failure | A named misbehaviour, such as `webhook-delayed`, with settings. Failure ids are stable and never renamed after release. |
| Rule | A failure switched on for some twins and actions, with settings. For example "delay Flutterwave refund webhooks by 90 seconds". |
| Scenario | A built-in, named set of rules, sometimes changing over time. |
| Event | Anything that happened: a request arrived, a response was sent, a webhook attempt was made, a failure fired. Each event has a scope: a twin id, or `ibeji` for events not about one twin, such as a session starting. |
| Control API | The local HTTP interface the CLI, UI, and MCP server all use to control Ibeji. |
| Fixture | A recorded real response from a service's test mode, used to check its twin. |
| Credentials | The fake test keys, and any webhook verification value, that Ibeji issues for each twin, in the format that service's apps expect (C7). |
| Launch code | A single-use code in the dashboard link that lets the browser sign in to the session (C8). |

### C3. Architecture

```
                 your app or agent
        │ Paystack-style   │ Flutterwave-style   │ Stripe-style
        ▼                  ▼                     ▼
  ┌───────────┐     ┌──────────────┐     ┌────────────┐
  │ Paystack  │     │ Flutterwave  │     │ Stripe     │
  │ twin 4401 │     │ twin 4402    │     │ twin 4403  │──▶ webhooks to
  └─────┬─────┘     └──────┬───────┘     └─────┬──────┘    your app
        └──────────────────┼───────────────────┘
                           │ uses the twin framework
              ┌────────────▼─────────────┐
              │ Ibeji core               │
              │ state · failure engine · │
              │ webhook dispatcher ·     │
              │ events · scenarios       │
              └────────────▲─────────────┘
                           │
              ┌────────────┴─────────────┐
              │ Control API + UI  4400   │
              └───▲──────────▲───────▲───┘
                  │          │       │
                 CLI    browser UI   MCP server (stdio)
```

Rules:

1. **One core.** All shared behaviour lives in the core: state, the failure engine, webhook delivery, events, and scenarios. The CLI, UI, and MCP server never contain twin logic. They only call the control API.
2. **One twin framework, with room for differences.** Every twin is built as a twin definition the core understands. The core never contains code for a specific service. The services differ in request format (JSON or form encoding), errors, keys, signing, idempotency, and checkout outcomes, so each twin owns its request parser, response and error builders, signer, and checkout outcomes. The core only orchestrates. A shared conformance suite (T14) runs against every twin.
3. **Ports are defaults.** Control API and UI default to 4400. Paystack 4401, Flutterwave 4402, Stripe 4403. All can be changed. Tests use port 0, which lets the system pick a free port. The port a server actually bound to is the truth: it is used in the session file, links, checkout URLs, Host checks, and status output. All ports are checked before any server starts, so a clash never leaves a half-started session.
4. **Localhost only.** Every server is started with `hostname: '127.0.0.1'` and a test checks the bound address. (`@hono/node-server` binds to all addresses if no hostname is given.) Links always use `127.0.0.1`, never `localhost`, because `localhost` can resolve to the IPv6 address `::1`, which is not listening.
5. **Pure failure engine.** The function that decides what a failure does is pure: no clock, network, or file access inside it. It returns a plan. The core applies the plan with the injected clock, and the twin turns any error in the plan into its service's own error shape.
6. **Injectable clock and seeded randomness.** The seed is a whole number from 0 to 4294967295. If none is given, Ibeji picks one and prints it at start, so any run can be repeated. The seed covers every random choice: failure percentages, delay jitter, and scenario steps.
7. **Facts stay separate.** A fact about one service never applies to another unless its own documentation or fixtures confirm it. Each twin's facts live in its own file in `research/`.
8. **No hard-coded twin lists.** Generic code never uses a fixed list or union of twin ids, such as `z.enum(['paystack','flutterwave','stripe'])`. Twin ids are strings checked against the registry at runtime.

### C4. Twin scopes (v1)

The exact paths, field names, request formats, and response shapes for each twin come from that service's official documentation and recorded fixtures, written into `research/<twin>.md` during Phase 2. The action lists below are the target scope. Phase 2 checks each action against the documentation. If this section and the documentation disagree, the documentation wins and the difference is recorded in C21.

**Rules for all twins:**

- Money is handled as whole numbers in the unit each service uses. Each service's rules, including currencies with no minor unit, are recorded in its research file and followed exactly.
- Each twin accepts only the test credentials Ibeji issued for it (C7). A missing key, a wrong key, or a key in another format gets that service's own 401 error shape.
- Each twin detects its service's live key formats (all of them, including restricted keys where the service has them), refuses the request with the service's error shape, and records a warning event. The UI shows a red banner: "A live key was sent to the [Service] twin. Live keys must never be used with Ibeji. Remove it from your app's test settings." Neither the event nor the banner contains any part of the key, only a fingerprint (C12).
- Each twin checks the Host header of every request (C8 rule 4), limits request bodies to 1 MB, and sends no CORS headers. Apps call twins from their server, not from a browser.
- Each twin serves its own test checkout page on its own port (C10).
- Each twin sends its service's webhook events, signed or marked the way that service does.
- Each twin honours its service's idempotency rules where the service documents them. For example, Stripe documents an `Idempotency-Key` header, so the Stripe twin must return the original result for a repeated key exactly as Stripe does, and must never repeat the action. Where a service documents nothing, the twin does nothing special and the research file says so.

#### C4a. Paystack twin

| Area | Actions |
|---|---|
| Transactions | Initialize; verify; fetch one; list |
| Checkout | Local test checkout page where the tester picks success, declined, or abandoned |
| Refunds | Create; fetch one; list |
| Transfers | Create a transfer recipient; initiate a transfer; fetch and verify a transfer |
| Banks | List banks; resolve an account number to an account name |
| Webhooks | The events Paystack sends for the above |

#### C4b. Flutterwave twin

The research step (Phase 2) decides which Flutterwave API version to imitate: a version that Flutterwave's current documentation describes and its official Node library uses. The evidence, the date, and the decision go into `research/flutterwave.md` and C21, and are approved before Phase 3.

| Area | Actions |
|---|---|
| Payments | Create a hosted payment (the checkout link flow); verify a transaction by id and by reference; fetch; list |
| Checkout | Local test checkout page where the tester picks success, failed, or cancelled |
| Refunds | Refund a transaction; fetch and list refunds |
| Transfers | Initiate a transfer; fetch a transfer; list transfers |
| Banks | List banks for a country; resolve an account number |
| Webhooks | The events Flutterwave sends for the above, with its documented verification method |

#### C4c. Stripe twin

Stripe's requests are form-encoded rather than JSON, with nested fields written as `metadata[key]` and arrays as `items[0]`. Its errors have their own shape, and it supports idempotency keys and API version headers. The twin follows all of these exactly as recorded in `research/stripe.md`. Research decides which Stripe API version the twin imitates and what it does with a different `Stripe-Version` header, and records both in C21.

| Area | Actions |
|---|---|
| PaymentIntents | Create; retrieve; confirm; cancel; list |
| Checkout Sessions | Create (returns a link to the test checkout); retrieve; list |
| Checkout | Local test checkout page where the tester picks success, card declined, or requires extra authentication (then approve or fail), using Stripe's documented test outcomes as the guide |
| Refunds | Create; retrieve; list |
| Events | Retrieve and list events, since some apps poll Stripe's events instead of relying on webhooks |
| Webhooks | The events Stripe sends for the above, with Stripe's documented signature method |

Stripe payouts and Stripe Connect transfers are not in v1. They are listed in `docs/limits.md`.

### C5. The failure library

Each failure has: a stable id, a plain-English name, a "when this happens in real life" paragraph, a "what to check in your app" paragraph, a settings schema, the twins and actions it can apply to, and a `source` for each twin (`docs`, `real-story`, or `assumed`).

**Which twins a failure applies to.** Each twin definition declares the failures it supports, based on its research. The table below is the v1 target, not a confirmed fact. After Phase 2, any change to it is approved in C21. A failure with `source: assumed` is still offered, but the UI, CLI help, and docs label it "Assumed: not confirmed by the service's documentation."

**Settings every rule has:** `twins` (default: every running twin that supports the failure), `actions` (an action selector, default: every action the failure applies to on that twin).

| Id | Name | What the twin does | Settings (default) | Twins |
|---|---|---|---|---|
| `slow-response` | Slow response | Waits before sending whatever response it was going to send | `seconds` 1 to 120 (5) | All |
| `timeout-after-commit` | Success, but the reply is lost | Performs the action, then gives no reply | `mode`: `hang` (keep the connection open for up to 120 seconds, then close it) or `reset` (drop the connection at once) (`hang`) | All |
| `timeout-before-commit` | Failure, and the reply is lost | Does not perform the action, then gives no reply | `mode` as above (`hang`) | All |
| `server-error` | Server error | Responds with a 5xx error in the service's own shape | `times` 1 to 10000, or empty for "every time while on" (3); `status` from the twin's research (500) | All |
| `rate-limited` | Too many requests | Responds 429 in the service's own shape | `times` as above (3) | All |
| `flaky-network` | Unreliable network | Drops a share of connections, chosen with the seeded random generator | `percent` 1 to 100 (20); `when`: `before` or `after` the action is performed (`before`) | All |
| `webhook-delayed` | Late webhook | Holds back the first delivery attempt | `seconds` 1 to 3600 (60); `jitterSeconds` 0 to 3600, a random extra delay (0) | All |
| `webhook-duplicated` | Duplicate webhook | Sends extra copies of the same webhook, with the same event id and body | `copies` 2 to 5 (2); `gapSeconds` 0 to 300 (5) | All |
| `webhook-out-of-order` | Webhooks in the wrong order | Holds a twin's webhooks for a window, then sends them newest first | `windowSeconds` 1 to 300 (15) | All |
| `webhook-never-sent` | Missing webhook | Records the webhook but never sends it | `percent` 1 to 100 (100) | All |
| `webhook-verification-fails` | Forged webhook | Sends a webhook that fails the service's verification method, to test that the app rejects it | `method`: one of the methods the twin declares, such as `wrong-secret`, `corrupted`, or `missing` (`wrong-secret`) | All |
| `payment-declined` | Declined payment | Payments end as declined, in the service's own way | `percent` 1 to 100 (100) | All |
| `authentication-required` | Extra check needed | Payments need an extra authentication step before they finish | `then`: `succeed` or `fail` (`fail`) | Stripe (research confirms) |
| `transfer-stuck-pending` | Stuck transfer | Leaves transfers pending | `seconds` 1 to 86400, or empty for "until switched off" (empty) | Paystack, Flutterwave |
| `transfer-reversed` | Reversed transfer | Later marks a successful transfer as reversed or failed, as the service does, and sends the matching webhook | `afterSeconds` 1 to 86400 (60); `percent` 1 to 100 (100) | Paystack, Flutterwave |
| `bank-resolve-fails` | Account lookup fails | Account-name lookup fails | `mode`: `error` or `timeout` (`error`) | Paystack, Flutterwave |

A counter (`times`) belongs to one rule on one twin, and counts across all actions the rule covers. When it runs out, the rule stays listed but shows "used up" and stops firing.

**Order of application for a request.** At most one of steps 1 to 4 fires, the first in this order. Within one step, the most recently added rule wins.

1. `flaky-network` with `when: before`: the connection drops. The action is not performed.
2. `rate-limited`
3. `server-error`
4. `timeout-before-commit`
5. The action is performed. `payment-declined`, `authentication-required`, `transfer-stuck-pending`, `transfer-reversed`, and `bank-resolve-fails` shape the result here.
6. `timeout-after-commit`: the action stays performed, and no reply is sent.
7. `flaky-network` with `when: after`: the action stays performed, and the connection drops.
8. `slow-response`: if a response is still being sent, it is delayed.

A repeated request with the same idempotency key (where the twin supports one) never performs the action twice, whatever failures are on.

**Order of application for a webhook.**

1. `webhook-never-sent` decides first. If it fires, the webhook is recorded as `not-sent` and nothing else applies.
2. `webhook-verification-fails` changes how it is signed.
3. `webhook-out-of-order` places it in the hold window.
4. `webhook-delayed` delays its first attempt.
5. `webhook-duplicated` adds copies. Each copy follows steps 2 to 4 as well.

Delays apply to first attempts only. Retries after a failed attempt follow the twin's retry schedule (C7).

**Checkout pages and failures.** When a failure that shapes payments is on (`payment-declined`, `authentication-required`), it overrides the tester's button choice. The page then says so in plain words, for example "An Ibeji failure rule changed this result: Declined payment is on for this twin."

The agent may add a failure only when this spec is updated first (C21). Failure ids are never removed or renamed. Support for a failure on one twin may be added or removed only through C21.

### C6. Scenarios

A scenario is a built-in JSON file in `scenarios/` with: an id, a name, a plain-English story, the twins it supports, the rules it switches on with exact settings, and optional timed steps (for example, "after 120 seconds, remove rule 1"). Scenario files are validated with Zod when loaded. A bad file produces a clear error naming the file and the field.

When a person runs a scenario, they choose which of its supported twins it applies to. The default is every supported twin that is running. Naming a twin that is not running gives `TWIN_NOT_RUNNING`. Naming a twin the scenario does not support gives `FAILURE_NOT_SUPPORTED_BY_TWIN`.

v1 ships with these scenarios and these exact settings:

| Id | Story | Rules | Twins |
|---|---|---|---|
| `kola-case` | Refunds succeed, but the reply is lost. Tests whether the app refunds twice. | `timeout-after-commit` on `refund.create`, `mode: hang` | All |
| `slow-friday` | Everything is slow, and webhooks arrive 1 to 3 minutes late. | `slow-response` 8 seconds on all actions; `webhook-delayed` 60 seconds with `jitterSeconds` 120 | All |
| `bank-outage` | Transfers fail with server errors for 2 minutes, then recover. | `server-error` every time on `transfer`; after 120 seconds, removed | Paystack, Flutterwave |
| `webhook-storm` | Every webhook arrives twice, some out of order. | `webhook-duplicated` 2 copies, 3 seconds apart; `webhook-out-of-order` 15-second window | All |
| `stuck-payouts` | Transfers stay pending for 10 minutes, then half are reversed. | `transfer-stuck-pending` 600 seconds; `transfer-reversed` 50 percent, `afterSeconds` 600 | Paystack, Flutterwave |
| `checkout-declines` | Half of all checkout payments are declined. Tests how the app tells the customer and lets them try again. | `payment-declined` 50 percent | All |

**Lifecycle.** One scenario runs at a time. Starting a scenario stops the running one; the UI asks for confirmation first. A scenario owns the rules it adds, and they are marked with its id. Clearing failures (`ibeji clear`) removes every rule, including a scenario's, and stops the scenario. Resetting state does not touch rules or scenarios. If a twin stops, the scenario's rules for that twin are removed and an event says so.

### C7. Webhooks and credentials

**Credentials.** Ibeji creates fake test credentials for each twin the first time it starts, and stores them in `~/.ibeji/credentials.json`, readable only by the user. They stay the same across sessions, so a person sets up their app once. `ibeji keys --rotate [twin]` replaces them. Each twin declares which credentials its service uses, from research: for example a secret key, a public key, and a webhook verification value. Where a service verifies webhooks with the secret key itself, the twin does not invent a separate webhook secret. Every credential is clearly marked as an Ibeji key (for example by containing `ibeji`), in the service's test format.

**Delivery.**

- The tester sets a webhook URL for each twin, in the UI, the CLI, or the config file. Each twin's webhooks go only to its own URL.
- Each twin signs or marks its webhooks exactly as its service does. The method is confirmed from the documentation in Phase 2, recorded in that twin's research file, and tested against a known-good example.
- Each webhook is one delivery, made of one or more attempts. Every attempt is recorded and never changed afterwards.
- Delivery statuses: `queued`, `scheduled` (waiting for a delay or a retry), `sending`, `delivered` (the app answered 2xx), `failed` (the app answered with another status), `unreachable` (no connection, or no answer within 10 seconds), `not-sent` (no URL was set, or `webhook-never-sent` fired; the reason is recorded), and `abandoned` (the session stopped first).
- Failed and unreachable attempts are retried on each service's documented schedule. Where a schedule is not documented, the twin uses: 5 retries after 1, 5, 15, 30, and 60 minutes, each with up to 10 percent seeded jitter, marked `assumed` in its research file.
- A person can resend any webhook. A resend goes to the twin's current URL, is signed with the current credentials, has the same body, and is a new delivery linked to the original.
- Ibeji keeps at most the first 4 KB of each response from the app, with any authorization or signature headers removed.

**Where webhooks may go.** The address rules are in C13 rule 5.

### C8. Control API

A small HTTP API on the control port (default 4400), under `/_ibeji/api/v1/`. It is the only way to change rules, scenarios, webhook URLs, credentials, and sessions. Twin records change through each twin's own API and checkout page, as with the real services.

**Signing in.**

1. Each session creates a random session token of 32 bytes from a secure random source.
2. The CLI and MCP server read the token from the session file and send it as `Authorization: Bearer <token>`.
3. The browser never sees the token. `ibeji start` (and `ibeji open`) opens `http://127.0.0.1:<port>/?launch=<code>`. The launch code is single-use and expires after 2 minutes. The page sends it to `POST /_ibeji/api/v1/auth/exchange`. The server answers by setting a cookie, `ibeji_ui`, that is `HttpOnly` and `SameSite=Strict`, and holds a separate random UI token tied to this session. The page then removes the code from the address bar. Reloading or opening a second tab keeps working through the cookie. When the session ends, the cookie stops working, and the UI says: "Ibeji was restarted. Run `ibeji open` to get a new link."
4. A request is accepted if it carries a valid bearer token, or a valid `ibeji_ui` cookie. Requests that change something (POST, PUT, DELETE) using the cookie must also carry the header `X-Ibeji-Request: 1` and an `Origin` header equal to the control server's own origin. A cross-site page cannot add that header without the browser first asking permission, and the server never gives it.
5. Tokens are compared in constant time. The token, UI token, and launch codes never appear in logs, events, errors, exports, or the UI.

**Other protections, on the control server, every twin server, and every checkout page:**

1. The `Host` header must be exactly `127.0.0.1:<bound port>` or `localhost:<bound port>`, compared without case and without a trailing dot. Anything else gets `FORBIDDEN_HOST`. This blocks DNS rebinding, an attack where a malicious website pretends to be on your computer.
2. No CORS headers at all. CORS is the browser rule that decides whether one website may read another's responses.
3. HTML responses send `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'` and `Referrer-Policy: no-referrer`, so no other website can frame the page or learn its address.
4. Request bodies are limited to 1 MB (`BODY_TOO_LARGE`).

**Routes.** All under `/_ibeji/api/v1`. Every body is validated with Zod. Every error uses the JSON error shape in C12.

| Method and path | Purpose |
|---|---|
| `GET /health` | No sign-in needed. Returns `{ ok: true, instance: <instanceId> }`, used to detect stale session files. |
| `POST /auth/exchange` | Swaps a launch code for the UI cookie |
| `GET /status` | Session summary: version, seed, start time, twins, active rules, running scenario |
| `GET /twins` | Every registered twin: id, display name, running or not, address, actions, supported failures, currency rules, label colour token |
| `GET /twins/:twin/credentials` | That twin's Ibeji test credentials, with plain labels |
| `POST /credentials/rotate` | Body: optional `twin`. Replaces credentials. |
| `GET /twins/:twin/state` | That twin's records, by collection |
| `DELETE /twins/:twin/state` and `DELETE /state` | Reset one twin or all (scope below) |
| `GET /failures` | The catalog: text, settings schema as JSON Schema, support and source per twin |
| `GET /rules`, `POST /rules` | List rules; add one rule |
| `DELETE /rules/:id`, `DELETE /rules` | Remove one rule; remove all, optionally `?twin=` |
| `GET /scenarios`, `POST /scenarios/:id/run`, `POST /scenarios/stop` | List, run with optional `twins`, stop |
| `GET /twins/:twin/webhook-url`, `PUT /twins/:twin/webhook-url` | Read or set that twin's webhook URL (empty removes it) |
| `GET /webhooks` | Deliveries with their attempts, filter by `twin` and `status` |
| `POST /webhooks/:id/resend` | Resend one delivery |
| `GET /events` | Events, filter by `scope`, `type`, `after` (an event id), `limit` (up to 500) |
| `GET /events/stream` | Server-Sent Events: a way for a server to push updates over one open connection. Each message has an `id`, so a reconnecting browser can send `Last-Event-ID` and receive what it missed. A heartbeat every 15 seconds. |
| `GET /export` | The session as JSON (C9, `ibeji export`) |

Rules for any route that names a twin: an unknown twin gives `UNKNOWN_TWIN`; a twin that is registered but not running gives `TWIN_NOT_RUNNING` (except for credentials and webhook URL, which work while it is stopped).

**Reset scope.** Resetting a twin deletes its records and cancels its queued and scheduled webhooks (marked `abandoned`). It keeps rules, scenarios, webhook URLs, credentials, and the event log.

### C9. CLI

| Command | What it does |
|---|---|
| `ibeji start` | Starts the twins and the UI, prints each twin's address and credentials in plain words, prints the seed, and opens the browser. Flags: `--twins paystack,flutterwave` chooses which run (default: all registered twins); `--port <n>` for the control server; `--twin-port <twin>=<n>` (repeatable); `--seed <n>`; `--scenario <id>`; `--no-open`; `--allow-private-webhooks`; `--allow-public-webhooks`; `--config <file>`. |
| `ibeji open` | Prints and opens a fresh dashboard link for the running session. `--no-open` only prints it. |
| `ibeji status` | Shows what is running, twin by twin, the seed, and active rules. |
| `ibeji fail <failure>` | Switches on a failure. Settings are flags named after the failure's settings, such as `--seconds 90` or `--percent 50`. `--twin` (comma-separated) chooses twins. `--on` takes an action selector (C2). Example: `ibeji fail webhook-delayed --seconds 90 --twin flutterwave --on refund`. |
| `ibeji clear [failure]` | Removes rules: one failure, or all. Optional `--twin`. Stops a running scenario. |
| `ibeji scenario list` and `ibeji scenario run <id>` | Lists and runs scenarios, with optional `--twin`. `ibeji scenario stop` stops one. |
| `ibeji webhook-url <twin> [url]` | Shows or sets where that twin's webhooks go. `--clear` removes it. |
| `ibeji keys [twin]` | Prints the credentials. `--rotate` replaces them. Works without a running session. |
| `ibeji events [--follow] [--twin]` | Prints events, optionally live. |
| `ibeji resend <delivery-id>` | Resends a webhook. |
| `ibeji reset [--twin]` | Resets twin state (scope in C8). Asks for confirmation unless `--yes`. |
| `ibeji export <file>` | Saves the session to a JSON file (contents below). |
| `ibeji mcp` | Runs the MCP server over stdio. |
| `ibeji doctor` | Runs the checks below and explains every problem. |

**Rules.** Every command has `--help` with a real example. Every command that prints data supports `--json`. Exit codes: 0 success, 1 error, 2 bad usage. A command checks all its input before changing anything, and changes nothing if any part is invalid. Human errors print what, why, and fix on separate lines to stderr. With `--json`, errors print the C12 JSON shape to stdout. Commands other than `start`, `keys`, `mcp`, and `doctor` need a running session; if none is running, they say so and show `ibeji start`. If the browser cannot be opened, the link is printed and the command still succeeds.

**Session file.** `~/.ibeji/session.json` holds the instance id, process id, ports, token, start time, and version. The `~/.ibeji` folder is created readable only by the user (mode 700 on macOS and Linux; the user's own home folder on Windows). The file is written to a temporary name and then renamed, so it is never half-written, with mode 600. It is removed on clean shutdown. At start, if a session file exists: when its process is alive and `/health` returns the same instance id, start refuses with `SESSION_ALREADY_RUNNING`; otherwise the file is stale, is removed, and start continues with a note. Other commands that find a stale file report `SESSION_STALE` and remove it.

**Export contents.** Version, seed, start time, twins and ports, rules, scenario, webhook URLs, twin records, deliveries, and up to the last 5,000 events. Removed: the token, UI token, launch codes, every credential (replaced by its fingerprint), any live key (fingerprint only), and authorization and signature headers. The file is written with mode 600.

**doctor checks.** Node version against `engines`; every configured port free or used by this Ibeji session; the config file parses; the session file is valid or stale; the credentials file permissions; the built UI is present; each twin's webhook URL is allowed by C13 rule 5 and answers. Each problem prints what, why, and fix. Exit 0 when all is well, 1 otherwise.

### C10. Web dashboard (UI)

The UI is the main way non-technical people use Ibeji. It is served by the control server and opened by `ibeji start`.

**Twin switcher.** Every page that shows twin-specific information has a switcher at the top: All, then each registered twin, read from `GET /twins`. Twins that are not running are shown as off, with a one-line explanation of how to start them. Each twin has a label colour token from the Ibeji palette, always paired with its name in text, never colour alone. These are Ibeji's colours, never the services' brand colours.

**Pages:**

| Page | Purpose |
|---|---|
| Home | Status of each twin, its address and credentials with copy buttons, its webhook URL, a "what is happening now" panel, and a short "first time here?" guide |
| Connect your app | A step-by-step guide for each twin: the base URL and credentials to use, what to change in the app in plain words, a ready-to-copy instruction to paste into their own coding agent, and a "Check my connection" panel that shows whether any request reached that twin in the last 5 minutes, and what the last one was. It only reads Ibeji's own event log. It never contacts the app. |
| Live activity | A timeline of every request, response, webhook, and failure, newest first, in plain words, with the twin named on each line, details one click away, and filters by twin and type. A Pause button stops new lines moving the list, and shows how many arrived while paused; Resume shows them. |
| Failures | Every failure as a card: plain name, real-life explanation, "Assumed" label where it applies, a settings form with limits and defaults, a choice of twins and actions (unsupported twins disabled, with the reason in text), and an on/off switch. Active failures are marked with text as well as colour. |
| Scenarios | Every scenario as a card with its story, supported twins, a twin choice, and a Run button. Shows progress and a Stop button while running. |
| Webhooks | Every delivery, by twin, with every attempt, its status, the app's response code and first 4 KB of response, and a Resend button. A webhook URL field per twin, which explains the address rules when an address is refused. |
| Data | Each twin's records in readable tables, with amounts formatted using the twin's currency rules from `GET /twins`. A Reset button per twin and for all, whose confirmation says exactly what will and will not be deleted (C8 reset scope). |

**Test checkout pages.** Each twin serves its own test checkout page on its own port, because a real app sends its customer there without any sign-in. The twin declares its outcomes and what each outcome does; the shared framework renders the page. Each page:

- is server-rendered HTML with no React, using the same design tokens and local fonts as the UI
- is labelled, for example "Ibeji test checkout: Flutterwave twin. No real money moves."
- shows only the amount, currency, customer email, and reference from the twin's own record
- records the tester's choice with a POST form, checked for the twin's own `Origin`
- explains when a failure rule overrode the choice (C5)
- never uses the service's branding

**Design rules:**

- Colours: white, black, purple, dark grey, and dark purple, defined as tokens, plus one label token per twin. All text meets 4.5 to 1 contrast, including focus and disabled states. A test checks every pair.
- Fonts: IBM Plex Sans for text and IBM Plex Mono for codes and keys, bundled into the built UI. The UI never loads anything from the internet.
- Plain words everywhere. Every technical term has a one-line explanation in place.
- Works with keyboard only and with a screen reader. Real buttons, links, and form labels. New activity is announced politely, at most one summary every 5 seconds.
- Works on a laptop screen (1280 px) and down to tablet width (768 px).
- Every action that destroys data asks for confirmation.
- The UI shows a clear message when the connection to Ibeji is lost, reconnects on its own, and catches up on missed events.
- The UI never shows a live key or any part of one, and never asks for one.

**Serving.** Built files with hashed names are cached for a year; `index.html` is never cached. Unknown page paths return `index.html`; unknown API paths return `NOT_FOUND`.

### C11. MCP server

`ibeji mcp` runs an MCP server over stdio for AI coding agents, using the stdio entry point that the installed `@modelcontextprotocol/server` README documents. It finds the running session through the session file and reads that file again on every tool call, so it keeps working after Ibeji restarts.

Tools that concern twins take an optional `twin` string, checked against `GET /twins`. Leaving it out means "all running twins" for reading tools, and is an error for `ibeji_set_webhook_url` and `ibeji_get_connection_guide`, which need one twin. Input schemas reuse the same Zod schemas as the control API.

| Tool | Annotations |
|---|---|
| `ibeji_status` | readOnlyHint |
| `ibeji_list_failures` | readOnlyHint |
| `ibeji_list_scenarios` | readOnlyHint |
| `ibeji_list_events` | readOnlyHint |
| `ibeji_list_webhooks` | readOnlyHint |
| `ibeji_get_test_keys` | readOnlyHint |
| `ibeji_get_connection_guide` | readOnlyHint. Returns the base URL, credentials, and plain steps for connecting an app to one twin, so a coding agent can make the change itself. |
| `ibeji_enable_failure` | readOnlyHint false |
| `ibeji_clear_failures` | readOnlyHint false |
| `ibeji_run_scenario` | readOnlyHint false |
| `ibeji_set_webhook_url` | readOnlyHint false |
| `ibeji_resend_webhook` | readOnlyHint false |
| `ibeji_reset_state` | readOnlyHint false, destructiveHint true |

Annotations are hints to the agent, not protection. The two credential tools say in their descriptions that the values are Ibeji's fake local test keys, that MCP clients may log tool results, and that live keys must never be used.

There is no export tool, because writing files is better done from the CLI. If no session is running, every tool returns a result with `isError: true` and the what, why, and fix text. In stdio mode only MCP messages go to stdout; all logs go to stderr. The supported MCP protocol versions are whatever the installed SDK supports by default, recorded in BUILD-LOG.md.

### C12. Errors

Every error Ibeji produces has a stable code and three plain fields:

- **what** happened
- **why** it happened
- **fix**: what to do next

Shapes:

- Control API: HTTP status from the table below, body `{ "error": { "code", "what", "why", "fix" } }`.
- CLI: three lines to stderr, or the JSON body with `--json`.
- MCP: `isError: true`, the three lines as text, and the JSON as structured content.
- UI: the three fields shown in plain words.
- Zod problems become `CONFIG_INVALID`, `INVALID_RULE`, `SCENARIO_INVALID`, or `BAD_REQUEST`, listing every problem with its field.

| Code | HTTP |
|---|---|
| `BAD_REQUEST` | 400 |
| `CONFIG_INVALID` | (CLI only) |
| `CONFIG_HAS_SECRET` | (CLI only) |
| `PORT_IN_USE` | (CLI only) |
| `SESSION_NOT_RUNNING` | (CLI and MCP only) |
| `SESSION_STALE` | (CLI and MCP only) |
| `SESSION_ALREADY_RUNNING` | (CLI only) |
| `UNAUTHORIZED` | 401 |
| `LAUNCH_CODE_INVALID` | 401 |
| `FORBIDDEN_HOST` | 403 |
| `FORBIDDEN_ORIGIN` | 403 |
| `NOT_FOUND` | 404 |
| `UNKNOWN_TWIN` | 404 |
| `UNKNOWN_ACTION` | 400 |
| `UNKNOWN_FAILURE` | 400 |
| `UNKNOWN_SCENARIO` | 404 |
| `TWIN_NOT_RUNNING` | 409 |
| `FAILURE_NOT_SUPPORTED_BY_TWIN` | 400 |
| `INVALID_RULE` | 400 |
| `SCENARIO_INVALID` | (load time) |
| `WEBHOOK_URL_NOT_ALLOWED` | 400 |
| `BODY_TOO_LARGE` | 413 |
| `INTERNAL` | 500 |

A new code needs a C21 entry. Codes never change meaning after release.

Errors a twin returns to the app under test are different. They must look exactly like that service's own error responses, because the point is to imitate it. These are not Ibeji errors.

Rules for all code:

1. No empty catch blocks.
2. No `any` type. Use `unknown` and narrow it.
3. No floating promises, enforced by lint. A process-level handler turns any unhandled rejection into an `INTERNAL` error report on stderr.
4. No `console.log` in `src/`. All logging goes through a logger that writes to stderr only.
5. Secrets in output:
   - The session token, UI token, and launch codes never appear anywhere except the session file and the launch link.
   - A live key never appears, not even in part. Only its fingerprint: the first 8 hexadecimal characters of its SHA-256 hash.
   - Ibeji test credentials appear in full only where a person needs to copy them: `ibeji keys`, `ibeji start`, the Home and Connect your app pages, and the two MCP credential tools. Everywhere else, including logs, events, errors, and exports, they appear as their documented test prefix plus fingerprint.

### C13. Safety

1. Twins never make network requests to any real payment service. T7 blocks every outbound connection except to this computer during the full test suite. At runtime, the only outbound connections Ibeji makes are webhook deliveries, checked by rule 5.
2. Live keys are rejected by every twin and refused by the recorder (C4, C15).
3. Servers listen on 127.0.0.1 only (C3).
4. The control API is protected by the session token or UI cookie, Host checks, and Origin checks (C8).
5. **Webhook addresses.** Only `http` and `https` URLs.
   - Allowed by default: this computer only (`127.0.0.0/8`, `::1`, and `localhost`).
   - With `--allow-private-webhooks` (or the config field): also private network addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) and `host.docker.internal`.
   - With `--allow-public-webhooks`: also public addresses, with a warning printed at start and shown in the UI, because a twin sending fake "payment succeeded" messages to a real public server could cause harm.
   - Always refused: unspecified addresses (`0.0.0.0`, `::`), link-local addresses (`169.254.0.0/16`, `fe80::/10`, which include cloud metadata services), multicast, and broadcast.
   - For every attempt, the host name is resolved, every address it resolves to is checked, and the connection is made to a checked address, so a name cannot change between the check and the connection.
   - Redirects are never followed.
6. The recorder (C15) is the only code that talks to the real services. It refuses live keys for every service and is not part of the published package.
7. No telemetry, no update checks, and no loading of fonts, scripts, or images from the internet.
8. Session, credentials, and export files are readable only by the user.

### C14. Configuration

An optional `ibeji.config.json` in the folder where `ibeji start` runs, or the file named by `--config`. Fields:

| Field | Type |
|---|---|
| `twins` | array of twin ids |
| `ports` | object: `control`, and one entry per twin id |
| `webhookUrls` | object: one URL per twin id |
| `seed` | whole number, 0 to 4294967295 |
| `scenario` | scenario id |
| `open` | true or false |
| `allowPrivateWebhooks` | true or false |
| `allowPublicWebhooks` | true or false |

It is validated with Zod, strictly: unknown fields, unknown twin ids, duplicate twins, empty `twins`, `null` values, clashing ports, and a scenario that supports none of the chosen twins are all errors. Every problem is listed at once, with the field name, what was expected, and an example of a valid value. Any value that looks like a key, token, or secret is refused with `CONFIG_HAS_SECRET`, because config files get committed to repositories. Order of precedence: built-in defaults, then the config file, then command-line flags. A flag that takes a list replaces the config list; it never merges with it.

### C15. Recorder and fixtures

A separate script, `scripts/record-fixtures.mjs`, run by hand only, one service at a time: `node scripts/record-fixtures.mjs --service paystack` (or `flutterwave`, or `stripe`).

It:

1. Reads that service's **test** secret key from its own environment variable: `PAYSTACK_TEST_SECRET_KEY`, `FLUTTERWAVE_TEST_SECRET_KEY`, or `STRIPE_TEST_SECRET_KEY`. It refuses to run if the key is missing, does not match that service's test format, or matches any of its live formats, as recorded in its research file. It never prints the key.
2. Calls each supported action for that service in test mode, in a fixed order.
3. Pauses and tells the person when a step needs them, for example "Open this link and pay with the test card shown, then press Enter."
4. Saves every request and response to `fixtures/<service>/` as JSON: method, path, query, request body, status, the response headers that matter, response body, and the date recorded.
5. Replaces secrets and personal details before saving, with stable fake values from a fixed list.
6. Records steps the test account cannot do as `skipped`, with the error and reason. A skipped fixture is never used by T3 as the expected answer.
7. Prints a short summary of what was recorded and what was skipped.

Fixture privacy test (T13): scans bodies, headers, paths, and query strings of every fixture. It fails on anything that looks like a real key for any service, or an email, phone number, account number, or name that is not on the fixed list of fake values.

Fixtures are committed to the repository. Runtime data the twins need, such as bank lists, is copied from fixtures into `src/twins/<twin>/data/` and built into the package. The recorder and the fixtures folder are not published.

### C16. Repository layout

```
ibeji/
  SPEC.md
  BUILD-LOG.md          decisions and phase notes
  AGENTS.md             rules for the coding agent (Part E)
  TWIN-DESIGN.md        the twin framework design (Phase 2)
  research/
    paystack.md
    flutterwave.md
    stripe.md
  README.md
  LICENSE               MIT
  THIRD-PARTY-NOTICES   font licence and any other notices
  CITATION.cff
  CHANGELOG.md          written by Changesets
  package.json
  pnpm-lock.yaml        committed
  biome.json
  tsconfig.json         server code
  ui/tsconfig.json      UI code, with DOM types
  vitest.config.ts
  playwright.config.ts
  .changeset/
  .github/workflows/
  docs/
  fixtures/
    paystack/
    flutterwave/
    stripe/
  scenarios/
  scripts/
    record-fixtures.mjs
    recorder/           one small module per service
    generate-docs.mjs
    smoke.mjs
    publish-release.mjs
  src/
    core/               state, failure engine, webhook dispatcher, events, clock, random, errors, scenarios
    twins/
      registry.ts       the one list of twin definitions
      framework/        the twin definition type, shared helpers, conformance suite
      paystack/
      flutterwave/
      stripe/
    control/            control API, SSE, security checks
    cli/
    mcp/
    shared/             types and schemas shared with the UI
  ui/                   React app, built into dist/ui
  test/
    unit/
    integration/
    contract/           twin responses compared with fixtures, per twin
    conformance/        the shared twin suite, run against every twin
    compat/             official library compatibility tests (T15), dev dependencies only
    ui/
    smoke/
  examples/
    school-fees-app/    a tiny app that can use any of the three twins
```

Not committed: `node_modules`, `dist`, `coverage`, test reports.

**Published files:** `dist/` (the CLI, server code, built UI with fonts, twin data files), `scenarios/`, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES`, `CHANGELOG.md`. Nothing else. A test of the packed file checks this list (C18 `check:package`).

### C17. Testing

| Id | Test group | What it proves |
|---|---|---|
| T1 | Unit | Each module works alone |
| T2 | Property | The failure engine, form encoding, money formatting, and signatures hold for thousands of random inputs |
| T3 | Contract | Every twin response matches the shape of its recorded fixture: same fields, same types, same status codes, for every twin. Skipped fixtures are not used. |
| T4 | Failure behaviour | Every failure does exactly what C5 says on every twin that supports it, tested through the control API, including the order of application. A parity test turns on three failures (`webhook-delayed`, `server-error`, `payment-declined`) through the CLI, the MCP server, and the UI, and proves each produces the same rule. |
| T5 | Webhooks | Each twin's signing matches its service's method; statuses, retries, duplicates, delays, ordering, resends, and address rules behave as specified |
| T6 | Security | Bearer token, UI cookie, launch codes (single use, expiry), the `X-Ibeji-Request` and Origin checks, Host checks on every server, no CORS headers, frame and referrer headers, body limits, live keys rejected by every twin, every server bound to 127.0.0.1 |
| T7 | No outside network | The whole suite passes with every outbound connection blocked except to this computer, and with proxy environment variables removed |
| T8 | UI | Playwright tests for every page, the twin switcher, and every checkout page |
| T9 | Accessibility | axe checks on every page and checkout page report zero serious and zero critical problems; every page works with keyboard only |
| T10 | CLI | Every command's help, success path, JSON output, errors, and exit codes |
| T11 | MCP | Every tool works against a running session; stdout carries only MCP messages |
| T12 | Smoke | In a fresh folder outside the repository, whose path has a space and a non-English letter, the packed package installs, its runtime tree has no native code or install scripts, `ibeji start --no-open` runs, the example app completes a payment through each twin, a failure is switched on, and the expected behaviour is seen |
| T13 | Fixture privacy | As described in C15 |
| T14 | Twin conformance | Every twin passes the same shared suite, reading what to check from its own definition: starts and stops cleanly, binds to 127.0.0.1, checks Host, rejects missing, wrong, and live keys, emits events for every request, applies each failure it declares through the shared step and refuses the others, serves its checkout page, and signs webhooks so its own verification accepts them and rejects tampered ones |
| T15 | Official library compatibility | For each service whose official Node library can be pointed at another address (research decides), that library completes a payment and a refund against the twin. For any library that cannot, the reason and the alternative are recorded in `docs/limits.md`. |

**Coverage**, enforced by `@vitest/coverage-v8`: 100% of lines and branches for `src/core/` and `src/twins/framework/` as a whole, and at least 90% for `src/` as a whole. Files that contain only types, and index files that only re-export, are excluded. Nothing else is excluded.

**Test rules:**

- Unit and integration tests never use real time. They use the injected clock.
- UI (T8) and smoke (T12) tests may use real time, with a fixed upper limit on every wait. They never retry.
- No test connects to anything outside this computer. Smoke tests install the packed file, not from the registry.
- Every test that starts a server uses port 0 and stops it afterwards.
- A flaky test counts as a failing test. Fix the cause. Never add retries to hide it.

### C18. Quality gates

A step is finished only when all of these pass, run in this order:

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:ui
pnpm check:package
pnpm test:smoke
```

`test:ui` exists from Phase 6. Before it runs for the first time on a computer, and in every CI job, the test browser is installed with `pnpm exec playwright install chromium` (CI adds `--with-deps` on Linux). `check:package` and `test:smoke` exist from Phase 8: `check:package` runs publint and checks the packed file list against C16. Before each gate exists, its script prints that it is not added yet and exits 0. CI runs all gates on Windows, macOS, and Linux, with the latest Node 22 and the latest Node 24.

TypeScript settings must include `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `"types": ["node"]` for server code (the MCP SDK's types need Node's types, and new TypeScript versions no longer include them automatically). The UI's own tsconfig adds the DOM library instead.

### C19. Documentation

- README: one sentence on what Ibeji does, the Musa story in four lines, the three twins, a 2-minute quick start for non-technical users using the UI, one for developers using the CLI, the MCP setup, the "last recorded" date of each twin's fixtures, and a note that development needs a separate browser install for UI tests (users do not).
- `docs/connect-your-app.md`: plain steps for pointing an app at each twin, including a ready-to-paste instruction for vibe coders to give their own coding agent.
- `docs/failures.md`: every failure, with its real-life story, settings, and which twins it applies to. Generated from the catalog.
- `docs/scenarios.md`: every scenario. Generated from the scenario files.
- `docs/safety.md`: what Ibeji will and will not do, especially about keys, the dashboard sign-in, and webhook addresses.
- `docs/limits.md`: what is not supported yet, for each twin.
- `docs/stripe-and-ibeji.md`: a factual comparison with Stripe's own testing tools (Part F).
- `docs/cli.md`: every command with an example.
- A clear line in the README: "Ibeji is not affiliated with or endorsed by Paystack, Flutterwave, or Stripe."

### C20. Branding and legal

- Never use the logos, colours, or fonts of Paystack, Flutterwave, or Stripe in the UI or any test checkout page. Every checkout page uses Ibeji's own look and says clearly that it is a test checkout and no real money moves.
- Use the service names only as plain names, to describe what each twin imitates.
- Each research file starts with a line naming the service as a trademark of its owner and stating Ibeji is not affiliated with it.
- A failure's `source` is `real-story` only when the story is marked "OK to publish" in STORIES.md. Stories never name people or companies.

### C21. Decisions log

Every decision made during the build that changes or clarifies this spec is recorded here, with the date and reason. The agent proposes entries; Joseph approves them.

**27 October 2026: decisions from the Step 1.1 kickoff review.** The item numbers refer to the review in BUILD-LOG.md. All are applied in the sections named.

| Id | Decision | Review items | Sections |
|---|---|---|---|
| D1 | The no-native rule is split: nothing native for users; nothing compiles for developers; prebuilt tool binaries are allowed. | 1, 123 | C1, B3, T12 |
| D2 | The dashboard signs in with a single-use launch code exchanged for an `HttpOnly`, `SameSite=Strict` cookie. No token in any URL. SSE uses the cookie. CLI and MCP use a bearer token. | 2, 3, 13, 70 | C8, C10 |
| D3 | Requests that change something through the cookie need `X-Ibeji-Request: 1` and a matching `Origin`. No CORS headers anywhere. | 4, 96 | C8 |
| D4 | Host, frame, referrer, and body-size checks apply to every server, including twins and checkout pages. | 5, 6, 30 | C4, C8, C10 |
| D5 | Ports are defaults. The bound port is the truth. Ports are checked before any server starts. Links use `127.0.0.1`. | 1, 14, 18, 26 | C3, C8 |
| D6 | The control API has a versioned route table. | 9 | C8 |
| D7 | Credentials are fake, marked as Ibeji keys, stored per user, and stable across sessions until rotated. Each twin declares which credentials its service uses. | 11, 53 | C7 |
| D8 | Twins are listed only in `src/twins/registry.ts`. Generic code never hard-codes twin ids. | 19, 24, 47, 69, 83 | B3, C2, C3 |
| D9 | Actions have local and full ids, and a selector grammar. | 20, 45 | C2, C9 |
| D10 | Events have a scope, which is a twin id or `ibeji`. | 21 | C2 |
| D11 | Each twin declares its supported failures and checkout outcomes; T14 reads them. | 22, 25, 32 | C5, C10, T14 |
| D12 | `webhook-bad-signature` is renamed `webhook-verification-fails`, with a per-twin method setting. | 36 | C5 |
| D13 | New failure `authentication-required` for Stripe, pending research. `payment-declined` covers declines only. | 28, 33 | C5 |
| D14 | Every failure has exact settings, defaults, and limits. | 37, 39, 40, 41, 42, 43 | C5 |
| D15 | Failures apply in a fixed order, for requests and for webhooks. Active payment failures override the checkout button, and the page explains why. | 27, 38 | C5 |
| D16 | Assumed failures are offered with a visible "Assumed" label. Failure ids are stable; per-twin support changes only through C21. | 44, 46 | C5 |
| D17 | Scenarios are built in only, with exact settings and a defined lifecycle. | 48 to 52 | C6 |
| D18 | Webhook deliveries have attempts and eight statuses, a default retry schedule when undocumented, and defined resend behaviour. | 54, 55, 57, 58, 59 | C7 |
| D19 | Webhooks go to this computer only by default. Private addresses and public addresses each need their own flag. Link-local and metadata addresses are always refused. Addresses are resolved and pinned for each attempt; no redirects. | 56, 97 | C13 |
| D20 | One session per user, atomic session file, instance id, and stale detection. | 8 | C9 |
| D21 | Every CLI flag is defined. Commands validate everything before changing anything. Reset, clear, export, and doctor have exact scopes. Added `ibeji open` and `ibeji resend`. | 60 to 63, 68, 12 | C9 |
| D22 | Config fields are listed; validation is strict; secrets are refused; flags replace lists. | 64, 65, 66 | C14 |
| D23 | The seed is a whole number, printed at start, and covers every random choice. | 67 | C3 |
| D24 | Live keys are shown only as a fingerprint. Ibeji test keys appear in full only where people copy them. | 79, 90, 94 | C4, C12 |
| D25 | Error codes are listed with their HTTP statuses and shapes for each interface. | 89, 91, 92 | C12 |
| D26 | MCP: v2 stdio entry, optional `twin` as a checked string, annotations mapped, `ibeji_resend_webhook` and `ibeji_list_webhooks` added, no export tool. | 81 to 88 | C11 |
| D27 | UI: explicit Pause button instead of pausing on scroll; 5-minute connection window; settings forms; scenario twin choice and Stop; fonts bundled; caching rules. | 71 to 78, 80 | C10 |
| D28 | Tests: outbound network blocked except to this computer; real time allowed with fixed limits in UI and smoke tests; zero serious and critical axe problems; T4 parity test; T15 defined; coverage rules stated. | 93, 105 to 110 | C17 |
| D29 | Stack: missing packages added; `@arethetypeswrong/cli` removed because v1 publishes no types; Node `^22.18.0 \|\| >=24.11.0`; pnpm 10 pinned; `"types": ["node"]`; browser install step; `docs/`, published files, and lockfile defined. | 103, 104, 111 to 115 | C1, C16, C18 |
| D30 | B2 says "for the actions listed in C4". Release scope stays all three twins in 0.1.0 unless Joseph decides otherwise before Phase 4. Stories are used only with permission. | 119, 120, 121 | B2, Part F, C20 |

Still open, decided in Phase 2 and recorded here then: the Flutterwave API version (116), the Stripe API version and version header behaviour (117), the C4 action lists (118), the C5 per-twin table (32 to 35), each service's credentials and webhook verification method (53), and which official libraries can be pointed at a twin (109).

---

## Part E. Rules for the coding agent

These rules apply to every task. The full text is in `AGENTS.md`.

1. Read the SPEC.md sections named in the task before writing anything.
2. If anything is unclear, contradicts itself, or seems wrong, stop and ask. Never guess, especially about any payment service's behaviour, money, keys, or security.
3. Read the installed version of every library before using it.
4. Facts about a payment service come only from its research file and fixtures. Never apply a fact about one service to another.
5. Write tests first or alongside the code, named after their spec reference.
6. Never weaken, skip, or delete a test. Never lower coverage. Never hide a flaky test.
7. Follow the error rules in C12 and the safety rules in C13.
8. Never use a real key from any service in code, tests, fixtures, or logs.
9. Follow the dependency rules in C1. Ask before adding any new dependency.
10. Run every quality gate that exists, and show the real output.
11. Stay within the current task. Write ideas for later in BUILD-LOG.md.
12. Finish with the checklist the task asks for.
13. Commit at the end of each task with the message the task gives.
14. Explain decisions in plain English.

---

## Part F. Risks and open questions

| Risk | How it is handled |
|---|---|
| A twin drifts from its real service | Contract tests against recorded fixtures, a "last recorded" date for each twin in the README, and re-recording before each minor release |
| Apps cannot change a service's base URL | The Connect your app guide explains how for each twin, with a copy-ready instruction for coding agents. Research checks which official and common libraries allow a custom base URL. |
| Flutterwave changes API versions | Research picks one version and records why. The twin and docs name the version clearly. |
| Stripe already has official testing tools | Stripe offers a test mode with test cards, a command-line tool that can trigger webhook events, and an official mock server that returns example responses. Ibeji's difference is stateful records, failure injection, scenarios, and the dashboard, shared across all three services. Research records what Stripe's own tools already do, so Ibeji does not claim otherwise. |
| Legal or brand complaint | Neutral name, no service branding, a clear not-affiliated line, and readiness to change wording quickly |
| Fake success webhooks reach a real server | Webhooks go to this computer only by default; wider addresses need explicit flags (C13) |
| Another website on the person's computer tries to control Ibeji | Launch code and cookie sign-in, Host and Origin checks, no CORS, no token in URLs (C8) |
| A weaker coding model writes plausible but wrong service behaviour | Every fact must come from a research file or fixtures, contract tests catch drift, and the conformance suite keeps twins consistent |
| Three twins triple the work | Twins are built one at a time on a shared framework. Paystack first, then Flutterwave, then Stripe. Each later twin should be faster than the one before. |
| The newest TypeScript breaks a build tool | C1 allows pinning the latest 6.x, recorded in C21 |

Open questions for Joseph:

1. Release 0.1.0 with all three twins, or release 0.1.0 with Paystack and Flutterwave and add Stripe in 0.2.0? The default is all three. Decide before Phase 4.
2. Which real stories can be published in the failure library, and with what credit? Until a story is cleared, its failures use `docs` or `assumed`.