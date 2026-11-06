import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/run.js";
import { decideWebhook } from "../../src/core/failures/engine.js";
import { SeededRandom } from "../../src/core/random.js";
import { fingerprint } from "../../src/core/redact.js";
import { liveKeyPatterns } from "../../src/twins/registry.js";
import { startControlSession } from "../helpers/control.js";
import { startInProcessMcp } from "../helpers/mcp.js";

const TEST_KEYS = [
  "pk_live_REMOVAL_PAYSTACK_PUBLIC_1234567890",
  "sk_live_REMOVAL_PAYSTACK_SECRET_1234567890",
  "FLWPUBK-REMOVAL_FLUTTERWAVE_PUBLIC_1234567890",
  "FLWSECK-REMOVAL_FLUTTERWAVE_SECRET_1234567890",
  "pk_live_REMOVAL_STRIPE_PUBLIC_1234567890",
  "sk_live_REMOVAL_STRIPE_SECRET_1234567890",
  "rk_live_REMOVAL_STRIPE_RESTRICTED_1234567890",
] as const;

function keyPieces(key: string): readonly string[] {
  const pieces: string[] = [];
  for (let index = 0; index <= key.length - 12; index += 1) {
    pieces.push(key.slice(index, index + 12));
  }
  return pieces;
}

function containsKeyPiece(text: string, key: string): boolean {
  return keyPieces(key).some((piece) => text.includes(piece));
}

