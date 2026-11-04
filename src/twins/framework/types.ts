import type { ZodType } from "zod";

import type { Clock } from "../../core/clock.js";
import type { SeededRandom } from "../../core/random.js";
import type {
  RawWebhook,
  RetrySchedule,
  VerificationFailureMethod,
  WebhookHeaders,
  WebhookSignOptions,
} from "../../core/webhooks/types.js";

export type TwinId = string;
export type ActionId = string;
export type FailureId = string;
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type TwinState = Readonly<Record<string, JsonValue>>;
export type TwinStateView = Readonly<TwinState>;

export type CollectionColumn = {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "money" | "date";
};

export type CollectionDefinition = {
  readonly id: string;
  readonly label: string;
  readonly columns: readonly CollectionColumn[];
};

export type TwinRequest = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly params: Readonly<Record<string, string>>;
  readonly rawBody: Uint8Array;
};

export type TwinResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
  readonly contentType: string;
};

export type TwinStateStore = {
  read<T>(collection: string, id: string, schema: ZodType<T>): T | undefined;
  list<T>(collection: string, schema: ZodType<T>): readonly T[];
  insert<T>(collection: string, record: T): void;
  update<T>(collection: string, id: string, record: T): void;
  remove(collection: string, id: string): void;
  reset(): void;
};

export type TwinStateDefinition = {
  readonly schema: ZodType<TwinState>;
  readonly initial: () => TwinState;
  readonly collections: readonly CollectionDefinition[];
};

export type AuthResult =
  | { readonly kind: "valid" }
  | { readonly kind: "missing" }
  | { readonly kind: "wrong" }
  | { readonly kind: "live" };

export type AuthFailure = Exclude<AuthResult, { readonly kind: "valid" }>;

export type AuthAdapter = {
  readonly readKey: (request: TwinRequest) => string | null;
  readonly isLiveKey: (key: string) => boolean;
  readonly classify: (key: string | null, credentials: TwinCredentials) => AuthResult;
  readonly unauthorized: (result: AuthFailure) => TwinResponse;
};

export type TwinFailure = {
  readonly failureId?: FailureId;
  readonly kind:
    | "invalid-request"
    | "not-found"
    | "unauthorized"
    | "server"
    | "rate-limited"
    | "version-unsupported";
  readonly status?: number;
  readonly message?: string;
  readonly details?: JsonValue;
};

export type ResponseBuilder = {
  readonly success: (action: ActionDefinition, data: unknown, meta?: unknown) => TwinResponse;
  readonly created: (action: ActionDefinition, data: unknown) => TwinResponse;
  readonly error: (failure: TwinFailure) => TwinResponse;
  readonly notFound: (action?: ActionDefinition) => TwinResponse;
};

export type ActiveFailureEffects = {
  readonly declined?: boolean;
  readonly authenticationRequired?: { readonly then: "succeed" | "fail" };
  readonly transferStuckPending?: {
    readonly thenFailPercent: number;
    readonly seconds?: number | null;
    readonly thenFailed?: boolean;
    readonly endsAt?: number | undefined;
  };
  readonly transferReversed?: boolean;
  readonly transferReversal?: {
    readonly afterSeconds: number;
    readonly reverseAt: number;
    readonly reversed: boolean;
  };
  readonly bankResolveFails?: { readonly mode: "error" | "timeout" };
};

export type FailureSupport = {
  readonly id: FailureId;
  readonly source: "docs" | "real-story" | "assumed";
  readonly sourceReference?: string;
  readonly actions: readonly ActionId[];
};

export type HttpFailurePlan = {
  readonly failureId: FailureId;
  readonly actionId: ActionId;
  readonly status: number;
  readonly details?: JsonValue;
};

export type ResultFailurePlan = {
  readonly failureId: FailureId;
  readonly actionId: ActionId;
  readonly effects: ActiveFailureEffects;
};

export type FailureAdapter = {
  readonly support: readonly FailureSupport[];
  readonly httpError: (plan: HttpFailurePlan) => TwinResponse;
  readonly shapeResult: (plan: ResultFailurePlan) => ActiveFailureEffects;
};

export type WebhookEventDefinition = {
  readonly key: string;
  readonly wireName: string | null;
  readonly objectType: string;
  readonly actions: readonly ActionId[];
};

export type TwinWebhookDraft = {
  readonly key: string;
  readonly actionId: ActionId;
  readonly resourceId: string;
  readonly occurredAt: number;
  readonly data: JsonValue;
};

export type TwinWebhookSink = {
  readonly emit: (draft: TwinWebhookDraft) => void;
};

export type WebhookAdapter = {
  readonly events: readonly WebhookEventDefinition[];
  readonly build: (draft: TwinWebhookDraft, state: TwinStateView) => RawWebhook;
  readonly sign: (
    raw: RawWebhook,
    credentials: TwinCredentials,
    options: WebhookSignOptions,
  ) => WebhookHeaders;
  readonly verify: (
    raw: RawWebhook,
    headers: WebhookHeaders,
    credentials: TwinCredentials,
    now: Date,
  ) => boolean;
  readonly verificationFailures: readonly VerificationFailureMethod[];
  readonly summarize: (draft: TwinWebhookDraft, raw: RawWebhook) => string;
};

