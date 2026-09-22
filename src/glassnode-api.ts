import {
  GlassnodeConfig,
  GlassnodeConfigSchema,
  Logger,
  FetchFn,
  DEFAULT_API_URL,
  X402_API_URL,
} from './types/config.js';
import type { ZodType, ZodError } from 'zod';
import {
  GlassnodeError,
  GlassnodeAbortError,
  GlassnodeApiError,
  GlassnodeConfigError,
  GlassnodeInputError,
  GlassnodeNetworkError,
  GlassnodeValidationError,
} from './errors.js';
import { readErrorDetail } from './error-detail.js';
import { redactApiKey, redactSecrets } from './redact.js';
import {
  AssetMetadataResponse,
  MetricMetadataResponse,
  AssetMetadataResponseSchema,
  MetricMetadataResponseSchema,
  MetricListResponse,
  MetricListResponseSchema,
  MetricStatsResponse,
  MetricStatsResponseSchema,
  BulkResponse,
  BulkResponseSchema,
} from './types/metadata.js';
import type { MetricParams } from './types/params.js';
import type { CallOptions } from './types/call-options.js';

/** `name`s of the abort rejections fetch produces: `AbortSignal.timeout()` and a plain abort. */
const ABORT_NAMES = new Set(['TimeoutError', 'AbortError']);

/**
 * Classify a fetch rejection by its *shape*, not `instanceof Error`: a DOMException from another
 * realm, a polyfill or a custom fetch may reject with a non-Error object that still has a `name`.
 * Returns undefined when the rejection is neither an Error nor a TimeoutError/AbortError-named
 * object (e.g. a string) — that case stays "Unknown error occurred" and is not retried.
 */
function describeTransportFailure(
  error: unknown
): { message: string; timedOut: boolean } | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { name, message } = error as { name?: unknown; message?: unknown };
  const isAbort = typeof name === 'string' && ABORT_NAMES.has(name);
  if (!(error instanceof Error) && !isAbort) return undefined;
  return {
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError'.
    timedOut: name === 'TimeoutError',
    // A real Error keeps its message verbatim (as before); a bare object falls back to its name.
    message:
      error instanceof Error
        ? error.message
        : typeof message === 'string' && message
          ? message
          : String(name),
  };
}

/** Summarise Zod issues as `path: message` pairs (first few only) for an error message. */
function summarizeIssues(error: ZodError, max = 3): string {
  const parts = error.issues
    .slice(0, max)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
  const more = error.issues.length - parts.length;
  return parts.join('; ') + (more > 0 ? ` (+${more} more)` : '');
}

/**
 * Validate an API response against its schema, raising a GlassnodeValidationError on mismatch.
 * `redact` masks the API key in the issue summary: issue paths carry keys of the server's
 * response (e.g. record keys), which is text from outside the library.
 */
function validateResponse<T>(
  schema: ZodType<T>,
  data: unknown,
  endpoint: string,
  redact: (text: string) => string
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new GlassnodeValidationError(
    `Glassnode API error: response from ${endpoint} did not match the expected schema — ${redact(summarizeIssues(result.error))}`,
    { cause: result.error, endpoint }
  );
}

/** One metric path segment: URL-safe characters only, so the path never needs encoding. */
const METRIC_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Return why `path` is not a valid metric path, or undefined if it is valid. */
function metricPathProblem(path: string): string | undefined {
  if (path === '') return 'must not be empty';
  if (/\s/.test(path)) return 'must not contain whitespace';
  if (!path.startsWith('/')) {
    const fixed = '/' + path;
    return metricPathProblem(fixed) === undefined
      ? `must start with "/" (did you mean "${fixed}"?)`
      : 'must start with "/"';
  }
  for (const segment of path.slice(1).split('/')) {
    if (segment === '') return 'must not contain an empty segment ("//" or a trailing "/")';
    if (segment === '.' || segment === '..') return `must not contain a "${segment}" segment`;
    if (!METRIC_PATH_SEGMENT.test(segment)) {
      return 'contains an invalid character (allowed: letters, digits, "_", "-", "." and "/")';
    }
  }
  return undefined;
}

/**
 * Validate a caller-supplied metric path (e.g. `/market/price_usd_close`). Malformed paths are
 * rejected — never silently rewritten — with a GlassnodeInputError, before any request is made.
 * Messages never echo a full URL or a query string, which could carry an API key.
 */
