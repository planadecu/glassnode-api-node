import type { GlassnodeError } from '../errors.js';

/**
 * Fields shared by every hook event. Nothing in an event carries the API key: `url` is masked
 * (`api_key=***`) and no request or response headers are exposed (so neither the `X-Api-Key`
 * header nor x402 payment headers). The `error` of an event is the same object the call rejects
 * with, so the caveat on {@link GlassnodeError} applies: its `.cause` is not redacted.
 *
 * Treat every event as **read-only**. Each hook call gets a fresh event object, but `error` is the
 * live error (in `onError`, the very object the caller's promise rejects with); it is neither
 * frozen nor copied, so a hook that mutates it changes what the caller sees.
 */
export interface GlassnodeHookEventBase {
  /**
   * Correlation id of the call: every event of one method call (all its attempts and retries)
   * carries the same id, and no other call in this JavaScript realm has it. A process-local
   * counter — add your own prefix if ids must be unique across processes.
   */
  callId: number;
  /** HTTP method. The Glassnode API is read-only, so this is always `'GET'`. */
  method: 'GET';
  /** API endpoint path, without host or query string (e.g. `/v1/metrics/market/price_usd_close`). */
  endpoint: string;
  /** Full request URL with the API key masked (`api_key=***`). */
  url: string;
  /**
   * 1-based number of the attempt the event is about. For `onError`, the last attempt made, or
   * `0` when the call was cancelled before its first attempt.
   */
  attempt: number;
  /** Most attempts this call can make: `maxRetries + 1`. */
  maxAttempts: number;
}

/** `onRequest`: an attempt is about to be sent. */
export type GlassnodeRequestEvent = GlassnodeHookEventBase;

/** `onResponse`: an attempt got an HTTP response — any status, including non-2xx. */
export interface GlassnodeResponseEvent extends GlassnodeHookEventBase {
  /** HTTP status of the response. */
  status: number;
  /** True for a 2xx status (`Response.ok`). */
  ok: boolean;
  /** Milliseconds from sending the attempt until its response headers arrived. */
  durationMs: number;
}

/** Why an attempt is retried. */
export type GlassnodeRetryReason = 'status' | 'network' | 'timeout';

/** `onRetry`: an attempt failed with a retryable error and the client will retry after a wait. */
export interface GlassnodeRetryEvent extends GlassnodeHookEventBase {
  /**
   * `'status'` for a `429`/`5xx` response, `'timeout'` when the per-attempt `timeout` fired,
   * `'network'` for any other transport failure.
   */
  reason: GlassnodeRetryReason;
  /** HTTP status of the failed attempt, for `reason: 'status'`. */
  status?: number;
  /**
   * The failed attempt's error (a `GlassnodeApiError` or `GlassnodeNetworkError`). The live
   * object, not a copy — read-only.
   */
  error: GlassnodeError;
  /** Milliseconds the client waits before the next attempt (`attempt + 1`). */
  delayMs: number;
  /** Milliseconds from sending the failed attempt until it failed. */
  durationMs: number;
}

/** `onError`: the call failed — fired once per call, with the error it rejects with. */
export interface GlassnodeErrorEvent extends GlassnodeHookEventBase {
  /**
   * The error the call rejects with — the same live object the caller receives, so do not mutate
   * it (a change would be visible to the caller).
   */
  error: GlassnodeError;
  /** HTTP status behind the error, when there is one (`GlassnodeApiError`, `GlassnodePaymentError`). */
  status?: number;
  /** Duration of the last attempt in ms; absent when no attempt was sent. */
  durationMs?: number;
  /** Milliseconds from the start of the call (first attempt, waits included) until it failed. */
  elapsedMs: number;
}

/**
 * Structured observability hooks (the `hooks` config option). Every hook is optional and is
 * called synchronously with one event object; its return value is ignored and never awaited, so
 * an async hook does not delay the request. A hook that throws, or returns a promise that
 * rejects, never changes the call's outcome or retries: the error is swallowed (and passed to the
 * `logger`, if one is configured, as `'Hook <name> failed:', error`). Keep hooks fast — offload
 * slow work (e.g. exporting telemetry) instead of doing it inline. Events are read-only: see
 * {@link GlassnodeHookEventBase}.
 *
 * Hooks fire only once a call has passed argument validation: a `GlassnodeInputError` or a
 * `GlassnodeConfigError` fires none.
 *
 * Order per call: `onRequest` → (`onResponse`) → [`onRetry` → `onRequest` → (`onResponse`)]… →
 * `onError` if the call fails. A successful call ends with an `onResponse` whose `ok` is true and
 * no `onError`; a `200` whose body fails parsing or schema validation is followed by `onError`.
 */
export interface GlassnodeHooks {
  /** Before each attempt is sent. */
  onRequest?: (event: GlassnodeRequestEvent) => void;
  /** When an attempt gets an HTTP response (any status). */
  onResponse?: (event: GlassnodeResponseEvent) => void;
  /** Before the wait that precedes a retry. */
  onRetry?: (event: GlassnodeRetryEvent) => void;
  /** Once, when the call fails (including a cancellation and a response validation error). */
  onError?: (event: GlassnodeErrorEvent) => void;
}
