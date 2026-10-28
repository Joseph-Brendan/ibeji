import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, runCli } from "../../scripts/recorder/cli.mjs";
import { meta as flutterwave } from "../../scripts/recorder/flutterwave.mjs";
import { meta as paystack } from "../../scripts/recorder/paystack.mjs";
import { fingerprintKey, validateKey } from "../../scripts/recorder/shared.mjs";
import { meta as stripe } from "../../scripts/recorder/stripe.mjs";

const services = [
  {
    id: "paystack" as const,
    meta: paystack,
    live: "sk_live_livekey_123",
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
    live: "sk_live_livekey_123",
    wrong: "rk_test_wrong_format",
    test: "sk_test_testkey_123",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("C15 recorder key checks", () => {
  it("parses only the three supported --service choices", () => {
    for (const service of services) {
      expect(parseArgs(["--service", service.id])).toEqual({ ok: true, service: service.id });
      expect(parseArgs([`--service=${service.id}`])).toEqual({ ok: false });
    }
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

  it("refuses missing, wrong-format and live keys for every service before making a request", async () => {
    for (const service of services) {
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
    for (const service of services) {
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
});
