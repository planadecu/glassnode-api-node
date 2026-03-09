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
        'API request failed (500)'
      );
    });
  });

  describe('callBulkMetric', () => {
    it('should call a bulk metric endpoint and return validated data', async () => {
      const mockData = [
        {
          t: 1609459200,
          bulk: [
            { a: 'BTC', v: 600000000000 },
            { a: 'ETH', v: 100000000000, network: 'ethereum' },
          ],
        },
      ];
      const fetchFn = createMockFetch({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: mockData }),
      });

      const api = createApi(fetchFn);
      const result = await api.callBulkMetric('/market/marketcap_usd');

      expect(fetchFn).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}/v1/metrics/market/marketcap_usd/bulk?f=json&api_key=${API_KEY}`
      );
      expect(result).toHaveLength(1);
      expect(result[0].bulk).toHaveLength(2);
      expect(result[0].bulk[0].a).toBe('BTC');
      expect(result[0].bulk[1].network).toBe('ethereum');
    });

    it('should handle API errors', async () => {
      const fetchFn = createMockFetch({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const api = createApi(fetchFn);

      await expect(api.callBulkMetric('/market/marketcap_usd')).rejects.toThrow(
        'API request failed (403)'
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
        expect(apiError.message).toContain('Invalid or missing API key');
      }
    });

    it('should use specific messages for known status codes', async () => {
      const cases = [
        { status: 403, expected: 'Access forbidden' },
        { status: 404, expected: 'not found' },
        { status: 429, expected: 'Rate limit exceeded' },
      ];

      for (const { status, expected } of cases) {
        const fetchFn = createMockFetch({ ok: false, status, statusText: 'Error' });
        const api = createApi(fetchFn);

        try {
          await api.getMetricList();
          fail(`Expected error for status ${status}`);
        } catch (error) {
          expect((error as GlassnodeApiError).message).toContain(expected);
        }
      }
    });

    it('should mark 429 and 5xx errors as retryable', () => {
      expect(new GlassnodeApiError(429, 'Too Many Requests').isRetryable).toBe(true);
      expect(new GlassnodeApiError(500, 'Internal Server Error').isRetryable).toBe(true);
      expect(new GlassnodeApiError(503, 'Service Unavailable').isRetryable).toBe(true);
      expect(new GlassnodeApiError(400, 'Bad Request').isRetryable).toBe(false);
      expect(new GlassnodeApiError(401, 'Unauthorized').isRetryable).toBe(false);
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

  describe('retry logic', () => {
    it('should retry on 429 and succeed', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockMetricListResponse),
        });

      const api = new GlassnodeAPI({
        apiKey: API_KEY,
        fetch: fetchFn,
        maxRetries: 2,
        retryDelay: 1,
      });
      const result = await api.getMetricList();

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockMetricListResponse);
    });

    it('should retry on 500 and succeed', async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockMetricListResponse),
        });

      const api = new GlassnodeAPI({
        apiKey: API_KEY,
        fetch: fetchFn,
        maxRetries: 1,
        retryDelay: 1,
      });
      const result = await api.getMetricList();

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockMetricListResponse);
    });

    it('should throw after exhausting retries', async () => {
      const fetchFn = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const api = new GlassnodeAPI({
        apiKey: API_KEY,
        fetch: fetchFn,
        maxRetries: 2,
        retryDelay: 1,
      });

      await expect(api.getMetricList()).rejects.toThrow(GlassnodeApiError);
      expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should not retry on 401', async () => {
      const fetchFn = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const api = new GlassnodeAPI({
        apiKey: API_KEY,
        fetch: fetchFn,
        maxRetries: 2,
        retryDelay: 1,
      });

      await expect(api.getMetricList()).rejects.toThrow(GlassnodeApiError);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors', async () => {
      const fetchFn = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockMetricListResponse),
        });

      const api = new GlassnodeAPI({
        apiKey: API_KEY,
        fetch: fetchFn,
        maxRetries: 1,
        retryDelay: 1,
      });
      const result = await api.getMetricList();

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual(mockMetricListResponse);
    });
  });
});
