import { createServer } from "node:http";

import { providers } from "./providers.js";

const providerName = process.env.PAYMENT_PROVIDER;
const mode = process.env.APP_MODE;

function stopWith(message) {
  console.error(message);
  process.exit(1);
}

const provider = providers[providerName];
if (provider === undefined) {
  stopWith(
    'PAYMENT_PROVIDER must be "paystack" or "flutterwave". Stripe is version 0.2.0 and is not in this 0.1.0 example.',
  );
}
if (mode !== "naive" && mode !== "safe") {
  stopWith('APP_MODE must be "naive" or "safe".');
}

let config;
try {
  config = provider.readConfig(process.env);
} catch (error) {
  stopWith(error instanceof Error ? error.message : String(error));
}

const rawPort = process.env.PORT ?? "3000";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  stopWith("PORT must be a whole number from 0 to 65535.");
}

const appBaseUrlSetting = process.env.APP_BASE_URL?.replace(/\/+$/u, "");

const students = [
  {
    id: "amina",
    name: "Amina Bello",
    form: "JSS 2",
    fee: 25000,
    paid: false,
    payments: [],
  },
  {
    id: "chidi",
    name: "Chidi Okeke",
    form: "JSS 1",
    fee: 25000,
    paid: false,
    payments: [],
  },
  {
    id: "zainab",
    name: "Zainab Musa",
    form: "SS 1",
    fee: 30000,
    paid: false,
    payments: [],
  },
];

