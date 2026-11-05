import { IbejiError } from "../core/errors.js";
import { ControlClient } from "./client.js";
import {
  readSessionFile,
  removeSessionFile,
  type SessionFile,
  sessionFileIsLive,
} from "./session-file.js";

export type ControlSession = {
  readonly session: SessionFile;
  readonly client: ControlClient;
};

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

/** Read the session file again on every call, so a restarted session is found. */
export async function requireSession(home: string): Promise<ControlSession> {
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
