import {
  GlassnodeConfig,
  GlassnodeConfigSchema,
  Logger,
  FetchFn,
  DEFAULT_API_URL,
  X402_API_URL,
} from './types/config';
import { GlassnodeApiError } from './errors';
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
} from './types/metadata';

/** Mask the `api_key` query-param value so it never reaches logs. */
function redactApiKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]+/gi, '$1***');
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
    // Validate config with Zod
    const validatedConfig = GlassnodeConfigSchema.parse(config);

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
    let lastError: Error | undefined;
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
        if (error instanceof Error) {
          lastError = error;
          if (attempt < this.maxRetries) continue;
          throw new Error(`Glassnode API error: ${error.message}`, { cause: error });
        }
        throw new Error('Unknown error occurred', { cause: error });
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
        throw new Error('Glassnode API error: failed to parse response body as JSON', {
          cause: parseError,
        });
      }
    }

    // Unreachable in practice (the loop always returns or throws), but keep the throw definitive.
    throw lastError ?? new Error('Glassnode API request failed');
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
    const response = await this.request<{ data: AssetMetadataResponse }>('/v1/metadata/assets');
    // Validate response with Zod schema
    return AssetMetadataResponseSchema.parse(response.data);
  }

  /**
   * Get metadata for a specific metric
   * @param metricPath Path of the metric
   * @param params Queried parameters for the metric
   * @returns Promise resolving to validated metric metadata
   */
  async getMetricMetadata(
    metricPath: string,
    params: Record<string, string> = {}
  ): Promise<MetricMetadataResponse> {
    const response = await this.request('/v1/metadata/metric', { path: metricPath, ...params });
    // Validate response with Zod schema
    return MetricMetadataResponseSchema.parse(response);
  }

  /**
   * Get data-lag statistics for a specific metric.
   * Returns the current data lag as aggregated percentiles over the past 30 days.
   * @param metricPath Path of the metric (e.g. /institutions/us_spot_etf_balances_all)
   * @param params Optional query parameters (e.g. `a` to scope stats to an asset)
   * @returns Promise resolving to validated metric stats
   */
  async getMetricStats(
    metricPath: string,
    params: Record<string, string> = {}
  ): Promise<MetricStatsResponse> {
    const response = await this.request('/v1/metadata/metric/stats', {
      path: metricPath,
      ...params,
    });
    // Validate response with Zod schema
    return MetricStatsResponseSchema.parse(response);
  }

  /**
   * Get a list of all metrics
   * @returns Promise resolving to validated metric metadata
   */
  async getMetricList(): Promise<MetricListResponse> {
    const response = await this.request('/v1/metadata/metrics');
    // Validate response with Zod schema
    return MetricListResponseSchema.parse(response);
  }

  /**
   * Call a generic metric
   * @param metricPath Path of the metric (e.g. /accumulation_balance)
   * @param params Queried parameters for the metric
   * @returns Promise resolving to the response data
   */
  async callMetric<T>(metricPath: string, params: Record<string, string> = {}): Promise<T> {
    const response = await this.request('/v1/metrics' + metricPath, { ...params, f: 'json' });
    return response as T;
  }

  /**
   * Call a bulk metric endpoint (returns data for all assets at once)
   * @param metricPath Path of the metric (e.g. /market/marketcap_usd)
   * @param params Query parameters
   * @returns Promise resolving to validated bulk response
   */
  async callBulkMetric(
    metricPath: string,
    params: Record<string, string> = {}
  ): Promise<BulkResponse> {
    const response = await this.request<{ data: BulkResponse }>(
      '/v1/metrics' + metricPath + '/bulk',
      { ...params, f: 'json' }
    );
    return BulkResponseSchema.parse(response.data);
  }
}
