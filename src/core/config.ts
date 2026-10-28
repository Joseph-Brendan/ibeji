import { z } from "zod";

import { IbejiError, type ZodProblem, zodProblemsToError } from "./errors.js";

export const DEFAULT_CONTROL_PORT = 4400;
export const MAX_SEED = 4294967295;

export type ConfigOverrides = {
  readonly twins?: readonly string[] | undefined;
  readonly ports?: Readonly<Record<string, number>> | undefined;
  readonly webhookUrls?: Readonly<Record<string, string>> | undefined;
  readonly seed?: number | undefined;
  readonly scenario?: string | undefined;
  readonly open?: boolean | undefined;
  readonly allowPrivateWebhooks?: boolean | undefined;
  readonly allowPublicWebhooks?: boolean | undefined;
};

export type IbejiConfig = {
  readonly twins: readonly string[];
  readonly ports: Readonly<Record<string, number>>;
  readonly webhookUrls: Readonly<Record<string, string>>;
  readonly seed: number | undefined;
  readonly scenario: string | undefined;
  readonly open: boolean;
  readonly allowPrivateWebhooks: boolean;
  readonly allowPublicWebhooks: boolean;
};

export type ConfigContext = {
  /** Every twin id the registry knows. This file never hard-codes a twin list. */
  readonly twinIds: readonly string[];
  /** Defaults supplied by the twin definitions for their own ports. */
  readonly defaultPorts?: Readonly<Record<string, number>>;
  /** Built-in scenarios and the twins each one supports. */
  readonly scenarios?: Readonly<Record<string, readonly string[]>>;
  /** Extra credential shapes collected from the twin definitions. */
  readonly secretPatterns?: readonly RegExp[];
};

/**
 * Generic credential shapes. Service-specific patterns are added by the
 * registry through ConfigContext.secretPatterns, so the core never names a
 * particular service.
 */
const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /\b[a-z]{2,5}_(?:test|live)_[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\bwhsec_[A-Za-z0-9._~+/=-]{8,}\b/,
  /\b[A-Z]{4,}(?:_TEST)?-[A-Za-z0-9._~+/=-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
];

function normalisePatterns(patterns: readonly RegExp[]): readonly RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern.source, pattern.flags.replaceAll("g", "")));
}

function containsSecret(
  value: unknown,
  path: readonly PropertyKey[],
  patterns: readonly RegExp[],
  found: string[],
): void {
  if (typeof value === "string") {
    if (patterns.some((pattern) => pattern.test(value))) {
      found.push(path.length === 0 ? "(root)" : path.map((part) => String(part)).join("."));
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      containsSecret(item, [...path, index], patterns, found);
    });
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      containsSecret(item, [...path, key], patterns, found);
    }
  }
}

function findSecrets(raw: unknown, context: ConfigContext): readonly string[] {
  const patterns = normalisePatterns([
    ...DEFAULT_SECRET_PATTERNS,
    ...(context.secretPatterns ?? []),
  ]);
  const found: string[] = [];
  containsSecret(raw, [], patterns, found);
  return found;
}

function exampleFor(path: readonly PropertyKey[], context: ConfigContext): string {
  const root = path.length === 0 ? "" : String(path[0]);
  const firstTwin = context.twinIds[0] ?? "twin-id";
  const scenarioExample = Object.keys(context.scenarios ?? {})[0] ?? "slow-day";

  const examples = {
    twins: JSON.stringify(context.twinIds.slice(0, 1)),
    ports: JSON.stringify({ control: DEFAULT_CONTROL_PORT, ...context.defaultPorts }),
    webhookUrls: JSON.stringify({ [firstTwin]: "http://127.0.0.1:3000/webhook" }),
    seed: String(MAX_SEED),
    scenario: scenarioExample,
    open: "true",
    allowPrivateWebhooks: "true",
    allowPublicWebhooks: "false",
    "(root)": JSON.stringify({ twins: context.twinIds.slice(0, 1) }),
  } as const;

  if (root in examples) {
    return examples[root as keyof typeof examples];
  }

  return examples["(root)"];
}

function configError(issues: readonly z.core.$ZodIssue[], context: ConfigContext): IbejiError {
  const problems: ZodProblem[] = [];

  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        problems.push({
          path: [...issue.path, key],
          message: `Expected a field Ibeji knows. Example: ${exampleFor(issue.path, context)}`,
        });
      }
      continue;
    }

    problems.push({
      path: issue.path,
      message: `${issue.message} Example: ${exampleFor(issue.path, context)}`,
    });
  }

  return zodProblemsToError("CONFIG_INVALID", problems);
}

function secretError(fields: readonly string[]): IbejiError {
  return new IbejiError("CONFIG_HAS_SECRET", {
    why: `These fields look like keys, tokens, or secrets: ${fields.join(", ")}.`,
  });
}

