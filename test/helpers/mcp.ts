import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { type RunningSession, startSession } from "../../src/control/session.js";
import { FakeClock } from "../../src/core/clock.js";
import { Logger } from "../../src/core/logger.js";
import { loadScenarios } from "../../src/core/scenarios/loader.js";
import { createIbejiMcpServer } from "../../src/mcp/server.js";
import { registry } from "../../src/twins/registry.js";

export const ROOT = process.cwd();
export const CLI = join(ROOT, "dist", "cli.js");
export const MCP_PROXY = join(ROOT, "test", "helpers", "mcp-stdio-proxy.mjs");

export type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

export type McpHarness = {
  readonly client: Client;
  readonly logPath: string | undefined;
  close: () => Promise<void>;
};

export function zeroPorts(): Record<string, number> {
  const ports: Record<string, number> = { control: 0 };
  for (const definition of registry.list()) {
    ports[definition.id] = 0;
  }
  return ports;
}

export async function startIbeji(
  home: string,
  options: { readonly twins?: readonly string[] } = {},
): Promise<RunningSession> {
  const scenarios = await loadScenarios(join(ROOT, "scenarios"));
  return startSession({
    home,
    ...(options.twins === undefined ? {} : { twins: options.twins }),
    ports: zeroPorts(),
    scenarios,
    clock: new FakeClock(1_700_000_000_000),
    logger: new Logger({ level: "debug", write: () => {} }),
    handleSignals: false,
  });
}

export function mcpEnvironment(home: string, logPath?: string): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    HOME: home,
    USERPROFILE: home,
    ...(logPath === undefined ? {} : { IBEJI_MCP_STDOUT_LOG: logPath }),
  };
}

export async function startStdioMcp(home: string): Promise<McpHarness> {
  const logPath = join(home, "mcp-stdout.log");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_PROXY],
    cwd: ROOT,
    env: mcpEnvironment(home, logPath),
    stderr: "pipe",
  });
  const client = new Client({ name: "ibeji-t11", version: "1.0.0" });
  await client.connect(transport);
  return {
    client,
    logPath,
    close: async () => {
      await client.close();
    },
  };
}

export async function startInProcessMcp(home: string): Promise<McpHarness> {
  const server = createIbejiMcpServer({ home });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "ibeji-t11-in-process", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    logPath: undefined,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: ToolResult): string {
  return result.content
    .filter(
      (item): item is { readonly type: "text"; readonly text: string } => item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");
}

export function structuredOf<T>(result: ToolResult): T {
  if (result.structuredContent === undefined) {
    throw new Error("the MCP tool result has no structured content");
  }
  return result.structuredContent as T;
}

export function errorCodeOf(result: ToolResult): string {
  return structuredOf<{ readonly error: { readonly code: string } }>(result).error.code;
}

export async function stdoutLines(logPath: string): Promise<readonly string[]> {
  const text = await readFile(logPath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
