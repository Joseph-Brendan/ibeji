import { registry } from "../../src/twins/registry.js";
import { expect, gotoPage, openDashboard, test } from "./fixtures.js";
import { setWebhookUrl } from "./support/api.js";
import { expectFontsLoaded, expectLayoutFits } from "./support/assertions.js";
import { driverFor, seedPayment } from "./support/journey.js";

const twins = registry.list();

test.describe("T8 offline rendering", () => {
  test("T8 every page and checkout page renders with local fonts while all non-127.0.0.1 requests are blocked", async ({
    page,
    context,
    ibejiSession,
  }) => {
    const external: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") {
        await route.continue();
        return;
      }
      external.push(url.href);
      await route.abort();
    });

    await openDashboard(page, ibejiSession);
    const pages = [
      "Home",
      "Connect your app",
      "Live activity",
      "Failures",
      "Scenarios",
      "Webhooks",
      "Data",
    ];
    for (const name of pages) {
      if (name !== "Home") {
        await gotoPage(page, name);
      }
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expectFontsLoaded(page, `${name} offline`);
    }

    for (const twin of twins) {
      const driver = driverFor(twin.id);
      const payment = await driver.createPayment(
        ibejiSession.session,
        `offline-${twin.id}-${Date.now()}`,
        undefined,
      );
      const checkout = await context.newPage();
      try {
        await checkout.goto(payment.checkoutUrl);
        await expect(
          checkout.getByRole("heading", {
            name: `Ibeji test checkout: ${twin.displayName} twin. No real money moves.`,
          }),
        ).toBeVisible();
        await expectFontsLoaded(checkout, `${twin.displayName} checkout offline`);
        const resources = (await checkout.evaluate(`
          performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => !name.startsWith("http://127.0.0.1"))
        `)) as readonly string[];
        expect(resources, `${twin.displayName} checkout loaded a remote resource`).toEqual([]);
      } finally {
        await checkout.close();
      }
    }

    const remote = (await page.evaluate(`
      performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => !name.startsWith("http://127.0.0.1"))
    `)) as readonly string[];
    expect(remote, "the dashboard loaded a remote resource").toEqual([]);
    expect(external, "an external request was attempted").toEqual([]);
  });
});

test.describe("T8 responsive layout", () => {
  for (const width of [1280, 768]) {
    test(`T8 every page fits at ${width} pixels without overlap or clipping`, async ({
      dashboard,
      ibejiSession,
      receiver,
    }) => {
      await dashboard.setViewportSize({ width, height: 900 });
      for (const twin of twins) {
        await seedPayment(ibejiSession.session, twin.id, `width-${twin.id}-${width}-${Date.now()}`);
      }
      const twin = twins[0];
      expect(twin).toBeDefined();
      if (twin !== undefined) {
        await setWebhookUrl(ibejiSession, twin.id, `${receiver.url}/webhook`);
        await seedPayment(ibejiSession.session, twin.id, `width-hook-${width}-${Date.now()}`);
        await receiver.waitForRequest((request) => request.path === "/webhook", 10_000);
      }

      const pages = [
        "Home",
        "Connect your app",
        "Live activity",
        "Failures",
        "Scenarios",
        "Webhooks",
        "Data",
      ];
      for (const name of pages) {
        if (name !== "Home") {
          await gotoPage(dashboard, name);
        }
        if (name === "Home") {
          await expect(dashboard.getByTestId(/^twin-card-/u).first()).toBeVisible();
        } else if (name === "Live activity") {
          await expect(dashboard.getByTestId("event-row").first()).toBeVisible({ timeout: 10_000 });
        } else if (name === "Failures" || name === "Scenarios") {
          await expect(dashboard.locator(".failure-card, .scenario-card").first()).toBeVisible();
        } else if (name === "Webhooks") {
          await expect(dashboard.getByTestId(/^delivery-/u).first()).toBeVisible({
            timeout: 10_000,
          });
        } else if (name === "Data") {
          await expect(dashboard.getByTestId(`data-twin-${twins[0]?.id ?? ""}`)).toBeVisible({
            timeout: 10_000,
          });
        }
        await expectLayoutFits(dashboard, `${name} at ${width}px`);
      }

      if (twin !== undefined) {
        const driver = driverFor(twin.id);
        const payment = await driver.createPayment(
          ibejiSession.session,
          `width-checkout-${width}-${Date.now()}`,
          undefined,
        );
        const checkout = await dashboard.context().newPage();
        try {
          await checkout.setViewportSize({ width, height: 900 });
          await checkout.goto(payment.checkoutUrl);
          await expect(
            checkout.getByRole("heading", {
              name: `Ibeji test checkout: ${twin.displayName} twin. No real money moves.`,
            }),
          ).toBeVisible();
          await expectLayoutFits(checkout, `${twin.displayName} checkout at ${width}px`);
        } finally {
          await checkout.close();
        }
      }
    });
  }
});
