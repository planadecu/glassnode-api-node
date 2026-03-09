import { GlassnodeAPI } from '../src/glassnode-api';
import { GlassnodeApiError } from '../src/errors';
import {
  API_KEY,
  DEFAULT_API_URL,
  CUSTOM_API_URL,
  ASSETS_METADATA_ENDPOINT,
  METRICS_METADATA_ENDPOINT,
  METRICS_ENDPOINT,
  BAD_REQUEST_STATUS_TEXT,
  BAD_REQUEST_ERROR,
  STATUS_BAD_REQUEST,
  METRIC_METADATA_ENDPOINT,
} from './constants';
import {
  mockAssetMetadataResponse,
  mockMetricMetadataResponse,
  mockRawMetricMetadataResponse,
  mockMetricListResponse,
} from './mocks/metadata.mock';

function createMockFetch(response: Partial<Response>) {
  return jest.fn().mockResolvedValue(response);
}

function createApi(fetchFn: jest.Mock) {
  return new GlassnodeAPI({ apiKey: API_KEY, fetch: fetchFn });
}

describe('GlassnodeAPI', () => {
  describe('constructor', () => {
    it('should create an instance with default API URL', () => {
      const api = new GlassnodeAPI({ apiKey: API_KEY });

      // @ts-expect-error: Testing private property
      expect(api.apiKey).toBe(API_KEY);
      // @ts-expect-error: Testing private property
      expect(api.apiUrl).toBe(DEFAULT_API_URL);
    });

    it('should create an instance with custom API URL', () => {
      const api = new GlassnodeAPI({ apiKey: API_KEY, apiUrl: CUSTOM_API_URL });

      // @ts-expect-error: Testing private property
      expect(api.apiKey).toBe(API_KEY);
      // @ts-expect-error: Testing private property
      expect(api.apiUrl).toBe(CUSTOM_API_URL);
    });

    it('should accept an optional logger', async () => {
      const logger = jest.fn();
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetricListResponse),
      });

      const api = new GlassnodeAPI({ apiKey: API_KEY, logger, fetch: fetchFn });
      await api.getMetricList();

      expect(logger).toHaveBeenCalledWith('API call:', expect.stringContaining(DEFAULT_API_URL));
    });

    it('should use custom fetch when provided', async () => {
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetricListResponse),
      });

      const api = createApi(fetchFn);
      await api.getMetricList();

      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining(`${DEFAULT_API_URL}/v1/metadata/metrics`)
      );
    });
  });

  describe('getAssetMetadata', () => {
    it('should fetch asset metadata', async () => {
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: mockAssetMetadataResponse }),
      });

      const api = createApi(fetchFn);
      const result = await api.getAssetMetadata();

      expect(fetchFn).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${ASSETS_METADATA_ENDPOINT}?api_key=${API_KEY}`
      );
      expect(result).toEqual(mockAssetMetadataResponse);
      expect(result[0].id).toBe('bitcoin');
      expect(result[0].symbol).toBe('BTC');
    });

    it('should handle API errors', async () => {
      const fetchFn = createMockFetch({
        ok: false,
        status: STATUS_BAD_REQUEST,
        statusText: BAD_REQUEST_STATUS_TEXT,
      });

      const api = createApi(fetchFn);

      await expect(api.getAssetMetadata()).rejects.toThrow(BAD_REQUEST_ERROR);
    });
  });

  describe('getMetricMetadata', () => {
    it('should fetch metric metadata', async () => {
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRawMetricMetadataResponse),
      });

      const api = createApi(fetchFn);
      const result = await api.getMetricMetadata('/distribution/balance_exchanges');

      expect(fetchFn).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRIC_METADATA_ENDPOINT}?path=%2Fdistribution%2Fbalance_exchanges&api_key=${API_KEY}`
      );
      expect(result).toEqual(mockMetricMetadataResponse);
      expect(result.path).toBe('/distribution/balance_exchanges');
      expect(result.tier).toBe(2);
      expect(result.modified).toBeInstanceOf(Date);
      expect(result.modified!.getTime()).toBe(mockRawMetricMetadataResponse.modified! * 1000);
    });

    it('should handle optional params', async () => {
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRawMetricMetadataResponse),
      });

      const api = createApi(fetchFn);
      const result = await api.getMetricMetadata('/distribution/balance_exchanges', { a: 'BTC' });

      expect(fetchFn).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRIC_METADATA_ENDPOINT}?path=%2Fdistribution%2Fbalance_exchanges&a=BTC&api_key=${API_KEY}`
      );
      expect(result).toEqual(mockMetricMetadataResponse);
    });

    it('should handle API errors', async () => {
      const fetchFn = createMockFetch({
        ok: false,
        status: STATUS_BAD_REQUEST,
        statusText: BAD_REQUEST_STATUS_TEXT,
      });

      const api = createApi(fetchFn);

      await expect(api.getMetricMetadata('/distribution/balance_exchanges')).rejects.toThrow(
        BAD_REQUEST_ERROR
      );
    });
  });

  describe('getMetricList', () => {
    it('should fetch metric list', async () => {
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetricListResponse),
      });

      const api = createApi(fetchFn);
      const result = await api.getMetricList();

      expect(fetchFn).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRICS_METADATA_ENDPOINT}?api_key=${API_KEY}`
      );
      expect(result).toEqual(mockMetricListResponse);
      expect(result[0]).toBe('/distribution/balance_exchanges');
      expect(result.length).toBe(4);
    });

    it('should handle API errors', async () => {
      const fetchFn = createMockFetch({
        ok: false,
        status: STATUS_BAD_REQUEST,
        statusText: BAD_REQUEST_STATUS_TEXT,
      });

      const api = createApi(fetchFn);

      await expect(api.getMetricList()).rejects.toThrow(BAD_REQUEST_ERROR);
    });
  });

  describe('callMetric', () => {
    it('should call a metric endpoint and return data', async () => {
      const mockData = [{ t: 1609459200, v: 29000 }];
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      });

      const api = createApi(fetchFn);
      const result = await api.callMetric<{ t: number; v: number }[]>('/market/price_usd_close', {
        a: 'BTC',
      });

      expect(fetchFn).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRICS_ENDPOINT}/market/price_usd_close?a=BTC&f=json&api_key=${API_KEY}`
      );
      expect(result).toEqual(mockData);
      expect(result[0].v).toBe(29000);
    });

    it('should handle API errors', async () => {
      const fetchFn = createMockFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const api = createApi(fetchFn);

      await expect(api.callMetric('/market/price_usd_close', { a: 'BTC' })).rejects.toThrow(
        'API request failed with status 500'
      );
    });
  });

  describe('error handling', () => {
    it('should reject with empty API key', () => {
      expect(() => new GlassnodeAPI({ apiKey: '' })).toThrow();
    });

    it('should throw GlassnodeApiError with status and statusText', async () => {
      const fetchFn = createMockFetch({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const api = createApi(fetchFn);

      try {
        await api.getMetricList();
        fail('Expected GlassnodeApiError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GlassnodeApiError);
        const apiError = error as GlassnodeApiError;
        expect(apiError.status).toBe(401);
        expect(apiError.statusText).toBe('Unauthorized');
        expect(apiError.name).toBe('GlassnodeApiError');
      }
    });

    it('should handle network errors', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const api = createApi(fetchFn);

      await expect(api.getMetricList()).rejects.toThrow('Glassnode API error: Failed to fetch');
    });

    it('should preserve error cause', async () => {
      const networkError = new TypeError('Failed to fetch');
      const fetchFn = jest.fn().mockRejectedValue(networkError);
      const api = createApi(fetchFn);

      try {
        await api.getMetricList();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).cause).toBe(networkError);
      }
    });
  });
});
