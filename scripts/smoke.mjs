#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IS_WINDOWS = process.platform === "win32";
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";
const NPX = IS_WINDOWS ? "npx.cmd" : "npx";
const PNPM = IS_WINDOWS ? "pnpm.cmd" : "pnpm";
const STEP_NAMES = [
  "build and pack",
  "fresh temporary folder with a space and a non-English letter",
  "npm init and install the packed file",
  "installed tree has no native code or payment libraries",
  "npx ibeji --help",
  "start Ibeji on random free ports",
  "dashboard and its sign-in refusal",
  "payments through every registered twin",
  "safe app ignores duplicate webhooks",
  "status and MCP stdout",
  "stop, session cleanup and temporary folder removal",
];
const BANNED_PACKAGES = new Set([
  "@paystack/paystack-sdk",
  "paystack",
  "paystack-sdk",
  "paystack-node",
  "paystack-api",
  "flutterwave-node-v3",
  "flutterwave-node",
  "flutterwave-node-v4",
  "flutterwave",
  "stripe",
  "@stripe/stripe-js",
  "@stripe/react-stripe-js",
]);
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

const state = {
  tempRoot: undefined,
  smokeDir: undefined,
  home: undefined,
  tarballInRepo: undefined,
  startChild: undefined,
  startLines: [],
  session: undefined,
  startJson: undefined,
  apps: new Set(),
  cleaned: false,
};
const completed = new Set();
let activeStep = "";
let failed = false;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await check();
    if (value !== undefined && value !== false) {
      return value;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label} after ${timeoutMs}ms`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WINDOWS,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`${command} ${args.join(" ")} timed out`));
    }, options.timeout ?? 120_000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectRun(
          new Error(
            `${command} ${args.join(" ")} exited with code ${String(code)} signal ${String(
              signal,
            )}\n${stderr}\n${stdout}`,
          ),
        );
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

function spawnOutput(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    shell: options.shell ?? IS_WINDOWS,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      resolveExit();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(IS_WINDOWS ? "SIGINT" : "SIGTERM");
  await waitForExit(child, 5_000);
  if (child.exitCode === null && child.signalCode === null) {
    killTree(child);
    await waitForExit(child, 2_000);
  }
}

async function stopApp(app) {
  state.apps.delete(app);
  await stopChild(app.child);
}

function cliEnv() {
  return {
    ...process.env,
    HOME: state.home,
    USERPROFILE: state.home,
    NO_COLOR: "1",
  };
}

async function readSession() {
  const path = join(state.home, ".ibeji", "session.json");
  await waitFor(() => exists(path), 5_000, "the session file");
  return JSON.parse(await readFile(path, "utf8"));
}

async function startIbeji() {
  const args = [
    "--no-install",
    "ibeji",
    "start",
    "--no-open",
    "--json",
    "--port",
    "0",
    "--twin-port",
    "paystack=0",
    "--twin-port",
    "flutterwave=0",
  ];
  const processInfo = spawnOutput(NPX, args, {
    cwd: state.smokeDir,
    env: cliEnv(),
    stdin: "ignore",
  });
  state.startChild = processInfo.child;

  const startJson = await new Promise((resolveStart, rejectStart) => {
    const reader = createInterface({ input: processInfo.child.stdout });
    let settled = false;
    const finish = (action) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      processInfo.child.off("exit", onExit);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        rejectStart(new Error(`Ibeji did not start within 20 seconds.\n${processInfo.stderr}`));
      });
    }, 20_000);
    const onExit = (code, signal) => {
      finish(() => {
        rejectStart(
          new Error(
            `Ibeji exited during startup with code ${String(code)} signal ${String(
              signal,
            )}.\n${processInfo.stderr}`,
          ),
        );
      });
    };
    processInfo.child.once("exit", onExit);
    reader.on("line", (line) => {
      state.startLines.push(line);
      if (!line.startsWith("{")) {
        return;
      }
      let value;
      try {
        value = JSON.parse(line);
      } catch (error) {
        if (error instanceof SyntaxError) {
          return;
        }
        throw error;
      }
      if (typeof value === "object" && value !== null && value.ok === true) {
        finish(() => resolveStart(value));
      }
    });
  });

  const session = await readSession();
  if (typeof session.token !== "string" || session.token.length === 0) {
    throw new Error("the session file has no token");
  }
  if (!Number.isInteger(session.processId)) {
    throw new Error("the session file has no process id");
  }
  state.session = session;
  state.startJson = startJson;

  const controlUrl = startJson.addresses?.control?.url;
  if (typeof controlUrl !== "string") {
    throw new Error("the start output has no control address");
  }
  const health = await fetch(`${controlUrl}/_ibeji/api/v1/health`);
  if (!health.ok) {
    throw new Error(`the control health check answered HTTP ${health.status}`);
  }
  return startJson;
}

function twinEnv(twinId) {
  const address = state.startJson.addresses.twins[twinId];
  const credentials = state.startJson.credentials[twinId];
  if (address === undefined || credentials === undefined) {
    throw new Error(`the session has no address or credentials for ${twinId}`);
  }
  const prefix = `IBEJI_${twinId.toUpperCase()}`;
  const env = {
    PAYMENT_PROVIDER: twinId,
    APP_MODE: "safe",
    PORT: "0",
    [`${prefix}_BASE_URL`]: address.url,
    [`${prefix}_PUBLIC_KEY`]: credentials.public,
    [`${prefix}_SECRET_KEY`]: credentials.secret,
  };
  if (twinId === "flutterwave") {
    env.IBEJI_FLUTTERWAVE_WEBHOOK_HASH = credentials.webhook;
  }
  return env;
}

async function startApp(twinId) {
  if (twinId !== "paystack" && twinId !== "flutterwave") {
    throw new Error(`the example app does not support ${twinId} in version 0.1.0`);
  }
  const processInfo = spawnOutput(process.execPath, [join("school-fees-app", "server.js")], {
    cwd: state.smokeDir,
    env: { ...process.env, HOME: state.home, USERPROFILE: state.home, ...twinEnv(twinId) },
    stdin: "ignore",
    shell: false,
  });
  const app = { child: processInfo.child, url: "" };
  state.apps.add(app);

  const url = await new Promise((resolveApp, rejectApp) => {
    const reader = createInterface({ input: processInfo.child.stdout });
    let settled = false;
    const finish = (action) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      processInfo.child.off("exit", onExit);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        rejectApp(
          new Error(`the example app did not start within 10 seconds.\n${processInfo.stderr}`),
        );
      });
    }, 10_000);
    const onExit = (code, signal) => {
      finish(() => {
        rejectApp(
          new Error(
            `the example app exited during startup with code ${String(code)} signal ${String(
              signal,
            )}.\n${processInfo.stderr}`,
          ),
        );
      });
    };
    processInfo.child.once("exit", onExit);
    reader.on("line", (line) => {
      const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(line);
      if (match?.[1] !== undefined) {
        finish(() => resolveApp(`http://127.0.0.1:${match[1]}`));
      }
    });
  });

  app.url = url;
  return app;
}

