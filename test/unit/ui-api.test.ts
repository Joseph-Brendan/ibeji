import { describe, expect, it } from "vitest";

import { ApiError, ConnectionError, ControlApi, REQUEST_HEADER } from "../../ui/src/api/client.js";

type Call = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

function fakeFetch(
  handler: (call: Call) => Response | Promise<Response>,
  calls: Call[],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("T8 UI API client", () => {
  it("T8: GET requests send the cookie and no change header", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => jsonResponse(200, { ok: true }), calls),
    });

    await api.getStatus();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/status");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.has(REQUEST_HEADER)).toBe(false);
  });

  it("T8: changing requests send X-Ibeji-Request and a JSON body", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => jsonResponse(200, { ok: true }), calls),
    });

    await api.rotateCredentials("twin one");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/credentials/rotate");
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get(REQUEST_HEADER)).toBe("1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ twin: "twin one" }));
  });

  it("T8: state reads and resets use the control API and mark changes", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => jsonResponse(200, { ok: true }), calls),
    });

    await api.getState("twin one");
    expect(calls[0]?.url).toBe("/api/twins/twin%20one/state");
    expect(calls[0]?.init?.method).toBe("GET");

    await api.resetState("twin one");
    expect(calls[1]?.url).toBe("/api/twins/twin%20one/state");
    expect(calls[1]?.init?.method).toBe("DELETE");
    expect(new Headers(calls[1]?.init?.headers).get(REQUEST_HEADER)).toBe("1");

    await api.resetState();
    expect(calls[2]?.url).toBe("/api/state");
    expect(calls[2]?.init?.method).toBe("DELETE");
  });

  it("T8: exchange and event queries use the expected paths", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => jsonResponse(200, { ok: true }), calls),
    });

    await api.exchangeLaunchCode("code with spaces");
    expect(calls[0]?.url).toBe("/api/auth/exchange");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ code: "code with spaces" }));

    await api.getEvents({ scope: "pay stack", type: "request", after: 4, limit: 10 });
    expect(calls[1]?.url).toContain("/api/events?");
    expect(calls[1]?.url).toContain("scope=pay+stack");
    expect(calls[1]?.url).toContain("type=request");
    expect(calls[1]?.url).toContain("after=4");
    expect(calls[1]?.url).toContain("limit=10");
  });

  it("T8: failure, rule and scenario changes use the control API", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => jsonResponse(200, { ok: true }), calls),
    });

    await api.getFailures();
    expect(calls[0]?.url).toBe("/api/failures");
    await api.getRules();
    expect(calls[1]?.url).toBe("/api/rules");
    await api.addRule({
      failureId: "server-error",
      twins: ["twin one"],
      actions: "charge",
      settings: { times: 1, status: 500 },
    });
    expect(calls[2]?.url).toBe("/api/rules");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(new Headers(calls[2]?.init?.headers).get(REQUEST_HEADER)).toBe("1");
    await api.clearRules("twin one");
    expect(calls[3]?.url).toBe("/api/rules?twin=twin%20one");
    expect(calls[3]?.init?.method).toBe("DELETE");
    await api.getScenarios();
    expect(calls[4]?.url).toBe("/api/scenarios");
    await api.runScenario("slow-friday", ["twin one"]);
    expect(calls[5]?.url).toBe("/api/scenarios/slow-friday/run");
    expect(calls[5]?.init?.body).toBe(JSON.stringify({ twins: ["twin one"] }));
    await api.stopScenario();
    expect(calls[6]?.url).toBe("/api/scenarios/stop");
    expect(calls[6]?.init?.method).toBe("POST");
  });

  it("T8: C12 errors keep their what, why and fix", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(
        () =>
          jsonResponse(401, {
            error: {
              code: "UNAUTHORIZED",
              what: "The request is not authorized.",
              why: "The cookie is missing.",
              fix: "Run ibeji open.",
            },
          }),
        calls,
      ),
    });

    try {
      await api.getStatus();
      throw new Error("the request was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) {
        expect(error.code).toBe("UNAUTHORIZED");
        expect(error.what).toBe("The request is not authorized.");
        expect(error.why).toBe("The cookie is missing.");
        expect(error.fix).toBe("Run ibeji open.");
        expect(error.status).toBe(401);
      }
    }
  });

  it("T8: a stale session is marked so the page can say Ibeji was restarted", async () => {
    const calls: Call[] = [];
    const api = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: "UNAUTHORIZED",
                what: "The request is not authorized.",
                why: "The sign-in cookie is wrong.",
                fix: "Run ibeji open.",
              },
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json",
                "x-ibeji-stale-session": "1",
              },
            },
          ),
        calls,
      ),
    });

    await expect(api.getStatus()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      staleSession: true,
    });
  });

  it("T8: unknown error codes and network failures are safe", async () => {
    const calls: Call[] = [];
    const unknown = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => jsonResponse(500, { error: { code: "NOT_A_CODE" } }), calls),
    });
    await expect(unknown.getStatus()).rejects.toMatchObject({ code: "INTERNAL" });

    const dead = new ControlApi({
      baseUrl: "/api",
      fetchImpl: fakeFetch(() => {
        throw new Error("connection refused");
      }, calls),
    });
    await expect(dead.getStatus()).rejects.toBeInstanceOf(ConnectionError);
  });
});
