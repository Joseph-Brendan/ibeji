export type RunCliDeps = {
  readonly cwd?: string;
  readonly fetchImpl?: typeof fetch;
  readonly prompt?: {
    readonly ask: (question: string) => Promise<string>;
    readonly close: () => void;
  };
};

export function parseArgs(
  args: readonly string[],
):
  | { readonly ok: true; readonly service: "paystack" | "flutterwave" | "stripe" }
  | { readonly ok: false };

export function runCli(
  args: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  deps?: RunCliDeps,
): Promise<number>;
