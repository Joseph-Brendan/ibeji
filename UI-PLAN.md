# Ibeji dashboard plan

Status: plan only. No UI code is written in this task.

This plan covers the dashboard served by the control server, the live states it needs, and the exact words a person sees. It uses the control API as it exists after Phase 5. It also covers the test checkout pages, which the twin framework serves outside the dashboard navigation.

Sources read for this plan:

- SPEC.md B2, C8, C10 and C12.
- BUILD-LOG.md, including the official library compatibility notes headed Phase 4, Step 4.7.
- The "Base URL in libraries" sections of `research/paystack.md`, `research/flutterwave.md` and `research/stripe.md`.
- `src/control`, especially `app.ts`, `session.ts`, `credentials.ts`, `sse.ts` and `types.ts`.
- The installed `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` packages, their licences and their file lists.

The user asked for Step 4.9 notes. The compatibility notes in BUILD-LOG.md are headed Phase 4, Step 4.7. They are the notes used here.

---

## 1. Who uses it

### 1.1 The non-technical vibe coder

Amaka runs a small online shop in Lagos. She used an AI coding tool to build the shop, and it takes payments with Paystack or Flutterwave. She does not want to read API documentation. In her first five minutes she wants to open one link, see that both twins are running, copy the base URL and test keys into her app, make one test payment, and watch the request appear in plain words. She also wants a block of text she can paste into her coding agent and know that the agent will use test keys only.

### 1.2 The international founder testing a Stripe checkout

Daniel is building a subscription product for customers outside Africa. He knows Stripe, but he does not want to create real charges while he tests failures. In his first five minutes he wants to point the official Stripe library at the local Stripe twin, open the local checkout, try a successful card, try a declined card, try a card that needs an extra bank check, and see the webhook attempts arrive. He wants the guide to tell him the exact host, port, protocol and API version to use, and he wants the local-only warning to be clear.

### 1.3 The developer testing an agent

Tobi is building an AI agent that creates payments and refunds. In his first five minutes he wants to start Ibeji with a repeatable seed, open Live activity, run a scenario such as "Kola's lost refund", watch the failure events, and copy the webhook URL into the agent's local tool. He wants JSON-friendly details, a stable event id, and a page that does not lose its place when new events arrive.

---

## 2. Product rules that shape the UI

These rules come from C8, C10 and C12. They are not optional.

1. The dashboard is served by the control server. The browser never sees the session token.
2. The browser signs in with the `ibeji_ui` cookie. The cookie is `HttpOnly` and `SameSite=Strict`. The UI never puts a session token, UI token or launch code in `localStorage`, `sessionStorage`, IndexedDB, a URL after exchange, a log, an event or an error.
3. Every request that changes something and uses the cookie sends `X-Ibeji-Request: 1`. The browser sends the control server's own `Origin` by itself. The UI must not try to bypass either check.
4. Every screen that shows one twin's information has the twin switcher at the top.
5. A twin that is registered but not running is shown as off. It is never hidden.
6. Every error shows the C12 `what`, `why` and `fix` fields in plain words.
7. Every destructive action asks for confirmation and says exactly what will and will not be deleted.
8. The UI never asks for a key and never shows a live key. The Ibeji test keys appear in full only on Home and Connect your app, and in the two allowed credential tools outside the UI.
9. The UI reads twins, failures, scenarios, credentials, rules, events and deliveries from the control API. It does not contain a list of service ids and it does not contain service field names.
10. The UI works at 1280 px and down to 768 px. It also stays usable below 768 px, but that is not a supported target for v1.
11. The UI loads no font, script, image or stylesheet from the internet.
12. The UI uses plain words. A technical term gets a one-line explanation the first time it appears on a page.

### 2.1 Terms used in the UI

These explanations appear in the interface where the term first appears.

- Base URL: the address your app sends payment requests to.
- Test key: a fake key that works only with Ibeji. It cannot move real money.
- Public key: the test key that is safe to use in browser test code.
- Secret key: the private test key. Keep it on your server.
- Webhook: a message Ibeji sends to your app when something happens.
- Webhook URL: the address in your app that receives webhook messages.
- Signature: a code that proves a message came from the sender.
- Failure: a realistic problem Ibeji can create.
- Rule: one failure switched on for one or more twins, with settings.
- Scenario: a ready-made set of failure rules.
- Event: something that happened in Ibeji.
- Seed: a number that makes random choices repeatable.
- Record: one payment, refund, transfer, recipient or bank row.
- Reset: delete records and stop waiting webhooks. It does not delete rules, scenarios, webhook URLs, keys or events.
- Twin: a local copy of one payment service.
- API: the set of web addresses and rules an app uses to talk to a payment service.
- JSON: a text format for data.
- HTTP status: the number a server sends to say what happened. 200 means success.

---

## 3. Navigation

### 3.1 Pages

The dashboard has seven pages, in this order:

1. Home
2. Connect your app
3. Live activity
4. Failures
5. Scenarios
6. Webhooks
7. Data

The test checkout pages are not in this navigation. Each twin serves its own checkout page on its own port. The dashboard links to a checkout page in a new tab and labels it "Test checkout".

### 3.2 App shell

The laptop layout has three regions:

1. A slim top bar with the Ibeji wordmark, the session state, the seed and a Help button.
2. A left navigation column with the seven pages.
3. A main content area with a page title, the twin switcher and the page body.

At 1024 px and below, the left navigation becomes a horizontal row under the top bar. The row scrolls sideways when needed. At 768 px the twin switcher also scrolls sideways. The main content keeps a 24 px gutter and a maximum width of 1280 px.

The top bar never shows the session token. It shows:

- "Ibeji" as text.
- "Connected" or the connection banner text.
- "Seed 123456" when a seed exists.
- "Help" which opens a small panel with the one-line explanations from section 2.1.

The left navigation is a real `<nav>` with links. The active page uses `aria-current="page"` and a dark purple fill with white text.

### 3.3 How a person moves between pages

- The left navigation changes the page. It keeps the current twin choice in the URL.
- The twin switcher changes the twin choice. It reloads only the page data, not the whole page.
- The Home page links to Connect your app, Live activity, Failures, Scenarios, Webhooks and Data with plain text links.
- The Failures page links to Scenarios when a scenario owns a rule.
- The Scenarios page links to Failures so a person can see what a scenario switched on.
- The Webhooks page links to Home so a person can copy the webhook URL if they have not set one yet.
- Browser Back returns to the previous page and the previous twin choice.

The twin choice is carried in the URL as `?twin=<id>`. No twin query means All. A page reload, a copied link and a second tab keep the same choice. The UI does not use `localStorage` or `sessionStorage` for this.

Examples:

- `/failures?twin=paystack`
- `/webhooks?twin=flutterwave`
- `/data` means All twins.

---

## 4. The twin switcher

### 4.1 Placement

The switcher is a sticky bar directly below the top bar and above the page title. It is present on every page. It is not inside the left navigation, because it changes data, not the page.

At 1280 px it is one row:

`All | Paystack | Flutterwave | Stripe`

At 768 px it scrolls sideways with visible edge shadows. The All item is always first and always visible.

### 4.2 Items

Each item is a real link with the twin name in text. The colour is never the only signal.

- All: black text on white. Shows the number of running twins, for example "All, 2 running".
- A running twin: label badge with the twin's label colour and white name text, plus a status pill that says "Running".
- A stopped twin: label badge and name, then a status pill that says "Off". The link still works. The page explains how to start the twin.
- The current item has a 2 px dark purple underline and `aria-current="true"`.

The switcher shows a small help line under the row when a stopped twin is present:

"Off twins stay visible. Start one with `ibeji start --twins <id>`."

The id is filled from the twin's own data. The UI does not hard-code it.

### 4.3 Label colours

The control API returns a `labelColourToken` for each twin. The UI maps tokens to CSS variables. In version 0.1.0 the registry order gives:

| Twin | Token | Background | Text | Contrast |
|---|---|---|---|---|
| Paystack | `twin-label-1` | `#6B4FA1` | `#FFFFFF` | 6.45 to 1 |
| Flutterwave | `twin-label-2` | `#3A3A3A` | `#FFFFFF` | 11.37 to 1 |
| Stripe, version 0.2.0 | `twin-label-3` | `#2F1B45` | `#FFFFFF` | 15.40 to 1 |

The colours are Ibeji colours, not service brand colours. A twin name always sits next to the colour. An unknown token, such as a future fourth twin, uses the neutral label style: black text on white with a dark grey border, and the twin name still appears. No UI code needs to change when a fourth twin is added.

### 4.4 How the choice carries

