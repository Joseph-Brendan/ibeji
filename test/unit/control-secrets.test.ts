import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  LAUNCH_CODE_BYTES,
  LAUNCH_CODE_TTL_MS,
  SessionSecrets,
  TOKEN_BYTES,
} from "../../src/control/secrets.js";
import { FakeClock } from "../../src/core/clock.js";
import { IbejiError } from "../../src/core/errors.js";

describe("T6 session secrets and launch codes", () => {
  it("T6 creates a 32-byte session token from the random source", () => {
    const clock = new FakeClock(1_000);
    const secrets = new SessionSecrets(clock);
    expect(Buffer.from(secrets.token, "base64url")).toHaveLength(TOKEN_BYTES);
  });

  it("T6 compares tokens in constant time and handles different lengths", () => {
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "samo")).toBe(false);
    expect(constantTimeEqual("short", "a much longer value")).toBe(false);
  });

  it("T6 creates a 2-minute single-use launch code and a separate UI token", () => {
    const clock = new FakeClock(5_000);
    const secrets = new SessionSecrets(clock);
    const launch = secrets.createLaunchCode();

    expect(launch.expiresAt).toBe(5_000 + LAUNCH_CODE_TTL_MS);
    expect(clock.now() + 120_000).toBe(launch.expiresAt);
    expect(Buffer.from(launch.code, "base64url")).toHaveLength(LAUNCH_CODE_BYTES);

    const uiToken = secrets.exchangeLaunchCode(launch.code);
    expect(uiToken).not.toBe(secrets.token);
    expect(secrets.matchesUiToken(uiToken)).toBe(true);
    expect(secrets.matchesBearerToken(uiToken)).toBe(false);
    expect(secrets.matchesBearerToken(secrets.token)).toBe(true);
  });

  it("T6 rejects a used, expired, or made-up launch code", () => {
    const clock = new FakeClock(10_000);
    const secrets = new SessionSecrets(clock);

    const used = secrets.createLaunchCode();
    secrets.exchangeLaunchCode(used.code);
    expect(() => secrets.exchangeLaunchCode(used.code)).toThrow(IbejiError);

    const expired = secrets.createLaunchCode();
    clock.advanceBy(LAUNCH_CODE_TTL_MS);
    expect(() => secrets.exchangeLaunchCode(expired.code)).toThrow(
      expect.objectContaining({ code: "LAUNCH_CODE_INVALID" }),
    );

    expect(() => secrets.exchangeLaunchCode("made-up")).toThrow(
      expect.objectContaining({ code: "LAUNCH_CODE_INVALID" }),
    );
  });

  it("T6 builds a dashboard link without putting the bearer token in it", () => {
    const secrets = new SessionSecrets(new FakeClock());
    const link = secrets.createLaunchLink("http://127.0.0.1:4400");

    expect(link.startsWith("http://127.0.0.1:4400/_ibeji/?launch=")).toBe(true);
    expect(link).not.toContain(secrets.token);
  });

  it("T6 lists every secret that must never be echoed", () => {
    const secrets = new SessionSecrets(new FakeClock());
    const launch = secrets.createLaunchCode();
    const uiToken = secrets.exchangeLaunchCode(launch.code);
    const values = secrets.secretValues();

    expect(values).toContain(secrets.token);
    expect(values).toContain(uiToken);
    expect(values).toContain(launch.code);
    for (const value of values) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
