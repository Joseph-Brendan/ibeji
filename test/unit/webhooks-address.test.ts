import { describe, expect, it } from "vitest";

import { IbejiError } from "../../src/core/errors.js";
import {
  type AddressFamily,
  type AddressPolicy,
  type DnsAddress,
  type DnsResolver,
  defaultDnsResolver,
  dnsHostname,
  isWebhookAddressAllowed,
  parseWebhookUrl,
  resolveAllowedWebhookUrl,
  sortDnsAddresses,
} from "../../src/core/webhooks/address.js";

const loopbackOnly: AddressPolicy = { allowPrivate: false, allowPublic: false };
const privateAllowed: AddressPolicy = { allowPrivate: true, allowPublic: false };
const publicAllowed: AddressPolicy = { allowPrivate: false, allowPublic: true };
const allAllowed: AddressPolicy = { allowPrivate: true, allowPublic: true };

function resolverFor(table: Readonly<Record<string, readonly DnsAddress[]>>): DnsResolver {
  return async (hostname) => table[hostname] ?? [];
}

function addressCases(): readonly {
  readonly address: string;
  readonly family: AddressFamily;
  readonly policy: AddressPolicy;
  readonly allowed: boolean;
}[] {
  return [
    { address: "127.0.0.1", family: 4, policy: loopbackOnly, allowed: true },
    { address: "127.255.255.255", family: 4, policy: loopbackOnly, allowed: true },
    { address: "::1", family: 6, policy: loopbackOnly, allowed: true },
    { address: "::ffff:127.0.0.1", family: 6, policy: loopbackOnly, allowed: true },

    { address: "10.0.0.1", family: 4, policy: loopbackOnly, allowed: false },
    { address: "172.16.0.1", family: 4, policy: loopbackOnly, allowed: false },
    { address: "192.168.1.1", family: 4, policy: loopbackOnly, allowed: false },
    { address: "fc00::1", family: 6, policy: loopbackOnly, allowed: false },
    { address: "8.8.8.8", family: 4, policy: loopbackOnly, allowed: false },

    { address: "10.0.0.1", family: 4, policy: privateAllowed, allowed: true },
    { address: "172.16.0.1", family: 4, policy: privateAllowed, allowed: true },
    { address: "172.31.255.255", family: 4, policy: privateAllowed, allowed: true },
    { address: "192.168.1.1", family: 4, policy: privateAllowed, allowed: true },
    { address: "fc00::1", family: 6, policy: privateAllowed, allowed: true },
    { address: "fd12:3456::1", family: 6, policy: privateAllowed, allowed: true },
    { address: "172.32.0.1", family: 4, policy: privateAllowed, allowed: false },
    { address: "8.8.8.8", family: 4, policy: privateAllowed, allowed: false },

    { address: "8.8.8.8", family: 4, policy: publicAllowed, allowed: true },
    { address: "1.1.1.1", family: 4, policy: publicAllowed, allowed: true },
    {
      address: "2606:4700:4700::1111",
      family: 6,
      policy: publicAllowed,
      allowed: true,
    },
    { address: "10.0.0.1", family: 4, policy: publicAllowed, allowed: false },
    { address: "192.168.1.1", family: 4, policy: publicAllowed, allowed: false },

    { address: "8.8.8.8", family: 4, policy: allAllowed, allowed: true },
    { address: "10.0.0.1", family: 4, policy: allAllowed, allowed: true },
    { address: "127.0.0.1", family: 4, policy: allAllowed, allowed: true },

    { address: "0.0.0.0", family: 4, policy: allAllowed, allowed: false },
    { address: "169.254.169.254", family: 4, policy: allAllowed, allowed: false },
    { address: "224.0.0.1", family: 4, policy: allAllowed, allowed: false },
    { address: "239.255.255.255", family: 4, policy: allAllowed, allowed: false },
    { address: "255.255.255.255", family: 4, policy: allAllowed, allowed: false },
    { address: "::", family: 6, policy: allAllowed, allowed: false },
    { address: "fe80::1", family: 6, policy: allAllowed, allowed: false },
    { address: "ff02::1", family: 6, policy: allAllowed, allowed: false },
    { address: "::ffff:169.254.169.254", family: 6, policy: allAllowed, allowed: false },
  ];
}

function expectNotAllowed(run: () => Promise<unknown>, fixPart?: string): Promise<void> {
  return run().then(
    () => {
      throw new Error("the address was unexpectedly allowed");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("WEBHOOK_URL_NOT_ALLOWED");
        if (fixPart !== undefined) {
          expect(error.fix).toContain(fixPart);
        }
      }
    },
  );
}

