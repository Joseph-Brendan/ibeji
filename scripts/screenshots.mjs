#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "dist", "cli.js");
const OUTPUT = join(ROOT, "docs", "images");
export const CREDENTIAL_MASK = "[credential masked]";

/**
 * Replace every credential value in the live page before a screenshot. The
 * original values stay in the API and in the page's copy buttons, but they
 * never reach the image.
 */
export async function maskCredentials(page) {
  await page.locator("[data-credential-value]").evaluateAll((nodes, mask) => {
    for (const node of nodes) {
      node.textContent = mask;
    }
  }, CREDENTIAL_MASK);
}

/** Mask credentials first, then take one image. */
export async function captureScreenshot(page, path, options = {}) {
  await maskCredentials(page);
  await page.screenshot({ path, ...options });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function registeredTwinIds(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "keys", "--json"], {
      cwd: ROOT,
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ibeji keys --json did not finish within 20 seconds."));
    }, 20_000);
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
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ibeji keys --json exited with code ${String(code)}: ${stderr}`));
        return;
      }
      const parsed = JSON.parse(stdout);
      const twinIds = Array.isArray(parsed.twins)
        ? parsed.twins
            .map((twin) => (typeof twin === "object" && twin !== null ? twin.id : undefined))
            .filter((id) => typeof id === "string")
        : [];
      if (twinIds.length === 0) {
        reject(new Error("ibeji keys --json returned no registered twins."));
        return;
      }
      resolve(twinIds);
    });
  });
}

async function startSession(home, twinIds) {
  const child = spawn(
    process.execPath,
    [
      CLI,
      "start",
      "--no-open",
      "--json",
      "--port",
      "0",
      ...twinIds.flatMap((twinId) => ["--twin-port", `${twinId}=0`]),
    ],
    {
      cwd: ROOT,
      env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const started = await new Promise((resolve, reject) => {
    const reader = createInterface({ input: child.stdout });
    const timer = setTimeout(() => {
      reject(new Error("Ibeji did not start within 20 seconds."));
    }, 20_000);
    let settled = false;
    const finish = (action) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      action();
    };
    const onExit = (code, signal) => {
      finish(() => {
        reject(
          new Error(
            `Ibeji exited during startup with code ${String(code)} signal ${String(signal)}.`,
          ),
        );
      });
    };
    child.once("exit", onExit);
    reader.on("line", (line) => {
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
        finish(() => resolve(value));
      }
    });
  });

  const session = JSON.parse(await readFile(join(home, ".ibeji", "session.json"), "utf8"));
  return { child, started, session };
}

async function stopSession(running) {
  try {
    process.kill(running.session.processId, "SIGINT");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
  }
  await waitForExit(running.child, 10_000);
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill("SIGKILL");
    await waitForExit(running.child, 2_000);
  }
}

async function main() {
  if (!(await exists(join(ROOT, "dist", "ui", "index.html")))) {
    throw new Error("The dashboard build is missing. Run pnpm build first.");
  }
  await mkdir(OUTPUT, { recursive: true });
  const home = await mkdtemp(join(tmpdir(), "ibeji-screenshots-"));
  let running;
  let browser;
  try {
    const twinIds = await registeredTwinIds(home);
    running = await startSession(home, twinIds);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      colorScheme: "light",
    });
    await page.goto(running.started.launchLink);
    await page.getByRole("heading", { name: "Home", level: 1 }).waitFor();
    const boundTwinIds = Object.keys(running.session.ports.twins);
    for (const twinId of boundTwinIds) {
      await page.getByTestId(`twin-card-${twinId}`).waitFor();
    }
    await page.locator("[data-credential-value]").first().waitFor();
    await delay(500);
    await captureScreenshot(page, join(OUTPUT, "home.png"), {
      fullPage: true,
      animations: "disabled",
    });

    await page.getByRole("link", { name: "Failures", exact: true }).click();
    await page.getByRole("heading", { name: "Failures", level: 1 }).waitFor();
    await page.setViewportSize({ width: 1280, height: 1400 });
    await delay(500);
    await captureScreenshot(page, join(OUTPUT, "failures.png"), {
      fullPage: false,
      animations: "disabled",
    });
    console.log(`Wrote ${join("docs", "images", "home.png")}`);
    console.log(`Wrote ${join("docs", "images", "failures.png")}`);
  } finally {
    if (browser !== undefined) {
      await browser.close();
    }
    if (running !== undefined) {
      await stopSession(running);
    }
    await rm(home, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
