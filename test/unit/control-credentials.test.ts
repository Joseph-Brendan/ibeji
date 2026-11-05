import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CredentialsStore } from "../../src/control/credentials.js";
import { credentialsPath, ensureIbejiHome } from "../../src/control/paths.js";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import { paystackTwin } from "../../src/twins/paystack/definition.js";

const definitions = [paystackTwin, flutterwaveTwin];

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "ibeji-credentials-"));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("T6 credentials store", () => {
  it("T6 creates every registered twin's credentials on first load", async () => {
    await withHome(async (home) => {
      const store = await CredentialsStore.load(home, definitions);
      expect(Object.keys(store.all()).sort()).toEqual(["flutterwave", "paystack"]);
      expect(store.get("paystack").public).toMatch(/^pk_test_ibeji_/u);
      expect(store.get("paystack").secret).toMatch(/^sk_test_ibeji_/u);
      expect(store.get("flutterwave").webhook).toMatch(/^ibeji_/u);
      expect(store.views("paystack")).toHaveLength(2);
      expect(store.fingerprints().paystack?.secret).toHaveLength(8);

      expect(store.all().paystack).not.toBe(store.all().paystack);
    });
  });

  it("T6 refuses a corrupt or wrongly shaped credentials file", async () => {
    await withHome(async (home) => {
      await ensureIbejiHome(home);
      await writeFile(credentialsPath(home), "{not json", "utf8");
      await expect(CredentialsStore.load(home, definitions)).rejects.toMatchObject({
        code: "INTERNAL",
      });

      await writeFile(credentialsPath(home), JSON.stringify({ version: 2, twins: {} }), "utf8");
      await expect(CredentialsStore.load(home, definitions)).rejects.toMatchObject({
        code: "INTERNAL",
      });
    });
  });

  it("T6 regenerates only the twin whose values are not test credentials", async () => {
    await withHome(async (home) => {
      await ensureIbejiHome(home);
      await writeFile(
        credentialsPath(home),
        JSON.stringify({
          version: 1,
          twins: {
            paystack: {
              public: "pk_test_ibeji_kept_public",
              secret: "sk_test_ibeji_kept_secret",
            },
            flutterwave: {
              public: "FLWPUBK_TEST-ibeji-kept",
              secret: "not-a-test-key",
              webhook: "ibeji_kept_webhook",
            },
          },
        }),
        "utf8",
      );

      const store = await CredentialsStore.load(home, definitions);
      expect(store.get("paystack")).toEqual({
        public: "pk_test_ibeji_kept_public",
        secret: "sk_test_ibeji_kept_secret",
      });
      expect(store.get("flutterwave").secret).toMatch(/^FLWSECK_TEST-/u);
      expect(store.get("flutterwave").public).not.toBe("FLWPUBK_TEST-ibeji-kept");
      const saved = JSON.parse(await readFile(credentialsPath(home), "utf8")) as {
        twins: Record<string, Record<string, string>>;
      };
      expect(saved.twins.paystack?.secret).toBe("sk_test_ibeji_kept_secret");
    });
  });

  it("T6 refuses unknown twins and rotates the whole set", async () => {
    await withHome(async (home) => {
      const store = await CredentialsStore.load(home, definitions);
      expect(() => store.get("missing")).toThrow(expect.objectContaining({ code: "UNKNOWN_TWIN" }));
      expect(() => store.views("missing")).toThrow(
        expect.objectContaining({ code: "UNKNOWN_TWIN" }),
      );
      await expect(store.rotate("missing")).rejects.toMatchObject({ code: "UNKNOWN_TWIN" });

      const before = store.all();
      const rotated = await store.rotate();
      expect(rotated).toEqual(["paystack", "flutterwave"]);
      expect(store.all()).not.toEqual(before);
      expect(store.secretValues()).toHaveLength(10);
      if (process.platform !== "win32") {
        // Windows has no POSIX mode bits; the file inherits the user's profile ACL.
        expect((await stat(credentialsPath(home))).mode & 0o777).toBe(0o600);
      }
    });
  });
});
