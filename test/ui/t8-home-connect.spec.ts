import type { CredentialView } from "../../src/shared/control.js";
import { registry } from "../../src/twins/registry.js";
import { apiUrl, authHeaders } from "../helpers/control.js";
import { expect, gotoPage, openDashboard, selectTwin, test } from "./fixtures.js";
import { expectNoSeriousAxe } from "./support/assertions.js";
import { seedPayment } from "./support/journey.js";

const twins = registry.list();

test.describe("T8 session", () => {
  test("T8 starts every registered twin on port 0 and opens the dashboard", async ({
    dashboard,
    ibejiSession,
  }) => {
    expect(Object.keys(ibejiSession.session.addresses.twins).sort()).toEqual(
      twins.map((twin) => twin.id).sort(),
    );
    for (const twin of twins) {
      const address = ibejiSession.session.addresses.twins[twin.id];
      expect(address, twin.id).toBeDefined();
      if (address === undefined) {
        continue;
      }
      expect(address.hostname).toBe("127.0.0.1");
      expect(address.port).toBeGreaterThan(0);
      expect(address.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    }

    await expect(dashboard.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    expect(new URL(dashboard.url()).searchParams.has("launch")).toBe(false);
    await expectNoSeriousAxe(dashboard, "Home after sign-in");
  });
});

test.describe("T8 Home", () => {
  test("T8 Home loads the empty first run with a card for every running twin", async ({
    dashboard,
    ibejiSession,
  }) => {
    for (const twin of twins) {
      await expect(dashboard.getByTestId(`twin-card-${twin.id}`)).toBeVisible();
      const address = ibejiSession.session.addresses.twins[twin.id];
      expect(address).toBeDefined();
      if (address !== undefined) {
        await expect(dashboard.getByText(address.url, { exact: true })).toBeVisible();
      }
    }
    await expect(dashboard.getByText("No activity yet.")).toBeVisible();
    await expect(dashboard.getByText("No failures are turned on.")).toBeVisible();
    await expect(dashboard.getByTestId("seed-value")).toHaveText(String(ibejiSession.session.seed));
    await expectNoSeriousAxe(dashboard, "Home empty first run");
  });

  test("T8 Home copies the app address, each test key and switches twins", async ({
    dashboard,
    ibejiSession,
  }) => {
    for (const twin of twins) {
      await selectTwin(dashboard, twin.displayName);
      await expect(dashboard.getByTestId(`twin-card-${twin.id}`)).toBeVisible();
      await expect(dashboard.getByTestId("home-page").getByTestId(/^twin-card-/u)).toHaveCount(1);
      const address = ibejiSession.session.addresses.twins[twin.id];
      expect(address).toBeDefined();
      if (address !== undefined) {
        const copyAddress = dashboard.getByRole("button", {
          name: new RegExp(`app address for ${twin.displayName}`, "u"),
        });
        await copyAddress.click();
        await expect(copyAddress).toHaveText("Copied");
        const copied = (await dashboard.evaluate("navigator.clipboard.readText()")) as string;
        expect(copied).toBe(address.url);
      }

      const response = await fetch(apiUrl(ibejiSession.session, `/twins/${twin.id}/credentials`), {
        headers: authHeaders(ibejiSession.session),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { readonly credentials: readonly CredentialView[] };
      for (const credential of body.credentials) {
        await expect(
          dashboard.getByRole("button", {
            name: `Copy ${credential.label} for ${twin.displayName}`,
          }),
        ).toBeVisible();
      }
    }

    await dashboard.getByRole("link", { name: /All twins/u }).click();
    await expect(dashboard.getByTestId("home-page").getByTestId(/^twin-card-/u)).toHaveCount(
      twins.length,
    );
    await expectNoSeriousAxe(dashboard, "Home twin switcher and copy controls");
  });

  test("T8 Home shows real activity from each twin", async ({ dashboard, ibejiSession }) => {
    for (const twin of twins) {
      await seedPayment(ibejiSession.session, twin.id, `home-${twin.id}-${Date.now()}`);
    }
    await dashboard.reload();
    await expect(dashboard.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    for (const twin of twins) {
      const card = dashboard.getByTestId(`twin-card-${twin.id}`);
      await expect(card).toBeVisible();
      await expect(card.getByText(twin.displayName, { exact: true })).toBeVisible();
    }
    await expect(dashboard.getByText(/Your app started a Paystack payment/u).first()).toBeVisible();
    await expect(
      dashboard.getByText(/Your app started a Flutterwave payment/u).first(),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Home with real activity");
  });

  test("T8 Home shows the C12 error state", async ({ page, ibejiSession }) => {
    await page.route("**/_ibeji/api/v1/twins/paystack/credentials", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "The test keys could not be read.",
            why: "The credentials store is unavailable.",
            fix: "Restart Ibeji with ibeji start.",
          },
        }),
      });
    });
    await openDashboard(page, ibejiSession);
    await expect(page.getByRole("heading", { name: "We couldn't load this page." })).toBeVisible();
    await expect(page.getByText("The test keys could not be read.")).toBeVisible();
    await expect(page.getByText("The credentials store is unavailable.")).toBeVisible();
    await expect(page.getByText("Restart Ibeji with ibeji start.")).toBeVisible();
    await expectNoSeriousAxe(page, "Home error state");
  });

  test("T8 Home shows the disconnected banner", async ({ page, ibejiSession }) => {
    await page.route("**/_ibeji/api/v1/events/stream", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL" } }),
      });
    });
    await openDashboard(page, ibejiSession);
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(
      page.getByText(
        "Ibeji may have stopped on your computer. It will try to reconnect on its own.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/^Last updated at /u)).toBeVisible();
    await expectNoSeriousAxe(page, "Home disconnected");
  });
});

