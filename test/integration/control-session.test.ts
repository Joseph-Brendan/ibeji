import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { credentialsPath, ensureIbejiHome, sessionPath } from "../../src/control/paths.js";
import { type RunningSession, startSession } from "../../src/control/session.js";
import { readSessionFile } from "../../src/control/session-file.js";
import { FakeClock } from "../../src/core/clock.js";
import { Logger } from "../../src/core/logger.js";
import { registry } from "../../src/twins/registry.js";

function zeroPorts(): Record<string, number> {
  const ports: Record<string, number> = { control: 0 };
  for (const definition of registry.list()) {
    ports[definition.id] = 0;
  }
  return ports;
}

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ibeji-session-"));
}

async function start(
  home: string,
  options: {
    readonly twins?: readonly string[];
    readonly ports?: Readonly<Record<string, number>>;
    readonly logs?: string[];
    readonly seed?: number;
    readonly webhookUrls?: Readonly<Record<string, string>>;
  } = {},
): Promise<RunningSession> {
  const logs = options.logs ?? [];
  return startSession({
    home,
    clock: new FakeClock(1_700_000_000_000),
    handleSignals: false,
    twins: options.twins,
    ports: options.ports ?? zeroPorts(),
    seed: options.seed,
    webhookUrls: options.webhookUrls,
    logger: new Logger({ level: "debug", write: (line) => logs.push(line) }),
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("expected a TCP address")));
        return;
      }
      server.close((error) => {
        if (error === undefined) {
          resolve(address.port);
        } else {
          reject(error);
        }
      });
    });
  });
}

