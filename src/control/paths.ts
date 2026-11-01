import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { IbejiError } from "../core/errors.js";

export const IBEJI_FOLDER = ".ibeji";
export const CREDENTIALS_FILE = "credentials.json";
export const SESSION_FILE = "session.json";

export function ibejiDirectory(home: string): string {
  return join(home, IBEJI_FOLDER);
}

export function credentialsPath(home: string): string {
  return join(ibejiDirectory(home), CREDENTIALS_FILE);
}

export function sessionPath(home: string): string {
  return join(ibejiDirectory(home), SESSION_FILE);
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

export function isMissingFile(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

/**
 * Create ~/.ibeji as a private folder. On macOS and Linux this sets mode 700.
 * Windows ignores POSIX mode bits; the folder inherits the per-user ACL of the
 * user's profile, which is the protection described in BUILD-LOG.md.
 */
export async function ensureIbejiHome(home: string): Promise<string> {
  const directory = ibejiDirectory(home);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await chmod(directory, 0o700);
  }
  return directory;
}

/**
 * Write JSON through a temporary file in the same folder and rename it into
 * place, so a reader never sees a half-written file. Files are private.
 */
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  let renamed = false;

  try {
    await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(temporary, 0o600);
    }
    await rename(temporary, path);
    renamed = true;
  } finally {
    if (!renamed) {
      await rm(temporary, { force: true });
    }
  }
}

export type ReadJsonResult =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly value: unknown };

export async function readJsonFile(path: string): Promise<ReadJsonResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return { kind: "missing" };
    }
    throw new IbejiError("INTERNAL", {
      what: "An Ibeji file could not be read.",
      why: `The file at ${path} could not be read.`,
      fix: "Check the file's permissions and try again.",
      cause: error,
    });
  }

  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

export async function ensurePrivateFile(path: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, 0o600);
  }
}

export async function removePrivateFile(path: string): Promise<void> {
  await rm(path, { force: true });
}
