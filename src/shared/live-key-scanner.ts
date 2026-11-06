import { fingerprint } from "../core/redact.js";

export type LiveKeyPattern = {
  readonly service: string;
  readonly pattern: RegExp;
};

export type LiveKeyMatch = {
  readonly key: string;
  readonly fingerprint: string;
  readonly services: readonly string[];
};

export type LiveKeyScan<T> = {
  readonly value: T;
  readonly matches: readonly LiveKeyMatch[];
};

function globalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.replaceAll(/[gy]/gu, "");
  return new RegExp(pattern.source, `${flags}g`);
}

function mergeMatches(target: Map<string, Set<string>>, matches: readonly LiveKeyMatch[]): void {
  for (const match of matches) {
    const services = target.get(match.key) ?? new Set<string>();
    for (const service of match.services) {
      services.add(service);
    }
    target.set(match.key, services);
  }
}

function finalMatches(target: ReadonlyMap<string, ReadonlySet<string>>): readonly LiveKeyMatch[] {
  return [...target.entries()].map(([key, services]) => ({
    key,
    fingerprint: fingerprint(key),
    services: [...services],
  }));
}

export function scanLiveKeyText(
  text: string,
  patterns: readonly LiveKeyPattern[],
): LiveKeyScan<string> {
  const found = new Map<string, Set<string>>();

  for (const entry of patterns) {
    const regex = globalPattern(entry.pattern);
    for (const match of text.matchAll(regex)) {
      const key = match[0];
      if (key.length === 0) {
        continue;
      }
      const services = found.get(key) ?? new Set<string>();
      services.add(entry.service);
      found.set(key, services);
    }
  }

  if (found.size === 0) {
    return { value: text, matches: [] };
  }

  const matches = finalMatches(found);
  let value = text;
  for (const match of [...matches].sort((left, right) => right.key.length - left.key.length)) {
    value = value.split(match.key).join(`[live key removed: ${match.fingerprint}]`);
  }
  return { value, matches };
}

function scanValue(
  value: unknown,
  patterns: readonly LiveKeyPattern[],
  found: Map<string, Set<string>>,
): unknown {
  if (typeof value === "string") {
    const scanned = scanLiveKeyText(value, patterns);
    mergeMatches(found, scanned.matches);
    return scanned.value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scanValue(item, patterns, found));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = scanValue(item, patterns, found);
    }
    return result;
  }

  return value;
}

export function scanLiveKeyValue<T>(value: T, patterns: readonly LiveKeyPattern[]): LiveKeyScan<T> {
  const found = new Map<string, Set<string>>();
  const scanned = scanValue(value, patterns, found) as T;
  return { value: scanned, matches: finalMatches(found) };
}

export function createLiveKeyScanner(patterns: readonly LiveKeyPattern[]) {
  return {
    scanText: (text: string): LiveKeyScan<string> => scanLiveKeyText(text, patterns),
    scanValue: <T>(value: T): LiveKeyScan<T> => scanLiveKeyValue(value, patterns),
    patterns,
  };
}

export type LiveKeyScanner = ReturnType<typeof createLiveKeyScanner>;

export function matchesLiveKey(value: string, patterns: readonly LiveKeyPattern[]): boolean {
  return scanLiveKeyText(value, patterns).matches.length > 0;
}
