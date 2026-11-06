import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, type Page, test } from "@playwright/test";

import { loadScenarios } from "../../src/core/scenarios/loader.js";
import type { Rule, TwinSummary } from "../../src/shared/control.js";
import { registry } from "../../src/twins/registry.js";
import {
  apiUrl,
  authHeaders,
  type ControlSessionHarness,
  startControlSession,
} from "../helpers/control.js";
import { CLI, mcpEnvironment, ROOT, startStdioMcp, structuredOf } from "../helpers/mcp.js";

const execFileAsync = promisify(execFile);

async function startHarness(): Promise<ControlSessionHarness> {
  return startControlSession({ scenarios: await loadScenarios("scenarios") });
}

async function openPage(page: Page, harness: ControlSessionHarness, name: string): Promise<void> {
  await page.goto(harness.session.createLaunchLink());
  await page.getByRole("heading", { name: "Home" }).waitFor();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

async function createRule(harness: ControlSessionHarness): Promise<void> {
  const response = await fetch(apiUrl(harness.session, "/rules"), {
    method: "POST",
    headers: {
      ...authHeaders(harness.session),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      failureId: "server-error",
      twins: ["paystack"],
      settings: { times: 1, status: 503 },
    }),
  });
  expect(response.status).toBe(200);
}

async function clearRules(harness: ControlSessionHarness): Promise<void> {
  await fetch(apiUrl(harness.session, "/rules"), {
    method: "DELETE",
    headers: authHeaders(harness.session),
  });
}

async function listRules(harness: ControlSessionHarness): Promise<readonly Rule[]> {
  const response = await fetch(apiUrl(harness.session, "/rules"), {
    headers: authHeaders(harness.session),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly rules: readonly Rule[] };
  return body.rules;
}

function ruleFacts(rule: Rule): Record<string, unknown> {
  return {
    failureId: rule.failureId,
    settings: rule.settings,
    twins: rule.twins,
    actions: rule.actions,
    resolvedActions: rule.resolvedActions,
  };
}

test("T8 Failures shows schema limits, defaults, validation and a working switch", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openPage(page, harness, "Failures");
    await expect(page.locator(".failure-card")).toHaveCount(15);
    const card = page.getByTestId("failure-server-error");
    await expect(card).toBeVisible();

    const times = card.getByLabel(/Number of times/u);
    const status = card.getByLabel(/HTTP status/u);
    await expect(times).toHaveValue("3");
    await expect(times).toHaveAttribute("min", "1");
    await expect(times).toHaveAttribute("max", "10000");
    await expect(status).toHaveValue("500");
    await expect(status).toHaveAttribute("min", "500");
    await expect(status).toHaveAttribute("max", "599");

    await status.fill("400");
    await card.getByRole("switch", { name: /Switch on for 2 twins/u }).click();
    await expect(card.getByText("Enter a number from 500 to 599.")).toBeVisible();
    await expect(card.locator(".status-pill")).toHaveText("Off");

    await status.fill("503");
    await card.getByRole("switch", { name: /Switch on for 2 twins/u }).click();
    await expect(card.locator(".status-pill")).toHaveText("On");
    await expect(card.locator(".active-twin")).toHaveCount(2);
    await expect(page.getByText("1 manual failure is on.")).toBeVisible();

    await card.getByRole("switch", { name: /Switch off for 2 twins/u }).click();
    await expect(card.locator(".status-pill")).toHaveText("Off");
    await expect(page.getByText("No manual failures are on.")).toBeVisible();
  } finally {
    await clearRules(harness);
    await harness.cleanup();
  }
});

test("T8 Failures disables an unsupported twin and explains why", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openPage(page, harness, "Failures");
    const card = page.getByTestId("failure-transfer-reversed");
    await expect(card).toBeVisible();
    await expect(card.getByRole("checkbox", { name: /Flutterwave/u })).toBeDisabled();
    await expect(card.getByText("Flutterwave does not support this failure.")).toBeVisible();
    await expect(card.getByRole("checkbox", { name: /Paystack/u })).toBeEnabled();
    await expect(
      page
        .getByTestId("failure-slow-response")
        .getByText("Assumed: not confirmed by the service's documentation."),
    ).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 a rule added through the control API appears on Failures without a refresh", async ({
  page,
}) => {
  const harness = await startHarness();
  try {
    await openPage(page, harness, "Failures");
    const card = page.getByTestId("failure-server-error");
    await expect(card.locator(".status-pill")).toHaveText("Off");

    await createRule(harness);
    await expect(card.locator(".status-pill")).toHaveText("On", { timeout: 1_000 });
    await expect(card.locator(".active-twin")).toHaveCount(1);
    await expect(
      card.getByRole("list", { name: "Active on" }).getByText("Paystack", { exact: true }),
    ).toBeVisible();
  } finally {
    await clearRules(harness);
    await harness.cleanup();
  }
});