export type CheckoutOutcome = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly authentication?: {
    readonly approveLabel: string;
    readonly failLabel: string;
  };
};

export type CheckoutPageContext = {
  readonly state: TwinStateStore;
  readonly recordId: string;
  readonly failures: ActiveFailureEffects;
  readonly money: MoneyRules;
  readonly clock: Clock;
};

export type CheckoutSubmitContext = CheckoutPageContext & {
  readonly authenticationChoice?: "approve" | "fail";
};

export type CheckoutPageModel = {
  readonly twinDisplayName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly customerEmail?: string;
  readonly reference: string;
  readonly outcomes: readonly CheckoutOutcome[];
  readonly failureNotice?: string;
};

export type CheckoutResult = {
  readonly notice: string;
  readonly webhooks: readonly TwinWebhookDraft[];
  readonly redirectUrl?: string;
};

export type CheckoutAdapter = {
  readonly outcomes: readonly CheckoutOutcome[];
  readonly page: (context: CheckoutPageContext) => CheckoutPageModel;
  readonly submit: (
    context: CheckoutSubmitContext,
    outcomeId: string,
    authenticationChoice?: "approve" | "fail",
  ) => Promise<CheckoutResult>;
};

export type CredentialSpec = {
  readonly id: string;
  readonly label: string;
  readonly role: "public" | "secret" | "webhook";
  readonly secret: boolean;
  readonly generate: (random: CryptoRandom) => string;
  readonly isTestFormat: (value: string) => boolean;
};

export type TwinCredentials = Readonly<Record<string, string>>;

export type MoneyRules = {
  readonly zeroDecimal: readonly string[];
  readonly fractionDigits: (currency: string) => number;
  readonly parseServiceAmount: (text: string, currency: string) => number;
  readonly formatServiceAmount: (amount: number, currency: string) => string;
  readonly formatDisplay: (amount: number, currency: string) => string;
  readonly assertValid: (amount: number, currency: string) => void;
};

export type CryptoRandom = {
  readonly bytes: (length: number) => Uint8Array;
};

export type IdempotencyStore = {
  readonly lookup: (twinId: TwinId, key: string) => StoredIdempotency | undefined;
  readonly save: (twinId: TwinId, record: StoredIdempotency) => void;
};

export type StoredIdempotency = {
  readonly key: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly fingerprint: string;
  readonly response: TwinResponse;
  readonly storedAt: number;
};

export type IdempotencyBeginContext = {
  readonly request: TwinRequest;
  readonly action: ActionDefinition;
  readonly credentials: TwinCredentials;
  readonly store: IdempotencyStore;
  readonly clock: Clock;
};

export type IdempotencyCompleteContext = {
  readonly key: string;
  readonly request: TwinRequest;
  readonly action: ActionDefinition;
  readonly store: IdempotencyStore;
  readonly clock: Clock;
};

export type IdempotencyDecision =
  | { readonly kind: "proceed"; readonly key: string | null }
  | { readonly kind: "replay"; readonly response: TwinResponse }
  | { readonly kind: "error"; readonly response: TwinResponse };

export type IdempotencyAdapter =
  | { readonly mode: "none" }
  | {
      readonly mode: "header";
      readonly headerName: string;
      readonly maxKeyLength: number;
      readonly retentionSeconds: number;
      readonly begin: (context: IdempotencyBeginContext) => IdempotencyDecision;
      readonly complete: (context: IdempotencyCompleteContext, response: TwinResponse) => void;
    };

export type ActionHandler = (context: ActionContext) => Promise<TwinResponse> | TwinResponse;

export type ActionDefinition = {
  readonly id: ActionId;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly kind: "read" | "write" | "checkout";
  readonly eventSummary?: (request: TwinRequest, state: TwinStateStore) => string;
  readonly handler: ActionHandler;
};

export type ActionContext = {
  readonly action: ActionDefinition;
  readonly request: TwinRequest;
  readonly state: TwinStateStore;
  readonly failures: ActiveFailureEffects;
  readonly credentials: TwinCredentials;
  readonly clock: Clock;
  readonly random: SeededRandom;
  readonly webhooks: TwinWebhookSink;
};

export type TwinRouter = {
  add(action: ActionDefinition): void;
};

export type RouteRegistrar = (router: TwinRouter) => void;

export type TwinDefinition = {
  readonly id: TwinId;
  readonly displayName: string;
  readonly defaultPort: number;
  readonly actions: readonly ActionDefinition[];
  readonly state: TwinStateDefinition;
  readonly auth: AuthAdapter;
  readonly idempotency: IdempotencyAdapter;
  readonly routes: RouteRegistrar;
  readonly responses: ResponseBuilder;
  readonly failures: FailureAdapter;
  readonly webhooks: WebhookAdapter;
  readonly checkout: CheckoutAdapter;
  readonly credentials: readonly CredentialSpec[];
  readonly money: MoneyRules;
  readonly retry: RetrySchedule;
};