function assertMetricPath(path: unknown): asserts path is string {
  const fail = (reason: string): never => {
    throw new GlassnodeInputError(`Invalid metricPath: ${reason}`, { argument: 'metricPath' });
  };
  if (typeof path !== 'string') return fail(`must be a string, got ${typeof path}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return fail('pass only the metric path (e.g. "/market/price_usd_close"), not a full URL');
  }
  if (path.includes('?')) {
    return fail('must not include a query string — pass query parameters via `params` instead');
  }
  if (path.includes('#')) return fail('must not contain "#"');
  const problem = metricPathProblem(path);
  if (problem) fail(`${JSON.stringify(path)} ${problem}`);
}

/**
 * The epoch-ms time of a Date (NaN for an invalid one), or undefined if `value` is not a Date.
 * A brand check rather than `instanceof`, so a Date from another realm (iframe, `vm`) counts too.
 */
function dateTime(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return Date.prototype.getTime.call(value);
  } catch {
    return undefined;
  }
}

/** The string form of a caller-supplied param value, or why it cannot be sent. */
function formatParamValue(value: unknown): { value: string } | { problem: string } {
  if (typeof value === 'string') return { value };
  if (typeof value === 'boolean') return { value: value ? 'true' : 'false' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { problem: `must be a finite number, got ${value}` };
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      return {
        problem: `${value} is outside the safe integer range (±${Number.MAX_SAFE_INTEGER}) and may have lost precision — pass it as a string`,
      };
    }
    // Number#toString is locale-independent and gives the shortest round-trip form; -0 → "0".
    const text = String(value);
    if (/e/i.test(text)) {
      return { problem: `${text} would be sent in exponent notation — pass it as a string` };
    }
    return { value: text };
  }
  const ms = dateTime(value);
  if (ms !== undefined) {
    if (Number.isNaN(ms)) return { problem: 'is an invalid Date' };
    // Unix seconds, floored to the second the instant falls in (also for pre-1970 dates).
    return { value: String(Math.floor(ms / 1000)) };
  }
  if (value === null) {
    return { problem: 'must not be null — omit the parameter (or pass undefined) instead' };
  }
  const kind = Array.isArray(value) ? 'array' : typeof value;
  return { problem: `must be a string, number, boolean or Date, got ${kind}` };
}

/**
 * Validate caller-supplied query parameters and convert them to the strings that are sent (see
 * `MetricParamValue`): `undefined` values are dropped, invalid values are rejected. Also
 * rejects parameters the client sets itself, instead of silently overriding them: `api_key`
 * always (configure `apiKey` instead), `f` unless it asks for JSON (the client only parses JSON),
 * and any extra names in `reserved` (e.g. `path` for the metadata endpoints). Keeps key order,
 * so string-only params produce exactly the same URL as before.
 */
function normalizeParams(
  params: unknown,
  options: { format?: boolean; reserved?: string[] } = {}
): Record<string, string> {
  // A null-prototype record, so a "__proto__" param stays an ordinary key.
  const out: Record<string, string> = Object.create(null);
  if (params === undefined || params === null) return out;
  if (typeof params !== 'object' || Array.isArray(params) || dateTime(params) !== undefined) {
    throw new GlassnodeInputError(
      `Invalid params: must be an object of query parameters (e.g. { a: 'BTC' }), got ${Array.isArray(params) ? 'array' : typeof params}`,
      { argument: 'params' }
    );
  }
  const record = params as Record<string, unknown>;
  // Only defined values count: `{ api_key: undefined }` is the same as omitting it.
  const has = (name: string) =>
    Object.prototype.hasOwnProperty.call(record, name) && record[name] !== undefined;
  if (has('api_key')) {
    throw new GlassnodeInputError(
      'Invalid params: `api_key` must not be passed as a query parameter — set `apiKey` in the GlassnodeAPI config instead',
      { argument: 'params.api_key' }
    );
  }
  if (options.format && has('f')) {
    const f = record.f;
    if (typeof f !== 'string' || f.toLowerCase() !== 'json') {
      throw new GlassnodeInputError(
        `Invalid params: f=${formatForMessage(f)} is not supported — this client only supports JSON responses (omit \`f\`)`,
        { argument: 'params.f' }
      );
    }
  }
  for (const name of options.reserved ?? []) {
    if (has(name)) {
      throw new GlassnodeInputError(
        `Invalid params: \`${name}\` is set by the client from the metricPath argument and must not be passed in params`,
        { argument: `params.${name}` }
      );
    }
  }
  for (const name of Object.keys(record)) {
    const raw = record[name];
    if (raw === undefined) continue;
    const result = formatParamValue(raw);
    if ('problem' in result) {
      throw new GlassnodeInputError(`Invalid params: \`${name}\` ${result.problem}`, {
        argument: `params.${name}`,
      });
    }
    out[name] = result.value;
  }
  return out;
}

