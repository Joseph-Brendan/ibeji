import type { ControlClient } from "../control/client.js";
import { requireSession } from "../control/session-client.js";
import { IbejiError, isIbejiError } from "../core/errors.js";
import type { TwinList, TwinSummary } from "../shared/control.js";

/**
 * Read the session file again for every tool call. Nothing about the port or
 * token is cached, so an Ibeji restart is picked up by the next call.
 */
export async function withControlClient<T>(
  home: string,
  run: (client: ControlClient) => Promise<T>,
): Promise<T> {
  try {
    const { client } = await requireSession(home);
    return await run(client);
  } catch (error) {
    throw sessionError(error);
  }
}

export async function getTwins(client: ControlClient): Promise<TwinList> {
  return await client.twins;
}

export function findTwin(list: TwinList, twinId: string): TwinSummary {
  const twin = list.twins.find((item) => item.id === twinId);
  if (twin === undefined) {
    throw new IbejiError("UNKNOWN_TWIN", {
      why: `"${twinId}" is not a registered twin. Registered twins: ${list.twins
        .map((item) => item.id)
        .join(", ")}.`,
      fix: "Use one of the registered twin ids listed in this message.",
    });
  }
  return twin;
}

export async function resolveTwin(client: ControlClient, twinId: string): Promise<TwinSummary> {
  return findTwin(await getTwins(client), twinId);
}

export function asIbejiError(error: unknown): IbejiError {
  if (isIbejiError(error)) {
    return error;
  }
  return new IbejiError("INTERNAL", {
    what: "The Ibeji MCP tool could not finish.",
    why: error instanceof Error ? error.message : String(error),
    fix: "Try again. If the problem continues, report the steps that caused it.",
    cause: error,
  });
}

function sessionError(error: unknown): unknown {
  if (
    isIbejiError(error) &&
    (error.code === "SESSION_NOT_RUNNING" || error.code === "SESSION_STALE")
  ) {
    return new IbejiError(error.code, {
      what: "Ibeji is not running.",
      why:
        error.code === "SESSION_STALE"
          ? "The saved Ibeji session is no longer answering. It may have stopped or restarted."
          : "The MCP server reads the Ibeji session file on every tool call, and no live session was found.",
      fix: 'Run "ibeji start" in a terminal, then try this tool again.',
    });
  }
  return error;
}