describe("C13 webhook address rules", () => {
  it("C13: allows and refuses every address family range for each option", () => {
    for (const entry of addressCases()) {
      expect(
        isWebhookAddressAllowed(entry.address, entry.family, entry.policy),
        `${entry.address} with ${JSON.stringify(entry.policy)}`,
      ).toBe(entry.allowed);
    }
  });

  it("C13: accepts only http and https URLs", async () => {
    const resolver = resolverFor({});
    await expectNotAllowed(
      () => resolveAllowedWebhookUrl("ftp://127.0.0.1/webhook", loopbackOnly, resolver),
      "http or https",
    );
    await expect(
      resolveAllowedWebhookUrl(
        "http://127.0.0.1:3000/webhook",
        loopbackOnly,
        resolverFor({
          "127.0.0.1": [{ address: "127.0.0.1", family: 4 }],
        }),
      ),
    ).resolves.toMatchObject({ url: { protocol: "http:" } });
    await expect(
      resolveAllowedWebhookUrl(
        "https://127.0.0.1:3000/webhook",
        loopbackOnly,
        resolverFor({
          "127.0.0.1": [{ address: "127.0.0.1", family: 4 }],
        }),
      ),
    ).resolves.toMatchObject({ url: { protocol: "https:" } });
  });

  it("C13: names the private flag in the fix", async () => {
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://app.internal:3000/webhook",
          loopbackOnly,
          resolverFor({ "app.internal": [{ address: "10.1.2.3", family: 4 }] }),
        ),
      "--allow-private-webhooks",
    );
  });

  it("C13: names the public flag in the fix", async () => {
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://app.example.com/webhook",
          loopbackOnly,
          resolverFor({ "app.example.com": [{ address: "8.8.8.8", family: 4 }] }),
        ),
      "--allow-public-webhooks",
    );
  });

  it("C13: always-refused addresses name no enabling flag", async () => {
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://metadata.example.com/latest",
          allAllowed,
          resolverFor({
            "metadata.example.com": [{ address: "169.254.169.254", family: 4 }],
          }),
        ),
      "unspecified, link-local, multicast, or broadcast",
    );
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://broadcast.example.com/",
          allAllowed,
          resolverFor({
            "broadcast.example.com": [{ address: "255.255.255.255", family: 4 }],
          }),
        ),
      "unspecified, link-local, multicast, or broadcast",
    );
  });

  it("C13: rejects a name that resolves to both an allowed and a refused address", async () => {
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://mixed.example.com/webhook",
          loopbackOnly,
          resolverFor({
            "mixed.example.com": [
              { address: "127.0.0.1", family: 4 },
              { address: "10.0.0.1", family: 4 },
            ],
          }),
        ),
      "--allow-private-webhooks",
    );
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://mixed-public.example.com/webhook",
          loopbackOnly,
          resolverFor({
            "mixed-public.example.com": [
              { address: "127.0.0.1", family: 4 },
              { address: "8.8.8.8", family: 4 },
            ],
          }),
        ),
      "--allow-public-webhooks",
    );
  });

  it("C13: tricky host names are judged by their resolved addresses", async () => {
    await expect(
      resolveAllowedWebhookUrl(
        "http://localhost.example.com/webhook",
        loopbackOnly,
        resolverFor({
          "localhost.example.com": [{ address: "127.0.0.1", family: 4 }],
        }),
      ),
    ).resolves.toBeDefined();
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://localhost.example.com/webhook",
          loopbackOnly,
          resolverFor({
            "localhost.example.com": [{ address: "8.8.8.8", family: 4 }],
          }),
        ),
      "--allow-public-webhooks",
    );

    await expect(
      resolveAllowedWebhookUrl(
        "http://127.0.0.1.nip.io/webhook",
        loopbackOnly,
        resolverFor({
          "127.0.0.1.nip.io": [{ address: "127.0.0.1", family: 4 }],
        }),
      ),
    ).resolves.toBeDefined();
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://127.0.0.1.nip.io/webhook",
          loopbackOnly,
          resolverFor({
            "127.0.0.1.nip.io": [{ address: "10.0.0.1", family: 4 }],
          }),
        ),
      "--allow-private-webhooks",
    );
  });

  it("C13: host.docker.internal needs the private option unless it resolves publicly", async () => {
    await expect(
      resolveAllowedWebhookUrl(
        "http://host.docker.internal:3000/webhook",
        privateAllowed,
        resolverFor({
          "host.docker.internal": [{ address: "192.168.65.2", family: 4 }],
        }),
      ),
    ).resolves.toBeDefined();
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://host.docker.internal:3000/webhook",
          loopbackOnly,
          resolverFor({
            "host.docker.internal": [{ address: "192.168.65.2", family: 4 }],
          }),
        ),
      "--allow-private-webhooks",
    );
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://host.docker.internal:3000/webhook",
          privateAllowed,
          resolverFor({
            "host.docker.internal": [{ address: "8.8.8.8", family: 4 }],
          }),
        ),
      "--allow-public-webhooks",
    );
  });

  it("C13: an empty DNS result is refused", async () => {
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl("http://empty.example.com/webhook", loopbackOnly, resolverFor({})),
      "resolves to at least one address",
    );
  });

  it("C13: invalid addresses and malformed URLs are refused", async () => {
    expect(isWebhookAddressAllowed("not-an-ip", 4, loopbackOnly)).toBe(false);
    await expectNotAllowed(
      () =>
        resolveAllowedWebhookUrl(
          "http://invalid.example.com/webhook",
          loopbackOnly,
          resolverFor({
            "invalid.example.com": [{ address: "not-an-ip", family: 4 }],
          }),
        ),
      "valid IPv4 or IPv6",
    );
    await expectNotAllowed(
      () => resolveAllowedWebhookUrl("not a URL", loopbackOnly, resolverFor({})),
      "http or https",
    );
  });

  it("C13: the default resolver handles IPv4 and IPv6 literals without DNS", async () => {
    await expect(defaultDnsResolver("127.0.0.1")).resolves.toEqual([
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(defaultDnsResolver("::1")).resolves.toEqual([{ address: "::1", family: 6 }]);
    expect(
      sortDnsAddresses([
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).toEqual([
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ]);
  });

  it("C13: strips brackets from IPv6 URL host names and keeps IPv4 names", () => {
    expect(dnsHostname(new URL("http://[::1]:3000/webhook"))).toBe("::1");
    expect(dnsHostname(new URL("http://127.0.0.1:3000/webhook"))).toBe("127.0.0.1");
    expect(() => parseWebhookUrl("not a URL")).toThrow(IbejiError);
  });
});
