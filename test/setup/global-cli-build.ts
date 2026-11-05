import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync("pnpm", ["exec", "tsup", "--no-clean"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}
