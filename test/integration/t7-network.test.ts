import { createServer } from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";

import { T7_BLOCK_PREFIX } from "../setup/t7-network.js";

describe("T7 no outside network", () => {
  it("T7 removed proxy environment variables for the whole suite", () => {
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
    expect(process.env.http_proxy).toBeUndefined();
    expect(process.env.https_proxy).toBeUndefined();
  });

  it("T7 blocks a connection to an outside address", () => {
    expect(() => net.connect({ host: "203.0.113.1", port: 80 })).toThrow(T7_BLOCK_PREFIX);
    expect(() => net.connect(80, "example.com")).toThrow(T7_BLOCK_PREFIX);
  });

  it("T7 allows 127.0.0.1", async () => {
    const server = createServer((_request, response) => {
      response.end("local");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    expect(address).not.toBeNull();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(await response.text()).toBe("local");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