- Clicking a switcher item updates `?twin=<id>` with `history.pushState`.
- Clicking All removes the `twin` parameter.
- Page links copy the current query string.
- The chosen twin filters Home cards, Live activity, Failures, Scenarios, Webhooks and Data.
- Connect your app shows a guide for the chosen twin. When All is chosen, it shows a guide picker instead.
- A stopped twin can still be chosen. The page shows its off state rather than hiding it.

---

## 5. Design tokens

### 5.1 Colour palette

| Token | Hex | Use |
|---|---|---|
| `--ibeji-white` | `#FFFFFF` | Page background, card background, inverse text |
| `--ibeji-black` | `#111111` | Normal text, headings, code |
| `--ibeji-purple` | `#6B4FA1` | Links, primary buttons, focus ring, active marks |
| `--ibeji-dark-grey` | `#3A3A3A` | Secondary text, borders, off state |
| `--ibeji-dark-purple` | `#2F1B45` | Header bars, error banners, running state |
| `--twin-label-1` | `#6B4FA1` | First registered twin label |
| `--twin-label-2` | `#3A3A3A` | Second registered twin label |
| `--twin-label-3` | `#2F1B45` | Third registered twin label |

No other colour is used for text, backgrounds, borders or focus. A service logo or service colour never appears in the dashboard or the test checkout pages.

### 5.2 Contrast table

These are the only text and background pairs the UI uses. Every pair passes 4.5 to 1 for normal text.

| Text | Background | Ratio |
|---|---|---|
| `#111111` | `#FFFFFF` | 18.88 to 1 |
| `#3A3A3A` | `#FFFFFF` | 11.37 to 1 |
| `#6B4FA1` | `#FFFFFF` | 6.45 to 1 |
| `#2F1B45` | `#FFFFFF` | 15.40 to 1 |
| `#FFFFFF` | `#111111` | 18.88 to 1 |
| `#FFFFFF` | `#6B4FA1` | 6.45 to 1 |
| `#FFFFFF` | `#3A3A3A` | 11.37 to 1 |
| `#FFFFFF` | `#2F1B45` | 15.40 to 1 |
| `#FFFFFF` | `#6B4FA1` label 1 | 6.45 to 1 |
| `#FFFFFF` | `#3A3A3A` label 2 | 11.37 to 1 |
| `#FFFFFF` | `#2F1B45` label 3 | 15.40 to 1 |

State pairs:

| State | Text | Background | Ratio |
|---|---|---|---|
| Focus ring on light surface | `#6B4FA1` | `#FFFFFF` | 6.45 to 1 |
| Focus ring on dark surface | `#FFFFFF` | `#2F1B45` | 15.40 to 1 |
| Disabled button text | `#3A3A3A` | `#FFFFFF` | 11.37 to 1 |
| Placeholder text | `#3A3A3A` | `#FFFFFF` | 11.37 to 1 |
| Link text | `#6B4FA1` | `#FFFFFF` | 6.45 to 1 |
| Active navigation | `#FFFFFF` | `#2F1B45` | 15.40 to 1 |
| Inactive navigation | `#3A3A3A` | `#FFFFFF` | 11.37 to 1 |
| Primary button | `#FFFFFF` | `#6B4FA1` | 6.45 to 1 |
| Primary button hover | `#FFFFFF` | `#2F1B45` | 15.40 to 1 |
| Secondary button | `#111111` | `#FFFFFF` | 18.88 to 1 |
| Destructive button | `#FFFFFF` | `#2F1B45` | 15.40 to 1 |
| Running status | `#FFFFFF` | `#2F1B45` | 15.40 to 1 |
| Off status | `#111111` | `#FFFFFF` | 18.88 to 1 |
| Failed webhook status | `#FFFFFF` | `#6B4FA1` | 6.45 to 1 |
| Warning banner | `#111111` | `#FFFFFF` | 18.88 to 1 |
| Inline code | `#111111` | `#FFFFFF` | 18.88 to 1 |
| Code block | `#111111` | `#FFFFFF` | 18.88 to 1 |

Borders are `#3A3A3A` on `#FFFFFF` at 11.37 to 1. The border is not used as the only way to identify a control.

### 5.3 Type

Font family:

- Text: `"IBM Plex Sans", system-ui, sans-serif`
- Code, keys, event ids: `"IBM Plex Mono", ui-monospace, monospace`

Sizes:

| Token | Size | Line height | Use |
|---|---|---|---|
| `--type-display` | 2rem (32 px) | 2.5rem (40 px) | Page title on Home |
| `--type-h1` | 1.75rem (28 px) | 2.25rem (36 px) | Page title |
| `--type-h2` | 1.375rem (22 px) | 1.875rem (30 px) | Section title |
| `--type-h3` | 1.125rem (18 px) | 1.625rem (26 px) | Card title |
| `--type-body` | 1rem (16 px) | 1.5rem (24 px) | Body text |
| `--type-small` | 0.875rem (14 px) | 1.375rem (22 px) | Help text, table cells |
| `--type-micro` | 0.75rem (12 px) | 1.125rem (18 px) | Status pills, timestamps |
| `--type-mono` | 0.875rem (14 px) | 1.375rem (22 px) | Keys, ids, code |
| `--type-mono-small` | 0.75rem (12 px) | 1.125rem (18 px) | Inline event ids |

Rules:

- Body text is never smaller than 16 px on mobile and tablet.
- Help text is never smaller than 14 px.
- A paragraph is at most 70 characters wide.
- Headings use weight 600. Body uses weight 400. Keys and code use weight 400.
- The UI uses no italics for body text.

### 5.4 Spacing

| Token | Value |
|---|---|
| `--space-1` | 4 px |
| `--space-2` | 8 px |
| `--space-3` | 12 px |
| `--space-4` | 16 px |
| `--space-6` | 24 px |
| `--space-8` | 32 px |
| `--space-12` | 48 px |
| `--space-16` | 64 px |

Card padding is 24 px. Page gutters are 24 px. Space between page sections is 32 px. Space between a label and its field is 8 px.

### 5.5 Radius and borders

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4 px | Inputs, pills |
| `--radius-md` | 8 px | Buttons, small cards |
| `--radius-lg` | 12 px | Cards, dialogs |
| `--radius-pill` | 999 px | Status pills and twin badges |

Borders are 1 px solid `#3A3A3A`. Focus rings are 3 px solid `#6B4FA1` with a 2 px white offset. On dark surfaces the ring is 3 px white with a 2 px dark purple offset.

### 5.6 Motion

- Standard transition: 120 ms ease out.
- Dialog and panel transition: 180 ms ease out.
- Respect `prefers-reduced-motion`. When reduced motion is on, do not animate list movement or opening panels.

---

## 6. Components

| Component | Purpose | Important states |
|---|---|---|
| App shell | Top bar, navigation, switcher and main landmark | Normal, disconnected |
| Skip link | Moves focus to the main content | Focused |
| Top bar | Wordmark, connection text, seed, Help | Connected, reconnecting |
| Left navigation | Links to the seven pages | Current page, hover, focus |
| Twin switcher | All and each registered twin | All, running, off, current |
| Twin badge | Label colour plus twin name | Known token, unknown token fallback |
| Status pill | Text plus a shape and colour | Running, off, waiting, sending, delivered, failed, no answer, stopped |
| Copy button | Copies one value and gives feedback | Idle, copied, failed |
| Code block | Shows a URL, key or instruction | Normal, copied |
| Credential row | Label, value and copy button | Visible, copied, rotated |
| Card | Groups one topic or record | Normal, active, off, error |
| Section header | Title plus optional help and action | Normal |
| Help text | One-line explanation of a term | Normal |
| Empty state | Explains why a list is empty and what to do | First run, filter empty |
| Error panel | Shows C12 what, why and fix | Error, retry |
| Connection banner | Shows lost and restored control connection | Reconnecting, disconnected, restored |
| First-time guide | Four short steps on Home | Visible, dismissed for this page view |
| Failure card | One failure with text, settings and switch | Off, on, used up, scenario-owned, unsupported |
| Settings form | Fields built from the failure JSON Schema | Normal, invalid, saving |
| Twin checkbox group | Chooses twins for a rule | Supported, unsupported, off |
| Action picker | Chooses all actions or named actions | All, selected, invalid |
| Switch | Turns one manual rule on or off | On, off, busy, disabled |
| Scenario card | Story, twins, run button | Idle, running, unsupported twin |
| Progress strip | Shows timed steps for the active scenario | No steps, waiting, step complete |
| Event row | One event with a details disclosure | Collapsed, expanded |
| Filter bar | Twin and type filters | Default, filtered, cleared |
| Pause control | Freezes the activity list and counts arrivals | Running, paused |
| Webhook URL form | Reads and sets one twin's webhook URL | Empty, saved, refused, saving |
| Delivery row | One webhook delivery and its attempts | Collapsed, expanded, resend busy |
| Attempt row | One attempt with status, code, time and body | Delivered, failed, no answer |
| Data table | One twin collection | Loading, empty, normal, error |
| Money cell | Formats a whole number with the twin's currency rules | Normal, unknown currency |
| Confirmation dialog | Confirms a destructive action | Open, cancel, confirm busy |
| Toast | Short success message after an action | Success, error |
| Skeleton | Placeholder while a page loads | Loading |
| Off panel | Explains that one twin is not running | Twin off |
| Live region | Announces new activity without reading every event | Polite, paused |
| Test checkout form | Server-rendered choice form on a twin port | Normal, submitted, error |

