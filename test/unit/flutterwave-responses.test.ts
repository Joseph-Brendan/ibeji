import { describe, expect, it } from "vitest";
import {
  flutterwaveResponses,
  serverErrorResponse,
} from "../../src/twins/flutterwave/responses.js";
import type { ActionDefinition, TwinResponse } from "../../src/twins/framework/types.js";

const unknownAction: ActionDefinition = {
  id: "unknown.action",
  method: "GET",
  path: "/unknown",
  summary: "Unknown action",
  kind: "read",
  handler: () => flutterwaveResponses.notFound(),
};

function jsonOf(response: TwinResponse): unknown {
  return JSON.parse(response.body as string);
}

describe("C4 Flutterwave response builder", () => {
  it("C4 uses Flutterwave's generic error shapes for every failure kind", async () => {
    const server = flutterwaveResponses.error({ kind: "server", status: 503 });
    expect(server.status).toBe(503);
    expect(jsonOf(server)).toEqual({
      status: "error",
      message: "An error occurred. Please contact support",
      data: null,
    });

    const rate = flutterwaveResponses.error({ kind: "rate-limited" });
    expect(rate.status).toBe(429);
    expect(jsonOf(rate)).toEqual({
      status: "error",
      message: "Too many requests",
      data: null,
    });

    const unauthorized = flutterwaveResponses.error({ kind: "unauthorized" });
    expect(unauthorized.status).toBe(401);
    expect(jsonOf(unauthorized)).toEqual({
      status: "error",
      message: "Authorization required",
      data: null,
    });

    const customUnauthorized = flutterwaveResponses.error({
      kind: "unauthorized",
      message: "Custom authorization error",
    });
    expect(jsonOf(customUnauthorized)).toMatchObject({
      message: "Custom authorization error",
    });

    const notFound = flutterwaveResponses.error({ kind: "not-found" });
    expect(notFound.status).toBe(404);
    expect(jsonOf(notFound)).toEqual({
      status: "error",
      message: "Not found",
      data: null,
    });

    const invalid = flutterwaveResponses.error({ kind: "invalid-request" });
    expect(invalid.status).toBe(400);
    expect(jsonOf(invalid)).toEqual({
      status: "error",
      message: "One or more required parameters missing",
      data: null,
    });

    const version = flutterwaveResponses.error({ kind: "version-unsupported" });
    expect(version.status).toBe(400);
    expect(jsonOf(version)).toEqual({
      status: "error",
      message: "Unsupported API version",
      data: null,
    });
  });

  it("C4 uses the app_error shape only for a 500", async () => {
    const fiveHundred = serverErrorResponse(500);
    expect(jsonOf(fiveHundred)).toEqual({
      error_id: "ERRNOIBEJI500",
      message: "Application error. Please contact support",
      code: "app_error",
    });

    const unavailable = serverErrorResponse(503);
    expect(jsonOf(unavailable)).toEqual({
      status: "error",
      message: "An error occurred. Please contact support",
      data: null,
    });
  });

  it("C4 falls back to the generic success message for an unknown action", async () => {
    const response = flutterwaveResponses.success(unknownAction, { ok: true });
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toEqual({
      status: "success",
      message: "Request successful",
      data: { ok: true },
    });
    expect(flutterwaveResponses.created(unknownAction, { ok: true }).status).toBe(200);
  });
});
