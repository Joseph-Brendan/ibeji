import type { CredentialSpec, CryptoRandom } from "../framework/types.js";

export const FLUTTERWAVE_PUBLIC_PREFIX = "FLWPUBK_TEST-ibeji-";
export const FLUTTERWAVE_SECRET_PREFIX = "FLWSECK_TEST-ibeji-";
export const FLUTTERWAVE_WEBHOOK_PREFIX = "ibeji_";

function hex(random: CryptoRandom, bytes: number): string {
  return [...random.bytes(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export const flutterwaveCredentialSpecs: readonly CredentialSpec[] = [
  {
    id: "public",
    label: "Public key",
    role: "public",
    secret: false,
    generate: (random) => `${FLUTTERWAVE_PUBLIC_PREFIX}${hex(random, 12)}`,
    isTestFormat: (value) => /^FLWPUBK_TEST-[^\s]+$/u.test(value),
  },
  {
    id: "secret",
    label: "Secret key",
    role: "secret",
    secret: true,
    generate: (random) => `${FLUTTERWAVE_SECRET_PREFIX}${hex(random, 12)}`,
    isTestFormat: (value) => /^FLWSECK_TEST-[^\s]+$/u.test(value),
  },
  {
    id: "webhook",
    label: "Webhook secret hash",
    role: "webhook",
    secret: true,
    generate: (random) => `${FLUTTERWAVE_WEBHOOK_PREFIX}${hex(random, 12)}`,
    isTestFormat: (value) => /^ibeji_[^\s]+$/u.test(value),
  },
];