### 6.1 Status words

Each status uses text and colour.

| API value | UI text |
|---|---|
| `running` | Running |
| `off` | Off |
| `queued` | Waiting to send |
| `scheduled` | Waiting for retry |
| `sending` | Sending |
| `delivered` | Delivered |
| `failed` | App said no |
| `unreachable` | No answer |
| `not-sent` | Not sent |
| `abandoned` | Stopped |

A status pill never relies on colour alone. The text is always present.

### 6.2 Event type words

| API type | UI text |
|---|---|
| `request` | Request |
| `response` | Response |
| `webhook-sent` | Webhook sent |
| `webhook-delivered` | Webhook delivered |
| `webhook-failed` | Webhook failed |
| `failure-fired` | Failure fired |
| `rule-added` | Failure switched on |
| `rule-removed` | Failure switched off |
| `scenario-started` | Scenario started |
| `scenario-step` | Scenario step |
| `scenario-finished` | Scenario finished |
| `warning` | Warning |
| `state-reset` | Records reset |

"Failure fired" has a one-line help: "A failure rule changed this response."

---

## 7. Sign-in flow

### 7.1 The launch link

`ibeji start` and `ibeji open` print a link like:

`http://127.0.0.1:4400/?launch=<code>`

The code is single use and expires after two minutes. The browser opens the link. The link is the only place the code appears.

### 7.2 What the page does

1. The app shell reads the `launch` query parameter.
2. It sends `POST /_ibeji/api/v1/auth/exchange` with JSON `{ "code": "<code>" }` and `credentials: "same-origin"`.
3. The server answers with `Set-Cookie: ibeji_ui=...; HttpOnly; SameSite=Strict; Path=/`.
4. The browser stores the cookie. JavaScript never sees the cookie value.
5. The page calls `history.replaceState(null, "", "/")` to remove the code from the address bar and from the current history entry.
6. The page loads Home.
7. The code is removed from the address bar even when the exchange fails. A used or expired code cannot be retried.

The UI never writes the code, the session token or the UI token to `localStorage`, `sessionStorage`, IndexedDB, a cookie written by JavaScript, a URL after the exchange, a log or an event.

### 7.3 Reload and second tab

- Reload: the browser sends the `HttpOnly` cookie. GET routes work. The page loads normally.
- Second tab: the cookie works. The second tab loads normally. The first tab stays signed in.
- Same launch link in a second tab: the code was already used, so the second tab shows the invalid link page.

For changing requests, the UI sends `X-Ibeji-Request: 1`. The browser sends the same-origin `Origin` header. The UI does not try to send a token or to add CORS headers.

### 7.4 Invalid, used or expired code

Full page, no navigation:

- Heading: "That launch link is not valid."
- Body: "The link may have been used already, or it may be more than two minutes old."
- Help: "Run `ibeji open` to get a new link."
- Button: "Try again"
- Small help: "If Ibeji is not running, start it with `ibeji start`."

### 7.5 Ibeji restarted

When the cookie is no longer accepted and `/health` answers with a new instance, show:

- Heading: "Ibeji was restarted."
- Body: "Run `ibeji open` to get a new link."
- Button: "Try again"

The exact required sentence "Ibeji was restarted. Run `ibeji open` to get a new link." appears in the page's live region when the page loads.

### 7.6 No link and no cookie

When a person opens `/` directly with no cookie and no launch code:

- Heading: "Open Ibeji from your terminal."
- Body: "Run `ibeji start` to start Ibeji, or `ibeji open` to get a new dashboard link."
- Button: "Try again"

### 7.7 Control server not answering during exchange

- Heading: "Ibeji is not answering."
- Body: "The local process may have stopped. Start it again with `ibeji start`."
- Button: "Check again"

The page removes the code from the address bar before showing this state.

---

## 8. Disconnection and reconnection

### 8.1 Detecting a lost connection

- Every API request has a 5 second timeout.
- A network error or a 5xx response shows the connection banner after the first failure.
- A 401 does not show the connection banner. It shows the restarted page from section 7.5.
- A 409 with `TWIN_NOT_RUNNING` shows the page's off state, not the connection banner.
- The live event stream is one `EventSource` for the whole app. It is opened once and shared by Home and Live activity.

### 8.2 Banner text

Reconnecting:

- Heading: "Ibeji is not answering."
- Body: "The local process may have stopped. Ibeji will try again on its own."

After 30 seconds:

- Heading: "Ibeji is still not answering."
- Body: "Start Ibeji again with `ibeji start`."

Restored:

- "Connected again. Live updates resumed."

The restored message disappears after 5 seconds.

### 8.3 Reconnection

- `EventSource` reconnects on its own. The app does not create a second stream.
- The browser sends `Last-Event-ID` on reconnect. The server sends the events the browser missed.
- After a reconnect, the page also calls `GET /events?after=<lastSeenId>&limit=500` to fill any gap and to rebuild the list.
- The page keeps the last seen event id in memory only. A reload starts from the newest 500 events.
- While disconnected, Pause still works. New events cannot arrive until the stream returns.
- If `/health` answers with a different instance after a disconnect, show the restarted page instead of reconnecting.

### 8.4 Missed events and duplicates

- The event id is the deduplication key.
- An event id that is already in the list is ignored.
- A reconnected stream may send an event that the catch-up request already returned. The id check prevents a duplicate row.
- The page never drops events because the list is full. It keeps the newest 500 in the page and offers "Older events are in the event log" with a link to the CLI `ibeji events`. The control API keeps the newest 5,000 events.

---

## 9. Pages

The state tables below use these shared state names:

- Loading: the first request is still running.
- Empty: the request succeeded and there is nothing to show.
- Normal: the request succeeded and there is data.
- Error: the request failed with a C12 error.
- Disconnected: the control server cannot be reached.
- Twin off: the chosen twin is registered but not running.

For every page, the error panel shows `what`, `why` and `fix` from the API, then a "Try again" button. The disconnected policy is in section 8. The twin off policy is repeated on each page because the available actions differ.

### 9.1 Home

**Purpose.** Show the session at a glance and help a first-time person make one test request.

**Information and routes.**

| Information | Route |
|---|---|
| Version, seed, start time, running twins, active rules, running scenario | `GET /status` |
| Twin display name, running state, address, actions, currency rules, label token | `GET /twins` |
| Test keys with labels and roles | `GET /twins/:twin/credentials` |
| Saved webhook URL | `GET /twins/:twin/webhook-url` |
| Newest events for "What is happening now" | `GET /events?limit=10`, then `GET /events/stream` |
| Active rules detail | `GET /rules` |

**Actions and routes.**

| Action | Route |
|---|---|
| Copy base URL | Local clipboard only |
| Copy a test key | Local clipboard only |
| Rotate one twin's test keys | `POST /credentials/rotate` with `{ "twin": "<id>" }`, after confirmation |
| Change a webhook URL | Navigation to `/webhooks?twin=<id>` |
| Open Connect your app | Navigation to `/connect?twin=<id>` |
| Open Live activity | Navigation to `/activity?twin=<id>` |
| Retry a failed load | Same route again |

**Layout, top to bottom.**

1. Page title "Home" and the help text "This page shows the session, the twins and the newest activity."
2. Session strip with version, seed, start time and the running scenario name.
3. "What is happening now" panel with the newest 10 events, a live dot, and the link "Open Live activity".
4. "First time here?" guide with four steps.
5. Twin cards, one per running twin, or one per chosen twin when the switcher is not All.
6. Active rules summary with a link to Failures.

Each twin card contains, in order:

