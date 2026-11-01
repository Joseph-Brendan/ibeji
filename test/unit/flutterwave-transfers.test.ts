import { describe, expect, it } from "vitest";

import { testTransferSchedule } from "../../src/twins/flutterwave/transfers.js";

describe("C4 Flutterwave test-transfer schedules", () => {
  it("C4 follows the documented _PMCK and DU_n reference suffixes", () => {
    expect(testTransferSchedule("merchant_PMCK")).toEqual({
      status: "SUCCESSFUL",
      delayMs: 600_000,
    });
    expect(testTransferSchedule("merchant_PMCK_ST_F")).toEqual({
      status: "FAILED",
      delayMs: 600_000,
    });
    expect(testTransferSchedule("merchant_PMCKDU_1")).toEqual({
      status: "SUCCESSFUL",
      delayMs: 60_000,
    });
    expect(testTransferSchedule("merchant_PMCK_ST_FDU_1")).toEqual({
      status: "FAILED",
      delayMs: 60_000,
    });
    expect(testTransferSchedule("plain-reference")).toBeUndefined();
    expect(testTransferSchedule("merchant_PMCKDU_0")).toBeUndefined();
  });
});
