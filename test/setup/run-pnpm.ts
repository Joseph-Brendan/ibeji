import { execFileSync, execSync } from "node:child_process";

const SAFE_ARGUMENT = /^[A-Za-z0-9_.:=/-]+$/u;

/**
 * Run a pnpm command from a Vitest global setup.
 *
 * On Windows pnpm is a .cmd file and Node cannot execute it through execFile
 * without a shell. The Windows branch therefore uses execSync with fixed,
 * validated arguments. The Unix branch executes pnpm directly without a shell.
 */
export function runPnpm(args: readonly string[]): void {
  if (process.platform !== "win32") {
    execFileSync("pnpm", args, {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    return;
  }

  for (const argument of args) {
    if (!SAFE_ARGUMENT.test(argument)) {
      throw new Error(`Refusing to run a pnpm argument with shell characters: ${argument}`);
    }
  }
  execSync(["pnpm", ...args].join(" "), {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}
