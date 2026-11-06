import type { Stats } from "node:fs";
import { chmod, stat } from "node:fs/promises";

import { z } from "zod";

import { IbejiError } from "../core/errors.js";
import {
  isMissingFile,
  readJsonFile,
  removePrivateFile,
  sessionPath,
  writePrivateJson,
} from "./paths.js";

export const sessionFileSchema = z.strictObject({
  instanceId: z.string().min(1),
  processId: z.number().int().positive(),
  ports: z.strictObject({
    control: z.number().int().min(1).max(65_535),
    twins: z.record(z.string(), z.number().int().min(1).max(65_535)),
  }),
  token: z.string().min(1),
  startTime: z.string().min(1),
  version: z.string().min(1),
});

export type SessionFile = z.infer<typeof sessionFileSchema>;

export type SessionFileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "ok";
      readonly value: SessionFile;
      readonly permissionsRepaired: boolean;
    };

function owningUserProblem(): IbejiError {
  return new IbejiError("SESSION_STALE", {
    what: "The saved session file belongs to another user.",
    why: "Ibeji refuses to read a session file owned by a different user, because its token belongs to that user.",
    fix: "Ask the file's owner to remove it, or remove it yourself only if you own the folder, then run ibeji start.",
  });
}

function permissionRepairProblem(path: string, cause: unknown): IbejiError {
  return new IbejiError("INTERNAL", {
    what: "The session file permissions could not be repaired.",
    why: `The file at ${path} is readable or writable by another user and Ibeji could not set mode 600.`,
    fix: `Run chmod 600 ${path} and try again.`,
    cause,
  });
}

/**
 * Every read checks the owner and mode on macOS and Linux. A user-owned file
 * that other users can reach is put back to mode 600. A file owned by another
 * user is refused rather than read.
 */
async function checkSessionPermissions(path: string): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }

  let details: Stats;
  try {
    details = await stat(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw new IbejiError("INTERNAL", {
      what: "The session file permissions could not be checked.",
      why: `The file at ${path} could not be inspected.`,
      fix: "Check the file's permissions and try again.",
      cause: error,
    });
  }

  const userId = process.getuid?.();
  if (userId !== undefined && details.uid !== userId) {
    throw owningUserProblem();
  }

  if ((details.mode & 0o077) === 0) {
    return false;
  }

  try {
    await chmod(path, 0o600);
  } catch (error) {
    throw permissionRepairProblem(path, error);
  }
  return true;
}

export async function writeSessionFile(home: string, value: SessionFile): Promise<void> {
  await writePrivateJson(sessionPath(home), value);
}

export async function readSessionFile(home: string): Promise<SessionFileRead> {
  const path = sessionPath(home);
  const permissionsRepaired = await checkSessionPermissions(path);
  const read = await readJsonFile(path);
  if (read.kind === "missing") {
    return { kind: "missing" };
  }
  if (read.kind === "invalid") {
    return { kind: "invalid" };
  }

  const parsed = sessionFileSchema.safeParse(read.value);
  return parsed.success
    ? { kind: "ok", value: parsed.data, permissionsRepaired }
    : { kind: "invalid" };
}

export async function removeSessionFile(home: string): Promise<void> {
  await removePrivateFile(sessionPath(home));
}

export function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

export type HealthCheck = (port: number, instanceId: string) => Promise<boolean>;

/**
 * Ask the running control server whether it is the instance named in the
 * session file. A missing answer, an error answer, or a different instance
 * means the file is stale.
 */
export async function healthMatchesInstance(port: number, instanceId: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/_ibeji/api/v1/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1_000),
    });
  } catch {
    return false;
  }

  if (!response.ok) {
    return false;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }

  if (typeof body !== "object" || body === null) {
    return false;
  }

  return (
    "ok" in body &&
    body.ok === true &&
    "instance" in body &&
    typeof body.instance === "string" &&
    body.instance === instanceId
  );
}

export async function sessionFileIsLive(
  value: SessionFile,
  healthCheck: HealthCheck = healthMatchesInstance,
): Promise<boolean> {
  if (!isProcessAlive(value.processId)) {
    return false;
  }
  return healthCheck(value.ports.control, value.instanceId);
}
