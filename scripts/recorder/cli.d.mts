import type { RecorderResult, ServiceMeta } from "./shared.mjs";

export type RunCliDeps = {
  readonly baseUrl?: string;
  readonly cwd?: string;
  readonly fetchImpl?: typeof fetch;
  readonly prompt?: {
    readonly ask: (question: string) => Promise<string>;
    readonly close: () => void;
  };
};

export function printSummary(results: readonly RecorderResult[]): void;

export function sharedPrefixServices(meta: ServiceMeta): readonly ServiceMeta[];

export function confirmSharedTestPrefix(
  meta: ServiceMeta,
  prompt: {
    readonly ask: (question: string) => Promise<string>;
    readonly close: () => void;
  },
): Promise<boolean>;

export function parseArgs(args: readonly string[]):
  | {
      readonly ok: true;
      readonly service: "paystack" | "flutterwave" | "stripe";
      readonly only?: string;
    }
  | { readonly ok: false };

export function runCli(
  args: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  deps?: RunCliDeps,
): Promise<number>;
