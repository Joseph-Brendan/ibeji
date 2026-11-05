import { McpServer } from "@modelcontextprotocol/server";

import { IBEJI_VERSION } from "../control/session.js";
import { registerIbejiTools } from "./tools.js";

export type IbejiMcpOptions = {
  /** The user's home folder. The session file is read again for every tool call. */
  readonly home: string;
};

export function createIbejiMcpServer(options: IbejiMcpOptions): McpServer {
  const server = new McpServer(
    { name: "ibeji", version: IBEJI_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Use these tools to inspect and control a running local Ibeji session. Start Ibeji with ibeji start first. Twin inputs are plain twin ids; an omitted twin means all running twins for read tools.",
    },
  );
  registerIbejiTools(server, options);
  return server;
}
