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
  GlassnodeApiError,
  GlassnodeConfigError,
  GlassnodeInputError,
  GlassnodeNetworkError,
  GlassnodeValidationError,
} from './errors.js';
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

/** Mask the `api_key` query-param value so it never reaches logs. */
function redactApiKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]+/gi, '$1***');
}

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

/** Validate an API response against its schema, raising a GlassnodeValidationError on mismatch. */
function validateResponse<T>(schema: ZodType<T>, data: unknown, endpoint: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new GlassnodeValidationError(
    `Glassnode API error: response from ${endpoint} did not match the expected schema — ${summarizeIssues(result.error)}`,
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
 * Reject query parameters the client sets itself, instead of silently overriding them:
 * `api_key` always (configure `apiKey` instead), `f` unless it asks for JSON (the client only
 * parses JSON), and any extra names in `reserved` (e.g. `path` for the metadata endpoints).
 */
function assertParams(
  params: Record<string, string>,
  options: { format?: boolean; reserved?: string[] } = {}
): void {
  const has = (name: string) => Object.prototype.hasOwnProperty.call(params ?? {}, name);
  if (has('api_key')) {
    throw new GlassnodeInputError(
      'Invalid params: `api_key` must not be passed as a query parameter — set `apiKey` in the GlassnodeAPI config instead',
      { argument: 'params.api_key' }
    );
  }
  if (options.format && has('f')) {
    const f = params.f;
    if (typeof f !== 'string' || f.toLowerCase() !== 'json') {
      throw new GlassnodeInputError(
        `Invalid params: f=${JSON.stringify(f)} is not supported — this client only supports JSON responses (omit \`f\`)`,
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
}

/**
 * Glassnode API client
 */
export class GlassnodeAPI {
  private apiKey: string | undefined;
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
    this.apiUrl = validatedConfig.apiUrl ?? (validatedConfig.x402 ? X402_API_URL : DEFAULT_API_URL);
    this.logger = validatedConfig.logger as Logger | undefined;
    this.fetchFn = (validatedConfig.fetch as FetchFn) ?? globalThis.fetch;
    this.maxRetries = validatedConfig.maxRetries;
    this.retryDelay = validatedConfig.retryDelay;
    this.maxRetryDelay = validatedConfig.maxRetryDelay;
    this.timeout = validatedConfig.timeout;
  }

  /**
   * Make an API request
   * @param endpoint API endpoint path
   * @param params Query parameters
   * @returns Promise resolving to the response data
   */
  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const queryParams = new URLSearchParams({
      ...params,
      ...(this.apiKey ? { api_key: this.apiKey } : {}),
    });

    const url = `${this.apiUrl}${endpoint}?${queryParams}`;
    let lastError: GlassnodeError | undefined;
    // Server-requested wait (from a Retry-After header) to use for the *next* attempt, if any.
    let retryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.nextRetryDelay(attempt, retryAfterMs);
        this.logger?.(`Retry ${attempt}/${this.maxRetries} after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      this.logger?.('API call:', redactApiKey(url));

      // Transport step — the only part that is retried on failure.
      let response: Response;
      try {
        // Abort the attempt after `timeout` ms (fresh signal per attempt). When no timeout is
        // configured, keep the single-argument call so a custom `fetch` sees exactly the URL.
        response =
          this.timeout !== undefined
            ? await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeout) })
            : await this.fetchFn(url);
      } catch (error) {
        // Network/transport failure (including a timeout abort) — retryable.
        retryAfterMs = undefined;
        const failure = describeTransportFailure(error);
        if (failure) {
          lastError = new GlassnodeNetworkError(
            `Glassnode API error: ${redactApiKey(failure.message)}`,
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
        const error = new GlassnodeApiError(response.status, response.statusText);
        if (error.isRetryable && attempt < this.maxRetries) {
          lastError = error;
          // Honour the server's Retry-After (e.g. on 429) for the next wait, if present.
          retryAfterMs = this.parseRetryAfter(response);
          continue;
        }
        // Surface the server's error body (e.g. "Resolution 1h is not allowed") in the message.
        const detail = await this.readErrorDetail(response);
        throw detail ? new GlassnodeApiError(response.status, response.statusText, detail) : error;
      }

      // Success. Parsing a 200 body is NOT a transient error, so it is thrown, never retried.
      try {
        return (await response.json()) as T;
      } catch (parseError) {
        throw new GlassnodeValidationError(
          'Glassnode API error: failed to parse response body as JSON',
          { cause: parseError, endpoint }
        );
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
   * Best-effort extraction of a human-readable message from an error response body.
   * Glassnode returns `{ "message": "..." }` (or `{ "error": "..." }`) on failures.
   * Never throws — returns undefined if the body is empty or unreadable.
   */
  private async readErrorDetail(response: Response): Promise<string | undefined> {
    try {
      const text = await response.text();
      if (!text.trim()) return undefined;
      try {
        const parsed = JSON.parse(text);
        const message = parsed?.message ?? parsed?.error;
        // Valid JSON: only use a string message/error — never dump the raw JSON (e.g. "null").
        return typeof message === 'string' && message.trim() ? message.trim() : undefined;
      } catch {
        // Non-JSON body — return the raw text.
        return text.trim().slice(0, 300);
      }
    } catch {
      return undefined;
    }
  }

  /**
   * Get metadata for all assets
   * @returns Promise resolving to validated asset metadata
   */
  async getAssetMetadata(): Promise<AssetMetadataResponse> {
    const endpoint = '/v1/metadata/assets';
    const response = await this.request<{ data?: unknown }>(endpoint);
    return validateResponse(AssetMetadataResponseSchema, response?.data, endpoint);
  }

  /**
   * Get metadata for a specific metric
   * @param metricPath Path of the metric
   * @param params Queried parameters for the metric
   * @returns Promise resolving to validated metric metadata
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed or `params` contains `path` or `api_key`
   */
  async getMetricMetadata(
    metricPath: string,
    params: Record<string, string> = {}
  ): Promise<MetricMetadataResponse> {
    assertMetricPath(metricPath);
    assertParams(params, { reserved: ['path'] });
    const endpoint = '/v1/metadata/metric';
    const response = await this.request(endpoint, { path: metricPath, ...params });
    return validateResponse(MetricMetadataResponseSchema, response, endpoint);
  }

  /**
   * Get data-lag statistics for a specific metric.
   * Returns the current data lag as aggregated percentiles over the past 30 days.
   * @param metricPath Path of the metric (e.g. /institutions/us_spot_etf_balances_all)
   * @param params Optional query parameters (e.g. `a` to scope stats to an asset)
   * @returns Promise resolving to validated metric stats
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed or `params` contains `path` or `api_key`
   */
  async getMetricStats(
    metricPath: string,
    params: Record<string, string> = {}
  ): Promise<MetricStatsResponse> {
    assertMetricPath(metricPath);
    assertParams(params, { reserved: ['path'] });
    const endpoint = '/v1/metadata/metric/stats';
    const response = await this.request(endpoint, { path: metricPath, ...params });
    return validateResponse(MetricStatsResponseSchema, response, endpoint);
  }

  /**
   * Get a list of all metrics
   * @returns Promise resolving to validated metric metadata
   */
  async getMetricList(): Promise<MetricListResponse> {
    const endpoint = '/v1/metadata/metrics';
    const response = await this.request(endpoint);
    return validateResponse(MetricListResponseSchema, response, endpoint);
  }

  /**
   * Call a generic metric
   * @param metricPath Path of the metric (e.g. /accumulation_balance)
   * @param params Queried parameters for the metric
   * @returns Promise resolving to the response data
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed, `params.f` is anything but `json`, or `params` contains `api_key`
   */
  async callMetric<T>(metricPath: string, params: Record<string, string> = {}): Promise<T> {
    assertMetricPath(metricPath);
    assertParams(params, { format: true });
    const response = await this.request('/v1/metrics' + metricPath, { ...params, f: 'json' });
    return response as T;
  }

  /**
   * Call a bulk metric endpoint (returns data for all assets at once)
   * @param metricPath Path of the metric (e.g. /market/marketcap_usd)
   * @param params Query parameters
   * @returns Promise resolving to validated bulk response
   * @throws GlassnodeInputError (as a rejected promise, before any request) if `metricPath` is
   *   malformed, `params.f` is anything but `json`, or `params` contains `api_key`
   */
  async callBulkMetric(
    metricPath: string,
    params: Record<string, string> = {}
  ): Promise<BulkResponse> {
    assertMetricPath(metricPath);
    assertParams(params, { format: true });
    const endpoint = '/v1/metrics' + metricPath + '/bulk';
    const response = await this.request<{ data?: unknown }>(endpoint, { ...params, f: 'json' });
    return validateResponse(BulkResponseSchema, response?.data, endpoint);
  }
}
