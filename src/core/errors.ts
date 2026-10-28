export type ErrorDefinition = {
  readonly status: number | undefined;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
};

/**
 * Every Ibeji error code from SPEC.md C12. The status is undefined where the
 * table says the code is only used by the CLI, by the MCP server, or at load
 * time, because those surfaces do not return an HTTP response.
 */
export const ERROR_DEFINITIONS = {
  BAD_REQUEST: {
    status: 400,
    what: "The request is not valid.",
    why: "One or more values in the request are missing, have the wrong type, or are not allowed.",
    fix: "Correct the values described in the error and try again.",
  },
  CONFIG_INVALID: {
    status: undefined,
    what: "The Ibeji configuration is invalid.",
    why: "One or more configuration values are missing, have the wrong type, or are not allowed.",
    fix: "Edit ibeji.config.json and correct every field listed in the error.",
  },
  CONFIG_HAS_SECRET: {
    status: undefined,
    what: "The Ibeji configuration contains something that looks like a secret.",
    why: "Configuration files are committed to repositories, so keys, tokens, and other secrets must never be stored in them.",
    fix: "Remove the secret from ibeji.config.json and pass it through the environment variable that the service expects.",
  },
  PORT_IN_USE: {
    status: undefined,
    what: "A port Ibeji needs is already in use.",
    why: "Another program, or another Ibeji session, is listening on that port.",
    fix: "Stop the other program or choose a different port with --port or --twin-port.",
  },
  SESSION_NOT_RUNNING: {
    status: undefined,
    what: "No Ibeji session is running.",
    why: "The command or tool needs a running session, and none was found.",
    fix: "Start Ibeji with ibeji start and run the command again.",
  },
  SESSION_STALE: {
    status: undefined,
    what: "The saved Ibeji session is no longer running.",
    why: "The session ended unexpectedly, or its process was stopped, but its session file is still present.",
    fix: "Run ibeji stop to clean up the stale session, then start Ibeji again.",
  },
  SESSION_ALREADY_RUNNING: {
    status: undefined,
    what: "An Ibeji session is already running.",
    why: "Only one session may run per user at a time.",
    fix: "Use the running session, or stop it with ibeji stop before starting a new one.",
  },
  UNAUTHORIZED: {
    status: 401,
    what: "The request is not authorized.",
    why: "The session token or sign-in cookie is missing, wrong, or expired.",
    fix: "Sign in again or use the token printed by ibeji start.",
  },
  LAUNCH_CODE_INVALID: {
    status: 401,
    what: "The launch code is not valid.",
    why: "The code is wrong, has already been used, or has expired.",
    fix: "Ask ibeji start to print a new dashboard link and open that link.",
  },
  FORBIDDEN_HOST: {
    status: 403,
    what: "The request came to the wrong host name.",
    why: "Ibeji only accepts requests addressed to 127.0.0.1 on the port it is using.",
    fix: "Change the app's base URL to 127.0.0.1 and the port printed by ibeji start.",
  },
  FORBIDDEN_ORIGIN: {
    status: 403,
    what: "The request came from a different origin.",
    why: "Ibeji accepts browser requests only from its own dashboard origin.",
    fix: "Open the dashboard from the link printed by ibeji start and retry from that page.",
  },
  NOT_FOUND: {
    status: 404,
    what: "The requested item was not found.",
    why: "No item matches the identifier or path in the request.",
    fix: "Check the identifier or path and try again.",
  },
  UNKNOWN_TWIN: {
    status: 404,
    what: "The requested twin is not known.",
    why: "The twin id does not match any twin in the registry.",
    fix: "Use one of the twin ids shown by ibeji twins, or by the dashboard.",
  },
  UNKNOWN_ACTION: {
    status: 400,
    what: "The requested action is not known.",
    why: "The action selector does not match any action offered by the chosen twin.",
    fix: "Use a resource name, a local action id such as refund.create, or a full action id shown by the dashboard.",
  },
  UNKNOWN_FAILURE: {
    status: 400,
    what: "The requested failure is not known.",
    why: "The failure id does not match any failure in the catalog.",
    fix: "Use one of the failure ids shown by ibeji fail --help or the dashboard.",
  },
  UNKNOWN_SCENARIO: {
    status: 404,
    what: "The requested scenario is not known.",
    why: "The scenario id does not match any built-in scenario.",
    fix: "Use one of the scenario ids shown by ibeji scenario list or the dashboard.",
  },
  TWIN_NOT_RUNNING: {
    status: 409,
    what: "The requested twin is not running.",
    why: "The action needs a twin that is not part of the current session.",
    fix: "Start the twin with ibeji start --twins and try again.",
  },
  FAILURE_NOT_SUPPORTED_BY_TWIN: {
    status: 400,
    what: "The failure is not supported by the requested twin.",
    why: "The twin does not declare this failure because the real service does not behave that way.",
    fix: "Choose a failure the twin supports, as shown in the dashboard.",
  },
  INVALID_RULE: {
    status: 400,
    what: "The failure rule is not valid.",
    why: "One or more rule settings are missing, out of range, or not allowed.",
    fix: "Correct the rule settings listed in the error and try again.",
  },
  SCENARIO_INVALID: {
    status: undefined,
    what: "The scenario file is not valid.",
    why: "One or more scenario values are missing, have the wrong type, or are not allowed.",
    fix: "Correct the scenario file listed in the error and start Ibeji again.",
  },
  WEBHOOK_URL_NOT_ALLOWED: {
    status: 400,
    what: "The webhook URL is not allowed.",
    why: "Ibeji refuses addresses that could reach an unsafe network or an unspecified host.",
    fix: "Use an allowed http or https address shown by ibeji webhooks --help.",
  },
  BODY_TOO_LARGE: {
    status: 413,
    what: "The request body is too large.",
    why: "Ibeji accepts request bodies up to 1 MB.",
    fix: "Send a smaller request body.",
  },
  INTERNAL: {
    status: 500,
    what: "Ibeji hit an internal error.",
    why: "An unexpected error happened while handling the request.",
    fix: "Try again. If it keeps happening, report the error with the steps that caused it.",
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export type IbejiErrorOptions = {
  readonly what?: string;
  readonly why?: string;
  readonly fix?: string;
  readonly cause?: unknown;
};

/**
 * The one error type for every Ibeji surface. Callers may override any of the
 * three plain-English fields, but the code and HTTP status stay stable.
 */
export class IbejiError extends Error {
  readonly code: ErrorCode;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
  readonly status: number | undefined;
  override cause: unknown;

  constructor(code: ErrorCode, options: IbejiErrorOptions = {}) {
    const definition = ERROR_DEFINITIONS[code];
    const what = options.what ?? definition.what;
    const why = options.why ?? definition.why;
    const fix = options.fix ?? definition.fix;

    super(
      `${what}\n${why}\n${fix}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = "IbejiError";
    this.code = code;
    this.what = what;
    this.why = why;
    this.fix = fix;
    this.status = definition.status;
    this.cause = options.cause;
  }

  toJSON(): {
    name: string;
    code: ErrorCode;
    what: string;
    why: string;
    fix: string;
    message: string;
    status: number | undefined;
    cause: unknown;
  } {
    return {
      name: this.name,
      code: this.code,
      what: this.what,
      why: this.why,
      fix: this.fix,
      message: this.message,
      status: this.status,
      cause: this.cause,
    };
  }
}

export function isIbejiError(value: unknown): value is IbejiError {
  return value instanceof IbejiError;
}

export type ZodProblem = {
  readonly path: readonly PropertyKey[];
  readonly message: string;
};

export function formatZodPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "(root)";
  }
  return path.map((part) => String(part)).join(".");
}

/**
 * Turn every Zod problem into one Ibeji error. The why field names each field
 * and keeps Zod's own message, so no problem is hidden behind the first one.
 */
export function zodProblemsToError(code: ErrorCode, problems: readonly ZodProblem[]): IbejiError {
  if (problems.length === 0) {
    return new IbejiError(code);
  }

  const why = problems
    .map((problem) => `${formatZodPath(problem.path)}: ${problem.message}`)
    .join("; ");

  return new IbejiError(code, { why });
}
