import type { CheckoutOutcome, CheckoutPageModel, CheckoutResult, MoneyRules } from "./types.js";

const STYLES = `
:root{--white:#fff;--black:#111;--purple:#5b21b6;--dark-grey:#374151;--dark-purple:#3b0764;--bg:#f7f5fb;--line:#d8d2e8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--black);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.5}
main{max-width:42rem;margin:0 auto;padding:2rem 1rem 4rem}
.card{background:var(--white);border:1px solid var(--line);border-radius:.75rem;padding:1.5rem;box-shadow:0 8px 24px rgb(17 17 17 / 8%)}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .5rem}
p{margin:.5rem 0}
.label{color:var(--dark-grey);font-size:.875rem;text-transform:uppercase;letter-spacing:.04em}
.amount{font-size:2rem;font-weight:700;margin:.25rem 0}
.reference{font-family:"IBM Plex Mono",ui-monospace,monospace;overflow-wrap:anywhere}
.notice{border-left:4px solid var(--purple);background:#f3e8ff;padding:.75rem 1rem;margin:1rem 0}
.outcomes{display:grid;gap:.75rem;margin:1.25rem 0}
button{font:inherit;cursor:pointer;border-radius:.5rem;border:1px solid var(--purple);background:var(--white);color:var(--dark-purple);padding:.75rem 1rem;text-align:left}
button:hover,button:focus-visible{background:var(--purple);color:var(--white);outline:3px solid var(--dark-purple);outline-offset:2px}
button strong{display:block}
button span{display:block;font-size:.875rem;opacity:.9}
footer{margin-top:2rem;color:var(--dark-grey);font-size:.875rem}
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
<title>${escapeHtml(model.twinDisplayName)} test checkout</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<div class="card">
<h1>Ibeji test checkout: ${escapeHtml(model.twinDisplayName)} twin. No real money moves.</h1>
<p>This page is a local imitation for testing an app. No real money moves.</p>
<p class="amount">${escapeHtml(money.formatDisplay(model.amountMinor, model.currency))}</p>
<p><span class="label">Currency</span><br>${escapeHtml(model.currency)}</p>
${email}
<p><span class="label">Reference</span><br><span class="reference">${escapeHtml(model.reference)}</span></p>
${notice}
<form method="post" action="">
<div class="outcomes">
${model.outcomes.map(outcomeButton).join("\n")}
</div>
</form>
</div>
<footer>This checkout is served by Ibeji on this computer only. It never contacts ${escapeHtml(model.twinDisplayName)}.</footer>
</main>
</body>
</html>`;
}

export function renderCheckoutResult(result: CheckoutResult): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ibeji test checkout result</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<div class="card">
<h1>Ibeji test checkout result</h1>
<p role="status">${escapeHtml(result.notice)}</p>
<p>No real money moved.</p>
</div>
<footer>You can close this page and return to the app.</footer>
</main>
</body>
</html>`;
}