async function setWebhook(twinId, app) {
  await runCommand(
    NPX,
    ["--no-install", "ibeji", "webhook-url", twinId, `${app.url}/webhooks/${twinId}`],
    { cwd: state.smokeDir, env: cliEnv(), timeout: 20_000 },
  );
}

async function appState(appUrl) {
  const response = await fetch(`${appUrl}/state`);
  if (!response.ok) {
    throw new Error(`the example app state answered HTTP ${response.status}`);
  }
  return await response.json();
}

function studentOf(appStateValue, studentId) {
  const student = appStateValue.students?.find((item) => item.id === studentId);
  if (student === undefined) {
    throw new Error(`the example app has no student ${studentId}`);
  }
  return student;
}

async function startPayment(appUrl, studentId) {
  const response = await fetch(`${appUrl}/pay/${encodeURIComponent(studentId)}`, {
    method: "POST",
    redirect: "manual",
  });
  if (response.status !== 303) {
    throw new Error(`starting the payment answered HTTP ${response.status}`);
  }
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("the example app did not return a checkout link");
  }
  return new URL(location);
}

async function completeCheckout(checkout) {
  const response = await fetch(checkout, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: checkout.origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "outcome=success",
  });
  await response.text();
  if (response.status !== 200 && response.status !== 303) {
    throw new Error(`the Ibeji checkout answered HTTP ${response.status}`);
  }
}

