import { z } from "zod";

import { formatZodPath, IbejiError } from "../errors.js";
import { actionSelectorSchema, getFailure } from "../failures/catalog.js";

export type ScenarioRule = {
  readonly id: string;
  readonly failureId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly actions?: string | readonly string[] | undefined;
};

export type ScenarioStep = {
  readonly afterSeconds: number;
  readonly removeRule: string;
};

export type Scenario = {
  readonly id: string;
  readonly name: string;
  readonly story: string;
  readonly twins: readonly string[];
  readonly rules: readonly ScenarioRule[];
  readonly steps: readonly ScenarioStep[];
};

const scenarioRuleSchema = z.strictObject({
  id: z.string().min(1),
  failureId: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).default({}),
  actions: actionSelectorSchema.optional(),
});

const scenarioStepSchema = z.strictObject({
  afterSeconds: z.number().int().min(1),
  removeRule: z.string().min(1),
});

export const scenarioSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    story: z.string().min(1),
    twins: z.array(z.string().min(1)).min(1),
    rules: z.array(scenarioRuleSchema).min(1),
    steps: z.array(scenarioStepSchema).default([]),
  })
  .superRefine((scenario, ctx) => {
    const twinsSeen = new Set<string>();
    scenario.twins.forEach((twinId, index) => {
      if (twinsSeen.has(twinId)) {
        ctx.addIssue({
          code: "custom",
          path: ["twins", index],
          message: "Expected each twin only once.",
          input: twinId,
        });
      } else {
        twinsSeen.add(twinId);
      }
    });

    const ruleIds = new Set<string>();
    scenario.rules.forEach((rule, index) => {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "id"],
          message: "Expected each scenario rule id only once.",
          input: rule.id,
        });
      } else {
        ruleIds.add(rule.id);
      }

      const definition = getFailure(rule.failureId);
      if (definition === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", index, "failureId"],
          message: `Expected one of the failure ids in the catalog.`,
          input: rule.failureId,
        });
        return;
      }

      const settings = definition.failureSettingsSchema.safeParse(rule.settings);
      if (!settings.success) {
        for (const issue of settings.error.issues) {
          ctx.addIssue({
            code: "custom",
            path: ["rules", index, "settings", ...issue.path],
            message: issue.message,
            input: rule.settings,
          });
        }
      }
    });

    scenario.steps.forEach((step, index) => {
      if (!ruleIds.has(step.removeRule)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "removeRule"],
          message: `Expected the id of a rule in this scenario.`,
          input: step.removeRule,
        });
      }
    });
  });

function scenarioError(fileName: string, issues: readonly z.core.$ZodIssue[]): IbejiError {
  const problems = issues.map(
    (issue) => `${fileName}: ${formatZodPath(issue.path)}: ${issue.message}`,
  );

  return new IbejiError("SCENARIO_INVALID", {
    what: `The scenario file "${fileName}" is not valid.`,
    why: problems.join("; "),
    fix: "Correct every field named in the error and load the scenario again.",
  });
}

export function parseScenario(raw: unknown, fileName: string): Scenario {
  const result = scenarioSchema.safeParse(raw);
  if (!result.success) {
    throw scenarioError(fileName, result.error.issues);
  }
  return result.data;
}

export function parseScenarioJson(text: string, fileName: string): Scenario {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new IbejiError("SCENARIO_INVALID", {
      what: `The scenario file "${fileName}" is not valid.`,
      why: `${fileName}: the file does not contain valid JSON.`,
      fix: "Correct the JSON syntax and load the scenario again.",
      cause: error,
    });
  }

  return parseScenario(raw, fileName);
}
