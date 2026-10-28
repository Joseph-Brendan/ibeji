import { describe, expect, it } from "vitest";

import {
  type ConfigContext,
  createConfigSchema,
  createDefaultConfig,
  DEFAULT_CONTROL_PORT,
  MAX_SEED,
  mergeConfig,
  parseConfig,
} from "../../src/core/config.js";
import { IbejiError } from "../../src/core/errors.js";

const context: ConfigContext = {
  twinIds: ["alpha", "beta"],
  defaultPorts: { alpha: 4401, beta: 4402 },
  scenarios: {
    "slow-day": ["alpha"],
    "beta-only": ["beta"],
  },
  secretPatterns: [/\bsecret_[a-z0-9]{6,}\b/g],
};

function expectConfigInvalid(run: () => unknown, fields: readonly string[]): IbejiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IbejiError);
    if (!(error instanceof IbejiError)) {
      throw new Error("the thrown value was not an IbejiError");
    }
    expect(error.code).toBe("CONFIG_INVALID");
    for (const field of fields) {
      expect(error.why).toContain(field);
    }
    expect(error.why).toContain("Example:");
    return error;
  }

  throw new Error("the configuration unexpectedly passed validation");
}

describe("C14 configuration", () => {
  it("C14: accepts every field and keeps the supplied values", () => {
    const config = {
      twins: ["alpha"],
      ports: { control: 5000, alpha: 4401 },
      webhookUrls: { alpha: "http://127.0.0.1:3000/hook" },
      seed: 42,
      scenario: "slow-day",
      open: false,
      allowPrivateWebhooks: true,
      allowPublicWebhooks: false,
    };

    expect(parseConfig(config, context)).toEqual(config);
  });

  it("C14: reports several invalid fields in one error", () => {
    const error = expectConfigInvalid(
      () => parseConfig({ twins: [], seed: -1, open: "yes", ports: { control: 70_000 } }, context),
      ["twins", "seed", "open", "ports.control"],
    );

    expect(error.message).toContain("The Ibeji configuration is invalid.");
  });

  it("C14: rejects unknown top-level fields and names every one", () => {
    expectConfigInvalid(
      () => parseConfig({ notAField: true, alsoWrong: 1 }, context),
      ["notAField", "alsoWrong"],
    );
  });

  it("C14: rejects unknown twin ids", () => {
    expectConfigInvalid(() => parseConfig({ twins: ["gamma"] }, context), ["twins.0"]);
  });

  it("C14: rejects duplicate twins", () => {
    expectConfigInvalid(() => parseConfig({ twins: ["alpha", "alpha"] }, context), ["twins.1"]);
  });

  it("C14: rejects an empty twins list", () => {
    expectConfigInvalid(() => parseConfig({ twins: [] }, context), ["twins"]);
  });

  it("C14: rejects null values", () => {
    expectConfigInvalid(() => parseConfig({ open: null }, context), ["open"]);
  });

  it("C14: rejects clashing ports", () => {
    expectConfigInvalid(
      () => parseConfig({ ports: { control: 4400, alpha: 4400 } }, context),
      ["ports.alpha"],
    );
  });

  it("C14: rejects ports outside 0 to 65535 and non-numeric ports", () => {
    expectConfigInvalid(() => parseConfig({ ports: { alpha: -1 } }, context), ["ports.alpha"]);
    expectConfigInvalid(() => parseConfig({ ports: { alpha: 70_000 } }, context), ["ports.alpha"]);
    expectConfigInvalid(() => parseConfig({ ports: { alpha: "4401" } }, context), ["ports.alpha"]);
  });

  it("C14: rejects unknown port and webhook keys", () => {
    expectConfigInvalid(() => parseConfig({ ports: { gamma: 4401 } }, context), ["ports.gamma"]);
    expectConfigInvalid(
      () => parseConfig({ webhookUrls: { gamma: "http://127.0.0.1:3000/hook" } }, context),
      ["webhookUrls.gamma"],
    );
    expectConfigInvalid(
      () => parseConfig({ webhookUrls: { control: "http://127.0.0.1:3000/hook" } }, context),
      ["webhookUrls.control"],
    );
  });

  it("C14: rejects a webhook URL that is not http or https", () => {
    expectConfigInvalid(
      () => parseConfig({ webhookUrls: { alpha: "ftp://127.0.0.1/hook" } }, context),
      ["webhookUrls.alpha"],
    );
  });

  it("C14: rejects seeds outside 0 to 4294967295", () => {
    expectConfigInvalid(() => parseConfig({ seed: MAX_SEED + 1 }, context), ["seed"]);
    expectConfigInvalid(() => parseConfig({ seed: 1.5 }, context), ["seed"]);
    expect(parseConfig({ seed: MAX_SEED }, context).seed).toBe(MAX_SEED);
  });

  it("C14: rejects an empty scenario id", () => {
    expectConfigInvalid(() => parseConfig({ scenario: "" }, context), ["scenario"]);
  });

  it("C14: rejects a scenario that supports none of the chosen twins", () => {
    expectConfigInvalid(
      () => parseConfig({ twins: ["alpha"], scenario: "beta-only" }, context),
      ["scenario"],
    );
  });

  it("C14: accepts a scenario that supports one of the implicitly chosen twins", () => {
    expect(parseConfig({ scenario: "beta-only" }, context).scenario).toBe("beta-only");
  });

  it("C14: rejects an unknown scenario", () => {
    expectConfigInvalid(() => parseConfig({ scenario: "missing" }, context), ["scenario"]);
  });

  it("C14: accepts any scenario id when no scenario catalog is supplied", () => {
    expect(parseConfig({ scenario: "not-checked-yet" }, { twinIds: ["alpha"] }).scenario).toBe(
      "not-checked-yet",
    );
  });

  it("C14: rejects secret-looking values with CONFIG_HAS_SECRET and never echoes them", () => {
    const secret = "sk_test_ibeji_config_sample_123";
    try {
      parseConfig({ scenario: secret }, context);
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (!(error instanceof IbejiError)) {
        throw new Error("the thrown value was not an IbejiError");
      }
      expect(error.code).toBe("CONFIG_HAS_SECRET");
      expect(error.why).toContain("scenario");
      expect(error.message).not.toContain(secret);
      return;
    }

    throw new Error("the configuration unexpectedly accepted a secret");
  });

  it("C14: finds secrets in arrays and in custom patterns", () => {
    try {
      parseConfig({ twins: ["secret_abcdef"] }, context);
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("CONFIG_HAS_SECRET");
        expect(error.why).toContain("twins.0");
      }
      return;
    }

    throw new Error("the configuration unexpectedly accepted a secret");
  });

  it("C14: refuses a secret even when it is the whole config value", () => {
    expect(() => parseConfig("sk_test_ibeji_config_sample_123", context)).toThrow(IbejiError);
    try {
      parseConfig("sk_test_ibeji_config_sample_123", context);
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("CONFIG_HAS_SECRET");
        expect(error.why).toContain("(root)");
      }
    }
  });

  it("C14: reports all secret-looking fields in one CONFIG_HAS_SECRET error", () => {
    try {
      parseConfig(
        {
          scenario: "sk_test_ibeji_config_sample_123",
          webhookUrls: { alpha: "http://127.0.0.1:3000/hook?token=Bearer abcdefgh" },
        },
        context,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("CONFIG_HAS_SECRET");
        expect(error.why).toContain("scenario");
        expect(error.why).toContain("webhookUrls.alpha");
      }
      return;
    }

    throw new Error("the configuration unexpectedly accepted secrets");
  });

  it("C14: uses a safe fallback in examples when no twin or scenario is known", () => {
    expectConfigInvalid(
      () =>
        parseConfig(
          { webhookUrls: { anything: "ftp://127.0.0.1/hook" } },
          { twinIds: [], scenarios: {} },
        ),
      ["webhookUrls.anything"],
    );
  });

  it("C14: validates the same schema without a scenario catalog or secret patterns", () => {
    const schema = createConfigSchema({ twinIds: ["alpha"] });
    expect(schema.safeParse({ twins: ["alpha"] }).success).toBe(true);
    expect(schema.safeParse({ twins: ["missing"] }).success).toBe(false);
    expectConfigInvalid(() => parseConfig({ seed: -1 }, { twinIds: ["alpha"] }), ["seed"]);
  });

  it("C14: built-in defaults follow the C3 port defaults supplied by the registry", () => {
    const defaults = createDefaultConfig(context);
    expect(defaults).toEqual({
      twins: ["alpha", "beta"],
      ports: { control: DEFAULT_CONTROL_PORT, alpha: 4401, beta: 4402 },
      webhookUrls: {},
      seed: undefined,
      scenario: undefined,
      open: true,
      allowPrivateWebhooks: false,
      allowPublicWebhooks: false,
    });
  });

  it("C14: merges defaults, then the config file, then flags, and flags replace lists", () => {
    const defaults = createDefaultConfig(context);
    const file = {
      twins: ["alpha"],
      ports: { alpha: 5001 },
      webhookUrls: { alpha: "http://127.0.0.1:3000/from-file" },
      seed: 1,
      scenario: "slow-day",
      open: false,
      allowPrivateWebhooks: true,
      allowPublicWebhooks: true,
    };
    const flags = {
      twins: ["beta"],
      ports: { beta: 6002 },
      webhookUrls: { beta: "http://127.0.0.1:3000/from-flags" },
      seed: 2,
      scenario: "beta-only",
      open: true,
      allowPrivateWebhooks: false,
      allowPublicWebhooks: false,
    };

    expect(mergeConfig(defaults, file, flags)).toEqual({
      twins: ["beta"],
      ports: {
        control: DEFAULT_CONTROL_PORT,
        alpha: 5001,
        beta: 6002,
      },
      webhookUrls: {
        alpha: "http://127.0.0.1:3000/from-file",
        beta: "http://127.0.0.1:3000/from-flags",
      },
      seed: 2,
      scenario: "beta-only",
      open: true,
      allowPrivateWebhooks: false,
      allowPublicWebhooks: false,
    });

    expect(mergeConfig(defaults, file, {})).toMatchObject({
      twins: ["alpha"],
      seed: 1,
      scenario: "slow-day",
      open: false,
      allowPrivateWebhooks: true,
      allowPublicWebhooks: true,
    });

    expect(mergeConfig(defaults, {}, {})).toEqual(defaults);
  });
});