test("T8 Failures clear all and per-twin clear confirm and remove rules", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openPage(page, harness, "Failures");
    const card = page.getByTestId("failure-server-error");
    const dialog = page.locator("dialog");

    await createRule(harness);
    await expect(card.locator(".status-pill")).toHaveText("On", { timeout: 1_000 });
    await page.getByRole("button", { name: "Clear all failures" }).click();
    await expect(page.getByRole("heading", { name: "Clear all failures?" })).toBeVisible();
    await expect(dialog.getByText(/stops the running scenario/u)).toBeVisible();
    await expect(
      dialog.getByText(/Records, webhook addresses, test keys and events stay/u),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Clear all failures" }).click();
    await expect(card.locator(".status-pill")).toHaveText("Off");
    await expect(page.getByText("All failures cleared.")).toBeVisible();

    await createRule(harness);
    await expect(card.locator(".status-pill")).toHaveText("On", { timeout: 1_000 });
    await page.getByRole("button", { name: "Clear Paystack failures" }).click();
    await expect(page.getByRole("heading", { name: "Clear Paystack failures?" })).toBeVisible();
    await expect(dialog.getByText(/including any scenario rule for this twin/u)).toBeVisible();
    await expect(dialog.getByText(/Other twins keep their rules/u)).toBeVisible();
    await dialog.getByRole("button", { name: "Clear Paystack failures" }).click();
    await expect(card.locator(".status-pill")).toHaveText("Off");
    await expect(page.getByText("Paystack failures cleared.")).toBeVisible();
  } finally {
    await clearRules(harness);
    await harness.cleanup();
  }
});

test("T8 Scenarios runs, shows progress, stops and confirms replacement", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openPage(page, harness, "Scenarios");
    await expect(page.locator(".scenario-card")).toHaveCount(6);
    const bankOutage = page.getByTestId("scenario-bank-outage");
    await expect(bankOutage.getByRole("heading", { name: "Bank outage" })).toBeVisible();
    await expect(bankOutage.getByText(/bank network fails for two minutes/u)).toBeVisible();
    await expect(bankOutage.getByText(/Supported twins: Paystack, Flutterwave/u)).toBeVisible();

    await bankOutage.getByRole("button", { name: "Run scenario" }).click();
    const active = page.locator(".active-scenario");
    await expect(active.getByRole("heading", { name: "Bank outage" })).toBeVisible();
    await expect(active.getByText(/Running on Paystack and Flutterwave/u)).toBeVisible();
    await expect(
      active.getByText(/Step 1 of 1: remove the Server error failure after 2 minutes/u),
    ).toBeVisible();

    await active.getByRole("button", { name: "Stop scenario" }).click();
    await expect(page.getByText("No scenario is running.")).toBeVisible();
    await expect(page.getByText("Scenario stopped.")).toBeVisible();

    const declines = page.getByTestId("scenario-checkout-declines");
    await declines.getByRole("button", { name: "Run scenario" }).click();
    await expect(active.getByRole("heading", { name: "Checkout declines" })).toBeVisible();

    const kola = page.getByTestId("scenario-kola-case");
    await kola.getByRole("button", { name: "Run scenario" }).click();
    const dialog = page.locator("dialog");
    await expect(page.getByRole("heading", { name: "Run Kola's lost refund?" })).toBeVisible();
    await expect(dialog.getByText(/stops the running scenario first/u)).toBeVisible();
    await dialog.getByRole("button", { name: "Run scenario" }).click();
    await expect(active.getByRole("heading", { name: "Kola's lost refund" })).toBeVisible();
    await expect(active.getByText("This scenario has no timed steps.")).toBeVisible();
    await active.getByRole("button", { name: "Stop scenario" }).click();
  } finally {
    await clearRules(harness);
    await harness.cleanup();
  }
});

