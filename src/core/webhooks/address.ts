import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";

import { IbejiError } from "../errors.js";

export type AddressFamily = 4 | 6;

export type DnsAddress = {
  readonly address: string;
  readonly family: AddressFamily;
};

export type DnsResolver = (hostname: string) => Promise<readonly DnsAddress[]>;

export type NetworkInterfaceAddress = {
  readonly address: string;
  readonly netmask: string;
  readonly family: "IPv4" | "IPv6";
};

export type NetworkInterfaceList = Readonly<
  Record<string, readonly NetworkInterfaceAddress[] | undefined>
>;

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

function ipv4Number(address: string): number | undefined {
  if (isIP(address) !== 4) {
    return undefined;
  }
  let value = 0;
  for (const part of address.split(".")) {
    value = (value * 256 + Number(part)) >>> 0;
  }
  return value;
}

function ipv4Text(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function broadcastAddresses(interfaces: NetworkInterfaceList): ReadonlySet<string> {
  const broadcasts = new Set<string>(["255.255.255.255"]);
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4") {
        continue;
      }
      const address = ipv4Number(entry.address);
      const netmask = ipv4Number(entry.netmask);
      if (address === undefined || netmask === undefined) {
        continue;
      }
      const hostMask = ~netmask >>> 0;
      if (hostMask <= 1) {
        continue;
      }
      broadcasts.add(ipv4Text(((address & netmask) | hostMask) >>> 0));
    }
  }
  return broadcasts;
}

/**
 * The caller has already checked this is a valid IPv6 address. The parser only
 * handles the three documented IPv4-in-IPv6 forms, not every IPv6 edge case.
 */
function ipv6Words(address: string): readonly number[] {
  const withoutZone = address.replace(/%[^%]*$/u, "");
  let text = withoutZone.toLowerCase();
  let tailWords: number[] = [];
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const octets = text
      .slice(lastColon + 1)
      .split(".")
      .map((part) => Number(part));
    tailWords = [
      (octets[0] as number) * 256 + (octets[1] as number),
      (octets[2] as number) * 256 + (octets[3] as number),
    ];
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith("::")) {
      text = text.slice(0, -1);
    }
  }

  const [head = "", tail] = text.split("::");
  const parseWords = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((item) => Number.parseInt(item, 16));
  const headWords = parseWords(head);
  const tailParts = parseWords(tail ?? "");
  const missing = 8 - headWords.length - tailParts.length - tailWords.length;
  return [...headWords, ...Array.from({ length: missing }, () => 0), ...tailParts, ...tailWords];
}

function embeddedIpv4(address: string): string | undefined {
  const words = ipv6Words(address);
  const dotted = (high: number | undefined, low: number | undefined): string =>
    ipv4Text((((high as number) << 16) | (low as number)) >>> 0);
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return dotted(words[6], words[7]);
  }
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    return dotted(words[6], words[7]);
  }
  if (words[0] === 0x2002) {
    return dotted(words[1], words[2]);
  }
  return undefined;
}

export function isWebhookAddressAllowed(
  address: string,
  family: AddressFamily,
  policy: AddressPolicy,
  interfaces: NetworkInterfaceList = networkInterfaces(),
): boolean {
  return addressKind(address, family, policy, interfaces) === "allowed";
}

export function isLoopbackWebhookAddress(address: string, family: AddressFamily): boolean {
  return isIP(address) === family && matches(LOOPBACK, address, family);
}

function addressKind(
  address: string,
  family: AddressFamily,
  policy: AddressPolicy,
  interfaces: NetworkInterfaceList,
): AddressKind {
  if (isIP(address) !== family) {
    return "invalid";
  }
  if (family === 6) {
    const ipv4 = embeddedIpv4(address);
    if (ipv4 !== undefined) {
      return addressKind(ipv4, 4, policy, interfaces);
    }
  }
  if (family === 4 && broadcastAddresses(interfaces).has(address)) {
    return "always-refused";
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
  interfaces: NetworkInterfaceList = networkInterfaces(),
): Promise<ResolvedWebhookUrl> {
  const url = parseWebhookUrl(rawUrl);
  const hostname = dnsHostname(url);

  let addresses: readonly DnsAddress[];
  try {
    addresses = await resolver(hostname);
  } catch (error) {
    throw notAllowed(
      "The webhook URL is not allowed.",
      `${hostname} could not be resolved.`,
      "Use a host name that resolves to at least one address.",
      error,
    );
  }

  if (addresses.length === 0) {
    throw notAllowed(
      "The webhook URL is not allowed.",
      `${hostname} did not resolve to any IPv4 or IPv6 address.`,
      "Use a host name that resolves to at least one address.",
    );
  }

  for (const address of addresses) {
    const kind = addressKind(address.address, address.family, policy, interfaces);
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
