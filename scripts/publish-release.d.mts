import type { Readable } from "node:stream";

export const NPM_USER: "devanddesignhq";

export type ReleaseFile = { readonly path: string };

export type PackedRelease = {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly files: readonly ReleaseFile[];
};

export type ReleaseWriter = { readonly write: (text: string) => unknown };

export type GitResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type GitRunner = (args: readonly string[]) => Promise<GitResult>;

export type ReleaseOptions = {
  readonly cwd?: string;
  readonly releaseDir?: string;
  readonly stdout?: ReleaseWriter;
  readonly stderr?: ReleaseWriter;
  readonly input?: Readable;
  readonly env?: NodeJS.ProcessEnv;
  readonly npmCommand?: string;
  readonly npmArgsPrefix?: readonly string[];
  readonly pnpmCommand?: string;
  readonly gitCommand?: string;
  readonly git?: GitRunner;
  readonly shell?: boolean;
  readonly publishStdio?: "inherit" | "pipe";
  readonly waitIntervalMs?: number;
  readonly waitTimeoutMs?: number;
  readonly buildLogPath?: string;
  readonly build?: () => Promise<void>;
  readonly pack?: () => Promise<PackedRelease>;
  readonly ask?: () => Promise<string | undefined>;
  readonly sleep?: (milliseconds: number) => Promise<unknown>;
};

export function runRelease(options?: ReleaseOptions): Promise<number>;

export type ConfirmOptions = {
  readonly input?: Readable;
  readonly output?: ReleaseWriter;
  readonly question?: string;
  readonly drainMs?: number;
  readonly delay?: (milliseconds: number) => Promise<unknown>;
};

export function confirmRelease(options?: ConfirmOptions): Promise<string | undefined>;