function knownTwinKeys(
  input: Readonly<Record<string, unknown>>,
  context: ConfigContext,
  field: string,
  allowControl: boolean,
  ctx: z.RefinementCtx,
): void {
  const known = new Set(context.twinIds);
  for (const key of Object.keys(input)) {
    if ((!allowControl || key !== "control") && !known.has(key)) {
      const expected = allowControl
        ? `"control" or one of these twin ids: ${context.twinIds.join(", ")}`
        : `one of these twin ids: ${context.twinIds.join(", ")}`;
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `Expected ${expected} (field: ${field}).`,
        input,
      });
    }
  }
}

export function createConfigSchema(context: ConfigContext) {
  const twinIdSet = new Set(context.twinIds);

  const twinId = z.string().superRefine((value, ctx) => {
    if (!twinIdSet.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `Expected one of these twin ids: ${context.twinIds.join(", ")}.`,
        input: value,
      });
    }
  });

  const port = z.number().int().min(0).max(65535);
  const webhookUrl = z.url({ protocol: /^https?$/ });

  const ports = z
    .record(z.string(), port)
    .superRefine((value, ctx) => knownTwinKeys(value, context, "ports", true, ctx));

  const webhookUrls = z
    .record(z.string(), webhookUrl)
    .superRefine((value, ctx) => knownTwinKeys(value, context, "webhookUrls", false, ctx));

  return z
    .strictObject({
      twins: z.array(twinId).min(1).optional(),
      ports: ports.optional(),
      webhookUrls: webhookUrls.optional(),
      seed: z.number().int().min(0).max(MAX_SEED).optional(),
      scenario: z.string().min(1).optional(),
      open: z.boolean().optional(),
      allowPrivateWebhooks: z.boolean().optional(),
      allowPublicWebhooks: z.boolean().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.twins !== undefined) {
        const seen = new Set<string>();
        value.twins.forEach((id, index) => {
          if (seen.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["twins", index],
              message: "Expected each twin only once, but this twin is repeated.",
              input: id,
            });
          } else {
            seen.add(id);
          }
        });
      }

      if (value.ports !== undefined) {
        const owners = new Map<number, string>();
        for (const [name, portNumber] of Object.entries(value.ports)) {
          const owner = owners.get(portNumber);
          if (owner === undefined) {
            owners.set(portNumber, name);
          } else {
            ctx.addIssue({
              code: "custom",
              path: ["ports", name],
              message: `Expected a port different from the one used by ${owner} (${portNumber}).`,
              input: portNumber,
            });
          }
        }
      }

      if (value.scenario !== undefined && context.scenarios !== undefined) {
        const supported = context.scenarios[value.scenario];
        if (supported === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["scenario"],
            message: "Expected the id of a built-in scenario.",
            input: value.scenario,
          });
        } else {
          const chosen = value.twins ?? context.twinIds;
          if (!supported.some((id) => chosen.includes(id))) {
            ctx.addIssue({
              code: "custom",
              path: ["scenario"],
              message: "Expected a scenario that supports at least one of the chosen twins.",
              input: value.scenario,
            });
          }
        }
      }
    });
}

/**
 * Validate a raw ibeji.config.json value. Every problem is collected into one
 * CONFIG_INVALID error; anything that looks like a credential becomes
 * CONFIG_HAS_SECRET instead, because config files are committed.
 */
export function parseConfig(raw: unknown, context: ConfigContext): ConfigOverrides {
  const secrets = findSecrets(raw, context);
  if (secrets.length > 0) {
    throw secretError(secrets);
  }

  const result = createConfigSchema(context).safeParse(raw);
  if (!result.success) {
    throw configError(result.error.issues, context);
  }

  return result.data;
}

export function createDefaultConfig(context: ConfigContext): IbejiConfig {
  return {
    twins: [...context.twinIds],
    ports: { control: DEFAULT_CONTROL_PORT, ...context.defaultPorts },
    webhookUrls: {},
    seed: undefined,
    scenario: undefined,
    open: true,
    allowPrivateWebhooks: false,
    allowPublicWebhooks: false,
  };
}

/**
 * Apply C14's order: built-in defaults, then the config file, then flags. A
 * list supplied by flags replaces the file's list. Port and URL objects merge
 * by key so one flag can override one twin without dropping the others.
 */
export function mergeConfig(
  defaults: IbejiConfig,
  file: ConfigOverrides,
  flags: ConfigOverrides,
): IbejiConfig {
  return {
    twins: flags.twins ?? file.twins ?? defaults.twins,
    ports: { ...defaults.ports, ...file.ports, ...flags.ports },
    webhookUrls: { ...defaults.webhookUrls, ...file.webhookUrls, ...flags.webhookUrls },
    seed: flags.seed ?? file.seed ?? defaults.seed,
    scenario: flags.scenario ?? file.scenario ?? defaults.scenario,
    open: flags.open ?? file.open ?? defaults.open,
    allowPrivateWebhooks:
      flags.allowPrivateWebhooks ?? file.allowPrivateWebhooks ?? defaults.allowPrivateWebhooks,
    allowPublicWebhooks:
      flags.allowPublicWebhooks ?? file.allowPublicWebhooks ?? defaults.allowPublicWebhooks,
  };
}
