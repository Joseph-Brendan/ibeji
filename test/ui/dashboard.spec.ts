import { expect, test } from "@playwright/test";

import type { TwinSummary } from "../../src/shared/control.js";
import { type ControlSessionHarness, startControlSession } from "../helpers/control.js";

let harness: ControlSessionHarness;

test.beforeAll(async () => {
  harness = await startControlSession({});
});

test.afterAll(async () => {
  await harness.cleanup();
});

test("T8 the launch code signs in, leaves the address bar, survives reload and a second tab, and uses no web storage", async ({
  page,
}) => {
  await page.goto(harness.session.createLaunchLink());
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("launch")).toBe(false);

  const storage = (await page.evaluate(
    "({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })",
  )) as { readonly local: readonly string[]; readonly session: readonly string[] };
  expect(storage).toEqual({ local: [], session: [] });

  await expect(page.getByTestId("seed-value")).toHaveText(String(harness.session.seed));
  await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Choose a twin" })).toBeVisible();
  await expect(page.getByTestId("twin-card-paystack")).toBeVisible();
  await expect(page.getByTestId("twin-card-flutterwave")).toBeVisible();
  await expect(page.getByText("No activity yet.")).toBeVisible();
  await expect(page.getByText("No failures are turned on.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy secret key for Paystack" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy app address for Paystack" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  const second = await page.context().newPage();
  try {
    await second.goto(`${harness.session.addresses.control.url}/_ibeji/`);
    await expect(second.getByRole("heading", { name: "Home" })).toBeVisible();
  } finally {
    await second.close();
  }
});

test("T8 a used or made-up launch code shows the invalid page without keeping the code", async ({
  page,
}) => {
  await page.goto(`${harness.session.addresses.control.url}/_ibeji/?launch=not-a-real-code`);
  await expect(page.getByRole("heading", { name: "This sign-in link has expired." })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("launch")).toBe(false);
});

test("T8 opening the dashboard with no cookie explains ibeji start and ibeji open", async ({
  page,
}) => {
  await page.goto(`${harness.session.addresses.control.url}/_ibeji/`);
  await expect(
    page.getByRole("heading", { name: "Start Ibeji from your terminal." }),
  ).toBeVisible();
  await expect(
    page.getByText("Run ibeji start to begin, or ibeji open to get a dashboard link.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("T8 a stale cookie shows the restarted page and the exact live announcement", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "ibeji_ui",
      value: "this-is-not-a-live-token",
      url: harness.session.addresses.control.url,
    },
  ]);
  await page.goto(`${harness.session.addresses.control.url}/_ibeji/`);
  await expect(page.getByRole("heading", { name: "Ibeji was restarted." })).toBeVisible();
  await expect(page.locator('.sign-in-card [role="status"]')).toHaveText(
    "Ibeji was restarted. Run ibeji open to get a new link.",
  );
});

test("T8 the twin switcher renders a made-up fourth twin from the API", async ({ page }) => {
  await page.route("**/_ibeji/api/v1/twins", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { twins: TwinSummary[] };
    body.twins.push({
      id: "made-up",
      displayName: "Made Up Twin",
      running: false,
      address: null,
      port: null,
      actions: [],
      failures: [],
      currencyRules: {
        zeroDecimal: [],
        defaultFractionDigits: 2,
        fractionDigits: {},
      },
      labelColourToken: "twin-label-4",
    });
    await route.fulfill({ response, json: body });
  });

  await page.goto(harness.session.createLaunchLink());
  await expect(page.getByRole("link", { name: /Made Up Twin/u })).toBeVisible();
});

