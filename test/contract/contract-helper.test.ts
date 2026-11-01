import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertContract,
  assertContractFile,
  ContractMismatchError,
  compareContractBody,
  compareContractResponse,
  loadContractFixture,
} from "../../src/twins/framework/contract.js";
import { startTwin } from "../../src/twins/framework/server.js";
import { fakeCredentials, fakeTwinDefinition } from "../fixtures/fake-twin/definition.js";

describe("T3 contract helper", () => {
  it("T3 sends a fixture request and accepts the fake twin response shape", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      await assertContractFile(running, "test/fixtures/fake-twin/contract-payment.json");
    } finally {
      await running.stop();
    }
  });

  it("T3 reports a missing field", () => {
    expect(compareContractBody({ a: 1, b: 2 }, { a: 1 })).toEqual(["$.b: missing key"]);
  });

  it("T3 reports a renamed field as a missing key and an unexpected key", () => {
    expect(compareContractBody({ name: "Ada" }, { title: "Ada" })).toEqual([
      "$.name: missing key",
      "$.title: unexpected key",
    ]);
  });

  it("T3 reports a wrong type", () => {
    expect(compareContractBody({ amount: 1 }, { amount: "1" })).toEqual([
      "$.amount: expected number, got string",
    ]);
  });

  it("T3 compares arrays by length and by every item", () => {
    expect(compareContractBody([{ id: "a" }], [{ id: "a" }])).toEqual([]);
    expect(compareContractBody([{ id: "a" }], [{ id: 1 }])).toEqual([
      "$[0].id: expected string, got number",
    ]);
    expect(compareContractBody([1, 2], [1])).toEqual(["$: expected 2 items, got 1"]);
    expect(compareContractBody([1], "not-an-array")).toEqual(["$: expected array, got string"]);
  });

  it("T3 compares null, objects and primitives", () => {
    expect(compareContractBody(null, null)).toEqual([]);
    expect(compareContractBody(null, 1)).toEqual(["$: expected null, got number"]);
    expect(compareContractBody({ a: null }, { a: null })).toEqual([]);
    expect(compareContractBody({ a: 1 }, null)).toEqual(["$: expected object, got null"]);
    expect(compareContractBody({ a: {} }, { a: [] })).toEqual(["$.a: expected object, got array"]);
    expect(compareContractBody(true, 1)).toEqual(["$: expected boolean, got number"]);
  });

  it("T3 reports a status difference", () => {
    expect(compareContractResponse({ status: 200, body: { ok: true } }, 201, { ok: true })).toEqual(
      ["$.status: expected 200, got 201"],
    );
  });

  it("T3 rejects a response that is not JSON", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      await expect(
        assertContractFile(running, "test/fixtures/fake-twin/contract-payment.json").then(
          () => undefined,
        ),
      ).resolves.toBeUndefined();

      const fixture = await loadContractFixture("test/fixtures/fake-twin/contract-payment.json");
      expect(fixture.request.method).toBe("POST");
    } finally {
      await running.stop();
    }
  });

  it("T3 loads a fixture from a file and rejects malformed fixtures", async () => {
    const root = await mkdtemp(join(tmpdir(), "ibeji-contract-"));
    try {
      const malformed = join(root, "malformed.json");
      await writeFile(malformed, "{not json");
      await expect(loadContractFixture(malformed)).rejects.toThrow(
        "The contract fixture is not valid JSON.",
      );

      const notObject = join(root, "not-object.json");
      await writeFile(notObject, "[]");
      await expect(loadContractFixture(notObject)).rejects.toThrow(
        "The contract fixture is not an object.",
      );

      const missing = join(root, "missing.json");
      await writeFile(missing, JSON.stringify({ request: {}, response: {} }));
      await expect(loadContractFixture(missing)).rejects.toThrow(
        "The contract fixture is missing a field.",
      );

      const badMethod = join(root, "bad-method.json");
      await writeFile(
        badMethod,
        JSON.stringify({
          request: { method: "PATCH", path: "/", headers: {} },
          response: { status: 200, body: {} },
        }),
      );
      await expect(loadContractFixture(badMethod)).rejects.toThrow(
        "The contract fixture uses the unknown method",
      );

      const badHeaders = join(root, "bad-headers.json");
      await writeFile(
        badHeaders,
        JSON.stringify({
          request: { method: "GET", path: "/", headers: [] },
          response: { status: 200, body: {} },
        }),
      );
      await expect(loadContractFixture(badHeaders)).rejects.toThrow(
        "The contract fixture headers are not an object.",
      );

      const minimal = join(root, "minimal.json");
      await writeFile(
        minimal,
        JSON.stringify({
          request: { method: "GET", path: "/empty" },
          response: { status: 200, body: null },
        }),
      );
      const loaded = await loadContractFixture(minimal);
      expect(loaded.request.headers).toBeUndefined();
      expect(loaded.request.body).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("T3 throws a mismatch with every clear difference", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      await expect(
        assertContract(running, {
          request: {
            method: "GET",
            path: "/empty",
            headers: { authorization: `Bearer ${fakeCredentials.secret}` },
          },
          response: { status: 200, body: null },
        }),
      ).resolves.toBeUndefined();

      await expect(
        assertContract(running, {
          request: { method: "GET", path: "/empty" },
          response: {
            status: 401,
            body: { status: "error", message: "No key was sent.", data: null },
          },
        }),
      ).resolves.toBeUndefined();

      await expect(
        assertContract(running, {
          request: {
            method: "GET",
            path: "/plain",
            headers: { authorization: `Bearer ${fakeCredentials.secret}` },
          },
          response: { status: 200, body: {} },
        }),
      ).rejects.toBeInstanceOf(ContractMismatchError);

      await expect(
        assertContract(running, {
          request: {
            method: "POST",
            path: "/payments",
            headers: { authorization: `Bearer ${fakeCredentials.secret}` },
          },
          response: { status: 201, body: { missing: true } },
        }),
      ).rejects.toBeInstanceOf(ContractMismatchError);

      const mismatch = new ContractMismatchError(["$.field: missing key"]);
      expect(mismatch.differences).toEqual(["$.field: missing key"]);
      expect(mismatch.message).toContain("$.field: missing key");
    } finally {
      await running.stop();
    }
  });
});