test("T8 a scenario run through the control API appears without a refresh", async ({ page }) => {
  const harness = await startHarness();
  try {
    await openPage(page, harness, "Scenarios");
    await expect(page.getByText("No scenario is running.")).toBeVisible();

    const response = await fetch(apiUrl(harness.session, "/scenarios/bank-outage/run"), {
      method: "POST",
      headers: {
        ...authHeaders(harness.session),
        "content-type": "application/json",
      },
      body: JSON.stringify({ twins: ["paystack"] }),
    });
    expect(response.status).toBe(200);

    const active = page.locator(".active-scenario");
    await expect(active.getByRole("heading", { name: "Bank outage" })).toBeVisible({
      timeout: 2_000,
    });
    await expect(active.getByText(/Running on Paystack/u)).toBeVisible();
  } finally {
    await fetch(apiUrl(harness.session, "/scenarios/stop"), {
      method: "POST",
      headers: authHeaders(harness.session),
    });
    await harness.cleanup();
  }
});

test("T8 Scenarios disables a supported twin that is off", async ({ page }) => {
  const harness = await startHarness();
  try {
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

    await openPage(page, harness, "Scenarios");
    await expect(page.locator(".scenario-card")).toHaveCount(6);
    const bankOutage = page.getByTestId("scenario-bank-outage");
    await expect(bankOutage.getByRole("checkbox", { name: /Flutterwave/u })).toBeDisabled();
    await expect(
      bankOutage.getByText(/Flutterwave is off. Start it with ibeji start --twins flutterwave/u),
    ).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T4 parity: the UI, CLI, MCP and control API produce the same rule", async ({ page }) => {
  test.setTimeout(90_000);
  const harness = await startHarness();
  const mcp = await startStdioMcp(harness.home);
  try {
    const first = registry.list()[0];
    if (first === undefined) {
      throw new Error("the registry has no twins");
    }
    const cases: readonly {
      readonly failureId: string;
      readonly settings: Readonly<Record<string, number>>;
    }[] = [
      { failureId: "webhook-delayed", settings: { seconds: 12, jitterSeconds: 3 } },
      { failureId: "server-error", settings: { times: 5, status: 503 } },
      { failureId: "payment-declined", settings: { percent: 100 } },
    ];

    for (const testCase of cases) {
      await clearRules(harness);
      await openPage(page, harness, "Failures");
      const card = page.getByTestId(`failure-${testCase.failureId}`);
      for (const twin of registry.list().slice(1)) {
        await card.getByRole("checkbox", { name: twin.displayName }).uncheck();
      }
      for (const [key, value] of Object.entries(testCase.settings)) {
        await page.locator(`#failure-${testCase.failureId}-${key}`).fill(String(value));
      }
      await card.getByRole("switch", { name: /Switch on/u }).click();
      await expect(card.locator(".status-pill")).toHaveText("On");
      const uiRules = await listRules(harness);
      expect(uiRules).toHaveLength(1);
      const uiRule = uiRules[0];
      if (uiRule === undefined) {
        throw new Error(`the UI did not store the ${testCase.failureId} rule`);
      }

      await clearRules(harness);
      const settingArgs = Object.entries(testCase.settings).flatMap(([key, value]) => [
        `--${key}`,
        String(value),
      ]);
      const { stdout } = await execFileAsync(
        process.execPath,
        [CLI, "fail", testCase.failureId, "--twin", first.id, "--json", ...settingArgs],
        {
          cwd: ROOT,
          env: mcpEnvironment(harness.home),
          encoding: "utf8",
        },
      );
      const cliRule = (JSON.parse(stdout) as { readonly rule: Rule }).rule;

      await clearRules(harness);
      const mcpResult = await mcp.client.callTool({
        name: "ibeji_enable_failure",
        arguments: {
          failureId: testCase.failureId,
          twin: first.id,
          settings: testCase.settings,
        },
      });
      expect(mcpResult.isError).toBeFalsy();
      const mcpRule = structuredOf<{ readonly rule: Rule }>(mcpResult).rule;

      await clearRules(harness);
      const controlResponse = await fetch(apiUrl(harness.session, "/rules"), {
        method: "POST",
        headers: {
          ...authHeaders(harness.session),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          failureId: testCase.failureId,
          twins: [first.id],
          settings: testCase.settings,
        }),
      });
      expect(controlResponse.status).toBe(200);
      const controlRule = ((await controlResponse.json()) as { readonly rule: Rule }).rule;

      expect(ruleFacts(cliRule)).toEqual(ruleFacts(uiRule));
      expect(ruleFacts(mcpRule)).toEqual(ruleFacts(uiRule));
      expect(ruleFacts(controlRule)).toEqual(ruleFacts(uiRule));
    }
  } finally {
    await clearRules(harness);
    await mcp.close();
    await harness.cleanup();
  }
});
