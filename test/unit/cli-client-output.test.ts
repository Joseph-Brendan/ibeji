import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ControlClient } from "../../src/cli/control-client.js";
import { nodeCheck, satisfiesRange } from "../../src/cli/doctor.js";
import { commandHelp, failHelp } from "../../src/cli/help.js";
import {
  asIbejiError,
  errorBody,
  formatTime,
  wrapText,
  writeHumanError,
  writeLine,
  writeWrapped,
} from "../../src/cli/output.js";
import { readPackageInfo } from "../../src/cli/project.js";
import type { SessionFile } from "../../src/control/session-file.js";

function sessionFile(port: number): SessionFile {
  return {
    instanceId: "test",
    processId: process.pid,
    ports: { control: port, twins: {} },
    token: "token",
    startTime: new Date(0).toISOString(),
    version: "0.0.0",
  };
}

describe("T10 CLI control client and output", () => {
  it("T10: the control client handles JSON, empty and text bodies", async () => {
    const server = createServer((request, response) => {
      const path = request.url?.replace("/_ibeji/api/v1", "") ?? "";
      if (path === "/empty") {
        response.writeHead(200);
        response.end();
        return;
      }
      if (path === "/text") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("hello");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url, method: request.method }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    try {
      const client = new ControlClient(sessionFile(address.port));
      expect(await client.request<{ path: string }>("/ok")).toMatchObject({
        path: "/_ibeji/api/v1/ok",
      });
      expect(await client.request("/empty")).toBeUndefined();
      expect(await client.request("/text")).toBe("hello");
      expect(client.eventStreamUrl()).toContain("/events/stream");
      expect(client.eventStreamUrl("paystack")).toContain("scope=paystack");
      expect(client.authorizationHeader).toBe("Bearer token");

      await client.twins;
      await client.status;
      await client.failures;
      await client.rules;
      await client.scenarios;
      await client.webhookUrl("alpha");
      await client.setWebhookUrl("alpha", "http://127.0.0.1:1/hook");
      await client.addRule({ failureId: "slow-response", settings: {} });
      await client.removeRule("rule-1");
      await client.clearRules("alpha");
      await client.runScenario("scenario-1", ["alpha"]);
      await client.stopScenario();
      await client.events({ scope: "alpha", limit: 1 });
      await client.resend("delivery-1");
      await client.reset("alpha");
      await client.reset();
      await client.exportSession();
      await client.launchLink();
      expect(await client.placeholder()).toContain("path");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("T10: the control client turns API errors into Ibeji errors", async () => {
    const server = createServer((request, response) => {
      const path = request.url?.replace("/_ibeji/api/v1", "") ?? "";
      switch (path) {
        case "/full":
          response.writeHead(401, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              error: {
                code: "UNAUTHORIZED",
                what: "Not allowed.",
                why: "The token is wrong.",
                fix: "Use the right token.",
              },
            }),
          );
          return;
        case "/unknown-code":
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { code: "NOT_A_CODE" } }));
          return;
        case "/bad-shape":
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "bad" }));
          return;
        case "/bad-field":
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { code: 1 } }));
          return;
        case "/not-json":
          response.writeHead(500, { "content-type": "text/plain" });
          response.end("no json");
          return;
        default:
          response.writeHead(200, { "content-type": "application/json" });
          response.end("{}");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    try {
      const client = new ControlClient(sessionFile(address.port));

      await expect(client.request("/full")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        what: "Not allowed.",
      });
      await expect(client.request("/unknown-code")).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(client.request("/bad-shape")).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(client.request("/bad-field")).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(client.request("/not-json")).rejects.toMatchObject({ code: "INTERNAL" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("T10: the control client reports a dead session", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const client = new ControlClient(sessionFile(address.port));
    await expect(client.request("/status")).rejects.toMatchObject({ code: "SESSION_STALE" });
    await expect(client.placeholder()).rejects.toMatchObject({ code: "SESSION_STALE" });
  });

  it("T10: output helpers wrap text and format errors", () => {
    expect(wrapText("one two three four five", 20)).toEqual(["one two three four", "five"]);
    expect(wrapText("", 10)).toEqual([]);
    expect(wrapText("supercalifragilisticexpialidocious", 5)).toEqual([
      "supercalifragilisticexpialidocious",
    ]);
    expect(wrapText("one two", 20, "  ")).toEqual(["  one two"]);
    expect(formatTime("not-a-date")).toBe("not-a-date");
    expect(formatTime(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(asIbejiError(new Error("boom")).code).toBe("INTERNAL");
    expect(asIbejiError("boom").code).toBe("INTERNAL");
    expect(errorBody(asIbejiError(new Error("boom"))).error.code).toBe("INTERNAL");

    const lines: string[] = [];
    writeLine((text) => lines.push(text), "one");
    writeWrapped((text) => lines.push(text), "one two three", "  ");
    writeHumanError((text) => lines.push(text), asIbejiError(new Error("boom")));
    expect(lines.join("")).toContain("one\n");
    expect(lines.join("")).toContain("What happened:");
  });

  it("T10: package information errors are explained", async () => {
    const root = await mkdtemp(join(tmpdir(), "ibeji-package-"));
    try {
      await writeFile(join(root, "package.json"), "{bad", "utf8");
      await expect(readPackageInfo(root)).rejects.toMatchObject({ code: "INTERNAL" });

      await writeFile(join(root, "package.json"), "null", "utf8");
      await expect(readPackageInfo(root)).rejects.toMatchObject({ code: "INTERNAL" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("T10: the Node engine range check accepts the supported lines", () => {
    expect(satisfiesRange("22.18.0", "^22.18.0 || >=24.11.0")).toBe(true);
    expect(satisfiesRange("22.17.0", "^22.18.0 || >=24.11.0")).toBe(false);
    expect(satisfiesRange("23.9.0", "^22.18.0 || >=24.11.0")).toBe(false);
    expect(satisfiesRange("24.11.0", "^22.18.0 || >=24.11.0")).toBe(true);
    expect(satisfiesRange("25.0.0", "^22.18.0 || >=24.11.0")).toBe(true);
    expect(satisfiesRange("22.18.0", ">=22.0.0")).toBe(true);
    expect(satisfiesRange("22.18.0", ">22.18.0")).toBe(false);
    expect(satisfiesRange("22.19.0", "22.19.0")).toBe(true);
    expect(satisfiesRange("22.19.1", "22.19.0")).toBe(false);
    expect(nodeCheck("20.0.0", "^22.18.0 || >=24.11.0").problems[0]?.code).toBe("BAD_REQUEST");
    expect(nodeCheck("24.12.0", undefined).problems).toEqual([]);
    expect(commandHelp("fail")).toContain("Example:");
    expect(failHelp("not-a-failure")).toContain("Failures:");
  });
});
