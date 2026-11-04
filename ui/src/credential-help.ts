import type { CredentialView } from "../../src/shared/control.js";

export function credentialHelp(role: CredentialView["role"]): string {
  switch (role) {
    case "public":
      return "Safe to use in browser test code.";
    case "secret":
      return "Keep this key on your server.";
    case "webhook":
      return "Use this to check that updates really came from Ibeji.";
  }
}
