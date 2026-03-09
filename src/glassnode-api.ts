import { GlassnodeConfig, GlassnodeConfigSchema, Logger, FetchFn } from './types/config';
import { GlassnodeApiError } from './errors';
import {
  AssetMetadataResponse,
  MetricMetadataResponse,
  AssetMetadataResponseSchema,
  MetricMetadataResponseSchema,
  MetricListResponse,
  MetricListResponseSchema,
} from './types/metadata';

/**
 * Glassnode API client
 */
export class GlassnodeAPI {
  private apiKey: string;
  private apiUrl: string;
  private logger?: Logger;
  private fetchFn: FetchFn;

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
  }

  /**
   * Make an API request
   * @param endpoint API endpoint path
   * @param params Query parameters
   * @returns Promise resolving to the response data
   */
  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    // Add API key to params
    const queryParams = new URLSearchParams({
      ...params,
      api_key: this.apiKey,
    });

    const url = `${this.apiUrl}${endpoint}?${queryParams}`;
    this.logger?.('API call:', url);

    try {
      const response = await this.fetchFn(url);

      if (!response.ok) {
        throw new GlassnodeApiError(response.status, response.statusText);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof GlassnodeApiError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new Error(`Glassnode API error: ${error.message}`, { cause: error });
      }
      throw new Error('Unknown error occurred', { cause: error });
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
}
