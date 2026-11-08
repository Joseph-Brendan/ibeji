#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IS_WINDOWS = process.platform === "win32";
const SAFE_ARGUMENT = /^[A-Za-z0-9_.:=/-]+$/u;

function runPnpm(args, options) {
  if (!IS_WINDOWS) {
    return execFileSync("pnpm", args, options);
  }
  for (const argument of args) {
    if (!SAFE_ARGUMENT.test(argument)) {
      throw new Error(`Refusing to run a pnpm argument with shell characters: ${argument}`);
    }
  }
  return execSync(["pnpm", ...args].join(" "), options);
}
const EXPECTED_FILES = [
  "dist/",
  "scenarios/",
  "README.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
  "CHANGELOG.md",
];
const EXPECTED_KEYWORDS = [
  "paystack",
  "flutterwave",
  "stripe",
  "testing",
  "webhooks",
  "ai-agents",
  "mcp",
  "nigeria",
  "africa",
  "payments",
];
const REQUIRED_ROOT_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
  "CHANGELOG.md",
];

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const problems = [];
  const packageFile = join(ROOT, "package.json");
  const pkg = JSON.parse(await readFile(packageFile, "utf8"));

  if (pkg.private === true) {
    problems.push("package.json private must be removed for a release");
  }
  if (pkg.version !== "0.1.0") {
    problems.push("package.json version must be 0.1.0");
  }
  if (pkg.name !== "ibeji") {
    problems.push("package.json name must be ibeji");
  }
  if (typeof pkg.description !== "string" || pkg.description.trim() === "") {
    problems.push("package.json description is missing");
  }
  if (pkg.license !== "MIT") {
    problems.push("package.json license must be MIT");
  }
  if (pkg.bin?.ibeji !== "./dist/cli.js") {
    problems.push("package.json bin.ibeji must be ./dist/cli.js");
  }
  if (!sameList(pkg.files ?? [], EXPECTED_FILES)) {
    problems.push(`package.json files must be exactly ${JSON.stringify(EXPECTED_FILES)}`);
  }
  if (pkg.engines?.node !== "^22.18.0 || >=24.11.0") {
    problems.push("package.json engines.node must be ^22.18.0 || >=24.11.0");
  }
  if (typeof pkg.packageManager !== "string" || !/^pnpm@10\./u.test(pkg.packageManager)) {
    problems.push("package.json packageManager must pin pnpm 10.x");
  }
  if ("exports" in pkg) {
    problems.push("package.json must not have an exports field");
  }
  if ("types" in pkg || "typings" in pkg) {
    problems.push("package.json must not have a types or typings field");
  }
  if (!sameList(pkg.keywords ?? [], EXPECTED_KEYWORDS)) {
    problems.push(`package.json keywords must be exactly ${JSON.stringify(EXPECTED_KEYWORDS)}`);
  }
  if (
    pkg.repository?.type !== "git" ||
    pkg.repository?.url !== "git+https://github.com/Joseph-Brendan/ibeji.git"
  ) {
    problems.push("package.json repository must point at the Ibeji GitHub repository");
  }
  if (pkg.homepage !== "https://github.com/Joseph-Brendan/ibeji#readme") {
    problems.push("package.json homepage is missing or wrong");
  }
  if (pkg.bugs?.url !== "https://github.com/Joseph-Brendan/ibeji/issues") {
    problems.push("package.json bugs.url is missing or wrong");
  }

  const cli = join(ROOT, "dist", "cli.js");
  if (!(await exists(cli))) {
    problems.push("dist/cli.js is missing; run pnpm build first");
  } else {
    const firstLine = (await readFile(cli, "utf8")).split("\n")[0];
    if (firstLine !== "#!/usr/bin/env node") {
      problems.push("dist/cli.js does not start with the Node shebang");
    }
  }
  const notices = join(ROOT, "THIRD-PARTY-NOTICES");
  if (!(await exists(notices))) {
    problems.push("THIRD-PARTY-NOTICES is missing");
  } else {
    const text = await readFile(notices, "utf8");
    if (!text.includes("IBM Plex") || !text.includes("SIL Open Font License")) {
      problems.push("THIRD-PARTY-NOTICES must contain the IBM Plex font licence");
    }
  }
  if (!(await exists(join(ROOT, "CHANGELOG.md")))) {
    problems.push("CHANGELOG.md is missing");
  }

  try {
    runPnpm(["exec", "publint", "--strict"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    problems.push("publint reported a problem");
  }

  try {
    let output;
    try {
      output = runPnpm(["audit", "--prod", "--json"], {
        cwd: ROOT,
        encoding: "utf8",
      });
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "stdout" in error &&
        error.stdout !== null &&
        error.stdout !== undefined
      ) {
        output = String(error.stdout);
      } else {
        throw error;
      }
    }
    const report = JSON.parse(output);
    const vulnerabilities = report?.metadata?.vulnerabilities;
    if (
      vulnerabilities === null ||
      typeof vulnerabilities !== "object" ||
      Array.isArray(vulnerabilities)
    ) {
      throw new Error("the audit output has no vulnerability counts");
    }
    const total = Object.values(vulnerabilities).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
    if (total > 0) {
      problems.push(
        `pnpm audit --prod found ${total} production advisor${
          total === 1 ? "y" : "ies"
        }: ${JSON.stringify(vulnerabilities)}`,
      );
    } else {
      console.log("PASS: pnpm audit --prod found no advisories.");
    }
  } catch (error) {
    problems.push(
      `pnpm audit --prod failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let packed;
  try {
    const output = runPnpm(["pack", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    packed = JSON.parse(output);
  } catch (error) {
    problems.push(`pnpm pack failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const tarball = packed === undefined ? undefined : resolve(ROOT, String(packed.filename ?? ""));
  try {
    if (packed !== undefined) {
      const packedPaths = packed.files.map((file) => file.path).sort();
      console.log("Packed files:");
      for (const path of packedPaths) {
        console.log(`  ${path}`);
      }

      const allowedTop = new Set([
        "dist",
        "scenarios",
        "package.json",
        "README.md",
        "LICENSE",
        "THIRD-PARTY-NOTICES",
        "CHANGELOG.md",
      ]);
      for (const path of packedPaths) {
        const top = path.split("/")[0];
        if (top === undefined || !allowedTop.has(top)) {
          problems.push(`unexpected packed path: ${path}`);
        }
      }

      for (const required of REQUIRED_ROOT_FILES) {
        if (!packedPaths.includes(required)) {
          problems.push(`required packed file is missing: ${required}`);
        }
      }
      for (const required of ["dist/cli.js", "dist/ui/index.html"]) {
        if (!packedPaths.includes(required)) {
          problems.push(`required packed file is missing: ${required}`);
        }
      }
      if (!packedPaths.some((path) => path.startsWith("dist/ui/assets/") && path.endsWith(".js"))) {
        problems.push("the packed UI has no JavaScript asset");
      }
      if (
        !packedPaths.some((path) => path.startsWith("dist/ui/assets/") && path.endsWith(".css"))
      ) {
        problems.push("the packed UI has no CSS asset");
      }
      if (!packedPaths.some((path) => path.endsWith(".woff2"))) {
        problems.push("the packed UI has no local font file");
      }
      if (
        !packedPaths.some(
          (path) => path.startsWith("dist/ui/assets/fonts/") && path.includes("LICENSE-IBM-Plex"),
        )
      ) {
        problems.push("the packed UI has no IBM Plex font licence file");
      }

      const repoScenarios = (await readdir(join(ROOT, "scenarios")))
        .filter((file) => file.endsWith(".json"))
        .sort();
      const packedScenarios = packedPaths
        .filter((path) => path.startsWith("scenarios/"))
        .map((path) => path.slice("scenarios/".length))
        .sort();
      if (!sameList(repoScenarios, packedScenarios)) {
        problems.push(
          `packed scenarios must match scenarios/*.json exactly (repo ${JSON.stringify(
            repoScenarios,
          )}, packed ${JSON.stringify(packedScenarios)})`,
        );
      }
    }
  } finally {
    if (tarball !== undefined && tarball !== ROOT) {
      await rm(tarball, { force: true });
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`FAIL: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("PASS: package fields, publint and the packed file list match SPEC.md C16.");
}

await main();
