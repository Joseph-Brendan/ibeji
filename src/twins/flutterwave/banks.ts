import flutterwaveAccountNames from "./data/account-names.json" with { type: "json" };
import flutterwaveBanks from "./data/banks.json" with { type: "json" };

export type FlutterwaveBank = {
  readonly id: number;
  readonly code: string;
  readonly name: string;
};

/** The recorded NG bank-list fixture, stored as package data. */
export const FLUTTERWAVE_BANKS: readonly FlutterwaveBank[] = flutterwaveBanks;

/** A fixed list of fictional Nigerian names used for account resolution. */
export const FLUTTERWAVE_ACCOUNT_NAMES: readonly string[] = flutterwaveAccountNames;

export function banksForCountry(country: string): readonly FlutterwaveBank[] {
  return country.trim().toUpperCase() === "NG" ? FLUTTERWAVE_BANKS : [];
}

export function findBank(code: string): FlutterwaveBank | undefined {
  return FLUTTERWAVE_BANKS.find((bank) => bank.code === code);
}

export function bankNameFor(code: string): string {
  return findBank(code)?.name ?? "Flutterwave Bank";
}

function digitTotal(value: string): number {
  return [...value].reduce(
    (sum, character) => sum + (character >= "0" && character <= "9" ? Number(character) : 0),
    0,
  );
}

/**
 * The account name is a deterministic choice from the fixed fictional list.
 * Flutterwave docs do not describe how a test-mode account name is chosen.
 */
export function accountNameFor(accountNumber: string, bankCode: string): string {
  const names = FLUTTERWAVE_ACCOUNT_NAMES;
  const index = (digitTotal(accountNumber) + digitTotal(bankCode)) % names.length;
  return names[index] ?? "Ibeji Test Customer";
}
