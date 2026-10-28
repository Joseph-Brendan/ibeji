import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { IbejiError } from "../errors.js";

export type AddressFamily = 4 | 6;

export type DnsAddress = {
  readonly address: string;
  readonly family: AddressFamily;
};

export type DnsResolver = (hostname: string) => Promise<readonly DnsAddress[]>;

export type AddressPolicy = {
  readonly allowPrivate: boolean;
  readonly allowPublic: boolean;
};

export type ResolvedWebhookUrl = {
  readonly url: URL;
  readonly addresses: readonly DnsAddress[];
};

export const DEFAULT_ADDRESS_POLICY: AddressPolicy = {
  allowPrivate: false,
  allowPublic: false,
};

function subnetList(entries: readonly (readonly [string, number, "ipv4" | "ipv6"])[]): BlockList {
  const list = new BlockList();
  for (const [network, prefix, family] of entries) {
    list.addSubnet(network, prefix, family);
  }
  return list;
}

const ALWAYS_REFUSED = subnetList([
  ["0.0.0.0", 32, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["255.255.255.255", 32, "ipv4"],
  ["::", 128, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
]);

const LOOPBACK = subnetList([
  ["127.0.0.0", 8, "ipv4"],
  ["::1", 128, "ipv6"],
]);

const PRIVATE = subnetList([
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["fc00::", 7, "ipv6"],
]);

type AddressKind = "allowed" | "invalid" | "always-refused" | "private-refused" | "public-refused";

function familyName(family: AddressFamily): "ipv4" | "ipv6" {
  return family === 4 ? "ipv4" : "ipv6";
}

function matches(list: BlockList, address: string, family: AddressFamily): boolean {
  return list.check(address, familyName(family));
}

export function isWebhookAddressAllowed(
  address: string,
  family: AddressFamily,
  policy: AddressPolicy,
): boolean {
  return addressKind(address, family, policy) === "allowed";
}

function addressKind(address: string, family: AddressFamily, policy: AddressPolicy): AddressKind {
  if (isIP(address) !== family) {
    return "invalid";
  }
  if (matches(ALWAYS_REFUSED, address, family)) {
    return "always-refused";
  }
  if (matches(LOOPBACK, address, family)) {
    return "allowed";
  }
  if (matches(PRIVATE, address, family)) {
    return policy.allowPrivate ? "allowed" : "private-refused";
  }
  return policy.allowPublic ? "allowed" : "public-refused";
}

export function sortDnsAddresses(addresses: DnsAddress[]): readonly DnsAddress[] {
  return addresses.sort((left, right) => left.family - right.family);
}

export function defaultDnsResolver(hostname: string): Promise<readonly DnsAddress[]> {
  return lookup(hostname, { all: true, verbatim: true }).then((results) =>
    sortDnsAddresses(
      results.map((result) => ({
        address: result.address,
        family: result.family === 6 ? 6 : 4,
      })),
    ),
  );
}

function notAllowed(what: string, why: string, fix: string, cause?: unknown): IbejiError {
  return new IbejiError("WEBHOOK_URL_NOT_ALLOWED", {
    what,
    why,
    fix,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function parseWebhookUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw notAllowed(
      "The webhook URL is not allowed.",
      "The value is not a URL that Ibeji can parse.",
      "Use an http or https URL, for example http://127.0.0.1:3000/webhook.",
      error,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw notAllowed(
      "The webhook URL is not allowed.",
      `The URL uses the "${url.protocol}" scheme.`,
      "Use an http or https URL.",
    );
  }

  return url;
}

export function dnsHostname(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

type RefusedKind = Exclude<AddressKind, "allowed">;

const REFUSAL_FIX: Readonly<Record<RefusedKind, string>> = {
  "private-refused":
    "Use a loopback address, or start Ibeji with --allow-private-webhooks to allow private network addresses.",
  "public-refused":
    "Use a loopback or private address, or start Ibeji with --allow-public-webhooks to allow public addresses.",
  "always-refused": "Use an address that is not unspecified, link-local, multicast, or broadcast.",
  invalid: "Use a host name that resolves to valid IPv4 or IPv6 addresses.",
};

const REFUSAL_WHY: Readonly<Record<RefusedKind, string>> = {
  "private-refused": "a private network address",
  "public-refused": "a public address",
  "always-refused": "an unspecified, link-local, multicast, or broadcast address",
  invalid: "not a valid IPv4 or IPv6 address",
};

function refusalFix(kind: RefusedKind): string {
  return REFUSAL_FIX[kind];
}

function refusalWhy(kind: RefusedKind): string {
  return REFUSAL_WHY[kind];
}

/**
 * Resolve a webhook URL and check every address before any connection is made.
 * The returned addresses are the only addresses the dispatcher may connect to.
 */
export async function resolveAllowedWebhookUrl(
  rawUrl: string,
  policy: AddressPolicy,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<ResolvedWebhookUrl> {
  const url = parseWebhookUrl(rawUrl);
  const hostname = dnsHostname(url);
  const addresses = await resolver(hostname);

  if (addresses.length === 0) {
    throw notAllowed(
      "The webhook URL is not allowed.",
      `${hostname} did not resolve to any IPv4 or IPv6 address.`,
      "Use a host name that resolves to at least one address.",
    );
  }

  for (const address of addresses) {
    const kind = addressKind(address.address, address.family, policy);
    if (kind !== "allowed") {
      throw notAllowed(
        "The webhook URL is not allowed.",
        `${hostname} resolves to ${address.address}, which is ${refusalWhy(kind)}.`,
        refusalFix(kind),
      );
    }
  }

  return { url, addresses };
}
