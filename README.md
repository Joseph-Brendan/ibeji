# Ibeji: under construction

Ibeji is a set of local "twins" of payment services.

## Use Ibeji from an AI coding agent

`ibeji mcp` runs a Model Context Protocol server over stdio. Start Ibeji first:

```bash
ibeji start
```

Then add the server to your MCP client's configuration. For example:

```json
{
  "mcpServers": {
    "ibeji": {
      "command": "npx",
      "args": ["-y", "ibeji", "mcp"]
    }
  }
}
```

You can also run it directly with `npx -y ibeji mcp`.

The server reads `~/.ibeji/session.json` again on every tool call, so it keeps working after Ibeji restarts. It can show the session status, failures, scenarios, recent activity, webhook deliveries, test keys and the connection guide for each twin. It can also switch failures on and off, run scenarios, set a webhook URL, resend a webhook and reset twin records. Only MCP messages go to standard output; logs go to standard error.

The keys returned by `ibeji_get_test_keys` and `ibeji_get_connection_guide` are Ibeji's fake local test keys. MCP clients may log tool results. Never use a live key with Ibeji.
