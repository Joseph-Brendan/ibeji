import { describe, expect, it } from "vitest";

import { IbejiError } from "../../src/core/errors.js";
import { StateStore } from "../../src/core/state.js";

type Record = {
  readonly id: string | number;
  readonly value: { readonly amount: number };
};

describe("T1 state", () => {
  it("T1: returned records are copies, so callers cannot change stored data", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    alpha.insert<Record>("records", { id: "one", value: { amount: 100 } });

    const read = alpha.get<Record>("records", "one");
    expect(read).toEqual({ id: "one", value: { amount: 100 } });
    if (read === undefined) {
      throw new Error("the record was not returned");
    }
    (read.value as { amount: number }).amount = 999;

    const listed = alpha.list<Record>("records");
    (listed[0]?.value as { amount: number }).amount = 888;

    expect(alpha.get<Record>("records", "one")).toEqual({
      id: "one",
      value: { amount: 100 },
    });
  });

  it("T1: resetting one twin leaves the other twin's records untouched", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    const beta = store.registerTwin("beta", [{ name: "records" }]);
    alpha.insert<Record>("records", { id: "a", value: { amount: 1 } });
    beta.insert<Record>("records", { id: "b", value: { amount: 2 } });

    store.reset("alpha");

    expect(alpha.list("records")).toEqual([]);
    expect(beta.list("records")).toEqual([{ id: "b", value: { amount: 2 } }]);
  });

  it("T1: resetting all twins clears every collection", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    const beta = store.registerTwin("beta", [{ name: "records" }]);
    alpha.insert<Record>("records", { id: "a", value: { amount: 1 } });
    beta.insert<Record>("records", { id: "b", value: { amount: 2 } });

    store.reset();

    expect(alpha.list("records")).toEqual([]);
    expect(beta.list("records")).toEqual([]);
  });

  it("T1: one twin cannot reach another twin's collections", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "alpha-records" }]);
    const beta = store.registerTwin("beta", [{ name: "beta-records" }]);
    alpha.insert("alpha-records", { id: "a" });
    beta.insert("beta-records", { id: "b" });

    expect(alpha.list("alpha-records")).toHaveLength(1);
    expect(() => alpha.list("beta-records")).toThrow(IbejiError);
    expect(() => alpha.get("beta-records", "b")).toThrow(IbejiError);
    expect(beta.list("beta-records")).toHaveLength(1);
  });

  it("T1: the same collection name in two twins is stored separately", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    const beta = store.registerTwin("beta", [{ name: "records" }]);
    alpha.insert("records", { id: "same", value: "alpha" });
    beta.insert("records", { id: "same", value: "beta" });

    expect(alpha.get("records", "same")).toEqual({ id: "same", value: "alpha" });
    expect(beta.get("records", "same")).toEqual({ id: "same", value: "beta" });
  });

  it("T1: get returns undefined for a missing id and list returns an empty array", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);

    expect(alpha.get("records", "missing")).toBeUndefined();
    expect(alpha.list("records")).toEqual([]);
  });

  it("T1: insert accepts string and numeric ids and rejects duplicates", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    alpha.insert<Record>("records", { id: 1, value: { amount: 10 } });
    alpha.insert<Record>("records", { id: "two", value: { amount: 20 } });

    expect(alpha.get<Record>("records", 1)).toEqual({ id: 1, value: { amount: 10 } });
    expect(alpha.get<Record>("records", "two")).toEqual({
      id: "two",
      value: { amount: 20 },
    });
    expect(() => alpha.insert("records", { id: 1, value: "duplicate" })).toThrow(IbejiError);
  });

  it("T1: insert rejects a missing, empty or unusable id", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);

    expect(() => alpha.insert("records", { value: "no id" })).toThrow(IbejiError);
    expect(() => alpha.insert("records", { id: "", value: "empty" })).toThrow(IbejiError);
    expect(() => alpha.insert("records", { id: Number.NaN, value: "not finite" })).toThrow(
      IbejiError,
    );
  });

  it("T1: a collection can use a custom id field", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records", idField: "reference" }]);
    alpha.insert("records", { reference: "ref-1", value: 1 });

    expect(alpha.get("records", "ref-1")).toEqual({ reference: "ref-1", value: 1 });
  });

  it("T1: update merges changes and returns a copy", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    alpha.insert<Record>("records", { id: "one", value: { amount: 100 } });

    const updated = alpha.update<Record>("records", "one", { value: { amount: 200 } });
    expect(updated).toEqual({ id: "one", value: { amount: 200 } });
    expect(alpha.get<Record>("records", "one")).toEqual({
      id: "one",
      value: { amount: 200 },
    });
  });

  it("T1: update rejects a missing record and a changed id", () => {
    const store = new StateStore();
    const alpha = store.registerTwin("alpha", [{ name: "records" }]);
    alpha.insert<Record>("records", { id: "one", value: { amount: 100 } });

    expect(() => alpha.update("records", "missing", { value: { amount: 1 } })).toThrow(IbejiError);
    expect(() => alpha.update<Record>("records", "one", { id: "other" })).toThrow(IbejiError);
  });

  it("T1: rejects duplicate collection names and duplicate twin registration", () => {
    const store = new StateStore();
    expect(() => store.registerTwin("alpha", [{ name: "records" }, { name: "records" }])).toThrow(
      IbejiError,
    );

    store.registerTwin("alpha", [{ name: "records" }]);
    expect(() => store.registerTwin("alpha", [])).toThrow(IbejiError);
  });

  it("T1: an unregistered twin cannot be reached", () => {
    const store = new StateStore();
    expect(() => store.twin("missing")).toThrow(IbejiError);
    expect(() => store.reset("missing")).toThrow(IbejiError);
  });
});
