import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { printSummary, runCli } from "../../scripts/recorder/cli.mjs";
import { meta as flutterwave } from "../../scripts/recorder/flutterwave.mjs";
import { meta as paystack } from "../../scripts/recorder/paystack.mjs";
import {
  createRecorderContext,
  encodeForm,
  encodeJson,
  FAKE_EMAILS,
  fingerprintKey,
  KeyRejectedError,
  type RecorderResult,
  RecorderStopError,
  requireResponseField,
  validateKey,
} from "../../scripts/recorder/shared.mjs";
import { meta as stripe } from "../../scripts/recorder/stripe.mjs";

type CapturedRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

type FakeResponse = {
  readonly status: number;
  readonly body?: unknown;
  readonly contentType?: string;
};

type FakeHandler = (request: CapturedRequest) => FakeResponse;

async function startServer(handler: FakeHandler) {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const captured: CapturedRequest = {
        method: request.method ?? "GET",
        url: request.url ?? "",
        headers: request.headers,
        body,
      };
      requests.push(captured);
      const result = handler(captured);
      response.writeHead(result.status, {
        "content-type": result.contentType ?? "application/json",
      });
      response.end(
        typeof result.body === "string"
          ? result.body
          : JSON.stringify(result.body === undefined ? {} : result.body),
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined || error === null) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "ibeji-recorder-"));
}

async function startPaystackFlowServer(verifyStatuses: readonly string[]) {
  let verifyCount = 0;
  let initializeCount = 0;
  return startServer((request) => {
    if (request.method === "GET" && request.url.startsWith("/transaction?")) {
      return { status: 200, body: { status: true, message: "ok", data: [] } };
    }
    if (request.method === "POST" && request.url === "/transaction/initialize") {
      initializeCount += 1;
      return {
        status: 200,
        body: {
          status: true,
          message: "ok",
          data: { authorization_url: `https://example.com/checkout/${initializeCount}` },
        },
      };
    }
    if (request.method === "GET" && request.url === "/transaction/verify/ibeji-invalid-reference") {
      return {
        status: 400,
        body: { status: false, message: "Invalid reference", code: "invalid_params" },
      };
    }
    if (request.method === "GET" && request.url.startsWith("/transaction/verify/")) {
      const status = verifyStatuses[verifyCount] ?? "abandoned";
      verifyCount += 1;
      return { status: 200, body: { status: true, message: "ok", data: { id: 123, status } } };
    }
    if (request.method === "GET" && request.url === "/transaction/123") {
      return { status: 200, body: { status: true, message: "ok", data: { id: 123 } } };
    }
    if (request.method === "POST" && request.url === "/refund") {
      return { status: 200, body: { status: true, message: "ok", data: { id: 55 } } };
    }
    if (request.method === "GET" && request.url === "/refund/not-a-number") {
      return {
        status: 401,
        body: {
          status: false,
          message: "Please provide a valid refund ID. ID should be a valid integer",
          code: "missing_params",
        },
      };
    }
    if (request.method === "GET" && request.url.startsWith("/refund")) {
      return { status: 200, body: { status: true, message: "ok", data: [] } };
    }
    if (request.method === "POST" && request.url === "/transferrecipient") {
      return {
        status: 200,
        body: { status: true, message: "ok", data: { recipient_code: "RCP_fake" } },
      };
    }
    if (request.method === "POST" && request.url === "/transfer") {
      return {
        status: 200,
        body: { status: true, message: "ok", data: { id: 77, reference: "transfer-ref" } },
      };
    }
    if (request.method === "GET" && request.url.startsWith("/transfer/verify/")) {
      return {
        status: 200,
        body: { status: true, message: "ok", data: { id: 77, reference: "transfer-ref" } },
      };
    }
    if (request.method === "GET" && request.url.startsWith("/transfer/")) {
      return {
        status: 200,
        body: { status: true, message: "ok", data: { id: 77, reference: "transfer-ref" } },
      };
    }
    if (request.method === "GET" && request.url.startsWith("/bank/resolve")) {
      return {
        status: 200,
        body: {
          status: true,
          message: "ok",
          data: { account_number: "0000000000", account_name: "Test Name 1" },
        },
      };
    }
    if (request.method === "GET" && request.url.startsWith("/bank")) {
      if (request.headers.authorization === "Bearer invalid-ibeji-recorder") {
        return {
          status: 401,
          body: { status: false, message: "Invalid key", code: "invalid_key" },
        };
      }
      return { status: 200, body: { status: true, message: "ok", data: [] } };
    }
    return {
      status: 400,
      body: { status: false, message: "unexpected request", code: "invalid_params" },
    };
  });
}

