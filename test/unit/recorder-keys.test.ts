import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, runCli, sharedPrefixServices } from "../../scripts/recorder/cli.mjs";
import { meta as flutterwave } from "../../scripts/recorder/flutterwave.mjs";
import { meta as paystack } from "../../scripts/recorder/paystack.mjs";
import { fingerprintKey, validateKey } from "../../scripts/recorder/shared.mjs";
import { meta as stripe } from "../../scripts/recorder/stripe.mjs";
import { startLocalServer } from "../ui/support/local-server.js";

const services = [
  {
    id: "paystack" as const,
    meta: paystack,
    live: ["sk", "live", "livekey_123"].join("_"),
    wrong: "not-a-key",
    test: "sk_test_testkey_123",
  },
  {
    id: "flutterwave" as const,
    meta: flutterwave,
    live: "FLWSECK-livekey-123",
    wrong: "FLWPUBK_TEST-wrong-format",
    test: "FLWSECK_TEST-testkey-123",
  },
  {
    id: "stripe" as const,
    meta: stripe,
    live: ["sk", "live", "livekey_123"].join("_"),
    wrong: "rk_test_wrong_format",
    test: "sk_test_testkey_123",
  },
];

const runnableServices = services.filter((service) => service.id !== "stripe");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("C15 recorder key checks", () => {
  it("parses every supported --service choice, including the unavailable Stripe one", () => {
    for (const service of runnableServices) {
      expect(parseArgs(["--service", service.id])).toEqual({ ok: true, service: service.id });
      expect(parseArgs(["--service", service.id, "--only", "bank.resolve"])).toEqual({
        ok: true,
        service: service.id,
        only: "bank.resolve",
      });
      expect(parseArgs([`--service=${service.id}`])).toEqual({ ok: false });
    }
    expect(parseArgs(["--service", "stripe"])).toEqual({ ok: true, service: "stripe" });
    expect(parseArgs([])).toEqual({ ok: false });
    expect(parseArgs(["--service", "other"])).toEqual({ ok: false });
    expect(parseArgs(["--service", "paystack", "extra"])).toEqual({ ok: false });
  });

  it("exits with code 2 and makes no request for an invalid service argument", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("invalid arguments must not make a request");
    });
    const code = await runCli(
      ["--service", "other"],
      {},
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        prompt: { ask: vi.fn(async () => ""), close: vi.fn() },
      },
    );
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses missing, wrong-format and live keys for every runnable service before making a request", async () => {
    for (const service of runnableServices) {
      for (const key of [undefined, service.wrong, service.live]) {
        const fetchImpl = vi.fn(async () => {
          throw new Error("the recorder must not make a request with an invalid key");
        });
        const prompt = { ask: vi.fn(async () => ""), close: vi.fn() };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const code = await runCli(
          ["--service", service.id],
          { [service.meta.envName]: key },
          {
            fetchImpl: fetchImpl as unknown as typeof fetch,
            prompt,
          },
        );

        expect(code).toBe(1);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(prompt.ask).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
      }

      expect(validateKey(service.meta, service.test)).toEqual({
        ok: true,
        code: "valid",
        key: service.test,
      });
    }
  });

  it("prints only a fingerprint, never the key, for live and wrong-format refusals", async () => {
    for (const service of runnableServices) {
      for (const key of [service.wrong, service.live]) {
        const messages: string[] = [];
        const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
          messages.push(args.map(String).join(" "));
        });
        const code = await runCli(
          ["--service", service.id],
          { [service.meta.envName]: key },
          {
            fetchImpl: vi.fn() as unknown as typeof fetch,
            prompt: { ask: vi.fn(async () => ""), close: vi.fn() },
          },
        );

        expect(code).toBe(1);
        const output = messages.join("\n");
        expect(output).not.toContain(key);
        expect(output).toContain(fingerprintKey(key));
        errorSpy.mockRestore();
      }
    }
  });

  it("D48 refuses Stripe recording before reading its environment variable", async () => {
    let readEnvironment = false;
    const env = new Proxy(
      {},
      {
        get() {
          readEnvironment = true;
          throw new Error("the Stripe recorder must not read its key");
        },
      },
    );
    const fetchImpl = vi.fn(async () => {
      throw new Error("Stripe must not make a request in version 0.1.0");
    });
    const prompt = { ask: vi.fn(async () => "stripe"), close: vi.fn() };
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const code = await runCli(["--service", "stripe"], env, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        prompt,
      });

      expect(code).toBe(2);
      expect(readEnvironment).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(prompt.ask).not.toHaveBeenCalled();
      expect(errors.join("\n")).toContain(
        "Stripe recording is part of version 0.2.0 (SPEC.md C21 D42)",
      );
      expect(validateKey(stripe, "sk_test_testkey_123")).toEqual({
        ok: true,
        code: "valid",
        key: "sk_test_testkey_123",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("D48 asks for a shared test prefix and continues when the right service name is typed", async () => {
    expect(
      sharedPrefixServices(paystack)
        .map((meta) => meta.id)
        .sort(),
    ).toEqual(["paystack", "stripe"]);
    expect(sharedPrefixServices(flutterwave).map((meta) => meta.id)).toEqual(["flutterwave"]);

    const cwd = await mkdtemp(join(tmpdir(), "ibeji-recorder-shared-"));
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: true, data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const prompt = { ask: vi.fn(async () => "paystack"), close: vi.fn() };
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = await runCli(
        ["--service", "paystack", "--only", "bank.list"],
        { PAYSTACK_TEST_SECRET_KEY: "sk_test_shared_prefix_123" },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cwd,
          prompt,
        },
      );

      expect(code).toBe(0);
      expect(fetchImpl).toHaveBeenCalled();
      expect(prompt.ask).toHaveBeenCalledWith(expect.stringContaining("Type paystack to confirm"));
      expect(logs.join("\n")).toContain("shared by Paystack and Stripe in the research files");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("D48 asks for a shared test prefix and sends nothing for a wrong or empty answer", async () => {
    const server = await startLocalServer();
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-recorder-shared-stop-"));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      for (const answer of ["stripe", ""]) {
        server.clear();
        const prompt = { ask: vi.fn(async () => answer), close: vi.fn() };
        const code = await runCli(
          ["--service", "paystack"],
          { PAYSTACK_TEST_SECRET_KEY: "sk_test_shared_prefix_123" },
          { baseUrl: server.url, cwd, prompt },
        );

        expect(code, `answer=${JSON.stringify(answer)}`).toBe(1);
        expect(prompt.ask).toHaveBeenCalled();
        expect(prompt.close).toHaveBeenCalled();
        expect(logs.join("\n")).toContain("shared by Paystack and Stripe");
        expect(errors.join("\n")).toContain("No request was made.");
        expect(server.requests, `answer=${JSON.stringify(answer)}`).toHaveLength(0);
      }
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("D48 does not ask when the test prefix is not shared", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ibeji-recorder-unique-"));
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "success", data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const prompt = { ask: vi.fn(async () => ""), close: vi.fn() };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = await runCli(
        ["--service", "flutterwave", "--only", "bank.list"],
        { FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-unique_prefix_123" },
        { fetchImpl: fetchImpl as unknown as typeof fetch, cwd, prompt },
      );

      expect(code).toBe(0);
      expect(fetchImpl).toHaveBeenCalled();
      expect(prompt.ask).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
