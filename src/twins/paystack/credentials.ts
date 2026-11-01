import type { CredentialSpec, CryptoRandom } from "../framework/types.js";

export const PAYSTACK_PUBLIC_PREFIX = "pk_test_ibeji_";
export const PAYSTACK_SECRET_PREFIX = "sk_test_ibeji_";

function hex(random: CryptoRandom, bytes: number): string {
  return [...random.bytes(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export const paystackCredentialSpecs: readonly CredentialSpec[] = [
  {
    id: "public",
    label: "Public key",
    role: "public",
    secret: false,
    generate: (random) => `${PAYSTACK_PUBLIC_PREFIX}${hex(random, 12)}`,
    isTestFormat: (value) => /^pk_test_[^\s]+$/u.test(value),
  },
  {
    id: "secret",
    label: "Secret key",
    role: "secret",
    secret: true,
    generate: (random) => `${PAYSTACK_SECRET_PREFIX}${hex(random, 12)}`,
    isTestFormat: (value) => /^sk_test_[^\s]+$/u.test(value),
  },
];