1. Twin name, label badge and status pill.
2. "Base URL" with a monospace value and a "Copy base URL" button.
3. "Test keys" with one row per credential: label, monospace value, "Copy" button.
4. The help "These are fake test keys. They only work with Ibeji."
5. "Webhook URL" with the saved value or "Not set." and a "Change" link.
6. Buttons "Open Connect your app" and "Rotate test keys".

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton session strip, one skeleton twin card, skeleton activity panel | Visible screen-reader text: "Loading Home." |
| Empty first run | Normal session, no events and no active rules | Activity: "Nothing has happened yet." Rules: "No failures are on." Guide: "Start with Connect your app." |
| Normal | Session strip, activity, guide, twin cards, rules | Section headings as above |
| Error | Error panel in place of the failed section | "Ibeji could not load this page." plus the C12 fields and "Try again" |
| Disconnected | Connection banner above the page, last data stays visible and marked "Last updated at <time>." | "Ibeji is not answering. The local process may have stopped. Ibeji will try again on its own." |
| Twin off | The chosen twin card remains visible | "Paystack is off. Start it with `ibeji start --twins paystack`." and "Base URL: not available while this twin is off." The keys and webhook URL still show. |

**Exact additional text.**

- Session strip: "Version 0.1.0", "Seed 123456", "Started 4 November 2026 at 10:42", "Scenario: Slow Friday" or "Scenario: none".
- Activity empty: "Nothing has happened yet." and "Make a test request, or run a scenario."
- Guide heading: "First time here?"
- Guide steps: "Open Connect your app.", "Copy the base URL and test keys into your app.", "Make a test payment.", "Watch it appear on Live activity."
- Rules empty: "No failures are on."
- Rotate confirmation: "Rotate Paystack test keys?" "The old keys stop working. Update your app with the new keys." "This cannot be undone." Buttons: "Cancel", "Rotate keys".

### 9.2 Connect your app

**Purpose.** Walk a person through pointing their app at one twin and prove the connection works.

**Information and routes.**

| Information | Route |
|---|---|
| Twin name, running state, base URL, actions, currency rules | `GET /twins` |
| Every declared test key with plain label and role | `GET /twins/:twin/credentials` |
| Saved webhook URL | `GET /twins/:twin/webhook-url` |
| Requests that reached the twin in the last 5 minutes | `GET /events?scope=<twin>&type=request&limit=500` |
| Responses for the last request | `GET /events?scope=<twin>&type=response&limit=500` |
| Live updates for the connection panel | `GET /events/stream?scope=<twin>` |

**Actions and routes.**

| Action | Route |
|---|---|
| Copy base URL, key or instruction | Local clipboard only |
| Save webhook URL | `PUT /twins/:twin/webhook-url` with `{ "url": "..." }` |
| Clear webhook URL | `PUT /twins/:twin/webhook-url` with `{ "url": "" }` |
| Check my connection | `GET /events?scope=<twin>&type=request&limit=500` and the response events |
| Open test checkout | The twin's checkout link from `GET /twins` actions, opened in a new tab |
| Change twin | The twin switcher, `?twin=<id>` |

**Layout, top to bottom.**

1. Page title "Connect your app" and the help "Point your app at one twin. Copy the base URL and test keys below."
2. When All is selected, a row of twin cards. Each card has the twin name, its label badge, a one-line "Connect Paystack" summary and a "Open guide" link.
3. When one twin is selected, a guide header with the twin badge and status pill.
4. "Base URL" block with the address and "Copy base URL".
5. "Test keys" block with every key, its label, its role and a copy button.
6. "Webhook URL" block with the saved value, a field, "Save webhook URL" and "Clear webhook URL".
7. "What to change in your app" numbered steps. The full text is in section 10.
8. "Check my connection" panel.
9. "For your coding agent" block with the ready-to-paste instruction and "Copy instruction".
10. A small footer note: "Ibeji is a local test tool. No real money moves. Ibeji is not affiliated with Paystack, Flutterwave or Stripe."

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton twin cards or guide blocks | Screen-reader text: "Loading Connect your app." |
| Empty first run | The twin picker, no request history | "Choose a twin to connect." and "Make your first test request after you copy the base URL and keys." |
| Normal | Full guide, connection panel, agent instruction | Sections as above |
| Error | Error panel in place of the failed block | "Ibeji could not load this guide." plus C12 fields and "Try again" |
| Disconnected | Banner above the guide, saved values remain readable | "Ibeji is not answering. The local process may have stopped. Ibeji will try again on its own." |
| Twin off | Guide header remains, base URL is unavailable, keys and webhook URL remain | "Paystack is off. Start it with `ibeji start --twins paystack`." and "You can still copy its saved test keys and webhook URL." |

**Check my connection text.**

- Heading: "Check my connection"
- Help: "This panel only reads Ibeji's own event log. It never contacts your app."
- Empty: "No requests have reached Paystack in the last 5 minutes."
- Found: "Last request: POST /transaction/initialize at 10:42. Ibeji answered with HTTP 200 (success)."
- Found without a response yet: "Last request: POST /transaction/initialize at 10:42. No response is recorded yet."
- Refresh button: "Check again"
- Disconnected: "The control connection is lost. This panel will update when Ibeji answers."

### 9.3 Live activity

**Purpose.** Show every request, response, webhook and failure as it happens in plain words.

**Information and routes.**

| Information | Route |
|---|---|
| Newest events with id, time, scope, type, summary and details | `GET /events?limit=500` |
| Live events | `GET /events/stream` |
| Filter by twin | `scope=<twin>` on both routes |
| Filter by type | `type=<event-type>` on `GET /events` |
| Catch up after a reconnect | `GET /events?after=<id>&limit=500` |
| Twin names and label tokens | `GET /twins` |

**Actions and routes.**

| Action | Route |
|---|---|
| Choose a twin | Twin switcher, `?twin=<id>` |
| Filter by event type | Local filter on the fetched events, or `GET /events?type=<type>` |
| Pause | Local only. Keep the stream open and buffer new events. |
| Resume | Local only. Insert buffered events and clear the count. |
| Open details | Local disclosure. Details come from the event's `details` object. |
| Jump to latest | Local scroll only |
| Clear filters | Local only |

**Layout, top to bottom.**

1. Page title "Live activity" and the help "Every request, response, webhook and failure appears here as it happens."
2. Filter bar with a type selector and the controls "Pause activity" or "Resume".
3. A live status line: "Live", "Paused. 4 new events arrived." or "Reconnecting."
4. A vertical timeline, newest first.
5. Each row: time, twin badge, event type, one-line summary and a "Details" button.
6. Expanded details: a two-column table of the `details` fields, the event id in mono, and the twin scope.
7. If the person has scrolled down while not paused, a floating "Jump to latest" button with the number of new items.

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton rows | Screen-reader text: "Loading Live activity." |
| Empty first run | Empty timeline | "No activity yet." and "Make a test request, or run a scenario." |
| Normal | Timeline with rows | "Live" |
| Paused | Timeline frozen, count of new events | "Paused. 3 new events arrived." Button: "Resume" |
| Error | Error panel above the last list | "Ibeji could not load activity." plus C12 fields and "Try again" |
| Disconnected | Banner and "Reconnecting." | "Ibeji is not answering. The local process may have stopped. Ibeji will try again on its own." |
| Twin off | The timeline shows the off panel instead of a filtered list | "Paystack is off. Start it to see new activity for this twin. Choose All to see other twins." |

**Exact additional text.**

- Filter label: "Event type"
- Filter options: "All types", "Requests", "Responses", "Webhooks", "Failures", "Warnings", "Rules", "Scenarios".
- Pause help: "Pause freezes this list. Ibeji keeps the connection open and counts new events."
- Details button: "Details"; expanded button: "Hide details".
- Empty after a filter: "No events match this filter." Button: "Clear filters".
- Live region summary: a polite message such as "3 new events. Newest: Payment succeeded." at most once every 5 seconds.

### 9.4 Failures

**Purpose.** Let a person switch on realistic failures and set how they behave.

**Information and routes.**

| Information | Route |
|---|---|
| Failure name, real-life text, app checks, settings schema, source and support | `GET /failures` |
| Twin names, running state, actions and supported failures | `GET /twins` |
| Active manual and scenario rules, counters and rule ids | `GET /rules` |
| Running scenario name | `GET /scenarios` or `GET /status` |

**Actions and routes.**

| Action | Route |
|---|---|
| Switch on a manual failure | `POST /rules` with `failureId`, `settings`, `twins` and optional `actions` |
| Switch off a manual failure | `DELETE /rules/:id` for each matching manual rule |
| Save edited settings | `POST /rules` first, then `DELETE /rules/:id` for the old rule |
| Clear every failure | `DELETE /rules`, after confirmation |
| Try again | Same route |

**Layout, top to bottom.**

