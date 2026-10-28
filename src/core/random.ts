import { IbejiError } from "./errors.js";

const UINT32_MAX = 4294967295;

/**
 * A small seeded generator. Mulberry32 uses only 32-bit integer operations, so
 * the same seed produces the same sequence on every platform and every run.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
      throw new IbejiError("BAD_REQUEST", {
        what: "The random seed is invalid.",
        why: "A seed must be a whole number from 0 to 4294967295.",
        fix: "Choose a seed in that range and try again.",
      });
    }
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new IbejiError("BAD_REQUEST", {
        what: "The random integer range is invalid.",
        why: "The minimum and maximum must be safe whole numbers, and the minimum must not be greater than the maximum.",
        fix: "Pass a range where min is less than or equal to max.",
      });
    }

    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(percent: number): boolean {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new IbejiError("BAD_REQUEST", {
        what: "The random percentage is invalid.",
        why: "A percentage must be a number from 0 to 100.",
        fix: "Choose a percentage in that range and try again.",
      });
    }

    return this.next() * 100 < percent;
  }
}
