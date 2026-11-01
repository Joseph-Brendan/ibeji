import type { IbejiEvent } from "../core/events.js";
import { MAX_EVENTS } from "../core/events.js";
import type { Rule } from "../core/failures/rules.js";
import type { WebhookDelivery } from "../core/webhooks/dispatcher.js";
import type { SecretRedactor } from "./redact.js";

export type ExportTwinSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly running: boolean;
  readonly port: number | null;
};

export type ExportPorts = {
  readonly control: number;
  readonly twins: Readonly<Record<string, number>>;
};

export type ExportState = Readonly<
  Record<string, Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>>
>;

export type ExportInput = {
  readonly version: string;
  readonly seed: number;
  readonly startTime: string;
  readonly twins: readonly ExportTwinSummary[];
  readonly ports: ExportPorts;
  readonly rules: readonly Rule[];
  readonly scenario: string | null;
  readonly webhookUrls: Readonly<Record<string, string>>;
  readonly state: ExportState;
  readonly deliveries: readonly WebhookDelivery[];
  readonly events: readonly IbejiEvent[];
  readonly credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly redactor: SecretRedactor;
};

/**
 * The C9 export. It contains the session, never the bearer token, UI tokens,
 * launch codes, or a full credential. Strings that are live keys and header
 * values that carry authorization or a signature are replaced before return.
 */
export function buildSessionExport(input: ExportInput): unknown {
  const raw = {
    version: input.version,
    seed: input.seed,
    startTime: input.startTime,
    twins: input.twins,
    ports: input.ports,
    rules: input.rules,
    scenario: input.scenario,
    webhookUrls: input.webhookUrls,
    state: input.state,
    deliveries: input.deliveries,
    events: input.events.slice(-MAX_EVENTS),
    credentials: input.credentials,
  };

  return input.redactor.redactValue(raw);
}
