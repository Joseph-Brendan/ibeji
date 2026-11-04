import { homedir } from "node:os";
import {
  readSessionFile,
  removeSessionFile,
  type SessionFile,
  sessionFileIsLive,
} from "../control/session-file.js";
import { IbejiError } from "../core/errors.js";
import { ControlClient } from "./control-client.js";

export type CliSession = {
  readonly session: SessionFile;
  readonly client: ControlClient;
};

export function cliHome(home?: string): string {
  return home ?? homedir();
}

function notRunning(): IbejiError {
  return new IbejiError("SESSION_NOT_RUNNING", {
    fix: "Run: ibeji start",
  });
}

function stale(): IbejiError {
  return new IbejiError("SESSION_STALE", {
    what: "The saved Ibeji session is no longer running.",
    why: "The session file is invalid, or its process and health check no longer answer.",
    fix: "Run: ibeji start",
  });
}

export async function requireSession(home: string): Promise<CliSession> {
  const read = await readSessionFile(home);
  if (read.kind === "missing") {
    throw notRunning();
  }

  if (read.kind === "invalid") {
    await removeSessionFile(home);
    throw stale();
  }

  if (!(await sessionFileIsLive(read.value))) {
    await removeSessionFile(home);
    throw stale();
  }

  return { session: read.value, client: new ControlClient(read.value) };
}