async function payAndWait(app, studentId) {
  const checkout = await startPayment(app.url, studentId);
  await completeCheckout(checkout);
  return await waitFor(
    async () => {
      const current = await appState(app.url);
      const student = studentOf(current, studentId);
      return student.paid && student.payments.length >= 1 ? student : undefined;
    },
    15_000,
    `${studentId} to be marked paid`,
  );
}

async function controlJson(path) {
  const response = await fetch(`${state.startJson.addresses.control.url}/_ibeji/api/v1${path}`, {
    headers: { authorization: `Bearer ${state.session.token}` },
  });
  if (!response.ok) {
    throw new Error(`the control API answered HTTP ${response.status} for ${path}`);
  }
  return await response.json();
}

async function dashboardStep() {
  const launchLink = state.startJson.launchLink;
  if (typeof launchLink !== "string") {
    throw new Error("the start output has no dashboard link");
  }
  const launch = await fetch(launchLink, { redirect: "manual" });
  const launchHtml = await launch.text();
  if (launch.status !== 200 || !launchHtml.includes('<div id="root"></div>')) {
    throw new Error("the dashboard link did not return the UI");
  }

  const code = new URL(launchLink).searchParams.get("launch");
  if (code === null) {
    throw new Error("the dashboard link has no launch code");
  }
  const exchange = await fetch(
    `${state.startJson.addresses.control.url}/_ibeji/api/v1/auth/exchange`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    },
  );
  const cookieHeader = exchange.headers.get("set-cookie");
  if (exchange.status !== 200 || cookieHeader === null) {
    throw new Error("the launch code could not be exchanged for a dashboard session");
  }
  const cookie = cookieHeader.split(";")[0];
  if (!cookie.startsWith("ibeji_ui=")) {
    throw new Error("the dashboard session cookie has the wrong name");
  }

  const withCookie = await fetch(`${state.startJson.addresses.control.url}/`, {
    headers: { cookie },
  });
  const withCookieHtml = await withCookie.text();
  if (withCookie.status !== 200 || !withCookieHtml.includes("<title>Ibeji</title>")) {
    throw new Error("the dashboard did not return the UI with a valid session");
  }

  const apiWithCookie = await fetch(
    `${state.startJson.addresses.control.url}/_ibeji/api/v1/twins`,
    { headers: { cookie } },
  );
  if (apiWithCookie.status !== 200) {
    throw new Error(`the dashboard API answered HTTP ${apiWithCookie.status} with a session`);
  }

  const apiWithoutCookie = await fetch(
    `${state.startJson.addresses.control.url}/_ibeji/api/v1/twins`,
  );
  if (apiWithoutCookie.status !== 401) {
    throw new Error(`the dashboard API answered HTTP ${apiWithoutCookie.status} without a session`);
  }
}

async function walk(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
}

