import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Tool } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import type { RunningSession } from "../../src/control/session.js";
import type { FailureInfo, Rule, ScenarioInfo, WebhookDelivery } from "../../src/shared/control.js";
import { registry } from "../../src/twins/registry.js";
import {
  CLI,
  errorCodeOf,
  type McpHarness,
  mcpEnvironment,
  ROOT,
  startIbeji,
  startInProcessMcp,
  startStdioMcp,
  stdoutLines,
  structuredOf,
  type ToolResult,
  textOf,
} from "../helpers/mcp.js";

const TEST_TIMEOUT = 30_000;
const execFileAsync = promisify(execFile);

const TOOL_NAMES = [
  "ibeji_status",
  "ibeji_list_failures",
  "ibeji_list_scenarios",
  "ibeji_list_events",
  "ibeji_list_webhooks",
  "ibeji_get_test_keys",
  "ibeji_get_connection_guide",
  "ibeji_enable_failure",
  "ibeji_clear_failures",
  "ibeji_run_scenario",
  "ibeji_set_webhook_url",
  "ibeji_resend_webhook",
  "ibeji_reset_state",
] as const;

const READ_TOOLS = [
  "ibeji_status",
  "ibeji_list_failures",
  "ibeji_list_scenarios",
  "ibeji_list_events",
  "ibeji_list_webhooks",
  "ibeji_get_test_keys",
  "ibeji_get_connection_guide",
] as const;

const CHANGING_TOOLS = [
  "ibeji_enable_failure",
  "ibeji_clear_failures",
  "ibeji_run_scenario",
  "ibeji_set_webhook_url",
  "ibeji_resend_webhook",
] as const;

const NO_SESSION_CALLS: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
  ["ibeji_status", {}],
  ["ibeji_list_failures", {}],
  ["ibeji_list_scenarios", {}],
  ["ibeji_list_events", {}],
  ["ibeji_list_webhooks", {}],
  ["ibeji_get_test_keys", {}],
  ["ibeji_get_connection_guide", { twin: "paystack" }],
  ["ibeji_enable_failure", { failureId: "server-error" }],
  ["ibeji_clear_failures", {}],
  ["ibeji_run_scenario", { scenario: "slow-friday" }],
  ["ibeji_set_webhook_url", { twin: "paystack", url: "http://127.0.0.1:1/hook" }],
  ["ibeji_resend_webhook", { deliveryId: "delivery-1" }],
  ["ibeji_reset_state", {}],
];

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ibeji-mcp-"));
}

async function withSession(
  run: (home: string, session: RunningSession) => Promise<void>,
  options: { readonly twins?: readonly string[] } = {},
): Promise<void> {
  const home = await makeHome();
  let session: RunningSession | undefined;
  try {
    session = await startIbeji(home, options);
    await run(home, session);
  } finally {
    await session?.stop();
    await rm(home, { recursive: true, force: true });
  }
}

async function withStdio(
  home: string,
  run: (mcp: McpHarness) => Promise<void>,
): Promise<McpHarness> {
  const mcp = await startStdioMcp(home);
  try {
    await run(mcp);
    return mcp;
  } finally {
    await mcp.close();
  }
}

async function withInProcess(home: string, run: (mcp: McpHarness) => Promise<void>): Promise<void> {
  const mcp = await startInProcessMcp(home);
  try {
    await run(mcp);
  } finally {
    await mcp.close();
  }
}

