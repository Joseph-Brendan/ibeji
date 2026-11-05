import { runPnpm } from "./run-pnpm.js";

export default function setup(): void {
  runPnpm(["exec", "tsup", "--no-clean"]);
}
