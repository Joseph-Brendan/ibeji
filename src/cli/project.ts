import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type ConfigContext, type ConfigOverrides, parseConfig } from "../core/config.js";
import { IbejiError } from "../core/errors.js";
import { loadScenarios } from "../core/scenarios/loader.js";
import type { Scenario } from "../core/scenarios/schema.js";
import type { TwinDefinition } from "../twins/framework/types.js";
import { registry } from "../twins/registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export type PackageInfo = {
  readonly version: string;
  readonly engines: Readonly<Record<string, string>>;
};

export type ProjectInfo = {
  readonly root: string;
  readonly packageInfo: PackageInfo;
  readonly definitions: readonly TwinDefinition[];
  readonly scenarios: readonly Scenario[];
  readonly scenarioTwins: Readonly<Record<string, readonly string[]>>;
  readonly configContext: ConfigContext;
  readonly uiIndexPath: string | undefined;
};

function findRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "scenarios"))) {
      return candidate;
    }
  }
  return resolve(HERE, "..", "..");
}

function findUiIndex(root: string): string | undefined {
  const candidates = [
    join(root, "dist", "ui", "index.html"),
    join(root, "ui", "dist", "index.html"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export async function readPackageInfo(root: string): Promise<PackageInfo> {
  const path = join(root, "package.json");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new IbejiError("INTERNAL", {
      what: "The Ibeji package information could not be read.",
      why: `The file at ${path} could not be read as JSON.`,
      fix: "Reinstall Ibeji or run the command from the project folder.",
      cause: error,
    });
  }

  if (typeof raw !== "object" || raw === null) {
    throw new IbejiError("INTERNAL", {
      what: "The Ibeji package information is not valid.",
      why: `The file at ${path} does not contain an object.`,
      fix: "Reinstall Ibeji.",
    });
  }

  const version = "version" in raw && typeof raw.version === "string" ? raw.version : "0.0.0";
  let engines: Record<string, string> = {};
  if ("engines" in raw && typeof raw.engines === "object" && raw.engines !== null) {
    engines = Object.fromEntries(
      Object.entries(raw.engines).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  return { version, engines };
}

let cachedProject: ProjectInfo | undefined;

export async function loadProject(): Promise<ProjectInfo> {
  if (cachedProject !== undefined) {
    return cachedProject;
  }

  const root = findRoot();
  const definitions = registry.list();
  const scenarios = await loadScenarios(join(root, "scenarios"));
  const scenarioTwins = Object.fromEntries(
    scenarios.map((scenario) => [scenario.id, [...scenario.twins]]),
  );
  const packageInfo = await readPackageInfo(root);
  const configContext: ConfigContext = {
    twinIds: definitions.map((definition) => definition.id),
    defaultPorts: Object.fromEntries(
      definitions.map((definition) => [definition.id, definition.defaultPort]),
    ),
    scenarios: scenarioTwins,
  };

  cachedProject = {
    root,
    packageInfo,
    definitions,
    scenarios,
    scenarioTwins,
    configContext,
    uiIndexPath: findUiIndex(root),
  };
  return cachedProject;
}

export type LoadedConfig = {
  readonly path: string;
  readonly overrides: ConfigOverrides;
};

function configError(path: string, why: string, cause?: unknown): IbejiError {
  return new IbejiError("CONFIG_INVALID", {
    what: "The Ibeji configuration file is not valid.",
    why: `${path}: ${why}`,
    fix: "Edit the file and correct every field named in the error.",
    cause,
  });
}

export async function readConfigFile(
  project: ProjectInfo,
  cwd: string,
  explicitPath: string | undefined,
): Promise<LoadedConfig | undefined> {
  const path =
    explicitPath === undefined ? join(cwd, "ibeji.config.json") : resolve(cwd, explicitPath);
  const explicit = explicitPath !== undefined;

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (!explicit && error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw configError(
      path,
      explicit ? "The file does not exist or cannot be read." : "The file cannot be read.",
      error,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw configError(path, "The file does not contain valid JSON.", error);
  }

  return {
    path,
    overrides: parseConfig(raw, project.configContext),
  };
}