function makePrompt() {
  return { ask: vi.fn(async () => ""), close: vi.fn() };
}

function makeScriptedPrompt(answers: readonly string[]) {
  const queue = [...answers];
  return {
    ask: vi.fn(async () => queue.shift() ?? "q"),
    close: vi.fn(),
  };
}

const paystackKey = "sk_test_fake_recorder_key_123";

describe("C15 recorder preflight key check", () => {
  it("stops before recording on a 401 from Paystack's list call and saves nothing", async () => {
    const server = await startServer((request) => {
      if (request.method === "GET" && request.url.startsWith("/transaction?")) {
        return {
          status: 401,
          body: { status: false, message: "Invalid key", code: "invalid_key" },
        };
      }
      return { status: 500, body: { status: false, message: "unexpected request" } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makePrompt() },
      );

      expect(code).toBe(1);
      expect(server.requests).toHaveLength(1);
      const preflightUrl = new URL(server.requests[0]?.url ?? "", server.baseUrl);
      expect(preflightUrl.pathname).toBe("/transaction");
      expect(preflightUrl.searchParams.get("perPage")).toBe("50");
      expect(preflightUrl.searchParams.get("page")).toBe("1");

      const text = [...output.logs, ...output.errors].join("\n");
      expect(text).toContain("rejected the test secret key");
      expect(text).toContain("key was rejected");
      expect(text).toContain("Invalid key");
      expect(text).toContain("invalid_key");
      expect(text).toContain("test mode is on");
      expect(text).toContain("dashboard's copy button");
      expect(text).toContain("right business or account");
      expect(text).not.toContain(paystackKey);

      await expect(readdir(join(cwd, "fixtures"))).rejects.toThrow();
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("uses Stripe's smallest documented list page size and stops on a 403", async () => {
    const server = await startServer((request) => {
      if (request.method === "GET" && request.url.startsWith("/v1/payment_intents?")) {
        return {
          status: 403,
          body: {
            error: { type: "invalid_request_error", message: "The key lacks permission." },
          },
        };
      }
      return { status: 500, body: { error: { message: "unexpected request" } } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    const stripeKey = "sk_test_fake_recorder_key_456";
    try {
      const code = await runCli(
        ["--service", "stripe"],
        { STRIPE_TEST_SECRET_KEY: stripeKey },
        { baseUrl: server.baseUrl, cwd, prompt: makePrompt() },
      );

      expect(code).toBe(1);
      expect(server.requests).toHaveLength(1);
      const preflightUrl = new URL(server.requests[0]?.url ?? "", server.baseUrl);
      expect(preflightUrl.pathname).toBe("/v1/payment_intents");
      expect(preflightUrl.searchParams.get("limit")).toBe("1");
      expect(output.errors.join("\n")).toContain("The key lacks permission.");
      expect(output.errors.join("\n")).not.toContain(stripeKey);
      await expect(readdir(join(cwd, "fixtures"))).rejects.toThrow();
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder key trimming and hidden characters", () => {
  it("trims outer whitespace and refuses hidden characters with only length and fingerprint", async () => {
    expect(validateKey(paystack, "  sk_test_fake_trim_123  ")).toEqual({
      ok: true,
      code: "valid",
      key: "sk_test_fake_trim_123",
    });

    const hidden = "sk_test_fake\u200Bhidden_123";
    const rejected = validateKey(paystack, hidden);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.code).toBe("wrong-format");
      expect(rejected.message).toContain(`length ${hidden.length}`);
      expect(rejected.message).toContain(fingerprintKey(hidden));
      expect(rejected.message).not.toContain(hidden);
    }

    const fetchImpl = vi.fn(async () => {
      throw new Error("a key with hidden characters must not be sent");
    });
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: hidden },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          prompt: makePrompt(),
        },
      );
      expect(code).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(output.errors.join("\n")).not.toContain(hidden);
    } finally {
      output.restore();
    }
  });
});

describe("C15 recorder key-error detection", () => {
  it("separates key errors from input errors using each service's own response shape", () => {
    const refundInputError = {
      status: false,
      message: "Please provide a valid refund ID. ID should be a valid integer",
      code: "missing_params",
    };
    expect(paystack.isKeyError(401, refundInputError)).toBe(false);
    expect(
      paystack.isKeyError(401, { status: false, message: "Invalid key", code: "invalid_key" }),
    ).toBe(true);

    expect(
      stripe.isKeyError(401, {
        error: { type: "invalid_request_error", message: "Missing required param: currency." },
      }),
    ).toBe(false);
    expect(
      stripe.isKeyError(401, {
        error: { type: "invalid_request_error", code: "api_key_expired", message: "Expired." },
      }),
    ).toBe(true);

    expect(
      flutterwave.isKeyError(401, { status: "error", message: "Authorization required" }),
    ).toBe(true);
    expect(flutterwave.isKeyError(401, { status: "error", message: "Amount is required" })).toBe(
      false,
    );
  });
});

describe("C15 recorder customer email values", () => {
  it("sends Paystack's customer email on the fixed example.com list", async () => {
    const server = await startServer((request) => {
      if (request.method === "GET" && request.url.startsWith("/transaction?")) {
        return { status: 200, body: { status: true, message: "ok", data: [] } };
      }
      if (request.method === "POST" && request.url === "/transaction/initialize") {
        return {
          status: 200,
          body: {
            status: true,
            message: "ok",
            data: { authorization_url: "https://example.com/checkout" },
          },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/transaction/verify/")) {
        return {
          status: 401,
          body: { status: false, message: "Invalid key", code: "invalid_key" },
        };
      }
      return { status: 500, body: { status: false, message: "unexpected request" } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makePrompt() },
      );

      const initialize = server.requests.find(
        (request) => request.method === "POST" && request.url === "/transaction/initialize",
      );
      const body = JSON.parse(initialize?.body ?? "{}") as { email?: string };
      expect(body.email).toBe("customer.one@example.com");
      expect(initialize?.body).not.toContain("@ibeji.test");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("sends Flutterwave's customer email on the fixed example.com list", async () => {
    const server = await startServer((request) => {
      if (request.method === "GET" && request.url.startsWith("/v3/transfers?")) {
        return { status: 200, body: { status: "success", message: "ok", data: [] } };
      }
      if (request.method === "POST" && request.url === "/v3/payments") {
        return {
          status: 200,
          body: {
            status: "success",
            message: "ok",
            data: { link: "https://example.com/checkout" },
          },
        };
      }
      if (
        request.method === "GET" &&
        request.url.startsWith("/v3/transactions/verify_by_reference?")
      ) {
        return {
          status: 401,
          body: { status: "error", message: "Authorization required", data: null },
        };
      }
      return { status: 500, body: { status: "error", message: "unexpected request" } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    const flutterwaveKey = "FLWSECK_TEST-fake_recorder_key_123";
    try {
      await runCli(
        ["--service", "flutterwave"],
        { FLUTTERWAVE_TEST_SECRET_KEY: flutterwaveKey },
        { baseUrl: server.baseUrl, cwd, prompt: makePrompt() },
      );

      const create = server.requests.find(
        (request) => request.method === "POST" && request.url === "/v3/payments",
      );
      const body = JSON.parse(create?.body ?? "{}") as { customer?: { email?: string } };
      expect(body.customer?.email).toBe("customer.one@example.com");
      expect(create?.body).not.toContain("@ibeji.test");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder mid-run key rejection", () => {
  it("stops on a 401 from a call that should succeed and saves it only as skipped", async () => {
    const server = await startServer((request) => {
      if (request.method === "GET" && request.url.startsWith("/transaction?")) {
        return { status: 200, body: { status: true, message: "ok", data: [] } };
      }
      if (request.method === "POST" && request.url === "/transaction/initialize") {
        return {
          status: 401,
          body: { status: false, message: "Invalid key", code: "invalid_key" },
        };
      }
      return { status: 500, body: { status: false, message: "unexpected request" } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makePrompt() },
      );

      expect(code).toBe(1);
      expect(server.requests).toHaveLength(2);
      expect(server.requests[1]?.url).toBe("/transaction/initialize");
      expect(output.errors.join("\n")).toContain("key was rejected");
      expect(output.errors.join("\n")).not.toContain(paystackKey);

      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction.initialize.skipped.json");
      expect(files.some((file) => file.includes("invalid-request"))).toBe(false);

      const skipped = JSON.parse(
        await readFile(
          join(cwd, "fixtures", "paystack", "transaction.initialize.skipped.json"),
          "utf8",
        ),
      ) as { outcome: string; status: number; reason: string; requestBody: string };
      expect(skipped.outcome).toBe("skipped");
      expect(skipped.status).toBe(401);
      expect(skipped.reason).toContain("key rejected");
      expect(skipped.reason).toContain("Invalid key");
      expect(skipped.requestBody).not.toContain(paystackKey);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder Paystack 401 input errors", () => {
  it("does not stop the run on a 401 input error and still records transfers and banks", async () => {
    const verifyStatuses = ["success", "abandoned", "failed"];
    let verifyCount = 0;
    const server = await startServer((request) => {
      if (request.method === "GET" && request.url.startsWith("/transaction?")) {
        return { status: 200, body: { status: true, message: "ok", data: [] } };
      }
      if (request.method === "POST" && request.url === "/transaction/initialize") {
        return {
          status: 200,
          body: {
            status: true,
            message: "ok",
            data: { authorization_url: "https://example.com/checkout" },
          },
        };
      }
      if (
        request.method === "GET" &&
        request.url === "/transaction/verify/ibeji-invalid-reference"
      ) {
        return {
          status: 400,
          body: { status: false, message: "Invalid reference", code: "invalid_params" },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/transaction/verify/")) {
        const status = verifyStatuses[verifyCount] ?? "abandoned";
        verifyCount += 1;
        return {
          status: 200,
          body: { status: true, message: "ok", data: { id: 123, status } },
        };
      }
      if (request.method === "GET" && request.url === "/transaction/123") {
        return { status: 200, body: { status: true, message: "ok", data: { id: 123 } } };
      }
      if (request.method === "POST" && request.url === "/refund") {
        return { status: 200, body: { status: true, message: "ok", data: { id: 55 } } };
      }
      if (request.method === "GET" && request.url === "/refund/not-a-number") {
        return {
          status: 401,
          body: {
            status: false,
            message: "Please provide a valid refund ID. ID should be a valid integer",
            code: "missing_params",
          },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/refund")) {
        return { status: 200, body: { status: true, message: "ok", data: [] } };
      }
      if (request.method === "POST" && request.url === "/transferrecipient") {
        return {
          status: 200,
          body: { status: true, message: "ok", data: { recipient_code: "RCP_fake" } },
        };
      }
      if (request.method === "POST" && request.url === "/transfer") {
        return {
          status: 200,
          body: {
            status: true,
            message: "ok",
            data: { id: 77, reference: "transfer-ref" },
          },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/transfer/verify/")) {
        return {
          status: 200,
          body: { status: true, message: "ok", data: { id: 77, reference: "transfer-ref" } },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/transfer/")) {
        return {
          status: 200,
          body: { status: true, message: "ok", data: { id: 77, reference: "transfer-ref" } },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/bank/resolve")) {
        return {
          status: 200,
          body: {
            status: true,
            message: "ok",
            data: { account_number: "0000000000", account_name: "Test Name 1" },
          },
        };
      }
      if (request.method === "GET" && request.url.startsWith("/bank")) {
        if (request.headers.authorization === "Bearer invalid-ibeji-recorder") {
          return {
            status: 401,
            body: { status: false, message: "Invalid key", code: "invalid_key" },
          };
        }
        return { status: 200, body: { status: true, message: "ok", data: [] } };
      }
      return {
        status: 400,
        body: { status: false, message: "unexpected request", code: "invalid_params" },
      };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makePrompt() },
      );

      expect(code).toBe(0);
      expect(output.errors.join("\n")).not.toContain("key was rejected");

      const inputErrorIndex = server.requests.findIndex(
        (request) => request.url === "/refund/not-a-number",
      );
      expect(inputErrorIndex).toBeGreaterThan(-1);
      const laterUrls = server.requests.slice(inputErrorIndex + 1).map((request) => request.url);
      expect(laterUrls.some((url) => url.startsWith("/refund?"))).toBe(true);
      expect(laterUrls.some((url) => url.startsWith("/transferrecipient"))).toBe(true);
      expect(laterUrls.some((url) => url.startsWith("/bank"))).toBe(true);

      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction-verify-success.json");
      expect(files).toContain("transaction-verify-abandoned.json");
      expect(files).toContain("transaction-verify-failed.json");
      expect(output.logs.join("\n")).toContain("transaction.verify (unpaid) status: abandoned.");

      const saved = JSON.parse(
        await readFile(
          join(cwd, "fixtures", "paystack", "refund-fetch-invalid-request.json"),
          "utf8",
        ),
      ) as { outcome: string; note: string };
      expect(saved.outcome).toBe("invalid-request");
      expect(saved.note).toBe("The service returned 401 for an input error, not a key error.");
      expect(output.logs.join("\n")).toContain(
        "The service returned 401 for an input error, not a key error.",
      );
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder fixture labels from real status", () => {
  it("saves an abandoned verify under its real status after Enter then s", async () => {
    const server = await startPaystackFlowServer(["abandoned", "success", "failed"]);
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makeScriptedPrompt(["", "", "s"]) },
      );

      expect(code).toBe(0);
      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction-verify-abandoned.json");
      expect(files).not.toContain("transaction-verify-declined.json");
      expect(output.logs.join("\n")).toContain(
        "Expected status: success. Paystack returned: abandoned.",
      );
      expect(output.logs.join("\n")).toContain("Please type r, s, or q, then press Enter.");
      expect(output.logs.join("\n")).toContain("| 200 | abandoned |");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("retries with a new payment link when the person types r", async () => {
    const server = await startPaystackFlowServer(["abandoned", "success", "pending", "failed"]);
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makeScriptedPrompt(["", "r", ""]) },
      );

      expect(code).toBe(0);
      const initializeRequests = server.requests.filter(
        (request) =>
          request.method === "POST" &&
          request.url === "/transaction/initialize" &&
          request.body.includes('"reference"'),
      );
      expect(initializeRequests).toHaveLength(4);
      expect(output.logs.join("\n")).toContain("Link: https://example.com/checkout/1");
      expect(output.logs.join("\n")).toContain("Link: https://example.com/checkout/3");

      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction-verify-success.json");
      expect(files).toContain("transaction-verify-pending.json");
      expect(files).not.toContain("transaction-verify-abandoned.json");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("stops without saving when the person types q", async () => {
    const server = await startPaystackFlowServer(["abandoned"]);
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makeScriptedPrompt(["", "q"]) },
      );

      expect(code).toBe(1);
      expect(output.errors.join("\n")).toContain(
        "Expected status: success. Paystack returned: abandoned.",
      );
      expect(output.errors.join("\n")).toContain("you chose q");
      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).not.toContain("transaction-verify-abandoned.json");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("continues when two different steps produce the same fixture name", async () => {
    const server = await startPaystackFlowServer(["success", "success", "failed"]);
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makeScriptedPrompt([""]) },
      );

      expect(code).toBe(0);
      expect(output.logs.join("\n")).toContain(
        "Already recorded as transaction-verify-success.json; not saved again",
      );
      expect(output.logs.join("\n")).toContain(
        "not saved (duplicate of transaction-verify-success.json)",
      );
      expect(output.errors.join("\n")).not.toContain("Two steps tried to save the same fixture");
      expect(server.requests.some((request) => request.url.startsWith("/bank"))).toBe(true);
      expect(server.requests.some((request) => request.url.startsWith("/bank/resolve"))).toBe(true);
      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction-verify-success.json");
      expect(files).toContain("transaction-verify-failed.json");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder checkout emails", () => {
  it("uses a different example.com email for every checkout, including retries", async () => {
    expect(FAKE_EMAILS).toContain("customer.four@example.com");
    const server = await startPaystackFlowServer(["abandoned", "success", "pending", "failed"]);
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makeScriptedPrompt(["", "r", ""]) },
      );

      expect(code).toBe(0);
      const emails = server.requests
        .filter(
          (request) =>
            request.method === "POST" &&
            request.url === "/transaction/initialize" &&
            request.body.includes('"reference"'),
        )
        .map((request) => {
          const body = JSON.parse(request.body) as { email?: string };
          return body.email;
        });
      expect(emails).toEqual([
        "customer.one@example.com",
        "customer.two@example.com",
        "customer.three@example.com",
        "customer.four@example.com",
      ]);
      expect(output.logs.join("\n")).toContain(
        "If the checkout offers a saved card, choose to pay with a new or different card, and type the card number shown here.",
      );
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder duplicate save after s", () => {
  it("prints the existing fixture name, does not rewrite it, and continues", async () => {
    const server = await startPaystackFlowServer(["success", "abandoned", "success"]);
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const code = await runCli(
        ["--service", "paystack"],
        { PAYSTACK_TEST_SECRET_KEY: paystackKey },
        { baseUrl: server.baseUrl, cwd, prompt: makeScriptedPrompt(["", "", "s"]) },
      );

      expect(code).toBe(0);
      expect(output.logs.join("\n")).toContain(
        "Already recorded as transaction-verify-success.json; not saved again",
      );
      expect(output.errors.join("\n")).not.toContain("Two steps tried to save the same fixture");
      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction-verify-success.json");
      expect(files).toContain("transaction-verify-abandoned.json");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder invalid-request and invalid-key classification", () => {
  it("saves a 400 to deliberately wrong input as invalid-request", async () => {
    const server = await startServer(() => ({
      status: 400,
      body: { status: false, message: "Email Address is required", code: "missing_params" },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const result = await ctx.recordInvalid("transaction.initialize", {
        method: "POST",
        path: "/transaction/initialize",
        body: encodeJson({ amount: "10000", currency: "NGN" }),
      });

      expect(result.file.endsWith("transaction-initialize-invalid-request.json")).toBe(true);
      expect(ctx.results.at(-1)?.outcome).toBe("invalid-request");
      const saved = JSON.parse(await readFile(result.file, "utf8")) as {
        outcome: string;
        status: number;
      };
      expect(saved.outcome).toBe("invalid-request");
      expect(saved.status).toBe(400);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves a 401 input error as invalid-request with the input-error note and keeps going", async () => {
    const server = await startServer((request) => {
      if (request.url === "/refund/not-a-number") {
        return {
          status: 401,
          body: {
            status: false,
            message: "Please provide a valid refund ID. ID should be a valid integer",
            code: "missing_params",
          },
        };
      }
      return { status: 200, body: { status: true, message: "ok", data: [] } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const result = await ctx.recordInvalid("refund.fetch", {
        method: "GET",
        path: "/refund/not-a-number",
      });

      expect(result.file.endsWith("refund-fetch-invalid-request.json")).toBe(true);
      const entry = ctx.results.at(-1);
      expect(entry?.outcome).toBe("invalid-request");
      expect(entry?.note).toBe("The service returned 401 for an input error, not a key error.");
      const saved = JSON.parse(await readFile(result.file, "utf8")) as {
        outcome: string;
        note: string;
      };
      expect(saved.outcome).toBe("invalid-request");
      expect(saved.note).toBe("The service returned 401 for an input error, not a key error.");

      const next = await ctx.record({
        action: "refund.list",
        method: "GET",
        path: "/refund",
        query: { perPage: 5, page: 1 },
      });
      expect(next.status).toBe(200);
      expect(server.requests).toHaveLength(2);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves a 2xx to deliberately wrong input as lenient-input with a note", async () => {
    const server = await startServer(() => ({
      status: 200,
      body: { status: true, message: "accepted", data: {} },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const result = await ctx.recordInvalid("transaction.initialize", {
        method: "POST",
        path: "/transaction/initialize",
        body: encodeJson({ amount: "10000", currency: "NGN" }),
      });

      expect(result.file.endsWith("transaction-initialize-lenient-input.json")).toBe(true);
      const entry = ctx.results.at(-1);
      expect(entry?.outcome).toBe("lenient-input");
      expect(entry?.note).toContain("accepted the deliberately wrong input");
      const saved = JSON.parse(await readFile(result.file, "utf8")) as { outcome: string };
      expect(saved.outcome).toBe("lenient-input");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("never saves a 401 to wrong input as invalid-request", async () => {
    const server = await startServer(() => ({
      status: 401,
      body: { status: false, message: "Invalid key", code: "invalid_key" },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      await expect(
        ctx.recordInvalid("transaction.initialize", {
          method: "POST",
          path: "/transaction/initialize",
          body: encodeJson({ amount: "10000", currency: "NGN" }),
        }),
      ).rejects.toBeInstanceOf(KeyRejectedError);

      const files = await readdir(join(cwd, "fixtures", "paystack"));
      expect(files).toContain("transaction.initialize.skipped.json");
      expect(files.some((file) => file.includes("invalid-request"))).toBe(false);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves a response to a deliberately wrong key only as invalid-key", async () => {
    const server = await startServer(() => ({
      status: 200,
      body: { status: true, message: "the wrong key was accepted", data: [] },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const result = await ctx.recordInvalidKey("bank.list", {
        method: "GET",
        path: "/bank",
        query: { country: "nigeria" },
      });

      expect(result.file.endsWith("bank-list-invalid-key.json")).toBe(true);
      const entry = ctx.results.at(-1);
      expect(entry?.outcome).toBe("invalid-key");
      expect(entry?.note).toContain("accepted the deliberately wrong key");
      const saved = JSON.parse(await readFile(result.file, "utf8")) as { outcome: string };
      expect(saved.outcome).toBe("invalid-key");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder failed-step summary and skipped files", () => {
  it("prints the service message and code and saves the full redacted request and response", async () => {
    const server = await startServer(() => ({
      status: 400,
      body: { status: false, message: "Email Address is required", code: "missing_params" },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const result = await ctx.record({
        action: "transaction.initialize",
        method: "POST",
        path: "/transaction/initialize",
        body: encodeJson({
          amount: "10000",
          email: "ada@real-customer.example",
          currency: "NGN",
        }),
      });

      const entry = ctx.results.at(-1);
      expect(entry?.outcome).toBe("skipped");
      expect(entry?.reason).toContain("Email Address is required");
      expect(entry?.reason).toContain("missing_params");
      expect(entry?.serviceMessage).toBe("Email Address is required");
      expect(entry?.serviceCode).toBe("missing_params");
      expect(result.file.endsWith("transaction.initialize.skipped.json")).toBe(true);

      const saved = JSON.parse(await readFile(result.file, "utf8")) as {
        outcome: string;
        reason: string;
        method: string;
        path: string;
        requestBody: string;
        status: number;
        responseBody: { message: string; code: string };
      };
      expect(saved.outcome).toBe("skipped");
      expect(saved.reason).toContain("Email Address is required");
      expect(saved.method).toBe("POST");
      expect(saved.path).toBe("/transaction/initialize");
      expect(saved.requestBody).toContain("customer.one@example.com");
      expect(saved.requestBody).not.toContain("ada@real-customer.example");
      expect(saved.status).toBe(400);
      expect(saved.responseBody.message).toBe("Email Address is required");
      expect(saved.responseBody.code).toBe("missing_params");

      printSummary(ctx.results as readonly RecorderResult[]);
      const table = output.logs.join("\n");
      expect(table).toContain("Service message");
      expect(table).toContain("Email Address is required");
      expect(table).toContain("missing_params");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("writes a skipped file for a step skipped before any request", async () => {
    const server = await startServer(() => ({ status: 500, body: {} }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      await ctx.skip("checkout", "transaction.initialize did not return data.authorization_url");

      const file = join(cwd, "fixtures", "paystack", "checkout.skipped.json");
      const saved = JSON.parse(await readFile(file, "utf8")) as {
        outcome: string;
        reason: string;
        method: string | null;
        status: number | null;
      };
      expect(saved.outcome).toBe("skipped");
      expect(saved.reason).toContain("did not return data.authorization_url");
      expect(saved.method).toBeNull();
      expect(saved.status).toBeNull();
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reads Stripe's nested error message and code into the summary", async () => {
    const server = await startServer(() => ({
      status: 400,
      body: {
        error: {
          type: "invalid_request_error",
          code: "parameter_missing",
          message: "Missing required param: currency.",
        },
      },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    const stripeKey = "sk_test_fake_recorder_key_789";
    try {
      const ctx = createRecorderContext({
        meta: stripe,
        key: stripeKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const result = await ctx.record({
        action: "payment_intent.create",
        method: "POST",
        path: "/v1/payment_intents",
        body: encodeForm({ amount: 2000 }),
      });

      const entry = ctx.results.at(-1);
      expect(entry?.outcome).toBe("skipped");
      expect(entry?.reason).toContain("Missing required param: currency.");
      expect(entry?.reason).toContain("parameter_missing");
      expect(entry?.serviceMessage).toBe("Missing required param: currency.");
      expect(entry?.serviceCode).toBe("parameter_missing");
      expect(result.file.endsWith("payment_intent.create.skipped.json")).toBe(true);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder request printing", () => {
  it("prints the request body with fake personal values and never the key", async () => {
    const server = await startServer(() => ({
      status: 200,
      body: { status: true, message: "ok", data: {} },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      await ctx.record({
        action: "transaction.initialize",
        method: "POST",
        path: "/transaction/initialize",
        body: encodeJson({
          amount: "10000",
          email: "ada@real-customer.example",
          customer: { name: "Ada Lovelace", account_number: "0123456789" },
        }),
      });

      const printed = output.logs.join("\n");
      expect(printed).toContain("Request: POST /transaction/initialize");
      expect(printed).toContain("customer.one@example.com");
      expect(printed).toContain("Test Name 1");
      expect(printed).toContain("0000000001");
      expect(printed).not.toContain("ada@real-customer.example");
      expect(printed).not.toContain("Ada Lovelace");
      expect(printed).not.toContain("0123456789");
      expect(printed).not.toContain(paystackKey);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder passes real response values between steps", () => {
  it("uses the real value for the next request while saving a redacted response", async () => {
    const server = await startServer((request) => {
      if (request.url === "/transaction/initialize") {
        return {
          status: 200,
          body: {
            status: true,
            message: "ok",
            data: {
              id: 987654,
              customer: {
                email: "ada@real-customer.example",
                name: "Ada Lovelace",
              },
            },
          },
        };
      }
      return {
        status: 200,
        body: { status: true, message: "ok", data: { id: 987654 } },
      };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const initialize = await ctx.record({
        action: "transaction.initialize",
        method: "POST",
        path: "/transaction/initialize",
        body: encodeJson({ email: "ada@real-customer.example" }),
      });
      const transactionId = requireResponseField(
        initialize,
        "transaction.initialize",
        "data.id",
        "number",
      );
      expect(transactionId).toBe(987654);

      await ctx.record({
        action: "transaction.fetch",
        method: "GET",
        path: `/transaction/${String(transactionId)}`,
      });
      expect(server.requests[1]?.url).toBe("/transaction/987654");

      const savedText = await readFile(initialize.file, "utf8");
      const saved = JSON.parse(savedText) as {
        responseBody: { data: { customer: { email: string; name: string } } };
      };
      expect(saved.responseBody.data.customer.email).toBe("customer.one@example.com");
      expect(saved.responseBody.data.customer.name).toBe("Test Name 1");
      expect(savedText).not.toContain("ada@real-customer.example");
      expect(savedText).not.toContain("Ada Lovelace");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder missing 2xx response fields", () => {
  it("stops with the step, field path, and top-level fields present", async () => {
    const server = await startServer(() => ({
      status: 200,
      body: { status: true, message: "ok", data: { status: "success" } },
    }));
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const verify = await ctx.record({
        action: "transaction.verify",
        method: "GET",
        path: "/transaction/verify/ibeji-reference",
      });

      let caught: unknown;
      try {
        requireResponseField(verify, "transaction.verify", "data.id", "number");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RecorderStopError);
      const message = caught instanceof Error ? caught.message : "";
      expect(message).toContain("transaction.verify");
      expect(message).toContain("data.id");
      expect(message).toContain("Top-level fields present: status, message, data");
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder transfer account limit", () => {
  it("saves transfer.create as account-limit and does not stop the run", async () => {
    const server = await startServer((request) => {
      if (request.url === "/transfer") {
        return {
          status: 403,
          body: {
            status: false,
            message: "You cannot initiate third party payouts as a starter business",
            code: "transfer_unavailable",
          },
        };
      }
      return { status: 200, body: { status: true, message: "ok", data: [] } };
    });
    const cwd = await makeTempDir();
    const output = captureConsole();
    try {
      const ctx = createRecorderContext({
        meta: paystack,
        key: paystackKey,
        baseUrl: server.baseUrl,
        cwd,
        prompt: makePrompt(),
      });
      const transfer = await ctx.record({
        action: "transfer.create",
        failureOutcome: "account-limit",
        failureMatches: (response) => response.status === 403,
        failureFileName: "transfer-create.account-limit.json",
        method: "POST",
        path: "/transfer",
        body: encodeJson({ source: "balance", amount: 100, recipient: "RCP_fake" }),
      });

      expect(transfer.ok).toBe(false);
      expect(transfer.file.endsWith("transfer-create.account-limit.json")).toBe(true);
      const saved = JSON.parse(await readFile(transfer.file, "utf8")) as {
        outcome: string;
        status: number;
        responseBody: { message: string; code: string };
      };
      expect(saved.outcome).toBe("account-limit");
      expect(saved.status).toBe(403);
      expect(saved.responseBody.message).toContain("starter business");
      expect(saved.responseBody.code).toBe("transfer_unavailable");

      const next = await ctx.record({
        action: "bank.list",
        method: "GET",
        path: "/bank",
        query: { country: "nigeria" },
      });
      expect(next.status).toBe(200);
      expect(server.requests).toHaveLength(2);
    } finally {
      output.restore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("C15 recorder request encoding", () => {
  it("encodes Stripe arrays of objects with index brackets, not [object Object]", () => {
    const encoded = encodeForm({
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Ibeji recorder" },
            unit_amount: 2000,
          },
          quantity: 1,
        },
      ],
      payment_method_types: ["card"],
    });
    const params = new URLSearchParams(encoded);
    expect(params.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(params.get("line_items[0][price_data][product_data][name]")).toBe("Ibeji recorder");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("2000");
    expect(params.get("line_items[0][quantity]")).toBe("1");
    expect(params.getAll("payment_method_types[]")).toEqual(["card"]);
    expect(encoded).not.toContain("[object Object]");
  });
});