test.describe("T8 Connect your app", () => {
  test("T8 Connect shows the picker and a full guide for every twin", async ({
    dashboard,
    ibejiSession,
  }) => {
    await gotoPage(dashboard, "Connect your app");
    await expect(dashboard.getByText("Choose a twin to connect.")).toBeVisible();
    for (const twin of twins) {
      await expect(dashboard.getByTestId(`guide-card-${twin.id}`)).toBeVisible();
    }

    for (const twin of twins) {
      await dashboard.getByRole("link", { name: /All twins/u }).click();
      await expect(dashboard.getByText("Choose a twin to connect.")).toBeVisible();
      await dashboard.getByTestId(`guide-card-${twin.id}`).click();
      await expect(
        dashboard.getByRole("heading", { name: `Connect ${twin.displayName}` }),
      ).toBeVisible();
      const address = ibejiSession.session.addresses.twins[twin.id];
      expect(address).toBeDefined();
      if (address !== undefined) {
        await expect(dashboard.getByText(address.url, { exact: true })).toBeVisible();
      }
      const guide = ibejiSession.session.twins.get(twin.id)?.definition.connectionGuide;
      if (guide !== undefined) {
        await expect(dashboard.getByText(guide.agentInstruction, { exact: true })).toBeVisible();
      }
      await expect(dashboard.getByTestId(`webhook-editor-${twin.id}`)).toBeVisible();

      const response = await fetch(apiUrl(ibejiSession.session, `/twins/${twin.id}/credentials`), {
        headers: authHeaders(ibejiSession.session),
      });
      const body = (await response.json()) as { readonly credentials: readonly CredentialView[] };
      for (const credential of body.credentials) {
        await expect(dashboard.getByText(credential.value, { exact: true })).toBeVisible();
        await expect(
          dashboard.getByRole("button", {
            name: `Copy ${credential.label} for ${twin.displayName}`,
          }),
        ).toBeVisible();
      }
    }
    await expectNoSeriousAxe(dashboard, "Connect guide");
  });

  test("D53 Connect shows both safety warnings for every registered twin", async ({
    dashboard,
  }) => {
    const fakeDataWarning =
      "Use fake customer data only. Ibeji keeps everything your app sends, and shows it in the dashboard and exports.";
    const webhookWarning =
      "Never put a secret in a webhook URL. The URL is shown on screen and saved in exports.";
    for (const twin of twins) {
      await gotoPage(dashboard, "Connect your app");
      await dashboard.getByRole("link", { name: /All twins/u }).click();
      await dashboard.getByTestId(`guide-card-${twin.id}`).click();
      const warnings = dashboard.getByTestId("connect-warnings");
      await expect(warnings.getByText(fakeDataWarning)).toBeVisible();
      await expect(warnings.getByText(webhookWarning)).toBeVisible();
    }
    await expectNoSeriousAxe(dashboard, "Connect safety warnings");
  });

  test("T8 Connect copies the base URL, credentials and agent instruction", async ({
    dashboard,
    ibejiSession,
  }) => {
    await gotoPage(dashboard, "Connect your app");
    await dashboard.getByRole("link", { name: /All twins/u }).click();
    await dashboard.getByTestId(`guide-card-${twins[0]?.id ?? ""}`).click();
    const twin = twins[0];
    expect(twin).toBeDefined();
    if (twin === undefined) {
      return;
    }
    const address = ibejiSession.session.addresses.twins[twin.id];
    expect(address).toBeDefined();
    if (address !== undefined) {
      const copyBase = dashboard.getByRole("button", {
        name: new RegExp(`base URL for ${twin.displayName}`, "u"),
      });
      await copyBase.click();
      await expect(copyBase).toHaveText("Copied");
      expect(await dashboard.evaluate("navigator.clipboard.readText()")).toBe(address.url);
    }
    const copyInstruction = dashboard.getByRole("button", {
      name: new RegExp(`instruction for ${twin.displayName}`, "u"),
    });
    await copyInstruction.click();
    await expect(copyInstruction).toHaveText("Copied");
    const instruction = (await dashboard.evaluate("navigator.clipboard.readText()")) as string;
    expect(instruction).toContain("Never put a live key in test settings.");
    await expectNoSeriousAxe(dashboard, "Connect after copy actions");
  });

  test("T8 Connect saves and clears the webhook URL", async ({ dashboard }) => {
    await gotoPage(dashboard, "Connect your app");
    for (const twin of twins) {
      await dashboard.getByRole("link", { name: /All twins/u }).click();
      await dashboard.getByTestId(`guide-card-${twin.id}`).click();
      const editor = dashboard.getByTestId(`webhook-editor-${twin.id}`);
      const input = editor.getByRole("textbox", { name: "Webhook URL" });
      await input.fill("http://127.0.0.1:3000/ibeji-connect-hook");
      await expect(input).toHaveValue("http://127.0.0.1:3000/ibeji-connect-hook");
      await editor.getByRole("button", { name: "Save webhook URL" }).click();
      await expect(editor.getByText("Webhook URL saved.")).toBeVisible();
      await expect(editor.getByText("Saved address.")).toBeVisible();
      await editor.getByRole("button", { name: "Clear webhook URL" }).click();
      await expect(editor.getByText("Webhook URL cleared.")).toBeVisible();
      await expect(editor.getByText("No webhook URL set.")).toBeVisible();
    }
    await expectNoSeriousAxe(dashboard, "Connect webhook editor");
  });

  test("T8 Connect check-my-connection goes from no request to the last request", async ({
    dashboard,
    ibejiSession,
  }) => {
    for (const twin of twins) {
      await gotoPage(dashboard, "Connect your app");
      await dashboard.getByRole("link", { name: /All twins/u }).click();
      await dashboard.getByTestId(`guide-card-${twin.id}`).click();
      await expect(
        dashboard.getByText(`No requests have reached ${twin.displayName} in the last 5 minutes.`),
      ).toBeVisible();
      await seedPayment(ibejiSession.session, twin.id, `connect-${twin.id}-${Date.now()}`);
      await dashboard.getByRole("button", { name: "Check again" }).click();
      await expect(dashboard.getByText(/Last request: POST \/checkout\//u)).toBeVisible();
      await expect(dashboard.getByText(/Ibeji answered with HTTP \d+/u)).toBeVisible();
    }
    await expectNoSeriousAxe(dashboard, "Connect connection check");
  });

  test("T8 Connect shows the C12 error state", async ({ page, ibejiSession }) => {
    await page.route("**/_ibeji/api/v1/twins/paystack/credentials", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "The guide could not be loaded.",
            why: "The credentials store is unavailable.",
            fix: "Try again.",
          },
        }),
      });
    });
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Connect your app");
    await page.getByTestId("guide-card-paystack").click();
    await expect(page.getByRole("heading", { name: "We couldn't load this guide." })).toBeVisible();
    await expect(page.getByText("The guide could not be loaded.")).toBeVisible();
    await expectNoSeriousAxe(page, "Connect error state");
  });

  test("T8 Connect shows the disconnected banner", async ({ page, ibejiSession }) => {
    await page.route("**/_ibeji/api/v1/events/stream", async (route) => {
      await route.fulfill({ status: 503, json: { error: { code: "INTERNAL" } } });
    });
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Connect your app");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(page.getByTestId("connect-page")).toBeVisible();
    await expectNoSeriousAxe(page, "Connect disconnected");
  });
});
