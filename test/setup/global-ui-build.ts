import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync("pnpm", ["build:ui"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}