test("T8 the dashboard renders with no shadows or gradients", async ({ page }) => {
  const visualEffects = async (): Promise<readonly string[]> =>
    (await page.evaluate(`
      (() => {
        const found = [];
        for (const element of document.querySelectorAll("*")) {
          const style = getComputedStyle(element);
          if (style.boxShadow !== "none") {
            found.push(element.tagName + " has a box shadow");
          }
          if (style.textShadow !== "none") {
            found.push(element.tagName + " has a text shadow");
          }
          if (style.backgroundImage.includes("gradient")) {
            found.push(element.tagName + " has a gradient");
          }
        }
        return found;
      })()
    `)) as readonly string[];

  await page.goto(harness.session.createLaunchLink());
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(await visualEffects()).toEqual([]);

  await page.getByRole("button", { name: "Replace test keys" }).first().click();
  await expect(page.getByRole("heading", { name: "Replace Paystack test keys?" })).toBeVisible();
  expect(await visualEffects()).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("T8 Home shows the newest activity when events exist", async ({ page }) => {
  await page.route(/\/_ibeji\/api\/v1\/events\?limit=500$/u, async (route) => {
    await route.fulfill({
      json: {
        events: [
          {
            id: 42,
            time: Date.now(),
            type: "request",
            scope: "paystack",
            summary: "Payment succeeded.",
            details: {},
          },
        ],
      },
    });
  });

  await page.goto(harness.session.createLaunchLink());
  await expect(page.getByText("Payment succeeded.")).toBeVisible();
  await expect(page.getByText("No activity yet.")).not.toBeVisible();
});

test("T8 the Help menu opens with the plain-word terms and closes with Escape", async ({
  page,
}) => {
  await page.goto(harness.session.createLaunchLink());
  await page.getByRole("button", { name: "Help" }).click();
  const panel = page.getByRole("region", { name: "Help" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("App address")).toBeVisible();
  await expect(panel.getByText("The address your app uses to reach this twin.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
});

test("T8 the replace-keys action asks for confirmation and Cancel changes nothing", async ({
  page,
}) => {
  await page.goto(harness.session.createLaunchLink());
  await page.getByRole("button", { name: "Replace test keys" }).first().click();
  await expect(page.getByRole("heading", { name: "Replace Paystack test keys?" })).toBeVisible();
  await expect(
    page.getByText(
      "Your old keys will stop working right away. Update your app with the new keys.",
    ),
  ).toBeVisible();
  await expect(page.getByText("This cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Replace Paystack test keys?" }),
  ).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Replace test keys" }).first()).toBeFocused();
});

test("T8 an off twin shows its off state and still shows its saved keys", async ({ page }) => {
  await page.route("**/_ibeji/api/v1/twins", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { twins: TwinSummary[] };
    const twin = body.twins.find((item) => item.id === "flutterwave");
    if (twin !== undefined) {
      body.twins[body.twins.indexOf(twin)] = {
        ...twin,
        running: false,
        address: null,
        port: null,
      };
    }
    await route.fulfill({ response, json: body });
  });

  await page.goto(harness.session.createLaunchLink());
  await page.getByRole("link", { name: /Flutterwave/u }).click();
  await expect(
    page.getByText("Flutterwave is off. To turn it on, run ibeji start --twins flutterwave."),
  ).toBeVisible();
  await expect(page.getByText("Available when this twin is running.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy secret key for Flutterwave" })).toBeVisible();
});

test("T8 a credential error shows what, why and fix", async ({ page }) => {
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

  await page.goto(harness.session.createLaunchLink());
  await expect(page.getByRole("heading", { name: "We couldn't load this page." })).toBeVisible();
  await expect(page.getByText("The test keys could not be read.")).toBeVisible();
  await expect(page.getByText("The credentials store is unavailable.")).toBeVisible();
  await expect(page.getByText("Restart Ibeji with ibeji start.")).toBeVisible();
});

test("T8 a failed live stream shows the connection banner", async ({ page }) => {
  await page.route("**/_ibeji/api/v1/events/stream", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL" } }),
    });
  });

  await page.goto(harness.session.createLaunchLink());
  await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
  await expect(
    page.getByText("Ibeji may have stopped on your computer. It will try to reconnect on its own."),
  ).toBeVisible();
  await expect(page.getByText(/^Last updated at /u)).toBeVisible();
});
