import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

export type ReceivedRequest = {
  readonly path: string;
  readonly method: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  readonly receivedAt: number;
};

export type LocalServer = {
  readonly url: string;
  readonly requests: readonly ReceivedRequest[];
  clear: () => void;
  waitForRequest: (
    predicate: (request: ReceivedRequest) => boolean,
    timeoutMs: number,
  ) => Promise<ReceivedRequest>;
  close: () => Promise<void>;
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The local test server did not get a TCP address."));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
    server.closeAllConnections();
  });
}

/**
 * A local receiver for webhook and checkout-callback tests. It binds to
 * 127.0.0.1 and answers 200, which is the only success status the twins expect.
 */
export async function startLocalServer(): Promise<LocalServer> {
  const requests: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        path: request.url ?? "/",
        method: request.method ?? "GET",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        receivedAt: Date.now(),
      });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
      response.end('<!doctype html><html lang="en"><body>Local test receiver</body></html>');
    });
  });
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    requests,
    clear: () => {
      requests.length = 0;
    },
    waitForRequest: async (predicate, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = requests.find(predicate);
        if (found !== undefined) {
          return found;
        }
        if (Date.now() >= deadline) {
          throw new Error(`No local request arrived within ${timeoutMs} ms.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    close: () => close(server),
  };
}
