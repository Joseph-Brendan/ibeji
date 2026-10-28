import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { IbejiError } from "../errors.js";
import { parseScenarioJson, type Scenario } from "./schema.js";

export const DEFAULT_SCENARIOS_DIRECTORY = "scenarios";

/**
 * Read every .json scenario file in a folder. File order is deterministic.
 * Each file is validated before it is returned.
 */
export async function loadScenarios(
  directory: string = DEFAULT_SCENARIOS_DIRECTORY,
): Promise<readonly Scenario[]> {
  const entries = await readdir(directory);
  const files = entries.filter((entry) => entry.endsWith(".json")).sort();
  const scenarios: Scenario[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const text = await readFile(join(directory, file), "utf8");
    const scenario = parseScenarioJson(text, file);
    const previous = seen.get(scenario.id);
    if (previous !== undefined) {
      throw new IbejiError("SCENARIO_INVALID", {
        what: `The scenario file "${file}" is not valid.`,
        why: `id: the scenario id "${scenario.id}" is already used by ${previous}.`,
        fix: "Give each scenario a different id.",
      });
    }
    seen.set(scenario.id, file);
    scenarios.push(scenario);
  }

  return scenarios;
}
