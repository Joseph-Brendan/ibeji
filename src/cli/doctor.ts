import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import { credentialsPath, sessionPath } from "../control/paths.js";
import {
  readSessionFile,
  removeSessionFile,
  type SessionFile,
  sessionFileIsLive,
} from "../control/session-file.js";
import { createDefaultConfig, mergeConfig } from "../core/config.js";
import { type ErrorCode, isIbejiError } from "../core/errors.js";
import type { AddressPolicy, DnsResolver } from "../core/webhooks/address.js";
import { probeWebhookUrl } from "../core/webhooks/dispatcher.js";
import { ControlClient } from "./control-client.js";
import { type Writer, writeLine, writeWrapped } from "./output.js";
import { type ProjectInfo, readConfigFile } from "./project.js";

export type DoctorProblem = {
  readonly code: ErrorCode;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
};

export type DoctorCheck = {
  readonly name: string;
  readonly problems: readonly DoctorProblem[];
  readonly notes?: readonly string[];
};

export type DoctorResult = {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
};

export type DoctorOptions = {
  readonly home: string;
  readonly cwd: string;
  readonly configPath: string | undefined;
  readonly project: ProjectInfo;
  readonly dnsResolver?: DnsResolver;
};

function problem(code: ErrorCode, what: string, why: string, fix: string): DoctorProblem {
  return { code, what, why, fix };
}

function problemFromError(error: unknown): DoctorProblem {
  if (isIbejiError(error)) {
    return {
      code: error.code,
      what: error.what,
      why: error.why,
      fix: error.fix,
    };
  }
  return problem(
    "INTERNAL",
    "A doctor check failed.",
    error instanceof Error ? error.message : String(error),
    "Try again. If the problem continues, report it with the steps that caused it.",
  );
}

function versionParts(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value);
  if (match === null) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function satisfiesPart(version: string, part: string): boolean {
  const trimmed = part.trim();
  if (trimmed.startsWith("^")) {
    const base = trimmed.slice(1);
    const baseParts = versionParts(base);
    const currentParts = versionParts(version);
    return currentParts[0] === baseParts[0] && compareVersions(version, base) >= 0;
  }
  if (trimmed.startsWith(">=")) {
    return compareVersions(version, trimmed.slice(2).trim()) >= 0;
  }
  if (trimmed.startsWith(">")) {
    return compareVersions(version, trimmed.slice(1).trim()) > 0;
  }
  return compareVersions(version, trimmed) === 0;
}

export function satisfiesRange(version: string, range: string): boolean {
  return range.split("||").some((part) => satisfiesPart(version, part));
}

export function nodeCheck(nodeVersion: string, range: string | undefined): DoctorCheck {
  if (range === undefined || range.trim() === "") {
    return { name: "Node version", problems: [] };
  }
  if (satisfiesRange(nodeVersion, range)) {
    return { name: "Node version", problems: [] };
  }
  return {
    name: "Node version",
    problems: [
      problem(
        "BAD_REQUEST",
        "This Node version is not supported.",
        `Ibeji needs Node ${range}. This process is Node ${nodeVersion}.`,
        "Install a supported Node version and run the command again.",
      ),
    ],
  };
}

function portProblem(name: string, port: number): DoctorProblem {
  const flag = name === "control" ? "--port <n>" : `--twin-port ${name}=<n>`;
  return problem(
    "PORT_IN_USE",
    `Port ${port} is already in use.`,
    `The ${name} port is held by another program, not by this Ibeji session.`,
    `Stop the other program or choose a different port with ${flag}.`,
  );
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code === "EADDRINUSE"
      ) {
        resolve(false);
        return;
      }
      reject(error);
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => {
        if (error === undefined) {
          resolve(true);
        } else {
          reject(error);
        }
      });
    });
  });
}