/** Render a rejected value for an error message without throwing (e.g. on a symbol or bigint). */
function formatForMessage(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (dateTime(value) !== undefined) return 'a Date';
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

/** Largest per-call `timeout` (ms): the maximum timer delay every runtime supports (2^31 - 1). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Per-call options after validation. */
interface ResolvedCallOptions {
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Whether `value` looks like an AbortSignal. Duck-typed rather than `instanceof AbortSignal`, so a
 * signal from another realm or a spec-compliant polyfill is accepted too.
 */
function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<AbortSignal>;
  return (
    typeof s.aborted === 'boolean' &&
    typeof s.addEventListener === 'function' &&
    typeof s.removeEventListener === 'function'
  );
}

/**
 * Validate the per-call options argument (see {@link CallOptions}). `undefined`/`null` and
 * `undefined` fields mean "not set". Invalid values reject with a GlassnodeInputError before any
 * request is made.
 */
function normalizeCallOptions(options: unknown): ResolvedCallOptions {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new GlassnodeInputError(
      `Invalid options: must be an object such as { signal, timeout }, got ${Array.isArray(options) ? 'array' : typeof options}`,
      { argument: 'options' }
    );
  }
  const { signal, timeout } = options as { signal?: unknown; timeout?: unknown };
  if (signal !== undefined && !isAbortSignal(signal)) {
    throw new GlassnodeInputError(
      `Invalid options: \`signal\` must be an AbortSignal, got ${formatForMessage(signal)}`,
      { argument: 'options.signal' }
    );
  }
  if (
    timeout !== undefined &&
    (typeof timeout !== 'number' ||
      !Number.isInteger(timeout) ||
      timeout <= 0 ||
      timeout > MAX_TIMEOUT_MS)
  ) {
    throw new GlassnodeInputError(
      `Invalid options: \`timeout\` must be a positive integer number of milliseconds (at most ${MAX_TIMEOUT_MS}), got ${formatForMessage(timeout)}`,
      { argument: 'options.timeout' }
    );
  }
  return { signal, timeout };
}

/**
 * An AbortSignal that aborts (with the same `reason`) as soon as either input signal aborts, and a
 * `dispose` that removes the listeners it added. A small stand-in for `AbortSignal.any()`, which
 * only exists from Node 20.3 (this package supports Node >= 18). Calling `dispose` once the
 * attempt is over keeps a long-lived caller signal from accumulating listeners across calls.
 */
function combineSignals(
  a: AbortSignal,
  b: AbortSignal
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const listeners: [AbortSignal, () => void][] = [];
  const dispose = () => {
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    listeners.length = 0;
  };
  for (const source of [a, b]) {
    if (source.aborted) {
      controller.abort(source.reason);
      dispose();
      break;
    }
    const listener = () => {
      controller.abort(source.reason);
      dispose();
    };
    source.addEventListener('abort', listener);
    listeners.push([source, listener]);
  }
  return { signal: controller.signal, dispose };
}

/**
 * Wait `ms` before a retry. Resolves early (without waiting out the delay) when `signal` aborts;
 * the caller checks `signal.aborted` afterwards. The timer and the listener are always cleaned up.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Glassnode API client
 */
export class GlassnodeAPI {
  private apiKey: string | undefined;
  private apiKeyLocation: 'query' | 'header';
  private apiUrl: string;
  private logger?: Logger;
  private fetchFn: FetchFn;
  private maxRetries: number;
  private retryDelay: number;
  private maxRetryDelay: number;
  private timeout?: number;

  /**
   * Create a new Glassnode API client
   * @param config Configuration object
   */
  constructor(config: GlassnodeConfig) {
    // Validate config with Zod; surface failures as a GlassnodeConfigError (ZodError on `.cause`).
    const parsed = GlassnodeConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new GlassnodeConfigError(
        `Invalid GlassnodeAPI config: ${summarizeIssues(parsed.error, Infinity)}`,
        { cause: parsed.error }
      );
    }
    const validatedConfig = parsed.data;

