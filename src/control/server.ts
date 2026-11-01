import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";

import { createControlApp } from "./app.js";
import type { BoundAddress, ControlDependencies } from "./types.js";

export type RunningControlServer = {
  readonly app: Hono;
  readonly server: Server;
  readonly address: BoundAddress;
  readonly stop: () => Promise<void>;
};

export type StartControlServerOptions = {
  readonly port: number;
};

export async function startControlServer(
  deps: ControlDependencies,
  options: StartControlServerOptions,
): Promise<RunningControlServer> {
  const app = createControlApp(deps);
  let bound: AddressInfo | undefined;

  const server = (await new Promise<Server>((resolve, reject) => {
    const instance = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: options.port,
      },
      (info) => {
        bound = info;
        deps.controlPort.value = info.port;
        resolve(instance as Server);
      },
    );
    instance.once("error", reject);
  })) as Server;

  const addressInfo = bound as AddressInfo;
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  };

  return {
    app,
    server,
    address: {
      hostname: "127.0.0.1",
      address: addressInfo.address,
      port: addressInfo.port,
      url: `http://127.0.0.1:${addressInfo.port}`,
    },
    stop,
  };
}
