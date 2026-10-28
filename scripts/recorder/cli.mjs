import * as flutterwave from "./flutterwave.mjs";
import * as paystack from "./paystack.mjs";
import {
  createPrompt,
  createRecorderContext,
  Redactor,
  VALID_SERVICES,
  validateKey,
} from "./shared.mjs";
import * as stripe from "./stripe.mjs";

const SERVICES = {
  paystack,
  flutterwave,
  stripe,
};

const USAGE = "Usage: node scripts/record-fixtures.mjs --service <paystack|flutterwave|stripe>";

export function parseArgs(args) {
  if (args.length === 2 && args[0] === "--service") {
    return parseService(args[1]);
  }
  return { ok: false };
}

function parseService(value) {
  if (typeof value !== "string" || !VALID_SERVICES.includes(value)) {
    return { ok: false };
  }
  return { ok: true, service: value };
}

function printUsage() {
  console.error(USAGE);
  console.error(`Valid choices: ${VALID_SERVICES.join(", ")}`);
}

function statusLabel(status) {
  return status === null ? "-" : String(status);
}

function printSummary(results) {
  console.log("");
  console.log("Recorder summary");
  console.log("Action | Result | HTTP | File or reason");
  console.log("---|---|---|---");
  for (const result of results) {
    const resultLabel =
      result.outcome === "skipped"
        ? "skipped"
        : result.outcome === "invalid-request"
          ? "recorded (invalid request)"
          : result.outcome === "invalid-key"
            ? "recorded (invalid key)"
            : result.outcome === "idempotent-replay"
              ? "recorded (idempotent replay)"
              : result.outcome === "idempotency-mismatch"
                ? "recorded (idempotency mismatch)"
                : result.outcome === "setup"
                  ? "recorded (setup)"
                  : "recorded";
    const detail = result.reason ?? result.file ?? "";
    console.log(`${result.action} | ${resultLabel} | ${statusLabel(result.status)} | ${detail}`);
  }
}

export async function runCli(args, env = process.env, deps = {}) {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    printUsage();
    return 2;
  }

  const serviceModule = SERVICES[parsed.service];
  if (serviceModule === undefined) {
    printUsage();
    return 2;
  }
  const meta = serviceModule.meta;
  const key = env[meta.envName];
  const keyResult = validateKey(meta, key);
  if (!keyResult.ok) {
    console.error(keyResult.message);
    return 1;
  }

  const prompt = deps.prompt ?? createPrompt();
  const keyPatterns = [
    ...paystack.meta.keyPatterns,
    ...flutterwave.meta.keyPatterns,
    ...stripe.meta.keyPatterns,
  ];
  const redactor = new Redactor({ keyPatterns });
  const ctx = createRecorderContext({
    meta,
    key,
    cwd: deps.cwd ?? process.cwd(),
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    prompt,
    redactor,
  });

  try {
    await serviceModule.record(ctx);
  } catch (error) {
    console.error(
      `Recorder stopped: ${error instanceof Error ? error.message : String(error)}. ` +
        "What: an unexpected recorder error occurred. Why: a step threw instead of returning a response. " +
        "Fix: inspect the saved fixtures and the message above, then run the recorder again.",
    );
    return 1;
  } finally {
    ctx.close();
    printSummary(ctx.results);
  }

  return 0;
}
