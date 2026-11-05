import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import type { ControlClient } from "../control/client.js";
import { IbejiError } from "../core/errors.js";
import type {
  ConnectionGuideInfo,
  ConnectionGuideStep,
  CredentialView,
  StatusTwin,
  TwinSummary,
} from "../shared/control.js";
import {
  formatCredential,
  formatEvent,
  formatRule,
  formatWebhook,
  plural,
  toolError,
  toolResult,
} from "./output.js";
import {
  type ConnectionGuideInput,
  clearFailuresInputSchema,
  connectionGuideInputSchema,
  type EnableFailureInput,
  enableFailureInputSchema,
  type ListEventsInput,
  type ListWebhooksInput,
  listEventsInputSchema,
  listWebhooksInputSchema,
  type OptionalTwinInput,
  optionalTwinInputSchema,
  type ResendWebhookInput,
  type RunScenarioInput,
  resendWebhookInputSchema,
  runScenarioInputSchema,
  type SetWebhookUrlInput,
  setWebhookUrlInputSchema,
} from "./schemas.js";
import { asIbejiError, findTwin, getTwins, resolveTwin, withControlClient } from "./session.js";

const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
const CHANGING: ToolAnnotations = { readOnlyHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };

const KEY_WARNING =
  "These are Ibeji's fake local test keys, not real service keys. They only work with Ibeji. " +
  "MCP clients may log tool results, so treat them as visible test data. " +
  "Never put a live key in test settings: live keys must never be used with Ibeji.";

type ToolOptions = {
  readonly home: string;
};

type InputHandler<Input> = (input: Input, client: ControlClient) => Promise<CallToolResult>;

function guarded<Input>(
  home: string,
  handler: InputHandler<Input>,
): (input: Input) => Promise<CallToolResult> {
  return async (input) => {
    try {
      return await withControlClient(home, (client) => handler(input, client));
    } catch (error) {
      return toolError(asIbejiError(error));
    }
  };
}

function oneTwin(twin: string | undefined, tool: string): string {
  if (twin === undefined) {
    throw new IbejiError("BAD_REQUEST", {
      what: `${tool} needs one twin.`,
      why: "This tool changes or explains one twin, so it cannot choose a default.",
      fix: "Pass one twin id, for example one of the ids shown by ibeji_status.",
    });
  }
  return twin;
}

export function fallbackGuide(twin: TwinSummary): ConnectionGuideInfo {
  const address = twin.address ?? "the twin address shown by Ibeji";
  return {
    summary: `Point your app at the local ${twin.displayName} twin. Use the Ibeji test keys. No real money moves.`,
    baseUrlNote: "Use this base URL for every API call to this twin.",
    keysNote:
      "Copy the public key into browser test code. Copy the secret key into your server's test settings. These keys are fake and only work with Ibeji.",
    steps: [
      {
        title: "Send requests to the twin",
        body: `Send your ${twin.displayName} API calls to ${address}. Do not use the real service address.`,
      },
      {
        title: "Use the test keys",
        body: "Use the public key in browser test code and the secret key on your server. Never put a live key in test settings.",
      },
    ],
    webhookNote:
      "Set the twin's webhook URL to your app's endpoint and verify the message with the twin's credential before you trust it.",
    agentInstruction: `You are connecting this app to the local Ibeji ${twin.displayName} twin.

Never write a key in source code, a committed file, or a browser bundle. Use the secret key only on the server.

Send requests to the twin base URL. Do not hard-code the port.

Never put a live key in test settings. Live keys must never be used with Ibeji.`,
  };
}

function credentialText(twin: TwinSummary, credentials: readonly CredentialView[]): string {
  return `${twin.displayName}:\n${credentials.map(formatCredential).join("\n")}`;
}

function statusText(
  version: string,
  seed: number,
  startTime: string,
  twins: readonly StatusTwin[],
  ruleCount: number,
  scenario: string | null,
  filteredTwin: string | undefined,
): string {
  const running = twins.filter((twin) => twin.running).length;
  const lines = [
    `Ibeji is running. Version ${version}. Seed ${seed}. Started ${startTime}.`,
    `${running} of ${twins.length} ${plural(twins.length, "twin is", "twins are")} running.`,
  ];
  if (filteredTwin !== undefined) {
    lines.push(`Showing only ${filteredTwin}.`);
  }
  for (const twin of twins) {
    lines.push(
      `- ${twin.displayName}: ${twin.running ? (twin.address ?? "running") : "not running"}`,
    );
  }
  lines.push(`Active failure rules: ${ruleCount}. Scenario: ${scenario ?? "none"}.`);
  return lines.join("\n");
}