async function portCheck(
  ports: Readonly<Record<string, number>>,
  session: SessionFile | undefined,
): Promise<DoctorCheck> {
  const problems: DoctorProblem[] = [];
  const allowed = new Set<number>();
  if (session !== undefined) {
    allowed.add(session.ports.control);
    for (const port of Object.values(session.ports.twins)) {
      allowed.add(port);
    }
  }

  for (const [name, port] of Object.entries(ports)) {
    if (port === 0 || allowed.has(port)) {
      continue;
    }
    if (!(await portFree(port))) {
      problems.push(portProblem(name, port));
    }
  }

  return { name: "Ports", problems };
}

async function credentialsCheck(home: string): Promise<DoctorCheck> {
  if (process.platform === "win32") {
    return { name: "Credentials file permissions", problems: [] };
  }

  let details: Stats;
  try {
    details = await stat(credentialsPath(home));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { name: "Credentials file permissions", problems: [] };
    }
    return {
      name: "Credentials file permissions",
      problems: [
        problem(
          "INTERNAL",
          "The credentials file permissions could not be checked.",
          `The file at ${credentialsPath(home)} could not be read.`,
          "Check the file and its folder permissions.",
        ),
      ],
    };
  }

  if ((details.mode & 0o077) === 0) {
    return { name: "Credentials file permissions", problems: [] };
  }

  return {
    name: "Credentials file permissions",
    problems: [
      problem(
        "INTERNAL",
        "The credentials file is readable by other users.",
        `The file mode is ${(details.mode & 0o777).toString(8)}. Ibeji needs mode 600.`,
        `Run chmod 600 ${credentialsPath(home)}.`,
      ),
    ],
  };
}

async function dashboardCheck(project: ProjectInfo): Promise<DoctorCheck> {
  if (project.uiIndexPath !== undefined) {
    return { name: "Dashboard build", problems: [] };
  }

  return {
    name: "Dashboard build",
    problems: [
      problem(
        "INTERNAL",
        "The dashboard build is missing.",
        "No built dashboard file was found at dist/ui/index.html.",
        "Build the dashboard with pnpm build, then run doctor again.",
      ),
    ],
  };
}

async function webhookCheck(
  configUrls: Readonly<Record<string, string>>,
  policy: AddressPolicy,
  policySource: string,
  session: SessionFile | undefined,
  dnsResolver: DnsResolver | undefined,
): Promise<DoctorCheck> {
  const problems: DoctorProblem[] = [];
  const notes: string[] = [`Using ${policySource}.`];
  const urls: { twinId: string; url: string }[] = [];

  if (session !== undefined) {
    const client = new ControlClient(session);
    for (const twinId of Object.keys(session.ports.twins)) {
      try {
        const result = await client.webhookUrl(twinId);
        if (result.url !== null) {
          urls.push({ twinId, url: result.url });
        }
      } catch (error) {
        problems.push(problemFromError(error));
      }
    }
  } else {
    for (const [twinId, url] of Object.entries(configUrls)) {
      urls.push({ twinId, url });
    }
  }

  for (const item of urls) {
    try {
      const result = await probeWebhookUrl(item.url, policy, {
        ...(dnsResolver === undefined ? {} : { resolver: dnsResolver }),
        timeoutMs: 3_000,
      });
      if (result.kind === "not-contacted") {
        notes.push(
          `The webhook URL for ${item.twinId} resolves to a private or public address. It was not contacted.`,
        );
        continue;
      }
      if (result.kind === "unreachable") {
        problems.push(
          problem(
            "INTERNAL",
            `The webhook URL for ${item.twinId} did not answer.`,
            `Ibeji sent a HEAD request to ${item.url}, connected to ${result.address.address}, but got no answer: ${result.error}`,
            "Start the app that receives webhooks, or change the webhook URL.",
          ),
        );
      }
    } catch (error) {
      problems.push(problemFromError(error));
    }
  }

  return { name: "Webhook URLs", problems, notes };
}

function sessionPermissionsCheck(repaired: boolean, home: string): DoctorCheck {
  if (!repaired) {
    return { name: "Session file permissions", problems: [] };
  }
  return {
    name: "Session file permissions",
    problems: [
      problem(
        "INTERNAL",
        "The session file was readable by other users.",
        `Other users could read the session token in ${sessionPath(home)}. Ibeji changed the file mode to 600.`,
        "No action is needed now. Check who could read the file before the repair, and start a new session if you think the token was exposed.",
      ),
    ],
  };
}

