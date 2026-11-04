import type { CheckoutOutcome, CheckoutPageModel, CheckoutResult, MoneyRules } from "./types.js";

export const CHECKOUT_STYLES = `
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url("/_ibeji/fonts/ibm-plex-sans-latin-400-normal.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-display: swap;
  font-weight: 600;
  src: url("/_ibeji/fonts/ibm-plex-sans-latin-600-normal.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url("/_ibeji/fonts/ibm-plex-sans-latin-ext-400-normal.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: "IBM Plex Sans";
  font-style: normal;
  font-display: swap;
  font-weight: 600;
  src: url("/_ibeji/fonts/ibm-plex-sans-latin-ext-600-normal.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
@font-face {
  font-family: "IBM Plex Mono";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url("/_ibeji/fonts/ibm-plex-mono-latin-400-normal.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "IBM Plex Mono";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url("/_ibeji/fonts/ibm-plex-mono-latin-ext-400-normal.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
:root {
  --ibeji-white: #ffffff;
  --ibeji-black: #111111;
  --ibeji-purple: #6b4fa1;
  --ibeji-dark-grey: #3a3a3a;
  --ibeji-dark-purple: #2f1b45;
  --ibeji-red: #8f1d21;
  --color-surface: var(--ibeji-white);
  --color-surface-muted: color-mix(in srgb, var(--ibeji-purple) 5%, var(--ibeji-white));
  --color-surface-accent: color-mix(in srgb, var(--ibeji-purple) 10%, var(--ibeji-white));
  --color-text: var(--ibeji-black);
  --color-text-muted: var(--ibeji-dark-grey);
  --color-line: color-mix(in srgb, var(--ibeji-dark-grey) 16%, var(--ibeji-white));
  --color-line-strong: color-mix(in srgb, var(--ibeji-dark-grey) 32%, var(--ibeji-white));
  --color-accent: var(--ibeji-purple);
  --color-accent-strong: var(--ibeji-dark-purple);
  --color-focus: var(--ibeji-purple);
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --radius-md: 10px;
  --radius-lg: 14px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --border-width: 1px;
  --focus-width: 3px;
  --focus-offset: 2px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--color-surface-muted); color: var(--color-text); font-family: var(--font-sans); line-height: 1.5; }
main { max-width: 42rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
.card { background: var(--color-surface); border: var(--border-width) solid var(--color-line); border-radius: var(--radius-lg); padding: var(--space-6); }
h1 { font-size: 1.75rem; line-height: 1.3; margin: 0 0 var(--space-2); font-weight: 600; letter-spacing: -0.015em; }
p { margin: var(--space-2) 0; }
.label { color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
.amount { font-family: var(--font-mono); font-size: 2rem; font-weight: 600; margin: var(--space-1) 0; }
.reference { font-family: var(--font-mono); overflow-wrap: anywhere; }
.notice { border-left: 3px solid var(--color-accent-strong); background: var(--color-surface-accent); padding: var(--space-3) var(--space-4); margin: var(--space-4) 0; border-radius: var(--radius-md); }
.outcomes { display: grid; gap: var(--space-3); margin: var(--space-6) 0 var(--space-2); }
button { font: inherit; cursor: pointer; border-radius: var(--radius-md); border: var(--border-width) solid var(--color-line-strong); background: var(--color-surface); color: var(--color-text); padding: var(--space-3) var(--space-4); text-align: left; }
button:hover, button:focus-visible { background: var(--color-surface-accent); border-color: var(--color-accent); }
button:focus-visible { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--focus-offset); }
button strong { display: block; }
button span { display: block; color: var(--color-text-muted); font-size: 0.875rem; }
footer { margin-top: var(--space-6); color: var(--color-text-muted); font-size: 0.875rem; }
.wordmark { color: var(--color-accent-strong); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.hint { color: var(--color-text-muted); }
.safety { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--border-width) solid var(--color-line); color: var(--color-text-muted); font-size: 0.875rem; }
`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function outcomeButton(outcome: CheckoutOutcome): string {
  const description = `<span>${escapeHtml(outcome.description)}</span>`;
  if (outcome.authentication === undefined) {
    return `<button type="submit" name="outcome" value="${escapeHtml(outcome.id)}"><strong>${escapeHtml(outcome.label)}</strong>${description}</button>`;
  }

  return [
    `<button type="submit" name="outcome" value="${escapeHtml(`${outcome.id}|approve`)}"><strong>${escapeHtml(outcome.authentication.approveLabel)}</strong>${description}</button>`,
    `<button type="submit" name="outcome" value="${escapeHtml(`${outcome.id}|fail`)}"><strong>${escapeHtml(outcome.authentication.failLabel)}</strong>${description}</button>`,
  ].join("");
}

export function renderCheckoutPage(model: CheckoutPageModel, money: MoneyRules): string {
  const email =
    model.customerEmail === undefined
      ? ""
      : `<p><span class="label">Customer</span><br>${escapeHtml(model.customerEmail)}</p>`;
  const notice =
    model.failureNotice === undefined
      ? ""
      : `<p class="notice" role="status">${escapeHtml(model.failureNotice)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ibeji test checkout: ${escapeHtml(model.twinDisplayName)} twin</title>
<link rel="preload" href="/_ibeji/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/_ibeji/checkout.css">
</head>
<body>
<main>
<div class="card">
<p class="wordmark">Ibeji</p>
<h1>Ibeji test checkout: ${escapeHtml(model.twinDisplayName)} twin. No real money moves.</h1>
<p>This page is a local imitation for testing an app. No real money moves.</p>
<p class="amount">${escapeHtml(money.formatDisplay(model.amountMinor, model.currency))}</p>
<p><span class="label">Currency</span><br>${escapeHtml(model.currency)}</p>
${email}
<p><span class="label">Reference</span><br><span class="reference">${escapeHtml(model.reference)}</span></p>
${notice}
<p class="hint">Choose a result.</p>
<form method="post" action="">
<div class="outcomes">
${model.outcomes.map(outcomeButton).join("\n")}
</div>
</form>
<p class="safety">This page is part of Ibeji. It is not the real service.</p>
</div>
<footer>This checkout is served by Ibeji on this computer only. Ibeji is not affiliated with ${escapeHtml(model.twinDisplayName)}.</footer>
</main>
</body>
</html>`;
}

export function renderCheckoutResult(result: CheckoutResult, twinDisplayName?: string): string {
  const heading =
    twinDisplayName === undefined
      ? "Ibeji test checkout result"
      : `Ibeji test checkout result: ${escapeHtml(twinDisplayName)} twin`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<link rel="preload" href="/_ibeji/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/_ibeji/checkout.css">
</head>
<body>
<main>
<div class="card">
<p class="wordmark">Ibeji</p>
<h1>${heading}</h1>
<p role="status">${escapeHtml(result.notice)}</p>
<p>No real money moved.</p>
<p class="safety">This page is part of Ibeji. It is not the real service.</p>
</div>
<footer>You can close this page and return to the app.${twinDisplayName === undefined ? "" : ` Ibeji is not affiliated with ${escapeHtml(twinDisplayName)}.`}</footer>
</main>
</body>
</html>`;
}