1. Page title "Failures" and the help "Switch on a realistic failure and set how it behaves."
2. A running scenario banner when a scenario is active. It says the scenario name, its twins, and "This scenario owns some failures. Stop it on Scenarios to change them."
3. A summary line: "2 manual failures are on." or "No manual failures are on."
4. Failure cards in catalog order.
5. Each card: failure name, source label, real-life text, "What to check in your app" disclosure, settings form, twin checkboxes, action picker, switch, and a small "Used up" or "From scenario" label when relevant.
6. At the bottom, "Clear all failures" as a secondary destructive button.

**Failure card fields.**

- Name and source label.
- Real-life paragraph.
- "What to check in your app" one-line disclosure.
- Settings fields from the failure `settingsSchema`:
  - `seconds`: "Seconds", whole number, range and default from the schema.
  - `mode`: "Connection end", options "Keep the connection open" (`hang`) and "Drop it at once" (`reset`).
  - `times`: "Number of times", whole number, or "Every time while on" when empty. Help: "Leave empty to fire every time while the rule is on."
  - `status`: "HTTP status", whole number from 500 to 599.
  - `percent`: "Share of requests", whole number from 1 to 100, shown with a percent sign.
  - `when`: "When to drop it", options "Before the action" (`before`) and "After the action" (`after`).
  - `jitterSeconds`: "Extra random delay", whole number of seconds.
  - `copies`: "Copies", whole number from 2 to 5.
  - `gapSeconds`: "Seconds between copies", whole number.
  - `windowSeconds`: "Hold window", whole number of seconds.
  - `method`: "Verification failure", a select with the methods the twin declares. If the API does not list them, use the three names in the failure help: "wrong-secret", "corrupted", "missing".
  - `then`: "If the customer finishes", options "Succeed" and "Fail".
  - `thenFailPercent`: "Share that fail", whole number from 0 to 100.
  - `afterSeconds`: "Seconds before reversal", whole number.
- Twin checkboxes. Unsupported twins are disabled and show "Paystack does not support this failure." A running twin that is off is disabled and shows "Start Paystack with `ibeji start --twins paystack` to use it."
- Action picker. Default: "All supported actions". The options come from the chosen twin's `actions` intersected with the failure support actions. A person can also type a resource selector such as `refund`.
- Switch. The label is "Switch on Paystack" or "Switch off Paystack" when one twin is selected. With several twins it is "Switch on for 2 twins".

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton cards | Screen-reader text: "Loading Failures." |
| Empty first run | Catalog is present, no manual rules | "No failures are on." and "Choose a card below to switch one on." |
| Normal | Cards and active labels | "Switch on", "Switch off", "Save changes" |
| Error | Error panel or field errors | "Ibeji could not save this failure." plus all field problems and the C12 fields |
| Disconnected | Banner, cards remain readable, switches disabled | "Ibeji is not answering. Changes are paused until it returns." |
| Twin off | Cards remain, unsupported and off twins disabled | "Paystack is off. Start it with `ibeji start --twins paystack` to switch on failures for it." |

**Exact additional text.**

- Source labels: "From the service docs", "Assumed: not confirmed by the service's documentation.", "From a real story".
- Scenario label: "From scenario: Slow Friday".
- Used up label: "Used up".
- Clear all confirmation: "Clear all failures?" "This removes every failure rule and stops the running scenario. Records, webhook URLs, test keys and events stay." Buttons: "Cancel", "Clear all failures".
- Save error: "Some settings are not valid." plus the field names and the server's full `why` text.

### 9.5 Scenarios

**Purpose.** Run a ready-made story that switches on several failures at once.

**Information and routes.**

| Information | Route |
|---|---|
| Scenario name, story, supported twins, rules, steps and running state | `GET /scenarios` |
| Running or stopped active scenario | `GET /scenarios` or `GET /status` |
| Scenario start time for progress | `GET /events?type=scenario-started&limit=1` |
| Completed timed steps | `GET /events?type=scenario-step&limit=50` |
| Twin running state and names | `GET /twins` |

**Actions and routes.**

| Action | Route |
|---|---|
| Run a scenario | `POST /scenarios/:id/run` with optional `{ "twins": ["<id>"] }` |
| Stop the running scenario | `POST /scenarios/stop` |
| Choose a twin | Twin switcher and the card's twin checkboxes |
| Open the failures it switches on | Navigation to `/failures?twin=<id>` |

**Layout, top to bottom.**

1. Page title "Scenarios" and the help "A scenario switches on several failures at once."
2. Active scenario banner with name, twins, progress strip and "Stop scenario".
3. Scenario cards in file order.
4. Each card: name, story, supported twins, twin checkboxes, a short rule list, progress details if running, and "Run scenario".
5. The progress strip lists timed steps, for example "Step 1 of 1: remove the transfer error after 2 minutes." When a step completes, it changes to "Step 1 of 1: done."

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton cards | Screen-reader text: "Loading Scenarios." |
| Empty first run | No active scenario | "No scenario is running." and "Choose a story below." |
| Normal | Cards, run buttons, active banner | "Run scenario", "Stop scenario" |
| Error | Error panel | "Ibeji could not run that scenario." plus C12 fields and "Try again" |
| Disconnected | Banner, run and stop disabled | "Ibeji is not answering. Scenario controls are paused." |
| Twin off | Card disabled for that twin | "Paystack is off. Start it with `ibeji start --twins paystack` to run this scenario on Paystack." |

**Exact additional text.**

- Run confirmation when another scenario is running: "Run Slow Friday?" "This stops the running scenario first. Its rules are removed." Buttons: "Cancel", "Run scenario".
- No timed steps: "This scenario has no timed steps."
- Waiting: "Waiting for the first timed step."
- Scenario running: "Running on Paystack and Flutterwave."
- Stop button: "Stop scenario".
- After stop: "Scenario stopped."

### 9.6 Webhooks

**Purpose.** Show every webhook delivery and let a person resend one.

**Information and routes.**

| Information | Route |
|---|---|
| Deliveries with status, event id, twin, action, URL, times and attempts | `GET /webhooks` |
| Filter by twin and status | `GET /webhooks?twin=<id>&status=<status>` |
| Saved webhook URL for one twin | `GET /twins/:twin/webhook-url` |
| Address rules | The C13 help text in this plan, plus API errors |

**Actions and routes.**

| Action | Route |
|---|---|
| Save a webhook URL | `PUT /twins/:twin/webhook-url` with `{ "url": "..." }` |
| Clear a webhook URL | `PUT /twins/:twin/webhook-url` with `{ "url": "" }` |
| Resend a delivery | `POST /webhooks/:id/resend` |
| Filter deliveries | Twin switcher plus the status select |
| Try again | Same route |

**Layout, top to bottom.**

1. Page title "Webhooks" and the help "A webhook is a message Ibeji sends to your app. This page shows every delivery."
2. Webhook URL editor. When All is selected, a table of each twin's saved URL with an "Edit" button. When one twin is selected, a field with "Save webhook URL" and "Clear webhook URL".
3. Help: "The URL must use http or https. By default Ibeji sends only to this computer. Use the start flags to allow private or public addresses."
4. Status filter.
5. Delivery list, newest first.
6. Each delivery row: status pill, twin badge, event id, action id, destination URL, created time and attempt count.
7. Expanded delivery: attempts in order. Each attempt shows attempt number, start and finish time, outcome, response status, response time, remote address, error code and the first 4 KB of the response body in a code block.
8. "Resend" button on each delivery.

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton rows | Screen-reader text: "Loading Webhooks." |
| Empty first run | No deliveries | "No webhooks yet." and "Set a webhook URL, then make a test payment." |
| Normal | URL editor and delivery list | Status words from section 6.1 |
| Error | Error panel near the failed action | "Ibeji could not save that webhook URL." plus C12 fields and "Try again" |
| Disconnected | Banner, resend disabled | "Ibeji is not answering. Resend is paused until it returns." |
| Twin off | URL editor remains, deliveries hidden for that twin | "Paystack is off. You can still set its webhook URL. Deliveries appear when it runs." |

**Exact additional text.**

- URL empty: "No webhook URL set."
- Address refused: use the server's C12 `what`, `why` and `fix` in the field error area.
- Resend button: "Resend"; while busy: "Resending..."; after success: "Delivery queued again."
- Attempt summary: "Attempt 2: No answer at 10:44. Ibeji will try again."
- Response body label: "First 4 KB of the response"
- Response body empty: "The app returned an empty body."
- No attempts yet: "No attempts yet. This delivery is waiting to send."
- Not sent reason: "Not sent because no webhook URL was set." or "Not sent because the webhook-never-sent failure fired."

### 9.7 Data

**Purpose.** Show each twin's records in readable tables and let a person reset them.

**Information and routes.**