function occupyPort(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe("T6 session file, credentials and ports", () => {
  it("T6 writes the session file with mode 600, uses an atomic name, and removes it on stop", async () => {
    const home = await makeHome();
    const session = await start(home);
    try {
      const file = await readFile(sessionPath(home), "utf8");
      const value = JSON.parse(file) as Record<string, unknown>;
      expect(value.instanceId).toBe(session.instanceId);
      expect(value.processId).toBe(process.pid);
      expect(value.token).toBe(session.token);
      expect(value.version).toBe("0.0.0");
      expect(typeof value.startTime).toBe("string");
      expect(value.ports).toMatchObject({
        control: session.addresses.control.port,
      });

      if (process.platform !== "win32") {
        // Windows has no POSIX mode bits; these paths inherit the user's profile ACL.
        expect((await stat(sessionPath(home))).mode & 0o777).toBe(0o600);
        expect((await stat(join(home, ".ibeji"))).mode & 0o777).toBe(0o700);
      }
      expect((await readdir(join(home, ".ibeji"))).sort()).toEqual([
        "credentials.json",
        "session.json",
      ]);

      await session.control.stop();
      await session.control.stop();
      await session.stop();
      await expect(readFile(sessionPath(home), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await session.stop();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 keeps credentials across restarts and rotates one twin or all", async () => {
    const home = await makeHome();
    try {
      const first = await start(home);
      const firstCredentials = first.credentials;
      const firstFile = JSON.parse(await readFile(credentialsPath(home), "utf8")) as unknown;
      expect(firstFile).toMatchObject({ version: 1 });
      if (process.platform !== "win32") {
        // Windows has no POSIX mode bits; the file inherits the user's profile ACL.
        expect((await stat(credentialsPath(home))).mode & 0o777).toBe(0o600);
      }
      await first.stop();

      const second = await start(home);
      expect(second.credentials).toEqual(firstCredentials);
      const before = second.credentialsStore.all();
      const rotated = await second.credentialsStore.rotate("paystack");
      expect(rotated).toEqual(["paystack"]);
      expect(second.credentialsStore.get("paystack")).not.toEqual(before.paystack);
      expect(second.credentialsStore.get("flutterwave")).toEqual(before.flutterwave);

      const rotatedPaystack = second.credentialsStore.get("paystack");
      await second.stop();

      const third = await start(home);
      expect(third.credentialsStore.get("paystack")).toEqual(rotatedPaystack);

      const allRotated = await third.credentialsStore.rotate();
      expect(allRotated).toEqual(["paystack", "flutterwave"]);
      await third.stop();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 creates credentials for every registered twin even when only one starts", async () => {
    const home = await makeHome();
    try {
      const session = await start(home, { twins: ["paystack"] });
      try {
        const file = JSON.parse(await readFile(credentialsPath(home), "utf8")) as {
          twins: Record<string, unknown>;
        };
        expect(Object.keys(file.twins).sort()).toEqual(["flutterwave", "paystack"]);
        expect(session.credentials.flutterwave).toBeDefined();
        expect(session.twins.has("flutterwave")).toBe(false);
        expect(session.credentialsStore.views("flutterwave")).toHaveLength(3);
      } finally {
        await session.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 refuses a second start while a live session answers health with its instance", async () => {
    const home = await makeHome();
    try {
      const first = await start(home);
      try {
        await expect(start(home)).rejects.toMatchObject({ code: "SESSION_ALREADY_RUNNING" });
        expect(first.control.address.port).toBeGreaterThan(0);
      } finally {
        await first.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 removes a stale session file, notes it, and continues", async () => {
    const home = await makeHome();
    const logs: string[] = [];
    try {
      await ensureIbejiHome(home);
      await writeFile(
        sessionPath(home),
        JSON.stringify({
          instanceId: "stale-instance",
          processId: 2_147_483_647,
          ports: { control: 1, twins: {} },
          token: "stale-token",
          startTime: "2020-01-01T00:00:00.000Z",
          version: "0.0.0",
        }),
        { mode: 0o600 },
      );

      const session = await start(home, { logs });
      try {
        expect(session.notes).toContain("Removed a stale session file.");
        expect(logs.some((line) => line.includes("Removed a stale session file."))).toBe(true);
        expect(session.instanceId).not.toBe("stale-instance");
      } finally {
        await session.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 removes an invalid session file as stale", async () => {
    const home = await makeHome();
    try {
      await ensureIbejiHome(home);
      await writeFile(sessionPath(home), "{not json", { mode: 0o600 });
      const session = await start(home);
      try {
        expect(session.notes).toContain("Removed an invalid session file.");
      } finally {
        await session.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 treats a live process whose health instance differs as stale", async () => {
    const home = await makeHome();
    const fake = createHttpServer((request, response) => {
      if (request.url === "/_ibeji/api/v1/health") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true, instance: "another-instance" }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    try {
      await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
      const address = fake.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a TCP address");
      }

      await ensureIbejiHome(home);
      await writeFile(
        sessionPath(home),
        JSON.stringify({
          instanceId: "expected-instance",
          processId: process.pid,
          ports: { control: address.port, twins: {} },
          token: "stale-token",
          startTime: "2020-01-01T00:00:00.000Z",
          version: "0.0.0",
        }),
        { mode: 0o600 },
      );

      const session = await start(home);
      try {
        expect(session.notes).toContain("Removed a stale session file.");
      } finally {
        await session.stop();
      }
    } finally {
      await new Promise<void>((resolve) => fake.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 rejects an unknown twin, an unknown port name, and an invalid seed", async () => {
    const home = await makeHome();
    try {
      await expect(start(home, { twins: ["missing"] })).rejects.toMatchObject({
        code: "UNKNOWN_TWIN",
      });
      await expect(
        start(home, { twins: ["paystack"], ports: { control: 0, missing: 0 } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(start(home, { seed: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 rejects an invalid port value and the same port requested twice", async () => {
    const home = await makeHome();
    try {
      await expect(
        start(home, {
          twins: ["paystack"],
          ports: { control: 70_000, paystack: 0 },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const shared = await freePort();
      await expect(
        start(home, {
          twins: ["paystack", "flutterwave"],
          ports: { control: 0, paystack: shared, flutterwave: shared },
        }),
      ).rejects.toMatchObject({
        code: "PORT_IN_USE",
        what: expect.stringContaining(String(shared)),
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 validates initial webhook URLs and warns when public addresses are allowed", async () => {
    const home = await makeHome();
    const logs: string[] = [];
    try {
      await expect(
        start(home, {
          webhookUrls: { paystack: "http://0.0.0.0:3000/hook" },
          logs,
        }),
      ).rejects.toMatchObject({ code: "WEBHOOK_URL_NOT_ALLOWED" });

      const session = await startSession({
        home,
        clock: new FakeClock(1_700_000_000_000),
        handleSignals: false,
        ports: zeroPorts(),
        allowPublicWebhooks: true,
        webhookUrls: { paystack: "http://127.0.0.1:3000/hook" },
        logger: new Logger({ level: "debug", write: (line) => logs.push(line) }),
      });
      try {
        expect(logs.some((line) => line.includes("Public webhook addresses are allowed"))).toBe(
          true,
        );
        const response = await fetch(
          `${session.addresses.control.url}/_ibeji/api/v1/twins/paystack/webhook-url`,
          { headers: { authorization: `Bearer ${session.token}` } },
        );
        expect(await response.json()).toEqual({
          twin: "paystack",
          url: "http://127.0.0.1:3000/hook",
        });

        const freshLink = session.createLaunchLink();
        expect(freshLink).toContain("/?launch=");
        expect(freshLink).not.toContain(session.token);
      } finally {
        await session.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 installs and removes SIGINT, SIGTERM and exit handlers on the default setting", async () => {
    const home = await makeHome();
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const beforeExit = process.listenerCount("exit");
    try {
      const session = await startSession({
        home,
        clock: new FakeClock(1_700_000_000_000),
        ports: zeroPorts(),
      });
      expect(process.listenerCount("SIGINT")).toBe(beforeSigint + 1);
      expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm + 1);
      expect(process.listenerCount("exit")).toBe(beforeExit + 1);
      await session.stop();
      expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
      expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
      expect(process.listenerCount("exit")).toBe(beforeExit);
      await session.stop();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 returns the requested seed, instance id and version", async () => {
    const home = await makeHome();
    try {
      const session = await startSession({
        home,
        clock: new FakeClock(1_700_000_000_000),
        handleSignals: false,
        ports: zeroPorts(),
        seed: 12_345,
        instanceId: "fixed-instance",
        version: "9.9.9",
      });
      try {
        expect(session.seed).toBe(12_345);
        expect(session.instanceId).toBe("fixed-instance");
        expect(session.version).toBe("9.9.9");
        const status = await fetch(`${session.addresses.control.url}/_ibeji/api/v1/status`, {
          headers: { authorization: `Bearer ${session.token}` },
        });
        expect(await status.json()).toMatchObject({
          seed: 12_345,
          instance: "fixed-instance",
          version: "9.9.9",
        });
      } finally {
        await session.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 allows a private webhook address only with the private flag", async () => {
    const home = await makeHome();
    try {
      const session = await startSession({
        home,
        clock: new FakeClock(1_700_000_000_000),
        handleSignals: false,
        ports: zeroPorts(),
        allowPrivateWebhooks: true,
        webhookUrls: { paystack: "http://10.0.0.1:3000/hook" },
      });
      try {
        const response = await fetch(
          `${session.addresses.control.url}/_ibeji/api/v1/twins/paystack/webhook-url`,
          { headers: { authorization: `Bearer ${session.token}` } },
        );
        expect(await response.json()).toEqual({
          twin: "paystack",
          url: "http://10.0.0.1:3000/hook",
        });
      } finally {
        await session.stop();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 removes its session file from the exit handler", async () => {
    const home = await makeHome();
    const before = process.listenerCount("exit");
    const session = await startSession({
      home,
      clock: new FakeClock(1_700_000_000_000),
      ports: zeroPorts(),
    });
    try {
      const listeners = process.listeners("exit");
      const handler = listeners[listeners.length - 1];
      if (handler === undefined) {
        throw new Error("expected the exit handler");
      }
      handler(0);
      await expect(readFile(sessionPath(home), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await session.stop();
      expect(process.listenerCount("exit")).toBe(before);
    } finally {
      await session.stop();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 removes the session file when the SIGINT handler runs", async () => {
    const home = await makeHome();
    const before = process.listenerCount("SIGINT");
    const session = await startSession({
      home,
      clock: new FakeClock(1_700_000_000_000),
      ports: zeroPorts(),
    });
    try {
      const listeners = process.listeners("SIGINT");
      const handler = listeners[listeners.length - 1];
      if (handler === undefined) {
        throw new Error("expected the SIGINT handler");
      }
      handler("SIGINT");

      for (let attempt = 0; attempt < 200; attempt += 1) {
        if ((await readSessionFile(home)).kind === "missing") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect((await readSessionFile(home)).kind).toBe("missing");
      await expect(fetch(session.addresses.control.url)).rejects.toThrow();
      await session.stop();
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally {
      process.exitCode = undefined;
      await session.stop();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 PORT_IN_USE names the control port and leaves nothing running", async () => {
    const home = await makeHome();
    const occupied = await occupyPort(0);
    const occupiedAddress = occupied.address();
    if (occupiedAddress === null || typeof occupiedAddress === "string") {
      throw new Error("expected a TCP address");
    }
    const twinPort = await freePort();
    try {
      await expect(
        start(home, {
          twins: ["paystack"],
          ports: { control: occupiedAddress.port, paystack: twinPort },
        }),
      ).rejects.toMatchObject({
        code: "PORT_IN_USE",
        what: expect.stringContaining(String(occupiedAddress.port)),
        fix: expect.stringContaining("--port"),
      });

      await expect(readFile(sessionPath(home), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(credentialsPath(home), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      const probe = await occupyPort(twinPort);
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("T6 PORT_IN_USE names a taken twin port and its flag", async () => {
    const home = await makeHome();
    const controlPort = await freePort();
    const occupied = await occupyPort(0);
    const occupiedAddress = occupied.address();
    if (occupiedAddress === null || typeof occupiedAddress === "string") {
      throw new Error("expected a TCP address");
    }
    try {
      await expect(
        start(home, {
          twins: ["paystack"],
          ports: { control: controlPort, paystack: occupiedAddress.port },
        }),
      ).rejects.toMatchObject({
        code: "PORT_IN_USE",
        what: expect.stringContaining(String(occupiedAddress.port)),
        fix: expect.stringContaining("--twin-port paystack="),
      });

      const probe = await occupyPort(controlPort);
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });
});
