import type { Clock } from "../core/clock.js";
import type { EventLog } from "../core/events.js";
import type { RuleStore } from "../core/failures/rules.js";
import type { Logger } from "../core/logger.js";
import type { ScenarioRunner } from "../core/scenarios/runner.js";
import type { Scenario } from "../core/scenarios/schema.js";
import type { AddressPolicy } from "../core/webhooks/address.js";
import type { WebhookDispatcher } from "../core/webhooks/dispatcher.js";
import type { RunningTwin } from "../twins/framework/server.js";
import type { FrameworkStateStore } from "../twins/framework/state.js";
import type { TwinDefinition } from "../twins/framework/types.js";
import type { CredentialsStore } from "./credentials.js";
import type { SessionSecrets } from "./secrets.js";

export type BoundAddress = {
  readonly hostname: "127.0.0.1";
  readonly address: string;
  readonly port: number;
  readonly url: string;
};

export type ControlDependencies = {
  readonly instanceId: string;
  readonly version: string;
  readonly seed: number;
  readonly startTime: string;
  readonly clock: Clock;
  readonly events: EventLog;
  readonly rules: RuleStore;
  readonly dispatcher: WebhookDispatcher;
  readonly scenarios: ScenarioRunner;
  readonly scenarioDefinitions: readonly Scenario[];
  readonly definitions: readonly TwinDefinition[];
  readonly runningTwins: ReadonlyMap<string, RunningTwin>;
  readonly states: ReadonlyMap<string, FrameworkStateStore>;
  readonly credentials: CredentialsStore;
  readonly webhookUrls: Map<string, string>;
  readonly secrets: SessionSecrets;
  readonly addressPolicy: AddressPolicy;
  readonly logger: Logger;
  readonly controlPort: { value: number };
};