| Information | Route |
|---|---|
| Twin names, running state, currency rules and label tokens | `GET /twins` |
| Collection labels, columns and records for one twin | `GET /twins/:twin/state` |
| Collected records for all twins in the export | `GET /export` is not used by this page |

**Actions and routes.**

| Action | Route |
|---|---|
| Choose a twin | Twin switcher |
| Reset one twin's records | `DELETE /twins/:twin/state`, after confirmation |
| Reset every twin's records | `DELETE /state`, after confirmation |
| Try again | Same route |

**Layout, top to bottom.**

1. Page title "Data" and the help "This page shows the records each twin has created."
2. Reset bar with "Reset Paystack records" when one twin is selected, or "Reset all records" when All is selected.
3. Twin sections, one per running twin. When All is selected, show each running twin in registry order.
4. Each section: twin badge, status pill and one table per collection.
5. Each table: collection label, column headers from the API, rows, and an empty row message when the collection is empty.
6. Money columns use the twin's currency rules from `GET /twins`. Dates use the local date and time with the time zone shown once at the top of the table.
7. Record ids are monospace and can be copied.

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Loading | Skeleton tables | Screen-reader text: "Loading Data." |
| Empty first run | Tables with headers and no rows | "No records yet." and "Make a test request to see records here." |
| Normal | Tables with rows | "Reset Paystack records" |
| Error | Error panel | "Ibeji could not load those records." plus C12 fields and "Try again" |
| Disconnected | Banner, reset disabled | "Ibeji is not answering. Records may be out of date." |
| Twin off | Off panel in place of the tables | "Paystack is off. Start it to see its records." |

**Exact reset text.**

- Single twin: "Reset Paystack records?" "This deletes every payment, refund, transfer, recipient and bank record for Paystack. It cancels queued and scheduled webhooks and marks them abandoned. It keeps failure rules, scenarios, webhook URLs, test keys and events." "This cannot be undone." Buttons: "Cancel", "Reset records".
- All twins: "Reset all twin records?" "This deletes every record for every running twin. It cancels queued and scheduled webhooks and marks them abandoned. It keeps failure rules, scenarios, webhook URLs, test keys and events." "This cannot be undone." Buttons: "Cancel", "Reset all records".
- After reset: "Records reset. Queued webhooks were marked abandoned."

**Money formatting.**

The UI uses the chosen twin's `currencyRules` from `GET /twins`.

- `zeroDecimal` lists currencies with no decimal part.
- `fractionDigits[currency]` gives the number of decimal places when present.
- If the currency is missing, use `defaultFractionDigits`.
- Amounts arrive as whole numbers in the smallest unit. The UI formats them for reading only. It never sends a formatted amount back to the twin.
- A currency with no known rule shows the whole number and the currency code with the help "Ibeji does not know this currency's decimal places."

### 9.8 Test checkout pages

These pages are not in the dashboard navigation. Each twin serves its own page on its own port. The page is server-rendered HTML with no React. It uses the same tokens and local fonts as the dashboard.

**Purpose.** Let a person choose a test payment outcome without signing in.

**Information shown.**

| Information | Source |
|---|---|
| Twin display name | The twin's definition |
| Amount and currency | The twin's own record |
| Customer email | The twin's own record |
| Reference | The twin's own record |
| Outcomes | The twin's `checkout.outcomes` |
| Failure override notice | The active failure effects |
| Test-only notice | Static text |

**Actions.**

| Action | What happens |
|---|---|
| Choose an outcome | A POST form to the twin's own checkout route |
| Submit | The twin applies the outcome and sends its webhooks |
| Back to app | The twin redirects to the callback URL when one was set |

**Layout, top to bottom.**

1. Ibeji wordmark and "Ibeji test checkout".
2. "[Service] twin. No real money moves."
3. Amount and currency in large text.
4. Customer email and reference.
5. Outcome buttons.
6. Failure override notice when a rule changed the result.
7. A short safety line: "This page is part of Ibeji. It is not the real service."
8. Footer: "Ibeji is not affiliated with [Service]."

**Outcome words.**

Paystack:

- "Pay successfully"
- "Decline the payment"
- "Abandon the payment"

Flutterwave:

- "Pay successfully"
- "Fail the payment"
- "Cancel the payment"

Stripe, version 0.2.0:

- "Pay successfully"
- "Decline the card"
- "Ask for extra authentication", then "Approve the check" or "Fail the check"

**Failure override text.**

"An Ibeji failure rule changed this result: Declined payment is on for this twin."

The failure name comes from the catalog. The page never names a failure id in the visible text.

**States.**

| State | What it shows | Exact text |
|---|---|---|
| Normal | Amount, record details and outcome buttons | "Choose a result." |
| Submitted success | Result page or redirect | "Payment complete. This was a test. No real money moved." |
| Submitted decline | Result page | "Payment declined. This was a test. No real money moved." |
| Submitted abandoned or cancelled | Result page | "Payment cancelled. This was a test. No real money moved." |
| Invalid or missing record | Error page | "This test checkout was not found. Return to your app and start a new payment." |
| Twin not running | The browser cannot connect because the twin server is stopped | No page can be shown. The dashboard explains how to start the twin. |
| Error | Server-rendered error page | "The test checkout could not finish." plus the C12 fields in plain words. |

---

## 10. Connect your app in full

This section is the full text of the Connect your app page. The page shows the actual base URL and keys from the control API. The examples below use the default ports. The UI always shows the bound port, not the default.

Every guide ends with the same warning:

"Never put a live key in test settings. Live keys must never be used with Ibeji."

### 10.1 Paystack

**Heading.** "Connect Paystack"

**Summary.** "Point your app at the local Paystack twin. Use the Ibeji test keys below. No real money moves."

**Test keys this twin declares.**

- Public key: label "Public key", value `pk_test_ibeji_...`.
- Secret key: label "Secret key", value `sk_test_ibeji_...`.

Paystack webhooks use the secret key for their signature. Ibeji does not invent a separate Paystack webhook secret.

**Step 1: Copy the base URL.**

"Copy the base URL and use it for every Paystack API call. The default is `http://127.0.0.1:4401`. Do not use `https://api.paystack.co`."

Copy field: "Base URL".

**Step 2: Copy the test keys.**

"Copy the public key into browser test code. Copy the secret key into your server's test settings. These keys are fake and only work with Ibeji."

Copy fields: "Public key", "Secret key".

**Step 3: Change the API call.**

"The official Paystack Node library is `@paystack/paystack-sdk` 1.2.2. It cannot change its base URL. Community libraries also hard-code the Paystack address. Use `fetch` or another HTTP client instead. An HTTP client is a small library that sends web requests."

Plain steps:

1. "Send `POST {base}/transaction/initialize` with JSON `{ email, amount }`. The amount is in the smallest unit, for example kobo for NGN."
2. "Read `data.authorization_url` and send the customer there. The twin checkout page opens on this computer."
3. "Read `data.reference`. Use `GET {base}/transaction/verify/{reference}` to check the result."
4. "Send `POST {base}/refund` with `{ transaction: reference }` and an optional amount to test a refund."
5. "Send the secret key in `Authorization: Bearer <secret key>`."

**Step 4: Set the webhook URL.**

"Open the Webhooks page and set the Paystack webhook URL to your app's endpoint. Paystack signs each webhook with the `x-paystack-signature` header. The signature is a keyed hash called HMAC SHA512. It is made from the exact bytes of the request body and the secret key. Verify it before you trust the message."

**Step 5: Check my connection.**

"Make one test request. This panel reads Ibeji's event log and shows the last request that reached Paystack. It never contacts your app."

**Agent instruction.**

Text block, ready to copy:

```text
You are connecting this app to the local Ibeji Paystack twin.

Read these values from environment variables:
IBEJI_PAYSTACK_BASE_URL
IBEJI_PAYSTACK_PUBLIC_KEY
IBEJI_PAYSTACK_SECRET_KEY

Never write a key in source code, a committed file, or a browser bundle. Use the secret key only on the server.

The official Paystack Node library is @paystack/paystack-sdk 1.2.2. It cannot change its base URL. Use fetch or another HTTP client. Send requests to IBEJI_PAYSTACK_BASE_URL. Do not use https://api.paystack.co.

For a payment:
1. POST {base}/transaction/initialize with JSON { email, amount }. The amount is in the smallest unit, for example kobo for NGN.
2. Send the customer to data.authorization_url.
3. Read data.reference and verify with GET {base}/transaction/verify/{reference}.

For a refund:
POST {base}/refund with JSON { transaction: reference, amount? }.

Send the secret key in Authorization: Bearer <IBEJI_PAYSTACK_SECRET_KEY>.

Verify webhooks with the x-paystack-signature header. It is an HMAC SHA512 of the raw request body using the secret key.

Never put a live key in test settings. Live keys must never be used with Ibeji.

Do not hard-code the port. Read the base URL from IBEJI_PAYSTACK_BASE_URL.
```

