import type { WebhookDelivery } from "../../../src/shared/control.js";
import { apiUrl, authHeaders } from "../../helpers/control.js";
import type { UiSession } from "./session.js";

async function request(
  ui: UiSession,
  path: string,
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<Response> {
  const response = await fetch(apiUrl(ui.session, path), {
    method: options.method ?? "GET",
    headers: {
      ...authHeaders(ui.session),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with HTTP ${response.status}.`);
  }
  return response;
}

export async function setWebhookUrl(ui: UiSession, twinId: string, url: string): Promise<void> {
  await request(ui, `/twins/${encodeURIComponent(twinId)}/webhook-url`, {
    method: "PUT",
    body: { url },
  });
}

export async function createRule(
  ui: UiSession,
  failureId: string,
  twins: readonly string[],
  settings: Readonly<Record<string, unknown>>,
  actions?: string,
): Promise<void> {
  await request(ui, "/rules", {
    method: "POST",
    body: {
      failureId,
      twins,
      settings,
      ...(actions === undefined ? {} : { actions }),
    },
  });
}

export async function clearRules(ui: UiSession): Promise<void> {
  await request(ui, "/rules", { method: "DELETE" });
}

export async function runScenario(
  ui: UiSession,
  scenarioId: string,
  twins: readonly string[],
): Promise<void> {
  await request(ui, `/scenarios/${encodeURIComponent(scenarioId)}/run`, {
    method: "POST",
    body: { twins },
  });
}

export async function stopScenario(ui: UiSession): Promise<void> {
  await request(ui, "/scenarios/stop", { method: "POST" });
}

export async function listWebhooks(
  ui: UiSession,
  twinId: string,
): Promise<readonly WebhookDelivery[]> {
  const response = await request(ui, `/webhooks?twin=${encodeURIComponent(twinId)}`);
  const body = (await response.json()) as { readonly deliveries: readonly WebhookDelivery[] };
  return body.deliveries;
}
