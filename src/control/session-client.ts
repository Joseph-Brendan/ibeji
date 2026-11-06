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

/**
 * Read the session file again on every call, so a restarted session is found.
 * A repaired file permission is reported through `warn` when a caller has an
 * output stream.
 */
export async function requireSession(
  home: string,
  warn?: (message: string) => void,
): Promise<ControlSession> {
  const read = await readSessionFile(home);
  if (read.kind === "missing") {
    throw notRunning();
  }

  if (read.kind === "invalid") {
    await removeSessionFile(home);
    throw stale();
  }

  if (read.permissionsRepaired) {
    warn?.("The session file was readable by other users. Ibeji changed its mode to 600.");
  }

  if (!(await sessionFileIsLive(read.value))) {
    await removeSessionFile(home);
    throw stale();
  }

  return { session: read.value, client: new ControlClient(read.value) };
}
