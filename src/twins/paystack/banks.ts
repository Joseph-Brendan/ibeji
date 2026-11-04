import paystackAccountNames from "./data/account-names.json" with { type: "json" };
import paystackBanks from "./data/banks.json" with { type: "json" };

export type PaystackBank = {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly code: string;
  readonly longcode: string;
  readonly gateway: string | null;
  readonly pay_with_bank: boolean;
  readonly supports_transfer: boolean;
  readonly available_for_direct_debit: boolean;
  readonly active: boolean;
  readonly country: string;
  readonly currency: string;
  readonly type: string;
  readonly is_deleted: boolean;
  readonly createdAt: string | null;
  readonly updatedAt: string;
};

/** The recorded bank-list fixture, stored as package data. */
export const PAYSTACK_BANKS: readonly PaystackBank[] = paystackBanks;

/** A fixed list of fictional names used for account resolution. */
export const PAYSTACK_ACCOUNT_NAMES: readonly string[] = paystackAccountNames;

export function listBanks(country: string | undefined): readonly PaystackBank[] {
  if (country === undefined || country.trim().toLowerCase() === "nigeria") {
    return PAYSTACK_BANKS;
  }
  return [];
}

export function findBank(code: string): PaystackBank | undefined {
  return PAYSTACK_BANKS.find((bank) => bank.code === code);
}

export function isKnownBankCode(code: string): boolean {
  return code === "001" || findBank(code) !== undefined;
}

export function bankNameFor(code: string): string {
  return findBank(code)?.name ?? "Ibeji Test Bank";
}

export function bankIdFor(code: string): number {
  return code === "001" ? 24 : (findBank(code)?.id ?? 24);
}

/**
 * The account name is a deterministic choice from the fixed fictional list.
 * Paystack docs do not describe how a test-mode account name is chosen.
 */
export function accountNameFor(accountNumber: string, bankCode: string): string {
  const total = [...`${accountNumber}${bankCode}`].reduce(
    (sum, character) => sum + (character >= "0" && character <= "9" ? Number(character) : 0),
    0,
  );
  return PAYSTACK_ACCOUNT_NAMES[total % PAYSTACK_ACCOUNT_NAMES.length] as string;
}