async function auditInstalledTree() {
  const nodeModules = join(state.smokeDir, "node_modules");
  const files = [];
  await walk(nodeModules, files);

  const problems = [];
  const packages = [];
  for (const file of files) {
    if (file.endsWith(".node")) {
      problems.push(`native file found: ${file}`);
    }
    if (file.endsWith("binding.gyp")) {
      problems.push(`native build file found: ${file}`);
    }
    if (file.endsWith("package.json")) {
      let pkg;
      try {
        pkg = JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (error instanceof SyntaxError) {
          continue;
        }
        throw error;
      }
      if (typeof pkg.name === "string") {
        packages.push(pkg.name);
        if (BANNED_PACKAGES.has(pkg.name)) {
          problems.push(`payment library found in the installed tree: ${pkg.name}`);
        }
      }
      for (const script of INSTALL_SCRIPTS) {
        if (typeof pkg.scripts?.[script] === "string" && pkg.scripts[script].trim() !== "") {
          problems.push(`install script found in ${pkg.name ?? file}: ${script}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
  console.log(`Audited ${packages.length} installed package.json files.`);
}

async function mcpStep() {
  const processInfo = spawnOutput(NPX, ["--no-install", "ibeji", "mcp"], {
    cwd: state.smokeDir,
    env: cliEnv(),
    stdin: "pipe",
  });
  const lines = [];
  let toolsCount = 0;

  const response = await new Promise((resolveMcp, rejectMcp) => {
    if (processInfo.child.stdin === null) {
      rejectMcp(new Error("the MCP process has no stdin"));
      return;
    }
    const reader = createInterface({ input: processInfo.child.stdout });
    let settled = false;
    const finish = (action) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      processInfo.child.off("exit", onExit);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        rejectMcp(
          new Error(`the MCP server did not answer within 5 seconds.\n${processInfo.stderr}`),
        );
      });
    }, 5_000);
    const onExit = (code, signal) => {
      finish(() => {
        rejectMcp(
          new Error(
            `the MCP server exited early with code ${String(code)} signal ${String(
              signal,
            )}.\n${processInfo.stderr}`,
          ),
        );
      });
    };
    processInfo.child.once("exit", onExit);
    reader.on("line", (line) => {
      lines.push(line);
      let value;
      try {
        value = JSON.parse(line);
      } catch (error) {
        if (error instanceof SyntaxError) {
          finish(() => rejectMcp(new Error("the MCP server wrote a non-JSON line to stdout")));
          return;
        }
        throw error;
      }
      if (value?.id === 2 && Array.isArray(value.result?.tools)) {
        toolsCount = value.result.tools.length;
        finish(() => resolveMcp(value));
      }
    });
    processInfo.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "ibeji-smoke", version: "1.0.0" },
        },
      })}\n`,
    );
    processInfo.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    processInfo.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
    );
  });

  if (toolsCount < 13) {
    throw new Error(`the MCP server listed ${toolsCount} tools, expected 13`);
  }
  if (response === undefined) {
    throw new Error("the MCP server did not return a tools list");
  }

  await delay(2_000);
  processInfo.child.stdin.end();
  await waitForExit(processInfo.child, 5_000);
  if (processInfo.child.exitCode === null && processInfo.child.signalCode === null) {
    killTree(processInfo.child);
    await waitForExit(processInfo.child, 2_000);
  }

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("the MCP server wrote a non-JSON line to stdout");
      }
      throw error;
    }
    if (parsed?.jsonrpc !== "2.0") {
      throw new Error("the MCP server wrote a line that is not JSON-RPC 2.0 to stdout");
    }
  }
  console.log(`Checked ${lines.length} stdout lines from the MCP server.`);
}

async function cleanup() {
  const problems = [];
  for (const app of [...state.apps]) {
    try {
      await stopApp(app);
    } catch (error) {
      problems.push(`could not stop the example app: ${messageOf(error)}`);
    }
  }

  if (state.session !== undefined) {
    try {
      process.kill(state.session.processId, "SIGINT");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
        problems.push(`could not signal the Ibeji process: ${messageOf(error)}`);
      }
    }
  }
  if (state.startChild !== undefined) {
    await waitForExit(state.startChild, 10_000);
    if (state.startChild.exitCode === null && state.startChild.signalCode === null) {
      killTree(state.startChild);
      await waitForExit(state.startChild, 2_000);
      problems.push("Ibeji did not stop when asked");
    }
  }

  if (state.home !== undefined) {
    const sessionFile = join(state.home, ".ibeji", "session.json");
    if (await exists(sessionFile)) {
      problems.push("the session file was not removed after Ibeji stopped");
    }
  }

  if (state.tarballInRepo !== undefined) {
    try {
      await rm(state.tarballInRepo, { force: true });
    } catch (error) {
      problems.push(`could not remove the pack file: ${messageOf(error)}`);
    }
  }
  if (state.tempRoot !== undefined) {
    try {
      await rm(state.tempRoot, { recursive: true, force: true });
    } catch (error) {
      problems.push(`could not remove the temporary folder: ${messageOf(error)}`);
    }
  }

  state.cleaned = true;
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
}

