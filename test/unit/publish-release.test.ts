import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  confirmRelease,
  type PackedRelease,
  type ReleaseOptions,
  runRelease,
} from "../../scripts/publish-release.mjs";

const FAKE_NPM = join(process.cwd(), "test", "helpers", "fake-npm.mjs");

type Harness = {
  readonly options: ReleaseOptions;
  readonly statePath: string;
  readonly releaseDir: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly cleanup: () => Promise<void>;
};

async function makeHarness(overrides: Partial<ReleaseOptions> = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "ibeji-release-test-"));
  const statePath = join(directory, "npm-state.json");
  const releaseDir = join(directory, "release");
  await mkdir(releaseDir, { recursive: true });
  const packageInfo = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly name: string;
    readonly version: string;
  };
  const tarball = join(releaseDir, `${packageInfo.name}-${packageInfo.version}.tgz`);
  await writeFile(tarball, "fake tarball", "utf8");
  const out = new PassThrough();
  const err = new PassThrough();
  let stdout = "";
  let stderr = "";
  out.on("data", (chunk) => {
    stdout += String(chunk);
  });
  err.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const packed: PackedRelease = {
    name: packageInfo.name,
    version: packageInfo.version,
    filename: tarball,
    files: [{ path: "dist/cli.js" }],
  };
  const { env: envOverrides, ...rest } = overrides;
  const options: ReleaseOptions = {
    cwd: process.cwd(),
    releaseDir,
    stdout: out,
    stderr: err,
    env: {
      ...process.env,
      FAKE_NPM_STATE: statePath,
      FAKE_NPM_VIEW_MODE: "absent",
      FAKE_NPM_VERSION: packageInfo.version,
      ...(envOverrides ?? {}),
    },
    npmCommand: process.execPath,
    npmArgsPrefix: [FAKE_NPM],
    publishStdio: "pipe",
    build: async () => {},
    pack: async () => packed,
    ask: async () => "yes",
    sleep: async () => {},
    waitIntervalMs: 1,
    waitTimeoutMs: 20,
    ...rest,
  };
  return {
    options,
    statePath,
    releaseDir,
    stdout: () => stdout,
    stderr: () => stderr,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function stateOf(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe("release script checks", () => {
  it("stops when npm whoami is not devanddesignhq", async () => {
    const harness = await makeHarness({
      env: { ...process.env, FAKE_NPM_WHOAMI: "someone-else" },
      pack: async () => {
        throw new Error("pack must not run after a failed sign-in check");
      },
    });
    try {
      expect(await runRelease(harness.options)).toBe(1);
      expect(harness.stderr()).toContain("You are not signed in to npm. Run: npm login");
      expect(harness.stdout()).not.toContain("About to publish");
    } finally {
      await harness.cleanup();
    }
  });

  it("stops when this version is already on npm", async () => {
    const harness = await makeHarness({
      env: {
        ...process.env,
        FAKE_NPM_VIEW_MODE: "present",
        FAKE_NPM_VERSION: (
          JSON.parse(await readFile("package.json", "utf8")) as { readonly version: string }
        ).version,
      },
      pack: async () => {
        throw new Error("pack must not run when the version already exists");
      },
    });
    try {
      expect(await runRelease(harness.options)).toBe(1);
      expect(harness.stderr()).toContain("is already on npm");
      expect(harness.stdout()).not.toContain("About to publish");
    } finally {
      await harness.cleanup();
    }
  });

  it("stops when the packed tarball has the wrong version", async () => {
    const harness = await makeHarness({
      pack: async () => ({
        name: "ibeji",
        version: "9.9.9",
        filename: join(harnessReleaseDir(), "ibeji-9.9.9.tgz"),
        files: [],
      }),
    });
    try {
      expect(await runRelease(harness.options)).toBe(1);
      expect(harness.stderr()).toContain("expected ibeji@");
      expect(harness.stdout()).not.toContain("Type yes");
    } finally {
      await harness.cleanup();
    }
  });

  it("prints what it received and stops when the answer is not yes", async () => {
    const harness = await makeHarness({ ask: async () => "no" });
    try {
      expect(await runRelease(harness.options)).toBe(1);
      expect(harness.stdout()).toContain('Received: "no"');
      expect((await stateOf(harness.statePath)).published).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });

  it("stops after five minutes when npm never shows the version", async () => {
    const harness = await makeHarness();
    try {
      expect(await runRelease(harness.options)).toBe(1);
      expect(harness.stderr()).toContain("within 5 minutes");
      const state = await stateOf(harness.statePath);
      expect(state.published).toBe(true);
      expect(state.publishCwd).toBe(await realpath(harness.releaseDir));
    } finally {
      await harness.cleanup();
    }
  });

  it("publishes the tarball from the release folder and confirms the version", async () => {
    const harness = await makeHarness({
      env: {
        ...process.env,
        FAKE_NPM_VIEW_MODE: "absent-then-present",
        FAKE_NPM_VERSION: (
          JSON.parse(await readFile("package.json", "utf8")) as { readonly version: string }
        ).version,
      },
    });
    try {
      expect(await runRelease(harness.options)).toBe(0);
      expect(harness.stdout()).toContain("Confirmed: ibeji@");
      const state = await stateOf(harness.statePath);
      expect(state.published).toBe(true);
      expect(state.publishCwd).toBe(await realpath(harness.releaseDir));
    } finally {
      await harness.cleanup();
    }
  });
});

describe("release confirmation", () => {
  it("discards input typed before the question and waits for a fresh answer", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let prompt = "";
    input.write("yes\n");
    let sent = false;
    output.on("data", (chunk) => {
      prompt += String(chunk);
      if (!sent && prompt.includes("Type yes to publish")) {
        sent = true;
        input.write("no\n");
      }
    });
    const answer = confirmRelease({
      input,
      output,
      drainMs: 0,
      delay: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      },
    });
    expect(await answer).toBe("no");
    expect(prompt).toContain("Type yes to publish");
  });
});

function harnessReleaseDir(): string {
  return join(tmpdir(), "ibeji-release-test");
}
