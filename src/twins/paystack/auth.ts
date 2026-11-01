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
  return key.startsWith("pk_live_") || key.startsWith("sk_live_");
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
      return unauthorizedResponse("Live keys are not accepted by Ibeji.");
    case "missing":
      return unauthorizedResponse("No secret key was provided.");
    case "wrong":
      return unauthorizedResponse("Invalid secret key.");
  }
}

export const paystackAuth: AuthAdapter = {
  readKey: readBearer,
  isLiveKey,
  classify,
  unauthorized,
};
