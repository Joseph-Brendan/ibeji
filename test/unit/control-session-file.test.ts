import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureIbejiHome,
  isMissingFile,
  readJsonFile,
  sessionPath,
  writePrivateJson,
} from "../../src/control/paths.js";
import {
  healthMatchesInstance,
  isProcessAlive,
  readSessionFile,
  sessionFileIsLive,
  writeSessionFile,
} from "../../src/control/session-file.js";

async function withHealthServer(
  body: string,
  status: number,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  try {
    await run(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("T6 session file helpers", () => {
  it("T6 checks process liveness", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_147_483_647)).toBe(false);
  });

  it("T6 accepts only a health answer with the same instance id", async () => {
    await withHealthServer(
      JSON.stringify({ ok: true, instance: "instance-1" }),
      200,
      async (port) => {
        expect(await healthMatchesInstance(port, "instance-1")).toBe(true);
        expect(await healthMatchesInstance(port, "instance-2")).toBe(false);
      },
    );

    await withHealthServer(
      JSON.stringify({ ok: false, instance: "instance-1" }),
      200,
      async (port) => {
        expect(await healthMatchesInstance(port, "instance-1")).toBe(false);
      },
    );

    await withHealthServer(JSON.stringify({ ok: true, instance: 7 }), 200, async (port) => {
      expect(await healthMatchesInstance(port, "7")).toBe(false);
    });

    await withHealthServer("not json", 200, async (port) => {
      expect(await healthMatchesInstance(port, "instance-1")).toBe(false);
    });

    await withHealthServer(
      JSON.stringify({ ok: true, instance: "instance-1" }),
      500,
      async (port) => {
        expect(await healthMatchesInstance(port, "instance-1")).toBe(false);
      },
    );

    const closed = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close(() => reject(new Error("expected a TCP address")));
          return;
        }
        server.close(() => resolve(address.port));
      });
    });
    expect(await healthMatchesInstance(closed, "instance-1")).toBe(false);
  });

  it("T6 combines liveness and the health answer", async () => {
    const value = {
      instanceId: "instance-1",
      processId: process.pid,
      ports: { control: 4400, twins: {} },
      token: "token",
      startTime: "2026-01-01T00:00:00.000Z",
      version: "0.0.0",
    };

    expect(await sessionFileIsLive(value, async () => true)).toBe(true);
    expect(await sessionFileIsLive(value, async () => false)).toBe(false);
    expect(await sessionFileIsLive({ ...value, processId: 2_147_483_647 }, async () => true)).toBe(
      false,
    );
  });

  it("T6 removes a temporary file when the atomic rename fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-atomic-"));
    try {
      const target = join(home, "target");
      await mkdir(target);
      await expect(writePrivateJson(target, { value: 1 })).rejects.toBeDefined();
      expect((await readdir(home)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 distinguishes a missing file from other read failures", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-read-"));
    try {
      expect(isMissingFile(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(true);
      expect(isMissingFile(new Error("other"))).toBe(false);
      expect(await readJsonFile(join(home, "missing.json"))).toEqual({ kind: "missing" });

      const directory = join(home, "directory");
      await mkdir(directory);
      await expect(readJsonFile(directory)).rejects.toMatchObject({ code: "INTERNAL" });

      const file = join(home, "file.json");
      await writePrivateJson(file, { value: 1 });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readJsonFile(file)).toEqual({ kind: "ok", value: { value: 1 } });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 reads a missing, invalid, and valid session file", async () => {
    const home = await mkdtemp(join(tmpdir(), "ibeji-session-file-"));
    try {
      expect(await readSessionFile(home)).toEqual({ kind: "missing" });

      await ensureIbejiHome(home);
      await writeFile(sessionPath(home), "{not json", "utf8");
      expect(await readSessionFile(home)).toEqual({ kind: "invalid" });

      await writeFile(sessionPath(home), JSON.stringify({ version: "0.0.0" }), "utf8");
      expect(await readSessionFile(home)).toEqual({ kind: "invalid" });

      const value = {
        instanceId: "instance-1",
        processId: process.pid,
        ports: { control: 4400, twins: { alpha: 4401 } },
        token: "token",
        startTime: "2026-01-01T00:00:00.000Z",
        version: "0.0.0",
      };
      await writeSessionFile(home, value);
      expect(await readSessionFile(home)).toEqual({ kind: "ok", value });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
