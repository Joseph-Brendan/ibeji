import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type RunningSession, startSession } from "../../../src/control/session.js";
import { realClock } from "../../../src/core/clock.js";
import { Logger } from "../../../src/core/logger.js";
import { loadScenarios } from "../../../src/core/scenarios/loader.js";
import { registry } from "../../../src/twins/registry.js";

export type UiSession = {
  readonly session: RunningSession;
  readonly home: string;
  readonly logs: readonly string[];
  cleanup: () => Promise<void>;
};

/**
 * Start a real Ibeji session for the browser tests. It uses port 0 for the
 * control server and every registered twin, a temporary home folder and the
 * real clock, because the browser tests exercise real webhook timing.
 */
export async function startUiSession(
  twins: readonly string[] | undefined = undefined,
): Promise<UiSession> {
  const home = await mkdtemp(join(tmpdir(), "ibeji-ui-"));
  const logs: string[] = [];
  const ports: Record<string, number> = { control: 0 };
  for (const definition of registry.list()) {
    ports[definition.id] = 0;
  }

  try {
    const session = await startSession({
      home,
      scenarios: await loadScenarios("scenarios"),
      clock: realClock,
      logger: new Logger({ level: "error", write: (line) => logs.push(line) }),
      handleSignals: false,
      ports,
      uiRoot: join(process.cwd(), "dist", "ui"),
      ...(twins === undefined ? {} : { twins }),
    });
    return {
      session,
      home,
      logs,
      cleanup: async () => {
        try {
          await session.stop();
        } finally {
          await rm(home, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
}
