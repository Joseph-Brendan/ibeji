import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { IbejiError } from "../../src/core/errors.js";
import { SeededRandom } from "../../src/core/random.js";

function sequence(seed: number, length: number): readonly number[] {
  const random = new SeededRandom(seed);
  return Array.from({ length }, () => random.next());
}

describe("T1 seeded random", () => {
  it("T1: the same seed gives the same 1,000 numbers", () => {
    expect(sequence(12345, 1_000)).toEqual(sequence(12345, 1_000));
  });

  it("T1: different seeds give different sequences", () => {
    expect(sequence(1, 1_000)).not.toEqual(sequence(2, 1_000));
  });

  it("T1: next() stays in [0, 1)", () => {
    for (const value of sequence(9, 1_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("T1: accepts the lowest and highest seed", () => {
    expect(sequence(0, 5)).toHaveLength(5);
    expect(sequence(4_294_967_295, 5)).toHaveLength(5);
  });

  it("T1: rejects a seed outside 0 to 4294967295", () => {
    for (const seed of [-1, 1.5, 4_294_967_296]) {
      expect(() => new SeededRandom(seed)).toThrow(IbejiError);
    }
  });

  it("T1: int(min, max) is inclusive and always stays in range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (first, second) => {
          const min = Math.min(first, second);
          const max = Math.max(first, second);
          const random = new SeededRandom(42);
          const value = random.int(min, max);

          return Number.isInteger(value) && value >= min && value <= max;
        },
      ),
    );
  });

  it("T1: int() handles a single-value range", () => {
    const random = new SeededRandom(7);
    expect(random.int(5, 5)).toBe(5);
  });

  it("T1: int() rejects unsafe or reversed ranges", () => {
    const random = new SeededRandom(7);
    expect(() => random.int(1.5, 2)).toThrow(IbejiError);
    expect(() => random.int(0, Number.MAX_SAFE_INTEGER + 1)).toThrow(IbejiError);
    expect(() => random.int(5, 4)).toThrow(IbejiError);
  });

  it("T1: chance() is false at 0 and true at 100", () => {
    const random = new SeededRandom(7);
    expect(random.chance(0)).toBe(false);
    expect(random.chance(100)).toBe(true);
  });

  it("T1: chance() rejects values outside 0 to 100", () => {
    const random = new SeededRandom(7);
    expect(() => random.chance(Number.NaN)).toThrow(IbejiError);
    expect(() => random.chance(-1)).toThrow(IbejiError);
    expect(() => random.chance(101)).toThrow(IbejiError);
  });
});
