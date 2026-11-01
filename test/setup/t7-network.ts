import net from "node:net";

export const T7_BLOCK_PREFIX = "T7: outbound connection blocked";
export const T7_ALLOWED_HOSTS: readonly string[] = [
  "127.0.0.1",
  "::1",
  "[::1]",
  "::ffff:127.0.0.1",
  "localhost",
];

const PROXY_VARIABLES = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const;

for (const name of PROXY_VARIABLES) {
  delete process.env[name];
}

function hostFromArgs(args: readonly unknown[]): string | undefined {
  const first = args[0];

  if (Array.isArray(first)) {
    return hostFromArgs(first);
  }

  if (typeof first === "string") {
    return undefined;
  }

  if (typeof first === "number") {
    const second = args[1];
    return typeof second === "string" ? second : "localhost";
  }

  if (typeof first === "object" && first !== null) {
    const options = first as Record<string, unknown>;
    if (typeof options.path === "string") {
      return undefined;
    }
    if (typeof options.host === "string") {
      return options.host;
    }
    if (typeof options.hostname === "string") {
      return options.hostname;
    }
    return "localhost";
  }

  return undefined;
}

function isAllowedHost(host: string): boolean {
  return T7_ALLOWED_HOSTS.includes(host.toLowerCase());
}

type ConnectFunction = (this: net.Socket, ...args: readonly unknown[]) => net.Socket;

const originalConnect = net.Socket.prototype.connect as unknown as ConnectFunction;

net.Socket.prototype.connect = function (
  this: net.Socket,
  ...args: readonly unknown[]
): net.Socket {
  const host = hostFromArgs(args);
  if (host !== undefined && !isAllowedHost(host)) {
    throw new Error(`${T7_BLOCK_PREFIX}: ${host}`);
  }
  return Reflect.apply(originalConnect, this, [...args]) as net.Socket;
} as unknown as typeof net.Socket.prototype.connect;