const pending = new Map();
const processed = new Set();
let appBaseUrl = appBaseUrlSetting ?? "";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value) {
  return `NGN ${String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}`;
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | School fees</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; color: #17131f; background: #f7f5fb; }
    body { margin: 0; }
    main { max-width: 850px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { margin: 0 0 8px; font-size: 2rem; }
    h2 { margin: 28px 0 12px; font-size: 1.25rem; }
    p { line-height: 1.55; }
    .panel { background: #fff; border: 1px solid #d9d2e6; border-radius: 10px; padding: 20px; margin: 16px 0; }
    .note { background: #efe9f8; border: 1px solid #d9d2e6; border-radius: 10px; padding: 14px 16px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9d2e6; border-radius: 10px; overflow: hidden; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e9e3f2; vertical-align: top; }
    th { background: #f1ecf9; font-size: 0.9rem; }
    tr:last-child td { border-bottom: 0; }
    .paid { color: #17663a; font-weight: 700; }
    .unpaid { color: #9a2f2f; font-weight: 700; }
    .button { display: inline-block; background: #6b4fa1; color: #fff; text-decoration: none; border: 0; border-radius: 6px; padding: 11px 16px; font: inherit; font-weight: 700; cursor: pointer; }
    .button:hover { background: #553b85; }
    code { background: #f1ecf9; padding: 2px 5px; border-radius: 4px; }
    ul { padding-left: 20px; }
    .muted { color: #5d566b; }
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

function sendHtml(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function redirect(response, location) {
  response.writeHead(303, { location });
  response.end();
}

async function readBody(request, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function studentById(id) {
  return students.find((student) => student.id === id);
}

function findStudentForPayment(reference) {
  const payment = pending.get(reference);
  return payment === undefined ? undefined : studentById(payment.studentId);
}

function homePage() {
  const rows = students
    .map((student) => {
      const records = student.payments
        .map(
          (payment) =>
            `<li><code>${escapeHtml(payment.reference)}</code> ${escapeHtml(
              payment.status,
            )} at ${escapeHtml(payment.receivedAt)}</li>`,
        )
        .join("");
      return `<tr>
        <td>${escapeHtml(student.name)}<br><span class="muted">${escapeHtml(student.form)}</span></td>
        <td>${escapeHtml(money(student.fee))}</td>
        <td class="${student.paid ? "paid" : "unpaid"}">${student.paid ? "Paid" : "Not paid"}</td>
        <td>${student.payments.length} payment record${student.payments.length === 1 ? "" : "s"}
          ${records === "" ? "" : `<details><summary>Show records</summary><ul>${records}</ul></details>`}
        </td>
        <td><a class="button" href="/pay/${encodeURIComponent(student.id)}">Pay fees</a></td>
      </tr>`;
    })
    .join("");

  const modeNote =
    mode === "naive"
      ? "Naive mode: a student is marked paid as soon as a payment starts, and every webhook is trusted. This is Musa's bug."
      : "Safe mode: a student is marked paid only after a verified webhook confirms success. Duplicate webhooks are ignored.";

  return page(
    "Students",
    `<h1>School fees</h1>
     <p class="note"><strong>${escapeHtml(provider.displayName)}</strong> · <strong>${escapeHtml(
       mode,
     )} mode</strong><br>${escapeHtml(modeNote)}</p>
     <p>This is a local test app. No real money moves. The parent is sent to the Ibeji test checkout page.</p>
     <table>
       <thead><tr><th>Student</th><th>Fee</th><th>Status</th><th>Payments</th><th>Action</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`,
  );
}

function payPage(student) {
  return page(
    `Pay ${student.name}`,
    `<h1>Pay school fees</h1>
     <div class="panel">
       <p><strong>Student:</strong> ${escapeHtml(student.name)} (${escapeHtml(student.form)})</p>
       <p><strong>Fee:</strong> ${escapeHtml(money(student.fee))}</p>
       <p>You will go to the Ibeji ${escapeHtml(provider.displayName)} test checkout. No real money moves.</p>
       <form method="post" action="/pay/${encodeURIComponent(student.id)}">
         <button class="button" type="submit">Start payment</button>
       </form>
     </div>
     <p><a href="/">Back to students</a></p>`,
  );
}

function returnPage(student) {
  const statusLine = student.paid
    ? `<p class="paid">${escapeHtml(student.name)} is marked paid.</p>`
    : `<p class="unpaid">${escapeHtml(student.name)} is not paid yet.</p>`;
  const message =
    mode === "safe"
      ? "Safe mode does not mark a student paid from this return page. It waits for a verified webhook."
      : "Naive mode marked the student paid when the payment started, before the result was known.";
  return page(
    "Payment returned",
    `<h1>Payment returned</h1>
     <div class="panel">
       ${statusLine}
       <p>${escapeHtml(message)}</p>
       <p><a href="/">Back to students</a></p>
     </div>`,
  );
}

function errorPage(message) {
  return page(
    "Payment problem",
    `<h1>Payment problem</h1>
     <div class="panel">
       <p>${escapeHtml(message)}</p>
       <p><a href="/">Back to students</a></p>
     </div>`,
  );
}

async function startPayment(response, student) {
  let created;
  try {
    created = await provider.createPayment({ config, student, appBaseUrl });
  } catch (error) {
    sendHtml(response, 502, errorPage(error instanceof Error ? error.message : String(error)));
    return;
  }

  pending.set(created.reference, { studentId: student.id, reference: created.reference });
  if (mode === "naive") {
    student.paid = true;
    student.markedPaidBy = "naive-start";
  }
  redirect(response, created.checkoutUrl);
}

async function receiveWebhook(request, response) {
  let rawBody;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { ok: false, error: error.message });
      return;
    }
    throw error;
  }

  if (!provider.verifyWebhook({ config, rawBody, headers: request.headers })) {
    sendJson(response, 401, { ok: false, error: "Webhook rejected: verification failed." });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendJson(response, 400, { ok: false, error: "Webhook body is not valid JSON." });
    return;
  }

  const event = payload?.event;
  const data = payload?.data;
  if (typeof event !== "string" || typeof data !== "object" || data === null) {
    sendJson(response, 400, { ok: false, error: "Webhook body is missing event or data." });
    return;
  }

  const reference = provider.webhookKey(event, data);
  const student = reference === undefined ? undefined : findStudentForPayment(reference);
  if (reference === undefined || student === undefined) {
    sendJson(response, 200, { ok: true, ignored: "unknown payment" });
    return;
  }

  const success = provider.isSuccess(event, data);
  if (success) {
    if (mode === "safe") {
      if (processed.has(reference)) {
        sendJson(response, 200, { ok: true, ignored: "duplicate webhook", student: student.id });
        return;
      }
      processed.add(reference);
    }
    student.paid = true;
    student.payments.push({
      provider: provider.id,
      reference,
      status: typeof data.status === "string" ? data.status : "unknown",
      success: true,
      receivedAt: new Date().toISOString(),
    });
  } else if (mode === "naive") {
    student.payments.push({
      provider: provider.id,
      reference,
      status: typeof data.status === "string" ? data.status : "unknown",
      success: false,
      receivedAt: new Date().toISOString(),
    });
  }

  sendJson(response, 200, {
    ok: true,
    student: student.id,
    success,
    records: student.payments.length,
  });
}

async function handle(request, response) {
  if (request.url === undefined) {
    sendHtml(response, 400, errorPage("The request has no address."));
    return;
  }
  const url = new URL(request.url, appBaseUrl || "http://127.0.0.1");
  const path = url.pathname;

  if (request.method === "GET" && path === "/") {
    sendHtml(response, 200, homePage());
    return;
  }

  if (request.method === "GET" && path === "/state") {
    sendJson(response, 200, {
      provider: provider.id,
      mode,
      students: students.map((student) => ({
        id: student.id,
        name: student.name,
        form: student.form,
        fee: student.fee,
        paid: student.paid,
        payments: [...student.payments],
      })),
    });
    return;
  }

  if (request.method === "GET" && path === "/health") {
    sendJson(response, 200, { ok: true, provider: provider.id, mode });
    return;
  }

  if (request.method === "GET" && path.startsWith("/pay/")) {
    const id = decodeURIComponent(path.slice("/pay/".length));
    const student = studentById(id);
    if (student === undefined) {
      sendHtml(response, 404, errorPage("That student was not found."));
      return;
    }
    sendHtml(response, 200, payPage(student));
    return;
  }

  if (request.method === "POST" && path.startsWith("/pay/")) {
    const id = decodeURIComponent(path.slice("/pay/".length));
    const student = studentById(id);
    if (student === undefined) {
      sendHtml(response, 404, errorPage("That student was not found."));
      return;
    }
    await startPayment(response, student);
    return;
  }

  if (request.method === "GET" && path === provider.returnPath) {
    const key = url.searchParams.get(provider.id === "paystack" ? "reference" : "tx_ref");
    const student = key === null ? undefined : findStudentForPayment(key);
    if (student === undefined) {
      sendHtml(response, 404, errorPage("That payment is not known to this app."));
      return;
    }
    sendHtml(response, 200, returnPage(student));
    return;
  }

  if (request.method === "POST" && path === provider.webhookPath) {
    await receiveWebhook(request, response);
    return;
  }

  if (path === "/webhooks/paystack" || path === "/webhooks/flutterwave") {
    sendHtml(response, 404, errorPage("That webhook belongs to a different provider."));
    return;
  }

  sendHtml(response, 404, errorPage("That page was not found."));
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("The school fees app could not finish a request:", message);
    if (!response.headersSent) {
      sendHtml(response, 500, errorPage("The app could not finish that request."));
    } else {
      response.end();
    }
  });
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort =
    typeof address === "object" && address !== null && "port" in address ? address.port : port;
  appBaseUrl = appBaseUrlSetting ?? `http://127.0.0.1:${actualPort}`;
  console.log(`School fees app listening on http://127.0.0.1:${actualPort}`);
  console.log(`Provider: ${provider.displayName}. Mode: ${mode}.`);
  console.log(`Webhook URL: ${appBaseUrl}${provider.webhookPath}`);
});
