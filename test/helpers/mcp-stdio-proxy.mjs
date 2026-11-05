import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const log = process.env.IBEJI_MCP_STDOUT_LOG;

if (log !== undefined) {
  writeFileSync(log, "");
}

const child = spawn(process.execPath, [cli, "mcp"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

process.stdin.pipe(child.stdin);

child.stdout.on("data", (chunk) => {
  if (log !== undefined) {
    appendFileSync(log, chunk);
  }
  process.stdout.write(chunk);
});

child.stderr.pipe(process.stderr);

child.on("close", (code) => {
  process.exitCode = code ?? 0;
});
