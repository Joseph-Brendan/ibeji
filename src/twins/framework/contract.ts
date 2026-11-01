import { readFile } from "node:fs/promises";

import { IbejiError } from "../../core/errors.js";
import type { RunningTwin } from "./server.js";
import type { HttpMethod, JsonValue } from "./types.js";

export type ContractRequest = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type ContractResponse = {
  readonly status: number;
  readonly body: JsonValue;
};

export type ContractFixture = {
  readonly request: ContractRequest;
  readonly response: ContractResponse;
};

export class ContractMismatchError extends Error {
  readonly differences: readonly string[];

  constructor(differences: readonly string[]) {
    super(`The twin response does not match the fixture:\n- ${differences.join("\n- ")}`);
    this.name = "ContractMismatchError";
    this.differences = differences;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function compare(expected: JsonValue, actual: unknown, path: string, differences: string[]): void {
  if (expected === null) {
    if (actual !== null) {
      differences.push(`${path}: expected null, got ${typeName(actual)}`);
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences.push(`${path}: expected array, got ${typeName(actual)}`);
      return;
    }
    if (actual.length !== expected.length) {
      differences.push(`${path}: expected ${expected.length} items, got ${actual.length}`);
      return;
    }
    expected.forEach((item, index) => {
      compare(item, actual[index], `${path}[${index}]`, differences);
    });
    return;
  }

  if (typeof expected === "object") {
    if (!isRecord(actual)) {
      differences.push(`${path}: expected object, got ${typeName(actual)}`);
      return;
    }

    const expectedObject = expected as { readonly [key: string]: JsonValue };
    const expectedKeys = Object.keys(expectedObject);
    const actualKeys = Object.keys(actual);
    for (const key of expectedKeys) {
      if (!Object.hasOwn(actual, key)) {
        differences.push(`${path}.${key}: missing key`);
      } else {
        compare(expectedObject[key] as JsonValue, actual[key], `${path}.${key}`, differences);
      }
    }
    for (const key of actualKeys) {
      if (!Object.hasOwn(expected, key)) {
        differences.push(`${path}.${key}: unexpected key`);
      }
    }
    return;
  }

  if (typeof actual !== typeof expected) {
    differences.push(`${path}: expected ${typeof expected}, got ${typeName(actual)}`);
  }
}

/** Compare a fixture body with a response body by shape, not by value. */
export function compareContractBody(
  expected: JsonValue,
  actual: unknown,
  path = "$",
): readonly string[] {
  const differences: string[] = [];
  compare(expected, actual, path, differences);
  return differences;
}

export function compareContractResponse(
  expected: ContractResponse,
  status: number,
  body: unknown,
): readonly string[] {
  const differences: string[] = [];
  if (status !== expected.status) {
    differences.push(`$.status: expected ${expected.status}, got ${status}`);
  }
  differences.push(...compareContractBody(expected.body, body));
  return differences;
}

function parseFixture(value: unknown, file: string): ContractFixture {
  if (!isRecord(value)) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The contract fixture is not an object.",
      why: `${file} must contain a request and a response.`,
      fix: "Use the contract fixture format from test/contract/README.md.",
    });
  }

  const request = value.request;
  const response = value.response;
  if (
    !isRecord(request) ||
    typeof request.method !== "string" ||
    typeof request.path !== "string" ||
    !isRecord(response) ||
    typeof response.status !== "number" ||
    !Object.hasOwn(response, "body")
  ) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The contract fixture is missing a field.",
      why: `${file} must have request.method, request.path, response.status and response.body.`,
      fix: "Correct the fixture and run the test again.",
    });
  }

  const method = request.method;
  if (method !== "GET" && method !== "POST" && method !== "PUT" && method !== "DELETE") {
    throw new IbejiError("BAD_REQUEST", {
      what: `The contract fixture uses the unknown method "${method}".`,
      why: `${file} must use GET, POST, PUT or DELETE.`,
      fix: "Correct the fixture method and run the test again.",
    });
  }

  const headers = request.headers;
  if (headers !== undefined && !isRecord(headers)) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The contract fixture headers are not an object.",
      why: `${file} request.headers must be an object of strings.`,
      fix: "Correct the fixture headers and run the test again.",
    });
  }

  return {
    request: {
      method,
      path: request.path,
      ...(headers === undefined ? {} : { headers: headers as Readonly<Record<string, string>> }),
      ...(typeof request.body === "string" ? { body: request.body } : {}),
    },
    response: {
      status: response.status,
      body: response.body as JsonValue,
    },
  };
}

export async function loadContractFixture(file: string): Promise<ContractFixture> {
  const text = await readFile(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The contract fixture is not valid JSON.",
      why: `${file} could not be parsed as JSON.`,
      fix: "Correct the JSON syntax and run the test again.",
      cause: error,
    });
  }
  return parseFixture(parsed, file);
}

export async function assertContract(
  running: RunningTwin,
  fixture: ContractFixture,
): Promise<void> {
  const url = `http://127.0.0.1:${running.port}${fixture.request.path}`;
  const init: RequestInit = {
    method: fixture.request.method,
    redirect: "manual",
    ...(fixture.request.headers === undefined ? {} : { headers: fixture.request.headers }),
    ...(fixture.request.body === undefined ? {} : { body: fixture.request.body }),
  };
  const response = await fetch(url, init);

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new ContractMismatchError([
        `$.body: expected JSON, got ${JSON.stringify(text.slice(0, 120))}`,
        `cause: ${String(error)}`,
      ]);
    }
  }

  const differences = compareContractResponse(fixture.response, response.status, body);
  if (differences.length > 0) {
    throw new ContractMismatchError(differences);
  }
}

export async function assertContractFile(running: RunningTwin, file: string): Promise<void> {
  await assertContract(running, await loadContractFixture(file));
}
