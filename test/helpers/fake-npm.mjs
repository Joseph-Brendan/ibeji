import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const command = args[0];
const statePath = process.env.FAKE_NPM_STATE;

async function readState() {
  if (statePath === undefined) {
    return {};
  }
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeState(state) {
  if (statePath !== undefined) {
    await writeFile(statePath, JSON.stringify(state), "utf8");
  }
}

if (command === "whoami") {
  if (process.env.FAKE_NPM_WHOAMI_EXIT === "1") {
    console.error("fake npm whoami failed");
    process.exitCode = 1;
  } else {
    console.log(process.env.FAKE_NPM_WHOAMI ?? "devanddesignhq");
  }
} else if (command === "view") {
  const state = await readState();
  const count = typeof state.view === "number" ? state.view + 1 : 1;
  state.view = count;
  await writeState(state);
  const mode = process.env.FAKE_NPM_VIEW_MODE ?? "absent";
  const version = process.env.FAKE_NPM_VERSION ?? "0.1.0";
  const present = mode === "present" || (mode === "absent-then-present" && count > 1);
  if (present) {
    console.log(JSON.stringify(version));
  } else {
    console.error("npm error code E404");
    process.exitCode = 1;
  }
} else if (command === "publish") {
  const state = await readState();
  state.published = true;
  state.publishCwd = process.cwd();
  state.publishArgs = args;
  await writeState(state);
  console.log("fake npm publish");
} else {
  console.error(`fake npm does not handle: ${args.join(" ")}`);
  process.exitCode = 1;
}