async function call(
  client: McpHarness["client"],
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolResult> {
  return await client.callTool({ name, arguments: args });
}

function toolByName(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((item) => item.name === name);
  if (tool === undefined) {
    throw new Error(`the MCP server did not register ${name}`);
  }
  return tool;
}

function ruleFromJson(text: string): Rule {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || !("rule" in parsed)) {
    throw new Error("the CLI did not return a rule");
  }
  return parsed.rule as Rule;
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

function controlUrl(session: RunningSession, path: string): string {
  return `${session.addresses.control.url}/_ibeji/api/v1${path}`;
}

async function controlJson<T>(
  session: RunningSession,
  path: string,
  options: { readonly method?: "GET" | "POST" | "DELETE"; readonly body?: unknown } = {},
): Promise<T> {
  const response = await fetch(controlUrl(session, path), {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${session.token}`,
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`the control API answered HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function resetRules(session: RunningSession): Promise<void> {
  await controlJson(session, "/rules", { method: "DELETE" });
}

async function exerciseEveryTool(mcp: McpHarness, session: RunningSession): Promise<void> {
  const { client } = mcp;
  const definitions = registry.list();
  const first = definitions[0];
  if (first === undefined) {
    throw new Error("the registry has no twins");
  }
  const second = definitions[1] ?? first;
  const firstAddress = session.addresses.twins[first.id];
  const firstGuide = first.connectionGuide;
  if (firstAddress === undefined || firstGuide === undefined) {
    throw new Error("the first twin has no address or connection guide");
  }

  const [delivery] = session.dispatcher.enqueue({
    eventId: "evt-mcp-t11",
    twinId: first.id,
    actionId: "refund.create",
    raw: { body: "{}", contentType: "application/json" },
    plan: {
      send: false,
      notSentReason: "webhook-never-sent",
      deliveries: [],
      firedSteps: [],
      firedRules: [],
    },
  });
  if (delivery === undefined) {
    throw new Error("the test webhook delivery was not created");
  }

  let result = await call(client, "ibeji_status", {});
  expect(result.isError).toBeFalsy();
  expect(textOf(result)).toContain("Ibeji is running");
  const status = structuredOf<{
    status: {
      instance: string;
      twins: readonly { readonly id: string }[];
    };
  }>(result).status;
  expect(status.twins.map((twin) => twin.id).sort()).toEqual(
    definitions.map((definition) => definition.id).sort(),
  );

  result = await call(client, "ibeji_status", { twin: first.id });
  expect(result.isError).toBeFalsy();
  const filteredStatus = structuredOf<{
    status: { readonly twins: readonly { readonly id: string }[] };
  }>(result).status;
  expect(filteredStatus.twins.map((twin) => twin.id)).toEqual([first.id]);

  result = await call(client, "ibeji_list_failures", {});
  expect(result.isError).toBeFalsy();
  const failures = structuredOf<{ readonly failures: readonly FailureInfo[] }>(result).failures;
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.map((failure) => failure.id)).toContain("slow-response");

  result = await call(client, "ibeji_list_failures", { twin: first.id });
  expect(result.isError).toBeFalsy();
  const filteredFailures = structuredOf<{ readonly failures: readonly FailureInfo[] }>(
    result,
  ).failures;
  expect(
    filteredFailures.every((failure) => failure.support.some((item) => item.twin === first.id)),
  ).toBe(true);

  result = await call(client, "ibeji_list_scenarios", {});
  expect(result.isError).toBeFalsy();
  const scenarios = structuredOf<{ readonly scenarios: readonly ScenarioInfo[] }>(result).scenarios;
  expect(scenarios.length).toBeGreaterThan(0);

  result = await call(client, "ibeji_list_scenarios", { twin: first.id });
  expect(result.isError).toBeFalsy();
  const filteredScenarios = structuredOf<{ readonly scenarios: readonly ScenarioInfo[] }>(
    result,
  ).scenarios;
  expect(filteredScenarios.every((scenario) => scenario.twins.includes(first.id))).toBe(true);

  result = await call(client, "ibeji_get_test_keys", {});
  expect(result.isError).toBeFalsy();
  expect(textOf(result)).toContain("fake local test keys");
  const keyTwins = structuredOf<{
    readonly twins: readonly {
      readonly id: string;
      readonly credentials: readonly { readonly value: string }[];
    }[];
  }>(result).twins;
  expect(keyTwins.map((twin) => twin.id).sort()).toEqual(
    definitions.map((definition) => definition.id).sort(),
  );
  const firstStored = session.credentialsStore.views(first.id);
  const firstReturned = keyTwins.find((twin) => twin.id === first.id);
  expect(firstReturned?.credentials.map((credential) => credential.value)).toEqual(
    firstStored.map((credential) => credential.value),
  );

  result = await call(client, "ibeji_get_test_keys", { twin: first.id });
  expect(result.isError).toBeFalsy();
  const oneKeyTwin = structuredOf<{
    readonly twins: readonly { readonly id: string }[];
  }>(result).twins;
  expect(oneKeyTwin.map((twin) => twin.id)).toEqual([first.id]);

  result = await call(client, "ibeji_get_connection_guide", { twin: first.id });
  expect(result.isError).toBeFalsy();
  expect(textOf(result)).toContain("Connect");
  const guide = structuredOf<{
    readonly twin: {
      readonly id: string;
      readonly baseUrl: string | null;
      readonly credentials: readonly { readonly value: string }[];
      readonly steps: readonly { readonly title: string; readonly body: string }[];
    };
  }>(result).twin;
  expect(guide.id).toBe(first.id);
  expect(guide.baseUrl).toBe(firstAddress.url);
  expect(guide.credentials.map((credential) => credential.value)).toEqual(
    firstStored.map((credential) => credential.value),
  );
  expect(guide.steps).toHaveLength(firstGuide.steps.length);
  expect(guide.steps.every((step) => !step.body.includes("{base}"))).toBe(true);

  result = await call(client, "ibeji_enable_failure", {
    failureId: "server-error",
    twin: first.id,
    settings: { times: 2, status: 503 },
  });
  expect(result.isError).toBeFalsy();
  const rule = structuredOf<{ readonly rule: Rule }>(result).rule;
  expect(rule.failureId).toBe("server-error");
  expect(rule.twins).toEqual([first.id]);
  expect(rule.settings).toEqual({ times: 2, status: 503 });

  result = await call(client, "ibeji_status", { twin: first.id });
  expect(result.isError).toBeFalsy();
  const statusWithRule = structuredOf<{
    readonly status: { readonly rules: readonly Rule[] };
  }>(result).status;
  expect(statusWithRule.rules.map((item) => item.id)).toContain(rule.id);

  result = await call(client, "ibeji_list_events", {});
  expect(result.isError).toBeFalsy();
  const events = structuredOf<{
    readonly events: readonly { readonly type: string }[];
  }>(result).events;
  expect(events.length).toBeGreaterThan(0);
  expect(events.map((event) => event.type)).toContain("rule-added");

  result = await call(client, "ibeji_list_events", {
    twin: first.id,
    type: "rule-added",
    after: 0,
    limit: 50,
  });
  expect(result.isError).toBeFalsy();
  const filteredEvents = structuredOf<{
    readonly events: readonly { readonly scope: string; readonly type: string }[];
  }>(result).events;
  expect(
    filteredEvents.every((event) => event.scope === first.id && event.type === "rule-added"),
  ).toBe(true);

  result = await call(client, "ibeji_clear_failures", { twin: first.id });
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly removed: number }>(result).removed).toBe(1);

  result = await call(client, "ibeji_list_webhooks", {});
  expect(result.isError).toBeFalsy();
  const deliveries = structuredOf<{
    readonly deliveries: readonly WebhookDelivery[];
  }>(result).deliveries;
  expect(deliveries.map((item) => item.id)).toContain(delivery.id);

  result = await call(client, "ibeji_list_webhooks", {
    twin: first.id,
    status: "not-sent",
  });
  expect(result.isError).toBeFalsy();
  const filteredDeliveries = structuredOf<{
    readonly deliveries: readonly WebhookDelivery[];
  }>(result).deliveries;
  expect(
    filteredDeliveries.every((item) => item.twinId === first.id && item.status === "not-sent"),
  ).toBe(true);

  result = await call(client, "ibeji_resend_webhook", { deliveryId: delivery.id });
  expect(result.isError).toBeFalsy();
  const resent = structuredOf<{ readonly delivery: WebhookDelivery }>(result).delivery;
  expect(resent.resendOf).toBe(delivery.id);

  result = await call(client, "ibeji_set_webhook_url", {
    twin: first.id,
    url: "http://127.0.0.1:1/ibeji-hook",
  });
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly url: string | null }>(result).url).toBe(
    "http://127.0.0.1:1/ibeji-hook",
  );

  result = await call(client, "ibeji_set_webhook_url", { twin: first.id, url: "" });
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly url: string | null }>(result).url).toBeNull();

  const scenario = scenarios.find((item) => item.twins.includes(first.id));
  if (scenario === undefined) {
    throw new Error("no scenario supports the first twin");
  }

  result = await call(client, "ibeji_run_scenario", {
    scenario: scenario.id,
    twin: first.id,
  });
  expect(result.isError).toBeFalsy();
  expect(session.scenarios.activeScenarioId).toBe(scenario.id);
  session.scenarios.stop();

  result = await call(client, "ibeji_run_scenario", { scenario: scenario.id });
  expect(result.isError).toBeFalsy();
  expect(session.scenarios.activeScenarioId).toBe(scenario.id);
  session.scenarios.stop();

  result = await call(client, "ibeji_enable_failure", {
    failureId: "payment-declined",
    twin: first.id,
    settings: { percent: 100 },
  });
  expect(result.isError).toBeFalsy();

  result = await call(client, "ibeji_clear_failures", { twin: first.id });
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly removed: number }>(result).removed).toBe(1);

  result = await call(client, "ibeji_enable_failure", {
    failureId: "payment-declined",
    twin: first.id,
    settings: { percent: 100 },
  });
  expect(result.isError).toBeFalsy();

  result = await call(client, "ibeji_clear_failures", {});
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly removed: number }>(result).removed).toBeGreaterThanOrEqual(1);

  result = await call(client, "ibeji_reset_state", { twin: first.id });
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly twin?: string }>(result).twin).toBe(first.id);

  result = await call(client, "ibeji_reset_state", {});
  expect(result.isError).toBeFalsy();
  expect(structuredOf<{ readonly ok: boolean }>(result).ok).toBe(true);

  if (second.id !== first.id) {
    result = await call(client, "ibeji_get_connection_guide", { twin: second.id });
    expect(result.isError).toBeFalsy();
    expect(structuredOf<{ readonly twin: { readonly id: string } }>(result).twin.id).toBe(
      second.id,
    );
  }
}

