import { GlassnodeConfig, GlassnodeConfigSchema, Logger, FetchFn } from './types/config';
import { GlassnodeApiError } from './errors';
import {
  AssetMetadataResponse,
  MetricMetadataResponse,
  AssetMetadataResponseSchema,
  MetricMetadataResponseSchema,
  MetricListResponse,
  MetricListResponseSchema,
  BulkResponse,
  BulkResponseSchema,
} from './types/metadata';

/**
 * Glassnode API client
 */
export class GlassnodeAPI {
  private apiKey: string;
  private apiUrl: string;
  private logger?: Logger;
  private fetchFn: FetchFn;
  private maxRetries: number;
  private retryDelay: number;

  /**
   * Create a new Glassnode API client
   * @param config Configuration object
   */
  constructor(config: GlassnodeConfig) {
    // Validate config with Zod
    const validatedConfig = GlassnodeConfigSchema.parse(config);

    this.apiKey = validatedConfig.apiKey;
    this.apiUrl = validatedConfig.apiUrl;
    this.logger = validatedConfig.logger as Logger | undefined;
    this.fetchFn = (validatedConfig.fetch as FetchFn) ?? globalThis.fetch;
    this.maxRetries = validatedConfig.maxRetries;
    this.retryDelay = validatedConfig.retryDelay;
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
      api_key: this.apiKey,
    });

    const url = `${this.apiUrl}${endpoint}?${queryParams}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryDelay * 2 ** (attempt - 1);
        this.logger?.(`Retry ${attempt}/${this.maxRetries} after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      this.logger?.('API call:', url);

      try {
        const response = await this.fetchFn(url);

        if (!response.ok) {
          const error = new GlassnodeApiError(response.status, response.statusText);
          if (error.isRetryable && attempt < this.maxRetries) {
            lastError = error;
            continue;
          }
          throw error;
        }

        return await response.json();
      } catch (error) {
        if (error instanceof GlassnodeApiError) {
          throw error;
        }
        if (error instanceof Error) {
          lastError = error;
          if (attempt < this.maxRetries) continue;
          throw new Error(`Glassnode API error: ${error.message}`, { cause: error });
        }
        throw new Error('Unknown error occurred', { cause: error });
      }
    }

    throw lastError;
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
    const response = await this.request('/v1/bulk' + metricPath, { ...params, f: 'json' });
    return BulkResponseSchema.parse(response);
  }
}
