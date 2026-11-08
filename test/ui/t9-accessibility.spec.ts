import { registry } from "../../src/twins/registry.js";
import { expect, gotoPage, test } from "./fixtures.js";
import { clearRules, createRule, setWebhookUrl } from "./support/api.js";
import { expectNoSeriousAxe } from "./support/assertions.js";
import { completeCheckoutInNode, driverFor, seedPayment } from "./support/journey.js";

const twins = registry.list();

test.describe("T9 dashboard axe", () => {
  test("T9 every dashboard page has zero serious or critical axe problems", async ({
    dashboard,
    ibejiSession,
    receiver,
  }) => {
    const twin = twins[0];
    expect(twin).toBeDefined();
    if (twin === undefined) {
      return;
    }
    await setWebhookUrl(ibejiSession, twin.id, `${receiver.url}/webhook`);
    await seedPayment(ibejiSession.session, twin.id, `axe-${Date.now()}`);
    await receiver.waitForRequest((request) => request.path === "/webhook", 10_000);

    await expectNoSeriousAxe(dashboard, "Home normal");

    await gotoPage(dashboard, "Connect your app");
    await expectNoSeriousAxe(dashboard, "Connect picker");
    await dashboard.getByTestId(`guide-card-${twin.id}`).click();
    await expectNoSeriousAxe(dashboard, "Connect guide");

    await gotoPage(dashboard, "Live activity");
    await expectNoSeriousAxe(dashboard, "Live activity normal");
    await dashboard.getByRole("button", { name: "Pause activity" }).click();
    await expectNoSeriousAxe(dashboard, "Live activity paused");
    await dashboard.getByRole("button", { name: "Resume" }).click();
    await dashboard.getByRole("button", { name: "Details" }).first().click();
    await expectNoSeriousAxe(dashboard, "Live activity details open");

    await gotoPage(dashboard, "Failures");
    await expectNoSeriousAxe(dashboard, "Failures normal");
    const failure = dashboard.getByTestId("failure-server-error");
    await failure.getByRole("switch", { name: /Switch on/u }).click();
    await expectNoSeriousAxe(dashboard, "Failures rule on");
    await dashboard.getByRole("button", { name: "Clear all failures" }).click();
    await expectNoSeriousAxe(dashboard, "Failures clear dialog");
    await dashboard.locator("dialog").getByRole("button", { name: "Cancel" }).click();
    await dashboard.getByRole("button", { name: "Clear all failures" }).click();
    await dashboard.locator("dialog").getByRole("button", { name: "Clear all failures" }).click();

    await gotoPage(dashboard, "Scenarios");
    await expectNoSeriousAxe(dashboard, "Scenarios normal");
    await dashboard
      .getByTestId("scenario-bank-outage")
      .getByRole("button", { name: "Run scenario" })
      .click();
    await expectNoSeriousAxe(dashboard, "Scenarios running");
    await dashboard
      .locator(".active-scenario")
      .getByRole("button", { name: "Stop scenario" })
      .click();

    await gotoPage(dashboard, "Webhooks");
    await expectNoSeriousAxe(dashboard, "Webhooks normal");
    const delivery = dashboard.getByTestId(/^delivery-/u).first();
    await expect(delivery).toBeVisible({ timeout: 10_000 });
    await delivery.getByText("Show attempts").click();
    await expectNoSeriousAxe(dashboard, "Webhooks expanded delivery");

    await dashboard.getByRole("link", { name: /All twins/u }).click();
    await gotoPage(dashboard, "Data");
    await expectNoSeriousAxe(dashboard, "Data normal");
    await dashboard.getByRole("button", { name: "Reset all records" }).click();
    await expectNoSeriousAxe(dashboard, "Data reset dialog");
    await dashboard.locator("dialog").getByRole("button", { name: "Cancel" }).click();
  });

  test("T9 Home help and key-replacement states have zero serious or critical axe problems", async ({
    dashboard,
  }) => {
    await dashboard.getByRole("button", { name: "Help" }).click();
    await expectNoSeriousAxe(dashboard, "Home Help panel");
    await dashboard.keyboard.press("Escape");
    await dashboard.getByRole("button", { name: "Replace test keys" }).first().click();
    await expectNoSeriousAxe(dashboard, "Home replace-keys dialog");
    await dashboard.getByRole("button", { name: "Cancel" }).click();
  });

  test("T9 a failure validation error has zero serious or critical axe problems", async ({
    dashboard,
  }) => {
    await gotoPage(dashboard, "Failures");
    const card = dashboard.getByTestId("failure-server-error");
    await card.getByLabel(/HTTP status/u).fill("400");
    await card.getByRole("switch", { name: /Switch on/u }).click();
    await expect(card.getByText("Enter a number from 500 to 599.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures validation error");
  });

  test("T9 sign-in states have zero serious or critical axe problems", async ({
    browser,
    ibejiSession,
  }) => {
    const controlUrl = ibejiSession.session.addresses.control.url;
    const invalid = await browser.newContext();
    try {
      const page = await invalid.newPage();
      await page.goto(`${controlUrl}/_ibeji/?launch=not-a-real-code`);
      await expect(
        page.getByRole("heading", { name: "This sign-in link has expired." }),
      ).toBeVisible();
      await expectNoSeriousAxe(page, "Sign-in invalid link");
    } finally {
      await invalid.close();
    }

    const noCookie = await browser.newContext();
    try {
      const page = await noCookie.newPage();
      await page.goto(controlUrl);
      await expect(
        page.getByRole("heading", { name: "Start Ibeji from your terminal." }),
      ).toBeVisible();
      await expectNoSeriousAxe(page, "Sign-in no cookie");
    } finally {
      await noCookie.close();
    }

    const stale = await browser.newContext();
    try {
      await stale.addCookies([{ name: "ibeji_ui", value: "not-a-live-token", url: controlUrl }]);
      const page = await stale.newPage();
      await page.goto(controlUrl);
      await expect(page.getByRole("heading", { name: "Ibeji was restarted." })).toBeVisible();
      await expectNoSeriousAxe(page, "Sign-in restarted");
    } finally {
      await stale.close();
    }
  });
});

test.describe("T9 checkout axe", () => {
  test("T9 every checkout page and the Paystack result page have zero serious or critical axe problems", async ({
    page,
    ibejiSession,
  }) => {
    for (const twin of twins) {
      const driver = driverFor(twin.id);
      const reference = `axe-checkout-${twin.id}-${Date.now()}`;
      const payment = await driver.createPayment(ibejiSession.session, reference, undefined);
      await page.goto(payment.checkoutUrl);
      await expect(
        page.getByRole("heading", {
          name: `Ibeji test checkout: ${twin.displayName} twin. No real money moves.`,
        }),
      ).toBeVisible();
      await expectNoSeriousAxe(page, `${twin.displayName} checkout page`);

      if (twin.id === "paystack") {
        await page.getByRole("button", { name: driver.checkoutSuccessLabel }).click();
        await expect(page.getByText(/payment succeeded/u)).toBeVisible();
        await expectNoSeriousAxe(page, `${twin.displayName} checkout result page`);
      } else {
        await completeCheckoutInNode(ibejiSession.session, twin.id, payment.checkoutUrl, "success");
      }
    }
  });

  test("T9 a checkout page with a failure override has zero serious or critical axe problems", async ({
    page,
    ibejiSession,
  }) => {
    const twin = twins[0];
    expect(twin).toBeDefined();
    if (twin === undefined) {
      return;
    }
    await createRule(ibejiSession, "payment-declined", [twin.id], { percent: 100 });
    try {
      const driver = driverFor(twin.id);
      const payment = await driver.createPayment(
        ibejiSession.session,
        `axe-declined-${Date.now()}`,
        undefined,
      );
      await page.goto(payment.checkoutUrl);
      await expect(page.getByText(/An Ibeji failure rule changed this result/u)).toBeVisible();
      await expectNoSeriousAxe(page, `${twin.displayName} checkout failure override`);
    } finally {
      await clearRules(ibejiSession);
    }
  });
});

test.describe("T9 keyboard", () => {
  test("T9 the skip link moves focus to the main content", async ({ dashboard }) => {
    await dashboard.keyboard.press("Tab");
    await expect(dashboard.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await dashboard.keyboard.press("Enter");
    expect(await dashboard.evaluate("document.activeElement && document.activeElement.id")).toBe(
      "main-content",
    );
  });

  test("T9 Home copy button works with the keyboard", async ({ dashboard }) => {
    await tabTo(dashboard, "Copy app address for Paystack");
    const copy = dashboard.getByRole("button", { name: /app address for Paystack/u });
    await expect(copy).toBeFocused();
    await copy.press("Space");
    await expect(copy).toHaveText("Copied");
  });

  test("T9 Connect your app works with the keyboard", async ({ dashboard }) => {
    await keyboardNavigate(dashboard, "Connect your app");
    await tabTo(dashboard, "Open guide");
    await dashboard.keyboard.press("Enter");
    await expect(dashboard.getByRole("heading", { name: "Connect Paystack" })).toBeVisible();
    await tabTo(dashboard, "base URL for Paystack");
    const copy = dashboard.getByRole("button", { name: /base URL for Paystack/u });
    await expect(copy).toBeFocused();
    await copy.press("Space");
    await expect(copy).toHaveText("Copied");
  });

  test("T9 Live activity works with the keyboard", async ({ dashboard }) => {
    await keyboardNavigate(dashboard, "Live activity");
    await tabTo(dashboard, "Pause activity");
    await dashboard.keyboard.press("Space");
    await expect(dashboard.getByRole("button", { name: "Resume" })).toBeVisible();
    await dashboard.keyboard.press("Space");
    await expect(dashboard.getByRole("button", { name: "Pause activity" })).toBeVisible();
  });

  test("T9 Failures works with the keyboard", async ({ dashboard }) => {
    await keyboardNavigate(dashboard, "Failures");
    await tabTo(dashboard, "Switch on for 2 twins");
    await dashboard.keyboard.press("Space");
    await expect(dashboard.locator(".failure-card").first().locator(".status-pill")).toHaveText(
      "On",
    );
  });

  test("T9 Scenarios works with the keyboard", async ({ dashboard }) => {
    await keyboardNavigate(dashboard, "Scenarios");
    await tabTo(dashboard, "Run scenario");
    await dashboard.keyboard.press("Space");
    await expect(
      dashboard.locator(".active-scenario").getByRole("heading", { name: "Bank outage" }),
    ).toBeVisible();
    await backTabTo(dashboard, "Stop scenario");
    const stop = dashboard.getByRole("button", { name: "Stop scenario" });
    await expect(stop).toBeFocused();
    await expect(stop).toBeEnabled();
    await stop.press("Space");
    await expect(dashboard.getByText("No scenario is running.")).toBeVisible();
  });

  test("T9 Webhooks works with the keyboard", async ({ dashboard, ibejiSession, receiver }) => {
    const twin = twins[0];
    expect(twin).toBeDefined();
    if (twin === undefined) {
      return;
    }
    await setWebhookUrl(ibejiSession, twin.id, `${receiver.url}/webhook`);
    await seedPayment(ibejiSession.session, twin.id, `keyboard-${Date.now()}`);
    await receiver.waitForRequest((request) => request.path === "/webhook", 10_000);
    await keyboardNavigate(dashboard, "Webhooks");
    await tabTo(dashboard, "Resend");
    await dashboard.keyboard.press("Space");
    await expect(dashboard.getByText("Delivery queued again.")).toBeVisible();
  });

  test("T9 Data works with the keyboard", async ({ dashboard, ibejiSession }) => {
    const twin = twins[0];
    expect(twin).toBeDefined();
    if (twin === undefined) {
      return;
    }
    await seedPayment(ibejiSession.session, twin.id, `keyboard-data-${Date.now()}`);
    await keyboardNavigate(dashboard, "Data");
    await tabTo(dashboard, "Reset all records");
    await dashboard.keyboard.press("Space");
    await expect(dashboard.getByRole("heading", { name: "Reset all twin records?" })).toBeVisible();
    await dashboard.keyboard.press("Escape");
    await expect(
      dashboard.getByRole("heading", { name: "Reset all twin records?" }),
    ).not.toBeVisible();
  });
});

async function keyboardNavigate(
  page: import("@playwright/test").Page,
  linkName: string,
): Promise<void> {
  await tabTo(page, linkName);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: linkName, level: 1 })).toBeVisible();
}

async function tabTo(
  page: import("@playwright/test").Page,
  text: string,
  maxTabs = 400,
): Promise<void> {
  await moveFocus(page, text, "Tab", maxTabs);
}

async function backTabTo(
  page: import("@playwright/test").Page,
  text: string,
  maxTabs = 400,
): Promise<void> {
  await moveFocus(page, text, "Shift+Tab", maxTabs);
}

async function moveFocus(
  page: import("@playwright/test").Page,
  text: string,
  key: "Tab" | "Shift+Tab",
  maxTabs: number,
): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press(key);
    const focused = (await page.evaluate(`
      (() => {
        const element = document.activeElement;
        if (element === null || element === document.body) return "";
        return [element.textContent || "", element.getAttribute("aria-label") || "", element.getAttribute("href") || ""].join(" ");
      })()
    `)) as string;
    if (focused.includes(text)) {
      return;
    }
  }
  throw new Error(`Could not reach "${text}" with ${maxTabs} ${key} presses.`);
}
