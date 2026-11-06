import type { CallToolResult } from "@modelcontextprotocol/server";
import type { IbejiError } from "../core/errors.js";
import type { CredentialView, EventItem, Rule, WebhookDelivery } from "../shared/control.js";
import { createLiveKeyScanner } from "../shared/live-key-scanner.js";
import { liveKeyPatterns } from "../twins/registry.js";

const outputScanner = createLiveKeyScanner(liveKeyPatterns());

export function toolResult(text: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: outputScanner.scanText(text).value }],
    structuredContent: outputScanner.scanValue(data).value,
  };
}

export function toolError(error: IbejiError): CallToolResult {
  const text = `${error.what}\nWhy: ${error.why}\nFix: ${error.fix}`;
  return {
    isError: true,
    content: [{ type: "text", text: outputScanner.scanText(text).value }],
    structuredContent: outputScanner.scanValue({
      error: {
        code: error.code,
        what: error.what,
        why: error.why,
        fix: error.fix,
      },
    }).value,
  };
}

export function formatSettings(settings: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return "defaults";
  }
  return entries
    .map(([key, value]) => `${key}=${value === null ? "empty" : String(value)}`)
    .join(", ");
}

export function formatRule(rule: Rule): string {
  return `Rule ${rule.id}: ${rule.failureId}. Twins: ${rule.twins.join(
    ", ",
  )}. Actions: ${rule.actions ?? "all supported"}. Settings: ${formatSettings(rule.settings)}.`;
}

export function formatTime(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function formatEvent(event: EventItem): string {
  return `#${event.id} ${formatTime(event.time)} [${event.type}] ${event.scope}: ${event.summary}`;
}

export function formatWebhook(delivery: WebhookDelivery): string {
  const attempts =
    delivery.attempts.length === 0
      ? "no attempts"
      : `${delivery.attempts.length} attempt${delivery.attempts.length === 1 ? "" : "s"}`;
  const response =
    delivery.attempts.at(-1)?.responseStatus === undefined
      ? ""
      : `, last response HTTP ${delivery.attempts.at(-1)?.responseStatus}`;
  return `${delivery.id}: ${delivery.twinId} ${delivery.actionId}, ${delivery.status}, ${attempts}${response}`;
}

export function formatCredential(credential: CredentialView): string {
  return `- ${credential.label} (${credential.role}): ${credential.value}`;
}

export function plural(count: number, singular: string, pluralWord: string): string {
  return count === 1 ? singular : pluralWord;
}
