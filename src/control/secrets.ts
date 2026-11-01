import { randomBytes, timingSafeEqual } from "node:crypto";

import type { Clock } from "../core/clock.js";
import { IbejiError } from "../core/errors.js";

export const LAUNCH_CODE_TTL_MS = 120_000;
export const TOKEN_BYTES = 32;

export type ByteSource = (length: number) => Uint8Array;

export type LaunchCode = {
  readonly code: string;
  readonly expiresAt: number;
};

function launchCodeInvalid(): IbejiError {
  return new IbejiError("LAUNCH_CODE_INVALID");
}

/**
 * Compare two strings without leaking their contents or length through the
 * time the comparison takes. timingSafeEqual refuses different lengths, so the
 * length is checked first; a length mismatch is still a failed comparison.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

function randomToken(bytes: ByteSource): string {
  return Buffer.from(bytes(TOKEN_BYTES)).toString("base64url");
}

/**
 * The session's sign-in material. The bearer token is for the CLI and MCP
 * server; the UI gets a one-time launch code exchanged for a separate cookie
 * token. Launch codes are single use and expire after two minutes.
 */
export class SessionSecrets {
  readonly token: string;
  private readonly clock: Clock;
  private readonly bytes: ByteSource;
  private readonly uiTokens = new Set<string>();
  private readonly launchCodes = new Map<string, number>();
  private readonly retiredCodes = new Set<string>();

  constructor(clock: Clock, bytes: ByteSource = randomBytes) {
    this.clock = clock;
    this.bytes = bytes;
    this.token = randomToken(bytes);
  }

  createLaunchCode(): LaunchCode {
    const code = randomToken(this.bytes);
    const expiresAt = this.clock.now() + LAUNCH_CODE_TTL_MS;
    this.launchCodes.set(code, expiresAt);
    return { code, expiresAt };
  }

  /** A fresh dashboard link for `ibeji open`, tied to the bound control port. */
  createLaunchLink(controlUrl: string): string {
    return `${controlUrl}/?launch=${encodeURIComponent(this.createLaunchCode().code)}`;
  }

  /**
   * Consume a launch code and return a new UI token. A used, expired, or
   * unknown code gives LAUNCH_CODE_INVALID. The code is removed even when it
   * has expired, so it can never become valid again.
   */
  exchangeLaunchCode(code: string): string {
    const found = this.findLaunchCode(code);
    if (found === undefined) {
      throw launchCodeInvalid();
    }

    this.launchCodes.delete(found.code);
    this.retiredCodes.add(found.code);
    if (this.clock.now() >= found.expiresAt) {
      throw launchCodeInvalid();
    }

    const uiToken = randomToken(this.bytes);
    this.uiTokens.add(uiToken);
    return uiToken;
  }

  matchesBearerToken(value: string): boolean {
    return constantTimeEqual(value, this.token);
  }

  matchesUiToken(value: string): boolean {
    let matched = false;
    for (const token of this.uiTokens) {
      matched = constantTimeEqual(value, token) || matched;
    }
    return matched;
  }

  private findLaunchCode(code: string): { code: string; expiresAt: number } | undefined {
    let found: { code: string; expiresAt: number } | undefined;
    for (const [stored, expiresAt] of this.launchCodes) {
      if (constantTimeEqual(code, stored)) {
        found = { code: stored, expiresAt };
      }
    }
    return found;
  }

  /** Every token and code that must never be echoed to a person or a file. */
  secretValues(): readonly string[] {
    return [this.token, ...this.uiTokens, ...this.launchCodes.keys(), ...this.retiredCodes];
  }
}