    this.apiKey = validatedConfig.apiKey;
    this.apiKeyLocation = validatedConfig.apiKeyLocation;
    this.apiUrl = validatedConfig.apiUrl ?? (validatedConfig.x402 ? X402_API_URL : DEFAULT_API_URL);
    this.logger = validatedConfig.logger as Logger | undefined;
    this.fetchFn = (validatedConfig.fetch as FetchFn) ?? globalThis.fetch;
    this.maxRetries = validatedConfig.maxRetries;
    this.retryDelay = validatedConfig.retryDelay;
    this.maxRetryDelay = validatedConfig.maxRetryDelay;
    this.timeout = validatedConfig.timeout;
  }

  /**
   * Mask the API key in text from outside the library before it goes into an error: any
   * `api_key=` query value, plus any raw (or URL-encoded) occurrence of the configured key when
   * it is long enough to mask safely (see `redactSecrets`). Applied to server error bodies and
   * status texts, transport error messages and schema-issue summaries.
   */
  private redact(text: string): string {
    return redactSecrets(text, [this.apiKey]);
  }

  /**
   * Make an API request
   * @param endpoint API endpoint path
   * @param params Query parameters
   * @param options Validated per-call options (`signal`, `timeout` overriding the config one)
   * @returns Promise resolving to the response data
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string> = {},
    options: ResolvedCallOptions = {}
  ): Promise<T> {
    const { signal } = options;
    const timeout = options.timeout ?? this.timeout;
    // A caller abort is never retried; its reason stays on `.cause`.
    const aborted = () =>
      new GlassnodeAbortError('Glassnode API error: the request was aborted by the caller', {
        cause: signal?.reason,
      });
    // The key goes in the query string (default) or the X-Api-Key header — never both, and
    // neither when there is no key (e.g. x402 mode).
    const keyInHeader = this.apiKeyLocation === 'header' && this.apiKey !== undefined;
    const queryParams = new URLSearchParams({
      ...params,
      ...(this.apiKey && !keyInHeader ? { api_key: this.apiKey } : {}),
    });
    const url = `${this.apiUrl}${endpoint}?${queryParams}`;
    const headers = keyInHeader ? { 'X-Api-Key': this.apiKey as string } : undefined;
    let lastError: GlassnodeError | undefined;
    // Server-requested wait (from a Retry-After header) to use for the *next* attempt, if any.
    let retryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.nextRetryDelay(attempt, retryAfterMs);
        this.logger?.(`Retry ${attempt}/${this.maxRetries} after ${delay}ms`);
        // Cut short by a caller abort (checked right below).
        await sleep(delay, signal);
      }
      // Covers an already-aborted signal (before any request) and an abort during the wait.
      if (signal?.aborted) throw aborted();

      this.logger?.('API call:', redactApiKey(url));

      // This attempt's signal: the caller's `signal` and/or a fresh `AbortSignal.timeout()` (a
      // new one per attempt), combined when both are set. `dispose` detaches the combiner's
      // listeners once the attempt is over (including reading the body).
      const attemptSignal =
        timeout === undefined
          ? { signal, dispose: () => {} }
          : signal
            ? combineSignals(signal, AbortSignal.timeout(timeout))
            : { signal: AbortSignal.timeout(timeout), dispose: () => {} };
      try {
        // Transport step — the only part that is retried on failure.
        let response: Response;
        try {
          // Pass an `init` only when there is something to put in it (the key header and/or a
          // signal), so with the defaults a custom `fetch` still sees a single-argument call with
          // exactly the URL.
          const init: RequestInit = {
            ...(headers ? { headers } : {}),
            ...(attemptSignal.signal ? { signal: attemptSignal.signal } : {}),
          };
          response =
            Object.keys(init).length > 0 ? await this.fetchFn(url, init) : await this.fetchFn(url);
        } catch (error) {
          // Already classified by a library-aware fetch (e.g. a GlassnodePaymentError from
          // createX402Fetch, which also covers an abort after a payment was sent): surface it
          // unchanged and never retry it.
          if (error instanceof GlassnodeError) throw error;
          // Cancelled by the caller: never retried, whatever the fetch rejected with.
          if (signal?.aborted) throw aborted();
          // Network/transport failure (including a timeout abort) — retryable.
          retryAfterMs = undefined;
          const failure = describeTransportFailure(error);
          if (failure) {
            lastError = new GlassnodeNetworkError(
              `Glassnode API error: ${this.redact(failure.message)}`,
              { cause: error, timedOut: failure.timedOut }
            );
            if (attempt < this.maxRetries) continue;
            throw lastError;
          }
          // Not recognisably an error (e.g. a string) from a custom fetch — not retried, as before.
          throw new GlassnodeNetworkError('Unknown error occurred', {
            cause: error,
            timedOut: false,
          });
        }

        if (!response.ok) {
          // The status text comes from the server (or a proxy) too, so it is redacted as well.
          const statusText = this.redact(response.statusText);
          const error = new GlassnodeApiError(response.status, statusText);
          if (error.isRetryable && attempt < this.maxRetries) {
            lastError = error;
            // Honour the server's Retry-After (e.g. on 429) for the next wait, if present.
            retryAfterMs = this.parseRetryAfter(response);
            continue;
          }
          // Surface the server's error body (e.g. "Resolution 1h is not allowed") in the message,
          // with the API key masked: a server or proxy may echo the request URL or the key.
          const rawDetail = await readErrorDetail(response);
          const detail = rawDetail ? this.redact(rawDetail) : undefined;
          throw detail ? new GlassnodeApiError(response.status, statusText, detail) : error;
        }

        // Success. Parsing a 200 body is NOT a transient error, so it is thrown, never retried.
        try {
          return (await response.json()) as T;
        } catch (parseError) {
          // Reading the body was cut off by the caller's abort: that is not a malformed body.
          if (signal?.aborted) throw aborted();
          throw new GlassnodeValidationError(
            'Glassnode API error: failed to parse response body as JSON',
            { cause: parseError, endpoint }
          );
        }
      } finally {
        attemptSignal.dispose();
      }
    }

    // Unreachable in practice (the loop always returns or throws), but keep the throw definitive.
    throw lastError ?? new GlassnodeError('Glassnode API request failed');
  }

  /**
   * Delay (ms) before the given retry attempt: a server-supplied Retry-After if present,
   * otherwise exponential backoff (`retryDelay * 2^(attempt-1)`) capped at `maxRetryDelay` and
   * then full-jittered to avoid synchronised retries across clients.
   */
  private nextRetryDelay(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, this.maxRetryDelay);
    const base = Math.min(this.retryDelay * 2 ** (attempt - 1), this.maxRetryDelay);
    return Math.round(Math.random() * base);
  }

  /**
   * Parse a `Retry-After` header into milliseconds. Supports both the delay-seconds form and an
   * HTTP-date. Returns undefined when the header is absent or unparseable.
   */
  private parseRetryAfter(response: Response): number | undefined {
    const raw = response.headers?.get?.('retry-after');
    if (!raw) return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(raw);
    return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
  }

  /**
   * Get metadata for all assets
   * @param options Per-call options: `signal` to cancel, `timeout` to override the config one
   *   (see {@link CallOptions})
   * @returns Promise resolving to validated asset metadata
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `options` is invalid
   * @throws GlassnodeAbortError if `options.signal` aborts (or was already aborted)
   */
  async getAssetMetadata(options?: CallOptions): Promise<AssetMetadataResponse> {
    const callOptions = normalizeCallOptions(options);
    const endpoint = '/v1/metadata/assets';
    const response = await this.request<{ data?: unknown }>(endpoint, {}, callOptions);
    return validateResponse(AssetMetadataResponseSchema, response?.data, endpoint, (t) =>
      this.redact(t)
    );
  }

  /**
   * Get metadata for a specific metric
   * @param metricPath Path of the metric
   * @param params Query parameters for the metric (see {@link MetricParams}); numbers, booleans
   *   and Dates are converted (a Date → unix seconds), `undefined` values are omitted
   * @param options Per-call options: `signal` to cancel, `timeout` to override the config one
   *   (see {@link CallOptions})
   * @returns Promise resolving to validated metric metadata
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed, `params.f` is anything but `json`, `params` contains `path` or `api_key`, a
   *   param value cannot be converted (see `MetricParamValue`), or `options` is invalid
   * @throws GlassnodeAbortError if `options.signal` aborts (or was already aborted)
   */
  async getMetricMetadata(
    metricPath: string,
    params: MetricParams = {},
    options?: CallOptions
  ): Promise<MetricMetadataResponse> {
    assertMetricPath(metricPath);
    const query = normalizeParams(params, { format: true, reserved: ['path'] });
    const callOptions = normalizeCallOptions(options);
    const endpoint = '/v1/metadata/metric';
    const response = await this.request(endpoint, { path: metricPath, ...query }, callOptions);
    return validateResponse(MetricMetadataResponseSchema, response, endpoint, (t) =>
      this.redact(t)
    );
  }

  /**
   * Get data-lag statistics for a specific metric.
   * Returns the current data lag as aggregated percentiles over the past 30 days.
   * @param metricPath Path of the metric (e.g. /institutions/us_spot_etf_balances_all)
   * @param params Optional query parameters (e.g. `a` to scope stats to an asset; see
   *   {@link MetricParams} for value conversion)
   * @param options Per-call options: `signal` to cancel, `timeout` to override the config one
   *   (see {@link CallOptions})
   * @returns Promise resolving to validated metric stats
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed, `params.f` is anything but `json`, `params` contains `path` or `api_key`, a
   *   param value cannot be converted (see `MetricParamValue`), or `options` is invalid
   * @throws GlassnodeAbortError if `options.signal` aborts (or was already aborted)
   */
  async getMetricStats(
    metricPath: string,
    params: MetricParams = {},
    options?: CallOptions
  ): Promise<MetricStatsResponse> {
    assertMetricPath(metricPath);
    const query = normalizeParams(params, { format: true, reserved: ['path'] });
    const callOptions = normalizeCallOptions(options);
    const endpoint = '/v1/metadata/metric/stats';
    const response = await this.request(endpoint, { path: metricPath, ...query }, callOptions);
    return validateResponse(MetricStatsResponseSchema, response, endpoint, (t) => this.redact(t));
  }

  /**
   * Get a list of all metrics
   * @param options Per-call options: `signal` to cancel, `timeout` to override the config one
   *   (see {@link CallOptions})
   * @returns Promise resolving to validated metric metadata
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `options` is invalid
   * @throws GlassnodeAbortError if `options.signal` aborts (or was already aborted)
   */
  async getMetricList(options?: CallOptions): Promise<MetricListResponse> {
    const callOptions = normalizeCallOptions(options);
    const endpoint = '/v1/metadata/metrics';
    const response = await this.request(endpoint, {}, callOptions);
    return validateResponse(MetricListResponseSchema, response, endpoint, (t) => this.redact(t));
  }

  /**
   * Call a generic metric
   * @param metricPath Path of the metric (e.g. /accumulation_balance)
   * @param params Query parameters for the metric, e.g. `{ a: 'BTC', s: 1609459200, i: '24h' }`
   *   or `{ a: 'BTC', s: new Date('2021-01-01') }` (see {@link MetricParams})
   * @param options Per-call options: `signal` to cancel, `timeout` to override the config one
   *   (see {@link CallOptions})
   * @returns Promise resolving to the response data
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed, `params.f` is anything but `json`, `params` contains `api_key`, a param value
   *   cannot be converted (see `MetricParamValue`), or `options` is invalid
   * @throws GlassnodeAbortError if `options.signal` aborts (or was already aborted)
   */
  async callMetric<T>(
    metricPath: string,
    params: MetricParams = {},
    options?: CallOptions
  ): Promise<T> {
    assertMetricPath(metricPath);
    const query = normalizeParams(params, { format: true });
    const callOptions = normalizeCallOptions(options);
    const response = await this.request(
      '/v1/metrics' + metricPath,
      { ...query, f: 'json' },
      callOptions
    );
    return response as T;
  }

  /**
   * Call a bulk metric endpoint (returns data for all assets at once)
   * @param metricPath Path of the metric (e.g. /market/marketcap_usd)
   * @param params Query parameters (see {@link MetricParams})
   * @param options Per-call options: `signal` to cancel, `timeout` to override the config one
   *   (see {@link CallOptions})
   * @returns Promise resolving to validated bulk response
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed, `params.f` is anything but `json`, `params` contains `api_key`, a param value
   *   cannot be converted (see `MetricParamValue`), or `options` is invalid
   * @throws GlassnodeAbortError if `options.signal` aborts (or was already aborted)
   */
  async callBulkMetric(
    metricPath: string,
    params: MetricParams = {},
    options?: CallOptions
  ): Promise<BulkResponse> {
    assertMetricPath(metricPath);
    const query = normalizeParams(params, { format: true });
    const callOptions = normalizeCallOptions(options);
    const endpoint = '/v1/metrics' + metricPath + '/bulk';
    const response = await this.request<{ data?: unknown }>(
      endpoint,
      { ...query, f: 'json' },
      callOptions
    );
    return validateResponse(BulkResponseSchema, response?.data, endpoint, (t) => this.redact(t));
  }
}