async function step(name, action) {
  activeStep = name;
  try {
    await action();
    completed.add(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ${messageOf(error)}`);
    throw error;
  }
}

async function main() {
  try {
    await step("build and pack", async () => {
      await runCommand(PNPM, ["build"], { cwd: ROOT, timeout: 180_000 });
      const output = await runCommand(PNPM, ["pack", "--json"], {
        cwd: ROOT,
        timeout: 120_000,
      });
      const packed = JSON.parse(output.stdout);
      const tarball = resolve(ROOT, String(packed.filename));
      if (!(await exists(tarball))) {
        throw new Error("pnpm pack did not write the tarball");
      }
      state.tarballInRepo = tarball;
    });

    await step("fresh temporary folder with a space and a non-English letter", async () => {
      const folder = await mkdtemp(join(tmpdir(), "ibeji smoke é-"));
      state.tempRoot = folder;
      // npm init rejects a package name containing a space or a non-English
      // letter. The project therefore lives in a valid subfolder whose full
      // path still contains the required characters.
      state.smokeDir = join(folder, "project");
      state.home = join(folder, "home");
      await mkdir(state.smokeDir, { recursive: true });
      await mkdir(state.home, { recursive: true });
      const absolute = resolve(state.smokeDir);
      const root = resolve(ROOT);
      if (absolute === root || absolute.startsWith(`${root}${sep}`)) {
        throw new Error("the smoke folder is inside the repository");
      }
      const hasNonEnglish = [...absolute].some(
        (character) => (character.codePointAt(0) ?? 0) > 0x7f,
      );
      if (!absolute.includes(" ") || !hasNonEnglish) {
        throw new Error("the smoke folder path has no space or non-English letter");
      }
      await cp(state.tarballInRepo, join(state.smokeDir, "ibeji.tgz"));
      await cp(join(ROOT, "examples", "school-fees-app"), join(state.smokeDir, "school-fees-app"), {
        recursive: true,
      });
      console.log(`Smoke folder: ${state.smokeDir}`);
    });

    await step("npm init and install the packed file", async () => {
      await runCommand(NPM, ["init", "-y"], { cwd: state.smokeDir, timeout: 60_000 });
      await runCommand(PNPM, ["add", "--offline", "./ibeji.tgz"], {
        cwd: state.smokeDir,
        timeout: 180_000,
      });
      const smokePackage = JSON.parse(await readFile(join(state.smokeDir, "package.json"), "utf8"));
      const dependencies = Object.keys(smokePackage.dependencies ?? {});
      if (dependencies.length !== 1 || dependencies[0] !== "ibeji") {
        throw new Error(
          `the smoke folder installed more than the packed package: ${dependencies.join(", ")}`,
        );
      }
      const installedPackage = JSON.parse(
        await readFile(join(state.smokeDir, "node_modules", "ibeji", "package.json"), "utf8"),
      );
      if (installedPackage.name !== "ibeji") {
        throw new Error("the installed package is not ibeji");
      }
      const binPath = join(state.smokeDir, "node_modules", ".bin", "ibeji");
      if (!(await exists(binPath)) && !(await exists(`${binPath}.cmd`))) {
        throw new Error("the installed package has no ibeji command");
      }
    });

    await step("installed tree has no native code or payment libraries", auditInstalledTree);

    await step("npx ibeji --help", async () => {
      const result = await runCommand(NPX, ["--no-install", "ibeji", "--help"], {
        cwd: state.smokeDir,
        env: cliEnv(),
        timeout: 30_000,
      });
      if (
        !result.stdout.includes("Usage:") ||
        !result.stdout.includes("Run the MCP server over stdio")
      ) {
        throw new Error("npx ibeji --help did not print the expected help");
      }
    });

    await step("start Ibeji on random free ports", async () => {
      const startJson = await startIbeji();
      const twinIds = Object.keys(startJson.addresses?.twins ?? {});
      if (twinIds.length === 0) {
        throw new Error("Ibeji started no twins");
      }
      console.log(`Started twins: ${twinIds.join(", ")}`);
    });

    await step("dashboard and its sign-in refusal", dashboardStep);

    await step("payments through every registered twin", async () => {
      const twinIds = Object.keys(state.startJson.addresses.twins);
      for (const twinId of twinIds) {
        const app = await startApp(twinId);
        try {
          await setWebhook(twinId, app);
          const student = await payAndWait(app, "amina");
          if (student.payments.length !== 1) {
            throw new Error(`${twinId} recorded ${student.payments.length} payments, expected 1`);
          }
          console.log(`PASS payment through ${twinId}`);
        } finally {
          await stopApp(app);
        }
      }
      console.log("Stripe is version 0.2.0 and is not in this 0.1.0 smoke run.");
    });

    await step("safe app ignores duplicate webhooks", async () => {
      const twinId = Object.keys(state.startJson.addresses.twins)[0];
      if (twinId === undefined) {
        throw new Error("there is no registered twin for the duplicate test");
      }
      const app = await startApp(twinId);
      try {
        await setWebhook(twinId, app);
        await runCommand(
          NPX,
          [
            "--no-install",
            "ibeji",
            "fail",
            "webhook-duplicated",
            "--twin",
            twinId,
            "--copies",
            "2",
            "--gapSeconds",
            "0",
          ],
          { cwd: state.smokeDir, env: cliEnv(), timeout: 30_000 },
        );
        const paid = await payAndWait(app, "amina");
        const reference = paid.payments[0]?.reference;
        if (typeof reference !== "string") {
          throw new Error("the app did not record a payment reference");
        }
        const recent = await waitFor(
          async () => {
            const body = await controlJson(`/webhooks?twin=${encodeURIComponent(twinId)}`);
            const deliveries = (body.deliveries ?? []).filter((delivery) =>
              String(delivery.raw?.body ?? "").includes(reference),
            );
            const delivered = deliveries.filter((delivery) => delivery.status === "delivered");
            return delivered.length >= 2 ? deliveries : undefined;
          },
          15_000,
          "two delivered duplicate webhooks",
        );
        const current = await appState(app.url);
        const student = studentOf(current, "amina");
        if (student.payments.length !== 1) {
          throw new Error(
            `the safe app recorded ${student.payments.length} payments for one duplicate delivery`,
          );
        }
        console.log(`Saw ${recent.length} duplicate deliveries for ${twinId}.`);
        await runCommand(NPX, ["--no-install", "ibeji", "clear", "--twin", twinId], {
          cwd: state.smokeDir,
          env: cliEnv(),
          timeout: 30_000,
        });
      } finally {
        await stopApp(app);
      }
    });

    await step("status and MCP stdout", async () => {
      const result = await runCommand(NPX, ["--no-install", "ibeji", "status", "--json"], {
        cwd: state.smokeDir,
        env: cliEnv(),
        timeout: 30_000,
      });
      const status = JSON.parse(result.stdout);
      if (!Array.isArray(status.twins) || status.twins.length === 0) {
        throw new Error("ibeji status returned no twins");
      }
      if (status.twins.some((twin) => twin.running !== true)) {
        throw new Error("ibeji status says a twin is not running");
      }
      await mcpStep();
    });

    await step("stop, session cleanup and temporary folder removal", cleanup);
  } catch {
    // The failing step has already printed the plain-English reason.
  } finally {
    if (!state.cleaned) {
      try {
        await cleanup();
        completed.add("stop, session cleanup and temporary folder removal");
        console.log(`PASS ${"stop, session cleanup and temporary folder removal"} (after failure)`);
      } catch (error) {
        failed = true;
        completed.add("stop, session cleanup and temporary folder removal");
        console.log(
          `FAIL stop, session cleanup and temporary folder removal (after failure): ${messageOf(
            error,
          )}`,
        );
      }
    }
    for (const name of STEP_NAMES) {
      if (!completed.has(name) && name !== activeStep) {
        failed = true;
        console.log(`FAIL ${name}: not run because an earlier step failed`);
      }
    }
  }

  if (failed) {
    console.log("FAIL smoke test");
    process.exitCode = 1;
    return;
  }
  console.log("PASS smoke test");
}

await main();
