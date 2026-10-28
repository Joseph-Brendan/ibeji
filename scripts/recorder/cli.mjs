import * as flutterwave from "./flutterwave.mjs";
import * as paystack from "./paystack.mjs";
import {
  createPrompt,
  createRecorderContext,
  RecorderStopError,
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

function summaryCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll(/\s*\n\s*/g, " ");
}

export function printSummary(results) {
  console.log("");
  console.log("Recorder summary");
  console.log("Action | Result | HTTP | Payment status | Service message | Code | File or reason");
  console.log("---|---|---|---|---|---|---|");
  for (const result of results) {
    const resultLabel =
      result.duplicateOf !== undefined
        ? `not saved (duplicate of ${result.duplicateOf})`
        : result.outcome === "skipped"
          ? "skipped"
          : result.outcome === "invalid-request"
            ? "recorded (invalid request)"
            : result.outcome === "invalid-key"
              ? "recorded (invalid key)"
              : result.outcome === "lenient-input"
                ? "recorded (lenient input)"
                : result.outcome === "account-limit"
                  ? "recorded (account limit)"
                  : result.outcome === "unpaid"
                    ? "recorded (unpaid)"
                    : result.outcome === "declined"
                      ? "recorded (declined)"
                      : result.outcome === "idempotent-replay"
                        ? "recorded (idempotent replay)"
                        : result.outcome === "idempotency-mismatch"
                          ? "recorded (idempotency mismatch)"
                          : result.outcome === "setup"
                            ? "recorded (setup)"
                            : "recorded";
    const detail = [result.note, result.reason, result.file]
      .filter((value) => value !== undefined && value !== null && value !== "")
      .join(" ");
    console.log(
      `${summaryCell(result.action)} | ${summaryCell(resultLabel)} | ${statusLabel(result.status)} | ${summaryCell(result.paymentStatus)} | ${summaryCell(result.serviceMessage)} | ${summaryCell(result.serviceCode)} | ${summaryCell(detail)}`,
    );
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
  const keyResult = validateKey(meta, env[meta.envName]);
  if (!keyResult.ok) {
    console.error(keyResult.message);
    return 1;
  }
  const key = keyResult.key;

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
    baseUrl: deps.baseUrl,
    cwd: deps.cwd ?? process.cwd(),
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    prompt,
    redactor,
  });

  console.log(
    `${meta.displayName} key accepted (length ${key.length}, fingerprint ${ctx.keyFingerprint}).`,
  );

  try {
    await ctx.preflight();
    await serviceModule.record(ctx);
  } catch (error) {
    if (error instanceof RecorderStopError) {
      console.error(error.message);
    } else {
      console.error(
        `Recorder stopped: ${error instanceof Error ? error.message : String(error)}. ` +
          "What: an unexpected recorder error occurred. Why: a step threw instead of returning a response. " +
          "Fix: inspect the saved fixtures and the message above, then run the recorder again.",
      );
    }
    return 1;
  } finally {
    ctx.close();
    if (ctx.results.length > 0) {
      printSummary(ctx.results);
    }
  }

  return 0;
}