### 10.2 Flutterwave

**Heading.** "Connect Flutterwave"

**Summary.** "Point your app at the local Flutterwave twin. Use the Ibeji test keys below. No real money moves."

**Test keys this twin declares.**

- Public key: label "Public key", value `FLWPUBK_TEST-ibeji-...`.
- Secret key: label "Secret key", value `FLWSECK_TEST-ibeji-...`.
- Webhook hash: label "Webhook hash", value `ibeji_...`.

The encryption key is not issued because the hosted payment flow in C4b does not use direct card-charge encryption.

**Step 1: Copy the base URL.**

"Copy the base URL and use it for every Flutterwave v3 API call. The default is `http://127.0.0.1:4402`. Do not use `https://api.flutterwave.com/v3`."

Copy field: "Base URL".

**Step 2: Copy the test keys.**

"Copy the public key into browser test code. Copy the secret key into your server's test settings. Copy the webhook hash into your webhook check. These values are fake and only work with Ibeji."

Copy fields: "Public key", "Secret key", "Webhook hash".

**Step 3: Point the official library at Ibeji.**

"This twin imitates Flutterwave API v3. v3 is the API version used by the official Node library. The official v3 Node library is `flutterwave-node-v3` 1.4.1. It accepts the base URL as the third constructor argument. The base URL must end with a slash because the library appends `v3/...` paths."

```js
const baseUrl = process.env.IBEJI_FLUTTERWAVE_BASE_URL;
const withSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
const flw = new Flutterwave(
  process.env.IBEJI_FLUTTERWAVE_PUBLIC_KEY,
  process.env.IBEJI_FLUTTERWAVE_SECRET_KEY,
  withSlash,
);
```

"The library has no Standard hosted-payment method. A hosted payment is a payment page that the payment service runs. Its `Charge` group calls `/v3/charges`, not `/v3/payments`. Create the hosted payment with `POST {base}/v3/payments` and `fetch`, read `data.link`, and send the customer there. Then use the library for the operations it does expose."

Plain steps:

1. "Send `POST {base}/v3/payments` with JSON `{ amount, tx_ref, currency, redirect_url, customer: { email } }`. Amounts are whole currency amounts, for example `7500` for NGN 7,500."
2. "Read `data.link` and send the customer there."
3. "Verify with `flw.Transaction.verify({ id })` or `flw.Transaction.verify_by_tx({ tx_ref })`."
4. "Refund with `flw.Transaction.refund({ id: String(transactionId), amount })`."
5. "Send the secret key in `Authorization: Bearer <secret key>`."

"The library starts telemetry code. Telemetry means automatic usage messages. That code contacts external Flutterwave and SigNoz hosts. Ibeji's compatibility test stubs those calls. If your app must make no outside requests, use direct HTTP calls instead of the library."

**Step 4: Set the webhook URL.**

"Open the Webhooks page and set the Flutterwave webhook URL to your app's endpoint. Flutterwave sends a `verif-hash` header. Compare it with the webhook hash before you trust the message. The v3 refund webhook has no documented event name. Treat the refund payload as its own message."

**Step 5: Check my connection.**

"Make one test request. This panel reads Ibeji's event log and shows the last request that reached Flutterwave. It never contacts your app."

**Agent instruction.**

```text
You are connecting this app to the local Ibeji Flutterwave twin.

Read these values from environment variables:
IBEJI_FLUTTERWAVE_BASE_URL
IBEJI_FLUTTERWAVE_PUBLIC_KEY
IBEJI_FLUTTERWAVE_SECRET_KEY
IBEJI_FLUTTERWAVE_WEBHOOK_HASH

Never write a key in source code, a committed file, or a browser bundle. Use the secret key only on the server.

This twin imitates Flutterwave API v3. The base URL default is http://127.0.0.1:4402.

The official flutterwave-node-v3 library can point at Ibeji. Pass the base URL as the third constructor argument and make sure it ends with a slash:
const baseUrl = process.env.IBEJI_FLUTTERWAVE_BASE_URL;
const withSlash = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
const flw = new Flutterwave(publicKey, secretKey, withSlash);

The library has no Standard hosted-payment method. Create the hosted payment with POST {base}/v3/payments using fetch. Read data.link and send the customer there. Then use the library for verify, verify_by_tx and refund.

The library may send telemetry to external hosts when it starts. If the app must stay fully local, use direct HTTP instead.

Verify webhooks by comparing the verif-hash header with IBEJI_FLUTTERWAVE_WEBHOOK_HASH.

Never put a live key in test settings. Live keys must never be used with Ibeji.

Do not hard-code the port. Read the base URL from IBEJI_FLUTTERWAVE_BASE_URL.
```

### 10.3 Stripe

This guide appears in version 0.2.0, when the Stripe twin is registered. It is not shown in version 0.1.0.

**Heading.** "Connect Stripe"

**Summary.** "Point your app at the local Stripe twin. Use the Ibeji test keys below. No real money moves."

**Test keys this twin declares.**

- Publishable key: label "Publishable key", value `pk_test_ibeji_...`.
- Secret key: label "Secret key", value `sk_test_ibeji_...`.
- Webhook secret: label "Webhook secret", value `whsec_ibeji_...`.

**Step 1: Copy the base URL.**

"Copy the base URL and use it for every Stripe v1 API call. The default is `http://127.0.0.1:4403`. Do not use `https://api.stripe.com`."

Copy field: "Base URL".

**Step 2: Copy the test keys.**

"Copy the publishable key into browser test code if your app uses one. Copy the secret key and webhook secret into your server's test settings. These values are fake and only work with Ibeji."

Copy fields: "Publishable key", "Secret key", "Webhook secret".

**Step 3: Point the official library at Ibeji.**

"The official `stripe` Node library supports a custom host, port and protocol. It also lets you disable telemetry. Parse the base URL environment variable so the host and port stay correct when Ibeji uses another port."

```js
const base = new URL(process.env.IBEJI_STRIPE_BASE_URL);
const stripe = new Stripe(process.env.IBEJI_STRIPE_SECRET_KEY, {
  host: base.hostname,
  port: Number(base.port),
  protocol: base.protocol === "https:" ? "https" : "http",
  apiVersion: "2026-09-30.endive",
  telemetry: false,
});
```

"The library appends `/v1/...` paths. An API version is the version of the request and response shapes. The Stripe twin serves only API version `2026-09-30.endive`. It accepts no version header or the exact version. It rejects other versions."

Plain steps:

1. "Create a PaymentIntent with `stripe.paymentIntents.create({ amount, currency })`. A PaymentIntent is one payment record."
2. "Or create a Checkout Session with `stripe.checkout.sessions.create`. A Checkout Session is one checkout page record. The twin returns a local checkout URL."
3. "Complete the local checkout page."
4. "Verify the PaymentIntent or Checkout Session, or use the twin's Events API. The Events API is the list of things that happened."
5. "Refund with `stripe.refunds.create` and a `payment_intent` id."

**Step 4: Set the webhook URL.**

"Open the Webhooks page and set the Stripe webhook URL to your app's endpoint. Stripe signs each webhook with the `Stripe-Signature` header. The signature is a keyed hash called HMAC SHA256. It is made from the timestamp, a literal dot, and the exact bytes of the body, using the webhook secret. The timestamp tolerance is the allowed clock difference. Check it and use the exact body bytes."

**Step 5: Check my connection.**

"Make one test request. This panel reads Ibeji's event log and shows the last request that reached Stripe. It never contacts your app."

**Agent instruction.**

```text
You are connecting this app to the local Ibeji Stripe twin.

Read these values from environment variables:
IBEJI_STRIPE_BASE_URL
IBEJI_STRIPE_PUBLIC_KEY
IBEJI_STRIPE_SECRET_KEY
IBEJI_STRIPE_WEBHOOK_SECRET

Never write a key in source code, a committed file, or a browser bundle. Use the secret key and webhook secret only on the server.

This guide is for Ibeji version 0.2.0, when the Stripe twin is registered.

The official stripe Node library can point at Ibeji. Parse the base URL and set host, port, protocol and apiVersion:
const base = new URL(process.env.IBEJI_STRIPE_BASE_URL);
const stripe = new Stripe(process.env.IBEJI_STRIPE_SECRET_KEY, {
  host: base.hostname,
  port: Number(base.port),
  protocol: base.protocol === "https:" ? "https" : "http",
  apiVersion: "2026-09-30.endive",
  telemetry: false,
});

The twin serves only API version 2026-09-30.endive. Use telemetry false so the library does not send telemetry to Stripe.

Create PaymentIntents, Checkout Sessions and Refunds through the library. Complete the local checkout page that the twin returns.

Verify webhooks with the Stripe-Signature header and IBEJI_STRIPE_WEBHOOK_SECRET. Use the raw request body.

Never put a live key in test settings. Live keys must never be used with Ibeji.

Do not hard-code the port. Read the base URL from IBEJI_STRIPE_BASE_URL.
```

