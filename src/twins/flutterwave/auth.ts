import type {
  AuthAdapter,
  AuthFailure,
  AuthResult,
  TwinCredentials,
  TwinRequest,
  TwinResponse,
} from "../framework/types.js";
import { unauthorizedResponse } from "./responses.js";

function readBearer(request: TwinRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization === undefined) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
  return match?.[1] ?? null;
}

function isLiveKey(key: string): boolean {
  return key.startsWith("FLWPUBK-") || key.startsWith("FLWSECK-");
}

function classify(key: string | null, credentials: TwinCredentials): AuthResult {
  if (key === null) {
    return { kind: "missing" };
  }
  if (key === credentials.secret) {
    return { kind: "valid" };
  }
  return { kind: "wrong" };
}

function unauthorized(failure: AuthFailure): TwinResponse {
  switch (failure.kind) {
    case "live":
    case "wrong":
      return unauthorizedResponse("Invalid authorization key");
    case "missing":
      return unauthorizedResponse("Authorization required");
  }
}

export const flutterwaveAuth: AuthAdapter = {
  readKey: readBearer,
  isLiveKey,
  classify,
  unauthorized,
};
