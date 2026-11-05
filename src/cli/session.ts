import { homedir } from "node:os";

export { requireSession } from "../control/session-client.js";

export function cliHome(home?: string): string {
  return home ?? homedir();
}
