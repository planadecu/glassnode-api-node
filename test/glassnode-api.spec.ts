import { GlassnodeAPI } from '../src/glassnode-api';
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

// Mock fetch globally
global.fetch = jest.fn();

describe('GlassnodeAPI', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with default API URL', () => {
      const api = new GlassnodeAPI({
        apiKey: API_KEY,
      });

      // @ts-expect-error: Testing private property
      expect(api.apiKey).toBe(API_KEY);
      // @ts-expect-error: Testing private property
      expect(api.apiUrl).toBe(DEFAULT_API_URL);
    });

    it('should create an instance with custom API URL', () => {
      const api = new GlassnodeAPI({
        apiKey: API_KEY,
        apiUrl: CUSTOM_API_URL,
      });

      // @ts-expect-error: Testing private property
      expect(api.apiKey).toBe(API_KEY);
      // @ts-expect-error: Testing private property
      expect(api.apiUrl).toBe(CUSTOM_API_URL);
    });

    it('should accept an optional logger', async () => {
      const logger = jest.fn();
      const api = new GlassnodeAPI({ apiKey: API_KEY, logger });

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetricListResponse),
      };
      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      await api.getMetricList();
      expect(logger).toHaveBeenCalledWith('API call:', expect.stringContaining(DEFAULT_API_URL));
    });
  });

  describe('getAssetMetadata', () => {
    it('should fetch asset metadata', async () => {
      // Mock response data
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ data: mockAssetMetadataResponse }),
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });
      const result = await api.getAssetMetadata();

      // Verify fetch was called with correct URL
      expect(global.fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${ASSETS_METADATA_ENDPOINT}?api_key=${API_KEY}`
      );

      // Verify response is parsed correctly
      expect(result).toEqual(mockAssetMetadataResponse);
      expect(result[0].id).toBe('bitcoin');
      expect(result[0].symbol).toBe('BTC');
    });

    it('should handle API errors', async () => {
      // Mock error response
      const mockResponse = {
        ok: false,
        status: STATUS_BAD_REQUEST,
        statusText: BAD_REQUEST_STATUS_TEXT,
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });

      await expect(api.getAssetMetadata()).rejects.toThrow(BAD_REQUEST_ERROR);
    });
  });

  describe('getMetricMetadata', () => {
    it('should fetch metric metadata', async () => {
      // Mock response data
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockRawMetricMetadataResponse),
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });
      const result = await api.getMetricMetadata('/distribution/balance_exchanges');

      // Verify fetch was called with correct URL
      expect(global.fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRIC_METADATA_ENDPOINT}?path=%2Fdistribution%2Fbalance_exchanges&api_key=${API_KEY}`
      );

      // Verify response is parsed correctly
      expect(result).toEqual(mockMetricMetadataResponse);
      expect(result.path).toBe('/distribution/balance_exchanges');
      expect(result.tier).toBe(2);

      // Verify the timestamp was transformed to a Date object
      expect(result.modified).toBeInstanceOf(Date);
      // Verify the timestamp was correctly converted (1733829848 seconds to milliseconds)
      expect(result.modified.getTime()).toBe(mockRawMetricMetadataResponse.modified * 1000);
    });

    it('should handle optional params', async () => {
      // Mock response data
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockRawMetricMetadataResponse),
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });
      const result = await api.getMetricMetadata('/distribution/balance_exchanges', { a: 'BTC' });

      // Verify fetch was called with correct URL including additional params
      expect(global.fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRIC_METADATA_ENDPOINT}?path=%2Fdistribution%2Fbalance_exchanges&a=BTC&api_key=${API_KEY}`
      );

      // Verify response is parsed correctly
      expect(result).toEqual(mockMetricMetadataResponse);
    });

    it('should handle API errors', async () => {
      // Mock error response
      const mockResponse = {
        ok: false,
        status: STATUS_BAD_REQUEST,
        statusText: BAD_REQUEST_STATUS_TEXT,
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });

      await expect(api.getMetricMetadata('/distribution/balance_exchanges')).rejects.toThrow(
        BAD_REQUEST_ERROR
      );
    });
  });

  describe('getMetricList', () => {
    it('should fetch metric list', async () => {
      // Mock response data
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetricListResponse),
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });
      const result = await api.getMetricList();

      // Verify fetch was called with correct URL
      expect(global.fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRICS_METADATA_ENDPOINT}?api_key=${API_KEY}`
      );

      // Verify response is parsed correctly
      expect(result).toEqual(mockMetricListResponse);
      expect(result[0]).toBe('/distribution/balance_exchanges');
      expect(result.length).toBe(4);
    });

    it('should handle API errors', async () => {
      // Mock error response
      const mockResponse = {
        ok: false,
        status: STATUS_BAD_REQUEST,
        statusText: BAD_REQUEST_STATUS_TEXT,
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });

      await expect(api.getMetricList()).rejects.toThrow(BAD_REQUEST_ERROR);
    });
  });

  describe('callMetric', () => {
    it('should call a metric endpoint and return data', async () => {
      const mockData = [{ t: 1609459200, v: 29000 }];
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });
      const result = await api.callMetric<{ t: number; v: number }[]>('/market/price_usd_close', {
        a: 'BTC',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}${METRICS_ENDPOINT}/market/price_usd_close?a=BTC&f=json&api_key=${API_KEY}`
      );
      expect(result).toEqual(mockData);
      expect(result[0].v).toBe(29000);
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      };

      // @ts-expect-error: Mocking fetch
      global.fetch.mockResolvedValue(mockResponse);

      const api = new GlassnodeAPI({ apiKey: API_KEY });

      await expect(api.callMetric('/market/price_usd_close', { a: 'BTC' })).rejects.toThrow(
        'API request failed with status 500'
      );
    });
  });

  describe('error handling', () => {
    it('should reject with empty API key', () => {
      expect(() => new GlassnodeAPI({ apiKey: '' })).toThrow();
    });

    it('should handle network errors', async () => {
      // @ts-expect-error: Mocking fetch
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const api = new GlassnodeAPI({ apiKey: API_KEY });

      await expect(api.getMetricList()).rejects.toThrow('Glassnode API error: Failed to fetch');
    });

    it('should preserve error cause', async () => {
      const networkError = new TypeError('Failed to fetch');
      // @ts-expect-error: Mocking fetch
      global.fetch.mockRejectedValue(networkError);

      const api = new GlassnodeAPI({ apiKey: API_KEY });

      try {
        await api.getMetricList();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).cause).toBe(networkError);
      }
    });
  });
});