---

## 11. Accessibility plan

### 11.1 Keyboard order

Every page follows this order:

1. Skip link: "Skip to main content".
2. Top bar: wordmark, connection status, Help button.
3. Twin switcher: All, then each twin.
4. Left navigation or horizontal navigation: seven links.
5. Main heading.
6. Page actions.
7. Page content.
8. Footer links.

Inside a card, the order is heading, help, fields, twin choices, action picker, switch, secondary actions. Dialogs trap focus and return focus to the button that opened them. Escape closes a dialog. The first focus in a confirmation dialog is "Cancel".

### 11.2 Focus styles

- Light surface: 3 px solid `#6B4FA1` ring with 2 px white offset. Ratio 6.45 to 1.
- Dark surface: 3 px solid `#FFFFFF` ring with 2 px `#2F1B45` offset. Ratio 15.40 to 1.
- Focus is never removed. `:focus-visible` is used so a mouse click does not show the ring, but keyboard focus always does.
- A focused link or button also gets a 2 px underline or border so the state is not colour alone.

### 11.3 Screen-reader labels

- Twin switcher: `<nav aria-label="Twin">`. Each link has the twin name and a visually hidden status: "Paystack, running" or "Paystack, off".
- Status pills: text is real text, not a background image. The pill has no extra `aria-label` that hides the text.
- Copy buttons: "Copy base URL for Paystack", "Copy secret key for Paystack", "Copy instruction for Paystack".
- Tables: each table has a `<caption>` with the collection label. Column headers are `<th scope="col">`.
- Forms: every field has a visible `<label>`. Help text is linked with `aria-describedby`. Errors are linked with `aria-describedby` and `aria-invalid="true"`.
- Dialogs: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`.
- Live event rows: no `aria-live` on the list. The separate live region announces summaries.
- The wordmark is text, not an image. The page has one `<h1>`.

### 11.4 Live regions

- One polite live region at the app root: `role="status"`, `aria-live="polite"`, `aria-atomic="true"`.
- It announces at most one summary every 5 seconds. Example: "3 new events. Newest: Payment succeeded."
- When paused: "4 new events while paused." It announces at most once every 5 seconds.
- On reconnect: "Connected again. Live updates resumed."
- On a destructive action: "Paystack records reset."
- The region does not read every event. The event list itself is not a live region.
- The "New activity" count is visible text and is updated visually without repeated announcements.
- Error panels use `role="alert"` for the first error only. Field errors are not announced one by one.

### 11.5 Motion and timing

- Respect `prefers-reduced-motion`.
- No content flashes more than three times per second.
- Auto-updating lists never move focus. If the user is reading an expanded event, new events do not collapse it.
- The Pause button is the only way to stop the list. Scrolling does not pause it.

### 11.6 Touch and tablet

- Every control has a target of at least 44 by 44 px.
- Tables scroll horizontally inside a labelled region. The page itself does not scroll sideways.
- The twin switcher and navigation rows scroll sideways with visible edge shadows.
- At 768 px the two-column card grid becomes one column.

---

## 12. Fonts

### 12.1 Packages

- `@fontsource/ibm-plex-sans` 5.3.0.
- `@fontsource/ibm-plex-mono` 5.3.0.

Both are installed in `devDependencies`.

### 12.2 What the packages contain

Each package contains:

- A `files/` folder with `.woff` and `.woff2` font binaries.
- CSS files for each weight and subset.
- SCSS metadata and mixins.
- `metadata.json`, `unicode.json`, `README.md`, `CHANGELOG.md` and `LICENSE`.
- A TypeScript declaration file for the CSS module.

The `files/` folders contain only font binaries. The packages as a whole are not only font files; they also contain CSS, SCSS, metadata and documentation. Neither package contains JavaScript runtime code, images, install scripts or native code.

### 12.3 Files to bundle

Copy these files into `dist/ui/assets/fonts/` at build time. Do not load them from a CDN.

IBM Plex Sans:

- `ibm-plex-sans-latin-400-normal.woff2`
- `ibm-plex-sans-latin-600-normal.woff2`
- `ibm-plex-sans-latin-ext-400-normal.woff2`
- `ibm-plex-sans-latin-ext-600-normal.woff2`

IBM Plex Mono:

- `ibm-plex-mono-latin-400-normal.woff2`
- `ibm-plex-mono-latin-ext-400-normal.woff2`

Add the `.woff` fallbacks only if the browser support target needs them. The build copies the font files and the two `LICENSE` files. It also adds a `THIRD-PARTY-NOTICES` entry that names IBM Plex Sans and IBM Plex Mono, the copyright holder and the licence.

### 12.4 Licence

Both fonts are licensed under the SIL Open Font License, Version 1.1 (`OFL-1.1`).

- IBM Plex Sans: Copyright 2019 IBM Corp. All rights reserved.
- IBM Plex Mono: Copyright 2017 IBM Corp. All rights reserved.

The OFL allows bundling, embedding and redistribution with software. The fonts are not sold by themselves. The licence text is included with the built UI.

### 12.5 Font loading

- Use `@font-face` with `font-display: swap`.
- Preload only the IBM Plex Sans 400 latin `woff2` file.
- Use `system-ui, sans-serif` and `ui-monospace, monospace` fallbacks.
- The UI never loads a font from the internet.
- The UI does not use a font from a service brand.

---

## 13. Build and serving notes for Phase 6

These notes keep the plan tied to the current server.

1. The control server will serve the built UI from `dist/ui`.
2. Hashed asset names get `Cache-Control: public, max-age=31536000, immutable`.
3. `index.html` gets `Cache-Control: no-store`.
4. Unknown page paths return `index.html`.
5. Unknown API paths keep returning the C12 `NOT_FOUND` JSON.
6. The server keeps the Host check, no CORS, HTML security headers and 1 MB body limit for the UI routes.
7. The UI never adds CORS headers and never calls a twin directly from the dashboard. It calls the control API. The test checkout pages are the only browser pages that talk to a twin port, and they are plain forms on the twin's own origin.
8. The UI build includes the local fonts and the licence files.
9. A test must check that no asset, font, script or stylesheet request leaves `127.0.0.1`.

---

## 14. Phase 6 checklist for the implementation

The UI work is ready to start when these plan items exist:

- The seven pages and the test checkout pages are implemented.
- The twin switcher uses `labelColourToken` and never a service colour.
- The exact text in this plan is used, or a later approved change replaces it.
- The contrast table is tested with an automated check.
- Keyboard-only and screen-reader checks cover the switcher, copy buttons, forms, dialogs and pause control.
- The sign-in flow removes the launch code from the address bar and uses no web storage.
- Reconnection catches up with `Last-Event-ID` and `/events?after=`.
- The font files and licences are in `dist/ui`, and no request leaves the computer.
- No live key is ever requested, shown or logged.

---

## 15. Usability refresh, 4 November 2026

The dashboard was refreshed after a review of the first Home build. The goal is a flatter, quieter interface and wording that a first-time user can follow without knowing payment-industry terms.

**Visual rules.**

- No shadows and no gradients anywhere. Borders are 1 px hairlines derived from the Ibeji palette.
- The top bar is white with a hairline bottom border. Connection state uses a small dot plus text.
- The left navigation uses a soft lavender active state, not a solid dark fill.
- Cards and panels use flat surfaces, 14 px corners and hairline borders. Empty states and the first-time guide use a soft lavender surface.
- Status uses a coloured dot plus text, never colour alone.
- Buttons are flat. The main action is purple; secondary actions are quiet outlined buttons.
- The interface stays usable at 390 px wide, not only at the 768 px target.

**Words used in the interface.**

| Instead of | Use |
|---|---|
| Base URL | App address |
| Seed | Repeatable run |
| Webhook URL | Webhook address |
| Rotate test keys | Replace test keys |
| What is happening now | Latest activity |
| Active rules | Failures turned on |
| Rule | Failure turned on for one or more twins |
| Off twins stay visible | A twin that is off stays visible |

The current source and the Playwright tests are the authority for exact text where the earlier sections of this plan still show the first draft. The original meaning, routes, states and safety rules do not change.
