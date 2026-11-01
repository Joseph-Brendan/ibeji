import { z } from "zod";

import { readJsonFile, removePrivateFile, sessionPath, writePrivateJson } from "./paths.js";

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
  | { readonly kind: "ok"; readonly value: SessionFile };

export async function writeSessionFile(home: string, value: SessionFile): Promise<void> {
  await writePrivateJson(sessionPath(home), value);
}

export async function readSessionFile(home: string): Promise<SessionFileRead> {
  const read = await readJsonFile(sessionPath(home));
  if (read.kind === "missing") {
    return { kind: "missing" };
  }
  if (read.kind === "invalid") {
    return { kind: "invalid" };
  }

  const parsed = sessionFileSchema.safeParse(read.value);
  return parsed.success ? { kind: "ok", value: parsed.data } : { kind: "invalid" };
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
