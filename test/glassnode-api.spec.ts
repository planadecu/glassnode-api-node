import { GlassnodeAPI } from '../src/glassnode-api';
import {
  API_KEY,
  DEFAULT_API_URL,
  CUSTOM_API_URL,
  ASSETS_METADATA_ENDPOINT,
  METRICS_METADATA_ENDPOINT,
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
});