describe("T11 MCP server", () => {
  it(
    "T11 tools/list exposes every C11 tool with exact annotations and useful descriptions",
    async () => {
      const home = await makeHome();
      try {
        await withStdio(home, async (mcp) => {
          const listed = await mcp.client.listTools();
          const tools = listed.tools;
          expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());

          for (const name of READ_TOOLS) {
            expect(toolByName(tools, name).annotations).toEqual({ readOnlyHint: true });
          }
          for (const name of CHANGING_TOOLS) {
            expect(toolByName(tools, name).annotations).toEqual({ readOnlyHint: false });
          }
          expect(toolByName(tools, "ibeji_reset_state").annotations).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
          });

          for (const tool of tools) {
            expect(tool.description?.length ?? 0).toBeGreaterThan(40);
          }
          for (const name of ["ibeji_get_test_keys", "ibeji_get_connection_guide"] as const) {
            const description = toolByName(tools, name).description?.toLowerCase() ?? "";
            expect(description).toContain("fake local test keys");
            expect(description).toContain("mcp clients may log tool results");
            expect(description).toContain("live keys must never be used");
          }

          for (const name of TOOL_NAMES) {
            const schema = toolByName(tools, name).inputSchema as {
              readonly properties?: Readonly<Record<string, { readonly type?: string }>>;
              readonly required?: readonly string[];
            };
            if (name === "ibeji_set_webhook_url" || name === "ibeji_get_connection_guide") {
              expect(schema.properties?.twin?.type).toBe("string");
            } else if (name === "ibeji_resend_webhook") {
              expect(schema.properties?.deliveryId?.type).toBe("string");
            }
          }
        });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 every tool works against a real session through the built CLI over stdio",
    async () => {
      await withSession(async (home, session) => {
        const mcp = await withStdio(home, async (harness) => {
          await exerciseEveryTool(harness, session);
        });
        if (mcp.logPath === undefined) {
          throw new Error("the stdio harness did not record stdout");
        }
        const lines = await stdoutLines(mcp.logPath);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          const parsed = JSON.parse(line) as unknown;
          expect(typeof parsed).toBe("object");
          expect(parsed).not.toBeNull();
          expect(
            typeof parsed === "object" &&
              parsed !== null &&
              "jsonrpc" in parsed &&
              parsed.jsonrpc === "2.0",
          ).toBe(true);
        }
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 the same tool handlers run in process for coverage",
    async () => {
      await withSession(async (home, session) => {
        await withInProcess(home, async (mcp) => {
          await exerciseEveryTool(mcp, session);
        });
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 every tool returns isError text saying Ibeji is not running",
    async () => {
      const home = await makeHome();
      try {
        await withStdio(home, async (mcp) => {
          for (const [name, args] of NO_SESSION_CALLS) {
            const result = await call(mcp.client, name, args);
            expect(result.isError).toBe(true);
            expect(textOf(result)).toContain("Ibeji is not running");
            expect(textOf(result)).toContain("ibeji start");
            expect(errorCodeOf(result)).toBe("SESSION_NOT_RUNNING");
          }

          const omittedTwinCalls: readonly (readonly [
            string,
            Readonly<Record<string, unknown>>,
          ])[] = [
            ["ibeji_get_connection_guide", {}],
            ["ibeji_set_webhook_url", { url: "http://127.0.0.1:1/hook" }],
          ];
          for (const [name, args] of omittedTwinCalls) {
            const result = await call(mcp.client, name, args);
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("SESSION_NOT_RUNNING");
          }
        });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 the in-process server reports missing and stale session files without a protocol error",
    async () => {
      const home = await makeHome();
      const mcp = await startInProcessMcp(home);
      try {
        const missing = await call(mcp.client, "ibeji_status", {});
        expect(missing.isError).toBe(true);
        expect(errorCodeOf(missing)).toBe("SESSION_NOT_RUNNING");
        expect(textOf(missing)).toContain("Ibeji is not running");

        await mkdir(join(home, ".ibeji"), { recursive: true });
        await writeFile(join(home, ".ibeji", "session.json"), "{}\n", "utf8");

        const stale = await call(mcp.client, "ibeji_status", {});
        expect(stale.isError).toBe(true);
        expect(errorCodeOf(stale)).toBe("SESSION_STALE");
        expect(textOf(stale)).toContain("Ibeji is not running");
        expect(textOf(stale)).toContain("ibeji start");
      } finally {
        await mcp.close();
        await rm(home, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 the in-process server covers unknown twins and every stopped-twin branch",
    async () => {
      const definitions = registry.list();
      const first = definitions[0];
      const second = definitions[1];
      if (first === undefined || second === undefined) {
        throw new Error("this test needs two registered twins");
      }

      await withSession(
        async (home, session) => {
          const mcp = await startInProcessMcp(home);
          try {
            let result = await call(mcp.client, "ibeji_status", { twin: "no-such-twin" });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("UNKNOWN_TWIN");

            result = await call(mcp.client, "ibeji_enable_failure", {
              failureId: "server-error",
              twin: "no-such-twin",
            });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("UNKNOWN_TWIN");

            result = await call(mcp.client, "ibeji_run_scenario", {
              scenario: "slow-friday",
              twin: "no-such-twin",
            });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("UNKNOWN_TWIN");

            result = await call(mcp.client, "ibeji_get_connection_guide", {});
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("BAD_REQUEST");

            result = await call(mcp.client, "ibeji_set_webhook_url", {
              url: "http://127.0.0.1:1/no-twin",
            });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("BAD_REQUEST");

            result = await call(mcp.client, "ibeji_list_events", { twin: second.id });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("TWIN_NOT_RUNNING");

            result = await call(mcp.client, "ibeji_reset_state", { twin: second.id });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("TWIN_NOT_RUNNING");

            result = await call(mcp.client, "ibeji_get_test_keys", { twin: second.id });
            expect(result.isError).toBeFalsy();

            result = await call(mcp.client, "ibeji_get_connection_guide", { twin: second.id });
            expect(result.isError).toBeFalsy();
            const guide = structuredOf<{
              readonly twin: { readonly running: boolean; readonly baseUrl: string | null };
            }>(result).twin;
            expect(guide.running).toBe(false);
            expect(guide.baseUrl).toBeNull();

            result = await call(mcp.client, "ibeji_set_webhook_url", {
              twin: second.id,
              url: "http://127.0.0.1:1/stopped-in-process",
            });
            expect(result.isError).toBeFalsy();
            await call(mcp.client, "ibeji_set_webhook_url", { twin: second.id, url: "" });

            result = await call(mcp.client, "ibeji_enable_failure", {
              failureId: "payment-declined",
              twin: first.id,
              settings: { percent: 100 },
            });
            expect(result.isError).toBeFalsy();
            const rule = structuredOf<{ readonly rule: Rule }>(result).rule;

            result = await call(mcp.client, "ibeji_status", { twin: first.id });
            expect(result.isError).toBeFalsy();
            expect(
              structuredOf<{ readonly status: { readonly rules: readonly Rule[] } }>(
                result,
              ).status.rules.map((item) => item.id),
            ).toContain(rule.id);

            expect(session.twins.has(second.id)).toBe(false);
          } finally {
            await mcp.close();
          }
        },
        { twins: [first.id] },
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 an unknown twin and a stopped twin give clear errors, while saved keys still work",
    async () => {
      const definitions = registry.list();
      const first = definitions[0];
      const second = definitions[1];
      if (first === undefined || second === undefined) {
        throw new Error("this test needs two registered twins");
      }

      await withSession(
        async (home, session) => {
          const mcp = await startStdioMcp(home);
          try {
            let result = await call(mcp.client, "ibeji_status", { twin: "no-such-twin" });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("UNKNOWN_TWIN");
            expect(textOf(result)).toContain("no-such-twin");
            expect(textOf(result)).toContain(first.id);

            result = await call(mcp.client, "ibeji_get_connection_guide", {
              twin: "no-such-twin",
            });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("UNKNOWN_TWIN");

            result = await call(mcp.client, "ibeji_list_events", { twin: second.id });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("TWIN_NOT_RUNNING");

            result = await call(mcp.client, "ibeji_reset_state", { twin: second.id });
            expect(result.isError).toBe(true);
            expect(errorCodeOf(result)).toBe("TWIN_NOT_RUNNING");

            result = await call(mcp.client, "ibeji_get_test_keys", { twin: second.id });
            expect(result.isError).toBeFalsy();
            const keys = structuredOf<{
              readonly twins: readonly { readonly id: string }[];
            }>(result).twins;
            expect(keys.map((twin) => twin.id)).toEqual([second.id]);

            result = await call(mcp.client, "ibeji_get_connection_guide", { twin: second.id });
            expect(result.isError).toBeFalsy();
            const guide = structuredOf<{
              readonly twin: { readonly running: boolean; readonly baseUrl: string | null };
            }>(result).twin;
            expect(guide.running).toBe(false);
            expect(guide.baseUrl).toBeNull();
            expect(textOf(result)).toContain("is off");

            result = await call(mcp.client, "ibeji_set_webhook_url", {
              twin: second.id,
              url: "http://127.0.0.1:1/stopped-hook",
            });
            expect(result.isError).toBeFalsy();
            await call(mcp.client, "ibeji_set_webhook_url", { twin: second.id, url: "" });

            expect(session.twins.has(second.id)).toBe(false);
          } finally {
            await mcp.close();
          }
        },
        { twins: [first.id] },
      );
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 the server reads the session file again after Ibeji restarts",
    async () => {
      const home = await makeHome();
      let first: RunningSession | undefined;
      let second: RunningSession | undefined;
      const mcp = await startStdioMcp(home);
      try {
        first = await startIbeji(home);
        const before = await call(mcp.client, "ibeji_status", {});
        expect(before.isError).toBeFalsy();
        const firstInstance = structuredOf<{
          readonly status: { readonly instance: string };
        }>(before).status.instance;
        expect(firstInstance).toBe(first.instanceId);

        await first.stop();
        first = undefined;

        second = await startIbeji(home);
        const after = await call(mcp.client, "ibeji_status", {});
        expect(after.isError).toBeFalsy();
        const secondInstance = structuredOf<{
          readonly status: { readonly instance: string };
        }>(after).status.instance;
        expect(secondInstance).toBe(second.instanceId);
        expect(secondInstance).not.toBe(firstInstance);
      } finally {
        await first?.stop();
        await second?.stop();
        await mcp.close();
        await rm(home, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    "T4 parity: webhook-delayed, server-error and payment-declined are identical through MCP, the CLI and the control API",
    async () => {
      await withSession(async (home, session) => {
        const mcp = await startStdioMcp(home);
        try {
          const cases: readonly {
            readonly failureId: string;
            readonly settings: Readonly<Record<string, number>>;
          }[] = [
            { failureId: "webhook-delayed", settings: { seconds: 12, jitterSeconds: 3 } },
            { failureId: "server-error", settings: { times: 5, status: 503 } },
            { failureId: "payment-declined", settings: { percent: 100 } },
          ];

          for (const testCase of cases) {
            for (const definition of registry.list()) {
              await resetRules(session);

              const mcpResult = await call(mcp.client, "ibeji_enable_failure", {
                failureId: testCase.failureId,
                twin: definition.id,
                settings: testCase.settings,
              });
              expect(mcpResult.isError).toBeFalsy();
              const mcpRule = structuredOf<{ readonly rule: Rule }>(mcpResult).rule;

              await resetRules(session);

              const settingArgs = Object.entries(testCase.settings).flatMap(([key, value]) => [
                `--${key}`,
                String(value),
              ]);
              const { stdout } = await execFileAsync(
                process.execPath,
                [
                  CLI,
                  "fail",
                  testCase.failureId,
                  "--twin",
                  definition.id,
                  "--json",
                  ...settingArgs,
                ],
                {
                  cwd: ROOT,
                  env: mcpEnvironment(home),
                  encoding: "utf8",
                },
              );
              const cliRule = ruleFromJson(stdout);

              await resetRules(session);

              const controlResult = await controlJson<{ readonly rule: Rule }>(session, "/rules", {
                method: "POST",
                body: {
                  failureId: testCase.failureId,
                  twins: [definition.id],
                  settings: testCase.settings,
                },
              });

              expect(ruleFacts(cliRule)).toEqual(ruleFacts(mcpRule));
              expect(ruleFacts(controlResult.rule)).toEqual(ruleFacts(mcpRule));
            }
          }
        } finally {
          await mcp.close();
        }
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "T11 a rule added through MCP appears in the control API",
    async () => {
      await withSession(async (home, session) => {
        const mcp = await startStdioMcp(home);
        try {
          const first = registry.list()[0];
          if (first === undefined) {
            throw new Error("the registry has no twins");
          }
          const result = await call(mcp.client, "ibeji_enable_failure", {
            failureId: "payment-declined",
            twin: first.id,
            settings: { percent: 75 },
          });
          expect(result.isError).toBeFalsy();
          const added = structuredOf<{ readonly rule: Rule }>(result).rule;

          const listed = await controlJson<{ readonly rules: readonly Rule[] }>(session, "/rules");
          const stored = listed.rules.find((rule) => rule.id === added.id);
          expect(stored).toBeDefined();
          expect(ruleFacts(stored as Rule)).toEqual(ruleFacts(added));
        } finally {
          await mcp.close();
        }
      });
    },
    TEST_TIMEOUT,
  );

  it("T11 the MCP server uses only the v2 package, never a v1 import path", async () => {
    const directory = join(ROOT, "src", "mcp");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(join(directory, file), "utf8");
      expect(text).not.toContain("@modelcontextprotocol/sdk");
      expect(text.toLowerCase()).not.toContain("paystack");
      expect(text.toLowerCase()).not.toContain("flutterwave");
      expect(text.toLowerCase()).not.toContain("stripe");
    }
  });
});
