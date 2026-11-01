import { IbejiError } from "../core/errors.js";
import { flutterwaveTwin } from "./flutterwave/definition.js";
import type { TwinDefinition } from "./framework/types.js";
import { paystackTwin } from "./paystack/definition.js";

export type TwinRegistry = {
  readonly list: () => readonly TwinDefinition[];
  readonly require: (id: string) => TwinDefinition;
  readonly has: (id: string) => boolean;
};

function duplicateTwin(id: string): IbejiError {
  return new IbejiError("BAD_REQUEST", {
    what: `The twin "${id}" is registered twice.`,
    why: "The twin registry must contain each twin id only once.",
    fix: "Remove the duplicate definition from src/twins/registry.ts.",
  });
}

function buildRegistry(definitions: readonly TwinDefinition[]): TwinRegistry {
  const byId = new Map<string, TwinDefinition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw duplicateTwin(definition.id);
    }
    byId.set(definition.id, definition);
  }

  return {
    list: () => [...byId.values()],
    require: (id) => {
      const definition = byId.get(id);
      if (definition === undefined) {
        throw new IbejiError("UNKNOWN_TWIN", {
          why: `"${id}" is not a twin in the registry.`,
        });
      }
      return definition;
    },
    has: (id) => byId.has(id),
  };
}

/**
 * The one list of real twin definitions. Stripe stays out until version 0.2.0
 * (SPEC.md C21 D42). Tests use createTwinRegistry with fake definitions.
 */
export const TWIN_DEFINITIONS: readonly TwinDefinition[] = Object.freeze([
  paystackTwin,
  flutterwaveTwin,
]);

export const registry: TwinRegistry = buildRegistry(TWIN_DEFINITIONS);

export function listTwins(): readonly TwinDefinition[] {
  return registry.list();
}

export function requireTwin(id: string): TwinDefinition {
  return registry.require(id);
}

export function createTwinRegistry(definitions: readonly TwinDefinition[]): TwinRegistry {
  return buildRegistry(definitions);
}