function guideText(
  twin: TwinSummary,
  guide: ConnectionGuideInfo,
  credentials: readonly CredentialView[],
  webhookUrl: string | null,
  steps: readonly ConnectionGuideStep[],
): string {
  const lines = [
    `Connect ${twin.displayName} to Ibeji.`,
    "",
    `Base URL: ${twin.address ?? "not available while this twin is off"}`,
    guide.baseUrlNote,
  ];
  if (!twin.running) {
    lines.push(
      `${twin.displayName} is off. Start it with ibeji start --twins ${twin.id} before sending requests.`,
    );
  }
  lines.push("", "Test keys:", ...credentials.map(formatCredential), guide.keysNote);
  lines.push("", "What to change in your app:");
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.title}`, step.body);
    if (step.code !== undefined) {
      lines.push(step.code);
    }
  });
  lines.push(
    "",
    `Webhook URL: ${webhookUrl ?? "not set"}`,
    guide.webhookNote,
    "",
    "Instruction for a coding agent:",
    guide.agentInstruction,
  );
  return lines.join("\n");
}

export function registerIbejiTools(server: McpServer, options: ToolOptions): void {
  server.registerTool(
    "ibeji_status",
    {
      title: "Ibeji status",
      description:
        "Show what the local Ibeji session is doing: version, seed, start time, every registered twin and whether it is running, and the active failure rules. Use this first to learn which twins are available.",
      inputSchema: optionalTwinInputSchema,
      annotations: READ_ONLY,
    },
    guarded<OptionalTwinInput>(options.home, async (input, client) => {
      const twinId = input.twin;
      const list = twinId === undefined ? undefined : await getTwins(client);
      if (twinId !== undefined && list !== undefined) {
        findTwin(list, twinId);
      }
      const status = await client.status;
      const twins =
        twinId === undefined ? status.twins : status.twins.filter((twin) => twin.id === twinId);
      const rules =
        twinId === undefined
          ? status.rules
          : status.rules.filter((rule) => rule.twins.includes(twinId));
      return toolResult(
        statusText(
          status.version,
          status.seed,
          status.startTime,
          twins,
          rules.length,
          status.scenario,
          twinId,
        ),
        { status: { ...status, twins, rules } },
      );
    }),
  );

  server.registerTool(
    "ibeji_list_failures",
    {
      title: "List Ibeji failures",
      description:
        "List the failures Ibeji can switch on, with plain-English explanations, settings, and the twins and actions each one supports. Optionally filter to one twin.",
      inputSchema: optionalTwinInputSchema,
      annotations: READ_ONLY,
    },
    guarded<OptionalTwinInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const failures = (await client.failures).failures.filter(
        (failure) =>
          input.twin === undefined ||
          failure.support.some((support) => support.twin === input.twin),
      );
      const lines =
        failures.length === 0
          ? ["No failures match that twin."]
          : failures.map(
              (failure) =>
                `- ${failure.name} (${failure.id}): supported by ${failure.support
                  .map((support) => `${support.twin} (${support.source})`)
                  .join(", ")}.`,
            );
      return toolResult(
        `Ibeji can switch on ${failures.length} ${plural(failures.length, "failure", "failures")}${
          input.twin === undefined ? "" : ` for ${input.twin}`
        }.\n${lines.join("\n")}`,
        { failures },
      );
    }),
  );

  server.registerTool(
    "ibeji_list_scenarios",
    {
      title: "List Ibeji scenarios",
      description:
        "List the built-in failure scenarios with their stories, supported twins, steps, and which one is running. Optionally filter to scenarios that include one twin.",
      inputSchema: optionalTwinInputSchema,
      annotations: READ_ONLY,
    },
    guarded<OptionalTwinInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const result = await client.scenarios;
      const scenarios = result.scenarios.filter(
        (scenario) => input.twin === undefined || scenario.twins.includes(input.twin),
      );
      const lines = scenarios.map(
        (scenario) =>
          `- ${scenario.id}: ${scenario.name}${scenario.running ? " (running)" : ""}. Twins: ${scenario.twins.join(", ")}.`,
      );
      return toolResult(
        `Ibeji has ${scenarios.length} ${plural(scenarios.length, "scenario", "scenarios")}. Active: ${
          result.active ?? "none"
        }.\n${lines.length === 0 ? "No scenarios match that twin." : lines.join("\n")}`,
        { scenarios, active: result.active },
      );
    }),
  );

  server.registerTool(
    "ibeji_list_events",
    {
      title: "List Ibeji activity",
      description:
        "Read Ibeji's recent activity log: requests, responses, webhooks, failure firings, rule changes and warnings. Optionally filter by twin, event type, and event id.",
      inputSchema: listEventsInputSchema,
      annotations: READ_ONLY,
    },
    guarded<ListEventsInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const events = (
        await client.events({
          ...(input.twin === undefined ? {} : { scope: input.twin }),
          ...(input.type === undefined ? {} : { type: input.type }),
          after: input.after,
          limit: input.limit,
        })
      ).events;
      const lines = events.map(formatEvent);
      return toolResult(
        `${events.length} ${plural(events.length, "event", "events")}, oldest first.\n${
          lines.length === 0 ? "No events match." : lines.join("\n")
        }`,
        { events },
      );
    }),
  );

  server.registerTool(
    "ibeji_list_webhooks",
    {
      title: "List Ibeji webhooks",
      description:
        "List webhook deliveries with their status, attempts, response codes, and errors. Optionally filter by twin or status.",
      inputSchema: listWebhooksInputSchema,
      annotations: READ_ONLY,
    },
    guarded<ListWebhooksInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const deliveries = (
        await client.webhooks({
          ...(input.twin === undefined ? {} : { twin: input.twin }),
          ...(input.status === undefined ? {} : { status: input.status }),
        })
      ).deliveries;
      const lines = deliveries.map(formatWebhook);
      return toolResult(
        `${deliveries.length} webhook ${plural(deliveries.length, "delivery", "deliveries")}.\n${
          lines.length === 0 ? "No webhook deliveries match." : lines.join("\n")
        }`,
        { deliveries },
      );
    }),
  );

  server.registerTool(
    "ibeji_get_test_keys",
    {
      title: "Get Ibeji test keys",
      description: `Return the fake local test keys for one twin, or for every running twin when twin is omitted. ${KEY_WARNING}`,
      inputSchema: optionalTwinInputSchema,
      annotations: READ_ONLY,
    },
    guarded<OptionalTwinInput>(options.home, async (input, client) => {
      const list = await getTwins(client);
      const targets =
        input.twin === undefined
          ? list.twins.filter((twin) => twin.running)
          : [findTwin(list, input.twin)];
      const responses = await Promise.all(
        targets.map(async (twin) => ({
          twin,
          credentials: (await client.credentials(twin.id)).credentials,
        })),
      );
      const body =
        responses.length === 0
          ? "No twins are running. Their saved test keys are still available when a twin starts."
          : responses
              .map(({ twin, credentials }) => credentialText(twin, credentials))
              .join("\n\n");
      return toolResult(`${KEY_WARNING}\n\n${body}`, {
        twins: responses.map(({ twin, credentials }) => ({
          id: twin.id,
          displayName: twin.displayName,
          credentials,
        })),
      });
    }),
  );

  server.registerTool(
    "ibeji_get_connection_guide",
    {
      title: "Get Ibeji connection guide",
      description: `Return the base URL, labelled credentials, webhook URL, and the same plain steps as the Connect your app page for one twin, so you can update an app to use it. ${KEY_WARNING}`,
      inputSchema: connectionGuideInputSchema,
      annotations: READ_ONLY,
    },
    guarded<ConnectionGuideInput>(options.home, async (input, client) => {
      const twin = await resolveTwin(client, oneTwin(input.twin, "ibeji_get_connection_guide"));
      const [credentialsResponse, webhook] = await Promise.all([
        client.credentials(twin.id),
        client.webhookUrl(twin.id),
      ]);
      const guide = twin.connectionGuide ?? fallbackGuide(twin);
      const base = twin.address ?? "http://127.0.0.1:<port>";
      const steps = guide.steps.map((step) => ({
        title: step.title,
        body: step.body.replaceAll("{base}", base),
        ...(step.code === undefined ? {} : { code: step.code.replaceAll("{base}", base) }),
      }));
      return toolResult(
        guideText(twin, guide, credentialsResponse.credentials, webhook.url, steps),
        {
          twin: {
            id: twin.id,
            displayName: twin.displayName,
            running: twin.running,
            baseUrl: twin.address,
            credentials: credentialsResponse.credentials,
            webhookUrl: webhook.url,
            summary: guide.summary,
            baseUrlNote: guide.baseUrlNote,
            keysNote: guide.keysNote,
            steps,
            webhookNote: guide.webhookNote,
            agentInstruction: guide.agentInstruction,
          },
        },
      );
    }),
  );

  server.registerTool(
    "ibeji_enable_failure",
    {
      title: "Enable an Ibeji failure",
      description:
        "Switch on a failure rule for one twin, or for every running twin that supports it when twin is omitted. Pass the failure id, optional settings, and an optional action selector.",
      inputSchema: enableFailureInputSchema,
      annotations: CHANGING,
    },
    guarded<EnableFailureInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const result = await client.addRule({
        failureId: input.failureId,
        settings: input.settings,
        ...(input.twin === undefined ? {} : { twins: [input.twin] }),
        ...(input.actions === undefined ? {} : { actions: input.actions }),
      });
      return toolResult(`Switched on a failure rule.\n${formatRule(result.rule)}`, {
        rule: result.rule,
      });
    }),
  );

  server.registerTool(
    "ibeji_clear_failures",
    {
      title: "Clear Ibeji failures",
      description:
        "Remove failure rules for one twin, or all failure rules when twin is omitted. This also stops a running scenario.",
      inputSchema: clearFailuresInputSchema,
      annotations: CHANGING,
    },
    guarded<OptionalTwinInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const result = await client.clearRules(input.twin);
      return toolResult(
        `Removed ${result.removed} failure rule ${plural(result.removed, "entry", "entries")}${
          input.twin === undefined ? "" : ` for ${input.twin}`
        }.`,
        result,
      );
    }),
  );

  server.registerTool(
    "ibeji_run_scenario",
    {
      title: "Run an Ibeji scenario",
      description:
        "Start a built-in scenario for one twin, or for the scenario's default running twins when twin is omitted. Use ibeji_list_scenarios to see the ids.",
      inputSchema: runScenarioInputSchema,
      annotations: CHANGING,
    },
    guarded<RunScenarioInput>(options.home, async (input, client) => {
      if (input.twin !== undefined) {
        await resolveTwin(client, input.twin);
      }
      const result = await client.runScenario(
        input.scenario,
        input.twin === undefined ? undefined : [input.twin],
      );
      return toolResult(
        `Started scenario ${result.scenario} for ${result.twins.join(", ") || "no running twins"}.`,
        result,
      );
    }),
  );

  server.registerTool(
    "ibeji_set_webhook_url",
    {
      title: "Set an Ibeji webhook URL",
      description:
        "Set where one twin sends its webhooks. The twin must be named. Send an empty url to remove it. Ibeji checks the address against its safety rules.",
      inputSchema: setWebhookUrlInputSchema,
      annotations: CHANGING,
    },
    guarded<SetWebhookUrlInput>(options.home, async (input, client) => {
      const twin = await resolveTwin(client, oneTwin(input.twin, "ibeji_set_webhook_url"));
      const result = await client.setWebhookUrl(twin.id, input.url);
      return toolResult(
        result.url === null
          ? `Removed the webhook URL for ${twin.displayName}.`
          : `${twin.displayName} now sends webhooks to ${result.url}.`,
        result,
      );
    }),
  );

  server.registerTool(
    "ibeji_resend_webhook",
    {
      title: "Resend an Ibeji webhook",
      description:
        "Send another copy of an existing webhook delivery, using the twin's current webhook URL. Use ibeji_list_webhooks to find the delivery id.",
      inputSchema: resendWebhookInputSchema,
      annotations: CHANGING,
    },
    guarded<ResendWebhookInput>(options.home, async (input, client) => {
      const result = await client.resend(input.deliveryId);
      return toolResult(
        `Created webhook delivery ${result.delivery.id} as another copy of ${input.deliveryId}. Status: ${result.delivery.status}.`,
        result,
      );
    }),
  );

  server.registerTool(
    "ibeji_reset_state",
    {
      title: "Reset Ibeji twin records",
      description:
        "Delete the records of one twin, or of every running twin when twin is omitted. This also abandons queued webhooks. It does not delete failures, scenarios, events, credentials or webhook URLs.",
      inputSchema: optionalTwinInputSchema,
      annotations: DESTRUCTIVE,
    },
    guarded<OptionalTwinInput>(options.home, async (input, client) => {
      const twin = input.twin === undefined ? undefined : await resolveTwin(client, input.twin);
      const result = await client.reset(twin?.id);
      const target =
        twin === undefined ? "all running twin records" : `${twin.displayName} records`;
      const abandoned = result.abandonedWebhooks;
      return toolResult(
        `Reset ${target}. Abandoned ${abandoned} queued ${plural(abandoned, "webhook", "webhooks")}.`,
        result,
      );
    }),
  );
}
