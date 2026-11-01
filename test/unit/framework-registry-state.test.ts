import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FrameworkStateStore, MemoryIdempotencyStore } from "../../src/twins/framework/state.js";
import {
  createTwinRegistry,
  listTwins,
  registry,
  requireTwin,
  TWIN_DEFINITIONS,
} from "../../src/twins/registry.js";
import { fakeTwinDefinition } from "../fixtures/fake-twin/definition.js";

const recordSchema = z.object({ id: z.string(), value: z.number() });

describe("T14 twin registry and framework state", () => {
  it("T14 the production registry holds Paystack and stays the one list", () => {
    expect(TWIN_DEFINITIONS).toHaveLength(1);
    expect(listTwins().map((twin) => twin.id)).toEqual(["paystack"]);
    expect(registry.list().map((twin) => twin.id)).toEqual(["paystack"]);
    expect(registry.has("paystack")).toBe(true);
    expect(registry.has("fake")).toBe(false);
    expect(() => registry.require("fake")).toThrow("is not a twin in the registry");
    expect(() => requireTwin("fake")).toThrow("is not a twin in the registry");
  });

  it("T14 a registry discovers definitions and refuses duplicates", () => {
    const created = createTwinRegistry([fakeTwinDefinition]);
    expect(created.list()).toEqual([fakeTwinDefinition]);
    expect(created.require("fake")).toBe(fakeTwinDefinition);
    expect(created.has("fake")).toBe(true);
    expect(created.has("other")).toBe(false);
    expect(() => createTwinRegistry([fakeTwinDefinition, fakeTwinDefinition])).toThrow(
      "is registered twice",
    );
  });

  it("T14 framework state reads, lists, inserts, updates, removes and resets", () => {
    const store = new FrameworkStateStore("fake", fakeTwinDefinition.state.collections);
    expect(store.read("payments", "one", recordSchema)).toBeUndefined();

    store.insert("payments", { id: "one", value: 1 });
    expect(store.read("payments", "one", recordSchema)).toEqual({ id: "one", value: 1 });
    expect(store.list("payments", recordSchema)).toEqual([{ id: "one", value: 1 }]);

    store.update("payments", "one", { id: "one", value: 2 });
    expect(store.read("payments", "one", recordSchema)?.value).toBe(2);

    store.remove("payments", "one");
    expect(store.list("payments", recordSchema)).toEqual([]);

    store.insert("payments", { id: "two", value: 3 });
    store.reset();
    expect(store.list("payments", recordSchema)).toEqual([]);
  });

  it("T14 the idempotency store keeps records per twin", () => {
    const store = new MemoryIdempotencyStore();
    const record = {
      key: "key-1",
      method: "POST" as const,
      path: "/payments",
      fingerprint: "POST /payments",
      response: {
        status: 200,
        headers: {},
        body: "{}",
        contentType: "application/json",
      },
      storedAt: 1,
    };
    expect(store.lookup("fake", "key-1")).toBeUndefined();
    store.save("fake", record);
    expect(store.lookup("fake", "key-1")).toEqual(record);
    expect(store.lookup("other", "key-1")).toBeUndefined();
  });
});
