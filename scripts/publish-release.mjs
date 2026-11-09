#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_RELEASE_DIR = join(homedir(), "ibeji-release");
const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const NPM_USER = "devanddesignhq";

function platformCommand(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      shell: options.shell ?? false,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr !== null) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      resolveRun({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

function commandArgs(prefix, args) {
  return [...prefix, ...args];
}

function stripVersion(value) {
  return value.trim().replace(/^"|"$/gu, "");
}

async function versionIsOnNpm(options) {
  const result = await run(
    options.npmCommand,
    commandArgs(options.npmArgsPrefix, [
      "view",
      `${options.name}@${options.version}`,
      "version",
      "--json",
    ]),
    { cwd: options.cwd, env: options.env, shell: options.shell },
  );
  if (result.code === 0) {
    return stripVersion(result.stdout) === options.version;
  }
  const detail = result.stderr.toLowerCase();
  if (detail.includes("e404") || detail.includes("404 not found")) {
    return false;
  }
  throw new Error(`npm view failed with exit code ${result.code}.`);
}

export async function checkVersionNotPublished(options) {
  if (await versionIsOnNpm(options)) {
    options.stderr.write(`${options.name}@${options.version} is already on npm.\n`);
    return false;
  }
  return true;
}

export async function checkNpmUser(options) {
  const result = await run(options.npmCommand, commandArgs(options.npmArgsPrefix, ["whoami"]), {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
  });
  if (result.code !== 0 || result.stdout.trim() !== NPM_USER) {
    options.stderr.write("You are not signed in to npm. Run: npm login\n");
    return false;
  }
  return true;
}

async function checkGitState(options) {
  const status = await options.git(["status", "--porcelain"]);
  if (status.code !== 0) {
    throw new Error(`git status failed with exit code ${status.code}.`);
  }
  if (status.stdout.trim() !== "") {
    return { clean: false, commit: "" };
  }
  const head = await options.git(["rev-parse", "HEAD"]);
  if (head.code !== 0) {
    throw new Error(`git rev-parse HEAD failed with exit code ${head.code}.`);
  }
  const commit = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error("git rev-parse HEAD did not return a full commit id.");
  }
  return { clean: true, commit };
}

async function sha256OfFile(filename) {
  return createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
}

function releaseRecord(packageInfo, commit, tarball, checksum) {
  return `## Release ${packageInfo.name}@${packageInfo.version} tarball

- Commit: \`${commit}\`
- Tarball: \`${tarball}\`
- SHA-256: \`${checksum}\`
`;
}

async function defaultBuild({ cwd, pnpmCommand, env, shell }) {
  const result = await run(pnpmCommand, ["build"], {
    cwd,
    env,
    shell,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.code !== 0) {
    throw new Error(`pnpm build failed with exit code ${result.code}.`);
  }
}

async function defaultPack({ cwd, releaseDir, pnpmCommand, env, shell }) {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  const result = await run(pnpmCommand, ["pack", "--json", "--pack-destination", releaseDir], {
    cwd,
    env,
    shell,
  });
  if (result.code !== 0) {
    throw new Error(`pnpm pack failed with exit code ${result.code}.`);
  }
  const packed = JSON.parse(result.stdout);
  const filename = resolve(releaseDir, basename(String(packed.filename)));
  const details = await stat(filename);
  if (!details.isFile()) {
    throw new Error(`the packed tarball is missing: ${filename}`);
  }
  return {
    name: String(packed.name),
    version: String(packed.version),
    filename,
    files: Array.isArray(packed.files)
      ? packed.files.map((file) => ({ path: String(file.path) }))
      : [],
  };
}

function questionText(packageName, version, tarball, files) {
  const fileLines = files.map((file) => `    ${file.path}`).join("\n");
  return `About to publish:
  package: ${packageName}@${version}
  tarball: ${tarball}
  files:
${fileLines}

`;
}

export async function confirmRelease(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const drainMs = options.drainMs ?? 150;
  const wait = options.delay ?? delay;
  const rl = createInterface({
    input,
    output,
    terminal: false,
  });
  let accepting = false;
  let settled = false;
  let finish;
  const answer = new Promise((resolveAnswer) => {
    finish = resolveAnswer;
  });
  rl.on("line", (line) => {
    if (accepting && !settled) {
      settled = true;
      finish(line);
    }
  });
  rl.on("close", () => {
    if (!settled) {
      settled = true;
      finish(undefined);
    }
  });

  // Anything typed before the prompt is ignored. The wait also lets the
  // terminal flush input that was already buffered.
  await wait(drainMs);
  accepting = true;
  output.write(options.question ?? "Type yes to publish: ");
  try {
    return await answer;
  } finally {
    rl.close();
  }
}

export async function waitForPublishedVersion(options) {
  const start = Date.now();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wait = options.sleep ?? delay;
  let lastError;
  while (Date.now() - start <= timeoutMs) {
    try {
      if (await versionIsOnNpm(options)) {
        options.stdout.write(`Confirmed: ${options.name}@${options.version} is on npm.\n`);
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - start + intervalMs > timeoutMs) {
      break;
    }
    await wait(intervalMs);
  }
  if (lastError !== undefined) {
    options.stderr.write(
      `npm view failed while waiting: ${lastError instanceof Error ? lastError.message : String(lastError)}\n`,
    );
  }
  options.stderr.write(`npm did not show ${options.name}@${options.version} within 5 minutes.\n`);
  return false;
}

export async function runRelease(options = {}) {
  const cwd = options.cwd ?? ROOT;
  const releaseDir = options.releaseDir ?? DEFAULT_RELEASE_DIR;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const npmCommand = options.npmCommand ?? platformCommand("npm");
  const npmArgsPrefix = options.npmArgsPrefix ?? [];
  const pnpmCommand = options.pnpmCommand ?? platformCommand("pnpm");
  const gitCommand = options.gitCommand ?? "git";
  const shell = options.shell ?? process.platform === "win32";
  const publishStdio = options.publishStdio ?? "inherit";
  const intervalMs = options.waitIntervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.waitTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wait = options.sleep ?? delay;
  const buildLogPath = options.buildLogPath ?? join(cwd, "BUILD-LOG.md");
  const git =
    options.git ??
    ((args) =>
      run(gitCommand, args, {
        cwd,
        env,
        shell,
      }));

  let packageInfo;
  try {
    packageInfo = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch (error) {
    stderr.write(`The package file could not be read: ${String(error)}\n`);
    return 1;
  }
  if (typeof packageInfo.name !== "string" || typeof packageInfo.version !== "string") {
    stderr.write("The package file has no name or version.\n");
    return 1;
  }

  const npmOptions = {
    cwd,
    env,
    shell,
    npmCommand,
    npmArgsPrefix,
    name: packageInfo.name,
    version: packageInfo.version,
    stdout,
    stderr,
  };

  try {
    if (!(await checkNpmUser(npmOptions))) {
      return 1;
    }
    if (!(await checkVersionNotPublished(npmOptions))) {
      return 1;
    }
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const build = options.build ?? (() => defaultBuild({ cwd, pnpmCommand, env, shell }));
  const pack = options.pack ?? (() => defaultPack({ cwd, releaseDir, pnpmCommand, env, shell }));
  let releaseCommit;
  try {
    const beforeBuild = await checkGitState({ git });
    if (!beforeBuild.clean) {
      stderr.write(
        "The working tree has uncommitted changes. Commit them before you release so the release file can be traced to a commit.\n",
      );
      return 1;
    }
    releaseCommit = beforeBuild.commit;
    await build();
    const beforePack = await checkGitState({ git });
    if (!beforePack.clean) {
      stderr.write(
        "The working tree changed while building. Commit the change before you release so the release file can be traced to a commit.\n",
      );
      return 1;
    }
    releaseCommit = beforePack.commit;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let packed;
  try {
    packed = await pack();
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (packed.name !== packageInfo.name || packed.version !== packageInfo.version) {
    stderr.write(
      `The packed tarball is ${packed.name}@${packed.version}, expected ${packageInfo.name}@${packageInfo.version}.\n`,
    );
    return 1;
  }
  try {
    const details = await stat(packed.filename);
    if (!details.isFile()) {
      throw new Error("not a file");
    }
  } catch {
    stderr.write(`The packed tarball is missing: ${packed.filename}\n`);
    return 1;
  }

  let checksum;
  try {
    checksum = await sha256OfFile(packed.filename);
  } catch (error) {
    stderr.write(
      `The packed tarball checksum could not be read: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 1;
  }

  stdout.write(`Release file:
  package: ${packageInfo.name}@${packageInfo.version}
  commit: ${releaseCommit}
  tarball: ${packed.filename}
  sha256: ${checksum}
`);
  try {
    await appendFile(
      buildLogPath,
      `\n${releaseRecord(packageInfo, releaseCommit, packed.filename, checksum)}`,
    );
  } catch (error) {
    stderr.write(
      `The release record could not be appended to ${buildLogPath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 1;
  }
  stdout.write(`Recorded the commit and checksum in ${buildLogPath}.\n`);

  stdout.write(questionText(packageInfo.name, packageInfo.version, packed.filename, packed.files));
  const answer =
    options.ask === undefined
      ? await confirmRelease({ input: options.input })
      : await options.ask();
  if (answer === undefined || answer.trim() !== "yes") {
    stdout.write(`Received: ${answer === undefined ? "<no answer>" : JSON.stringify(answer)}\n`);
    return 1;
  }

  const publish = await run(
    npmCommand,
    commandArgs(npmArgsPrefix, ["publish", basename(packed.filename)]),
    { cwd: releaseDir, env, shell, stdio: publishStdio === "inherit" ? "inherit" : "pipe" },
  );
  if (publish.code !== 0) {
    stderr.write(`npm publish failed with exit code ${publish.code}.\n`);
    return 1;
  }

  return (await waitForPublishedVersion({
    ...npmOptions,
    intervalMs,
    timeoutMs,
    sleep: wait,
  }))
    ? 0
    : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runRelease();
}
