import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";

import { createIbejiMcpServer, type IbejiMcpOptions } from "./server.js";

/**
 * The v2 stdio entry point owns the transport and the protocol-era decision.
 * Each connection gets one server instance from the factory.
 */
export function serveIbejiMcp(options: IbejiMcpOptions): StdioServerHandle {
  return serveStdio(() => createIbejiMcpServer(options), {
    onerror: (error) => {
      process.stderr.write(`Ibeji MCP error: ${error.message}\n`);
    },
  });
}
