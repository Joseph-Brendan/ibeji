import { fingerprint } from "../../core/redact.js";
import {
  createLiveKeyScanner,
  type LiveKeyMatch,
  type LiveKeyPattern,
  type LiveKeyScanner,
} from "../../shared/live-key-scanner.js";
import type { TwinRequest } from "./types.js";

export type ScannedTwinRequest = {
  readonly request: TwinRequest;
  readonly matches: readonly LiveKeyMatch[];
};

function mergeMatches(found: Map<string, Set<string>>, matches: readonly LiveKeyMatch[]): void {
  for (const match of matches) {
    const services = found.get(match.key) ?? new Set<string>();
    for (const service of match.services) {
      services.add(service);
    }
    found.set(match.key, services);
  }
}

function finalMatches(found: ReadonlyMap<string, ReadonlySet<string>>): readonly LiveKeyMatch[] {
  return [...found.entries()].map(([key, services]) => ({
    key,
    fingerprint: fingerprint(key),
    services: [...services],
  }));
}

function contentType(headers: Readonly<Record<string, string>>): string {
  return (headers["content-type"] ?? "").toLowerCase();
}

function scanHeaders(
  headers: Readonly<Record<string, string>>,
  scanner: LiveKeyScanner,
  found: Map<string, Set<string>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const scanned = scanner.scanText(value);
    mergeMatches(found, scanned.matches);
    result[name] = scanned.value;
  }
  return result;
}

function scanQuery(
  query: Readonly<Record<string, string | readonly string[]>>,
  scanner: LiveKeyScanner,
  found: Map<string, Set<string>>,
): Readonly<Record<string, string | readonly string[]>> {
  const result: Record<string, string | readonly string[]> = {};
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") {
      const scanned = scanner.scanText(value);
      mergeMatches(found, scanned.matches);
      result[name] = scanned.value;
      continue;
    }
    result[name] = value.map((item) => {
      const scanned = scanner.scanText(item);
      mergeMatches(found, scanned.matches);
      return scanned.value;
    });
  }
  return result;
}

function scanBody(
  rawBody: Uint8Array,
  type: string,
  scanner: LiveKeyScanner,
  found: Map<string, Set<string>>,
): Uint8Array {
  const text = new TextDecoder().decode(rawBody);
  if (type.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const scanned = scanner.scanValue(parsed);
      mergeMatches(found, scanned.matches);
      return new TextEncoder().encode(JSON.stringify(scanned.value));
    } catch {
      const scanned = scanner.scanText(text);
      mergeMatches(found, scanned.matches);
      return new TextEncoder().encode(scanned.value);
    }
  }

  if (type.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(text);
    for (const [name, value] of form) {
      const scanned = scanner.scanText(value);
      mergeMatches(found, scanned.matches);
      form.set(name, scanned.value);
    }
    return new TextEncoder().encode(form.toString());
  }

  const scanned = scanner.scanText(text);
  mergeMatches(found, scanned.matches);
  return new TextEncoder().encode(scanned.value);
}

export function createTwinLiveKeyScanner(
  patterns: readonly LiveKeyPattern[],
): (request: TwinRequest) => ScannedTwinRequest {
  const scanner = createLiveKeyScanner(patterns);
  return (request) => {
    const found = new Map<string, Set<string>>();
    const headers = scanHeaders(request.headers, scanner, found);
    const query = scanQuery(request.query, scanner, found);
    const rawBody = scanBody(request.rawBody, contentType(headers), scanner, found);
    return {
      request: { ...request, headers, query, rawBody },
      matches: finalMatches(found),
    };
  };
}