async function runJson(
  home: string,
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    home,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("D43 live keys in request fields are removed", () => {
  it("T6/D43 removes every live format from fields and every output surface", async () => {
    const harness = await startControlSession();
    const exportFile = join(harness.home, "live-key-export.json");
    try {
      const session = harness.session;
      const paystack = session.twins.get("paystack");
      const flutterwave = session.twins.get("flutterwave");
      expect(paystack).toBeDefined();
      expect(flutterwave).toBeDefined();
      if (paystack === undefined || flutterwave === undefined) {
        throw new Error("expected both twins");
      }
      const paystackCredentials = session.credentials.paystack ?? {};
      const flutterwaveCredentials = session.credentials.flutterwave ?? {};
      const paystackAddress = session.addresses.twins.paystack?.url;
      const flutterwaveAddress = session.addresses.twins.flutterwave?.url;
      expect(paystackAddress).toBeDefined();
      expect(flutterwaveAddress).toBeDefined();
      if (paystackAddress === undefined || flutterwaveAddress === undefined) {
        throw new Error("expected both twin addresses");
      }

      for (const [index, key] of TEST_KEYS.entries()) {
        const paystackResponse = await fetch(
          `${paystackAddress}/transaction/initialize?note=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${paystackCredentials.secret ?? ""}`,
              "content-type": "application/json",
              "x-review-key": key,
            },
            body: JSON.stringify({
              email: key,
              amount: "10000",
              reference: `removal-paystack-${index}`,
              metadata: { nested: { note: key } },
              callback_url: "http://127.0.0.1:1/return",
            }),
          },
        );
        expect(paystackResponse.status, `Paystack request ${index}`).toBe(200);
        const paystackBody = (await paystackResponse.json()) as {
          data?: { authorization_url?: string };
        };
        const authorizationUrl = paystackBody.data?.authorization_url;
        expect(authorizationUrl, `Paystack checkout ${index}`).toBeDefined();
        if (authorizationUrl !== undefined) {
          const checkout = await fetch(authorizationUrl, {
            method: "POST",
            redirect: "manual",
            headers: {
              origin: paystackAddress,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: "outcome=success",
          });
          expect(checkout.status, `Paystack checkout response ${index}`).toBeLessThan(400);
        }

        const flutterwaveResponse = await fetch(
          `${flutterwaveAddress}/v3/payments?note=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${flutterwaveCredentials.secret ?? ""}`,
              "content-type": "application/json",
              "x-review-key": key,
            },
            body: JSON.stringify({
              amount: 7500,
              tx_ref: `removal-flutterwave-${index}`,
              currency: "NGN",
              redirect_url: "http://127.0.0.1:1/return",
              customer: { email: key },
              meta: { nested: { note: key } },
            }),
          },
        );
        expect(flutterwaveResponse.status, `Flutterwave request ${index}`).toBe(200);
        const flutterwaveBody = (await flutterwaveResponse.json()) as {
          data?: { link?: string };
        };
        const checkoutLink = flutterwaveBody.data?.link;
        expect(checkoutLink, `Flutterwave checkout ${index}`).toBeDefined();
        if (checkoutLink !== undefined) {
          const checkout = await fetch(checkoutLink, {
            method: "POST",
            redirect: "manual",
            headers: {
              origin: flutterwaveAddress,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: "outcome=success",
          });
          expect(checkout.status, `Flutterwave checkout response ${index}`).toBeLessThan(400);
        }
      }

      const injectedKey = TEST_KEYS[0] as string;
      session.events.publish({
        type: "warning",
        scope: "ibeji",
        summary: `Injected output test ${injectedKey}`,
        details: { value: injectedKey },
      });
      const plan = decideWebhook({
        twinId: "paystack",
        actionId: "checkout.submit",
        rules: [],
        random: new SeededRandom(1),
        now: harness.clock.now(),
      });
      session.dispatcher.enqueue({
        eventId: "output-scan",
        twinId: "paystack",
        actionId: "checkout.submit",
        raw: {
          body: JSON.stringify({ email: injectedKey }),
          contentType: "application/json",
        },
        plan,
      });

      const headers = { authorization: `Bearer ${session.token}` };
      const events = await (
        await fetch(`${session.addresses.control.url}/_ibeji/api/v1/events?limit=500`, { headers })
      ).json();
      const paystackState = await (
        await fetch(`${session.addresses.control.url}/_ibeji/api/v1/twins/paystack/state`, {
          headers,
        })
      ).json();
      const flutterwaveState = await (
        await fetch(`${session.addresses.control.url}/_ibeji/api/v1/twins/flutterwave/state`, {
          headers,
        })
      ).json();
      const paystackWebhooks = await (
        await fetch(`${session.addresses.control.url}/_ibeji/api/v1/webhooks?twin=paystack`, {
          headers,
        })
      ).json();
      const flutterwaveWebhooks = await (
        await fetch(`${session.addresses.control.url}/_ibeji/api/v1/webhooks?twin=flutterwave`, {
          headers,
        })
      ).json();
      const exportApi = await (
        await fetch(`${session.addresses.control.url}/_ibeji/api/v1/export`, { headers })
      ).json();
      const cliError = await runJson(harness.home, [
        "webhook-url",
        "paystack",
        `http://${injectedKey.toLowerCase()}.invalid/`,
      ]);
      expect(cliError.code).not.toBe(0);
      expect(containsKeyPiece(cliError.stderr + cliError.stdout, injectedKey)).toBe(false);
      expect(cliError.stderr + cliError.stdout).toContain("[live key removed:");
      const cliEvents = await runJson(harness.home, ["events", "--json"]);
      const cliStatus = await runJson(harness.home, ["status", "--json"]);
      const cliExport = await runJson(harness.home, ["export", exportFile, "--json"]);
      const exportText = await readFile(exportFile, "utf8");
      const mcp = await startInProcessMcp(harness.home);
      let mcpEvents: unknown;
      let mcpWebhooks: unknown;
      try {
        mcpEvents = await mcp.client.callTool({
          name: "ibeji_list_events",
          arguments: { limit: 500 },
        });
        mcpWebhooks = await mcp.client.callTool({
          name: "ibeji_list_webhooks",
          arguments: {},
        });
        const mcpError = await mcp.client.callTool({
          name: "ibeji_set_webhook_url",
          arguments: {
            twin: "paystack",
            url: `http://${TEST_KEYS[0]?.toLowerCase() ?? ""}.invalid/`,
          },
        });
        expect(containsKeyPiece(JSON.stringify(mcpError), TEST_KEYS[0] as string)).toBe(false);
        expect(JSON.stringify(mcpError)).toContain("[live key removed:");
      } finally {
        await mcp.close();
      }

      expect(cliEvents.code).toBe(0);
      expect(cliStatus.code).toBe(0);
      expect(cliExport.code).toBe(0);
      const surfaces = {
        events: JSON.stringify(events),
        state: JSON.stringify({ paystackState, flutterwaveState }),
        webhooks: JSON.stringify({ paystackWebhooks, flutterwaveWebhooks }),
        exportApi: JSON.stringify(exportApi),
        exportFile: exportText,
        cliEvents: cliEvents.stdout,
        cliStatus: cliStatus.stdout,
        mcp: JSON.stringify({ mcpEvents, mcpWebhooks }),
        logger: harness.logs.join("\n"),
      };

      for (const key of TEST_KEYS) {
        for (const [surface, text] of Object.entries(surfaces)) {
          expect(
            containsKeyPiece(text, key),
            `${surface} contains a 12-character piece of ${key}`,
          ).toBe(false);
        }
        expect(surfaces.state).toContain(`[live key removed: ${fingerprint(key)}]`);
        expect(surfaces.events).toContain(fingerprint(key));
      }

      const warningEvents =
        (
          events as {
            events?: readonly { type: string; summary: string; details: Record<string, unknown> }[];
          }
        ).events ?? [];
      expect(
        warningEvents.some(
          (event) =>
            event.type === "warning" &&
            Array.isArray(event.details.services) &&
            event.details.services.includes("Flutterwave"),
        ),
      ).toBe(true);
      expect(
        warningEvents.every(
          (event) =>
            !containsKeyPiece(`${event.summary} ${JSON.stringify(event.details)}`, injectedKey),
        ),
      ).toBe(true);

      const urlKey = injectedKey.toLowerCase();
      const controlError = await fetch(
        `${session.addresses.control.url}/_ibeji/api/v1/twins/paystack/webhook-url`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ url: `http://${urlKey}.invalid/` }),
        },
      );
      const controlErrorText = await controlError.text();
      expect(controlError.status).toBe(400);
      expect(containsKeyPiece(controlErrorText, injectedKey)).toBe(false);
      expect(controlErrorText).toContain("[live key removed:");

      const stripeRestricted = TEST_KEYS[6] as string;
      const twinError = await fetch(
        `${flutterwaveAddress}/v3/refunds/${encodeURIComponent(stripeRestricted)}`,
        {
          headers: { authorization: `Bearer ${flutterwaveCredentials.secret ?? ""}` },
        },
      );
      const twinErrorText = await twinError.text();
      expect(twinError.status).toBe(400);
      expect(containsKeyPiece(twinErrorText, stripeRestricted)).toBe(false);
      expect(twinErrorText).toContain(`[live key removed: ${fingerprint(stripeRestricted)}]`);

      expect(liveKeyPatterns().length).toBeGreaterThanOrEqual(4);
    } finally {
      await rm(exportFile, { force: true });
      await harness.cleanup();
    }
  }, 60_000);
});