function sessionProblem(): DoctorProblem {
  return problem(
    "SESSION_STALE",
    "The saved session file is stale.",
    "The process in the session file is not answering, or the file is not valid.",
    "The stale file was removed. Run ibeji start to begin a new session.",
  );
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  checks.push(nodeCheck(process.versions.node, options.project.packageInfo.engines.node));

  let config = createDefaultConfig(options.project.configContext);
  try {
    const loaded = await readConfigFile(options.project, options.cwd, options.configPath);
    config = mergeConfig(config, loaded?.overrides ?? {}, {});
    checks.push({ name: "Configuration", problems: [] });
  } catch (error) {
    checks.push({ name: "Configuration", problems: [problemFromError(error)] });
  }

  let session: SessionFile | undefined;
  let sessionPermissionsRepaired = false;
  try {
    const read = await readSessionFile(options.home);
    if (read.kind === "missing") {
      checks.push({ name: "Session file", problems: [] });
    } else if (read.kind === "invalid") {
      await removeSessionFile(options.home);
      checks.push({ name: "Session file", problems: [sessionProblem()] });
    } else if (await sessionFileIsLive(read.value)) {
      session = read.value;
      sessionPermissionsRepaired = read.permissionsRepaired;
      checks.push({ name: "Session file", problems: [] });
    } else {
      await removeSessionFile(options.home);
      checks.push({ name: "Session file", problems: [sessionProblem()] });
    }
  } catch (error) {
    checks.push({ name: "Session file", problems: [problemFromError(error)] });
  }
  checks.push(sessionPermissionsCheck(sessionPermissionsRepaired, options.home));

  const ports = { ...config.ports };
  if (session !== undefined) {
    ports.control = session.ports.control;
    for (const [twinId, port] of Object.entries(session.ports.twins)) {
      ports[twinId] = port;
    }
  }
  checks.push(await portCheck(ports, session));
  checks.push(await credentialsCheck(options.home));
  checks.push(await dashboardCheck(options.project));

  let policy: AddressPolicy = {
    allowPrivate: config.allowPrivateWebhooks,
    allowPublic: config.allowPublicWebhooks,
  };
  let policySource = "the config file's address policy, because no session is running";
  if (session !== undefined) {
    try {
      const status = await new ControlClient(session).status;
      policy = status.addressPolicy;
      policySource = "the running session's address policy";
    } catch (error) {
      policySource = "the config file's address policy, because the running session did not answer";
      checks.push({
        name: "Address policy",
        problems: [problemFromError(error)],
      });
    }
  }
  checks.push(
    await webhookCheck(config.webhookUrls, policy, policySource, session, options.dnsResolver),
  );

  return {
    ok: checks.every((check) => check.problems.length === 0),
    checks,
  };
}

export function printDoctor(result: DoctorResult, writer: Writer): void {
  const problems = result.checks.flatMap((check) =>
    check.problems.map((item) => ({ check: check.name, ...item })),
  );
  const notes = result.checks.flatMap((check) =>
    (check.notes ?? []).map((note) => ({ check: check.name, note })),
  );

  if (problems.length === 0) {
    writeLine(writer, "All checks passed.");
  } else {
    writeLine(
      writer,
      `Doctor found ${problems.length} problem${problems.length === 1 ? "" : "s"}.`,
    );
    for (const [index, item] of problems.entries()) {
      writeLine(writer);
      writeLine(writer, `${index + 1}. ${item.check}: ${item.what} (${item.code})`);
      writeWrapped(writer, `Why: ${item.why}`, "   ");
      writeWrapped(writer, `Fix: ${item.fix}`, "   ");
    }
  }

  for (const item of notes) {
    writeLine(writer, `${item.check}: ${item.note}`);
  }
}

export function doctorErrorCount(result: DoctorResult): number {
  return result.checks.reduce((total, check) => total + check.problems.length, 0);
}
