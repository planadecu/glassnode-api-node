import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { GlassnodeAPI } from '../src/glassnode-api.js';
import { GlassnodeInputError } from '../src/errors.js';
import type { MetricParams, MetricParamValue, MetricTime, MetricInterval } from '../src/index.js';
import { API_KEY, DEFAULT_API_URL } from './constants.js';

const PRICE = `${DEFAULT_API_URL}/v1/metrics/market/price_usd_close`;

function okFetch(body: unknown = []) {
  return vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(body) });
}

function neverFetch() {
  return vi.fn().mockRejectedValue(new Error('fetch must not be called'));
}

function client(fetchFn: ReturnType<typeof vi.fn>) {
  return new GlassnodeAPI({ apiKey: API_KEY, fetch: fetchFn as typeof fetch });
}

/** The URL of the single request `params` produce via callMetric. */
async function urlFor(params: unknown): Promise<string> {
  const fetchFn = okFetch();
  await client(fetchFn).callMetric('/market/price_usd_close', params as MetricParams);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  return fetchFn.mock.calls[0][0] as string;
}

async function rejection(params: unknown, method: PathMethod = 'callMetric') {
  const fetchFn = neverFetch();
  const api = client(fetchFn);
  const err = await (api[method] as (p: string, q: unknown) => Promise<unknown>)(
    '/market/price_usd_close',
    params
  ).then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(GlassnodeInputError);
  expect(fetchFn).not.toHaveBeenCalled();
  return err as GlassnodeInputError;
}

type PathMethod = 'callMetric' | 'callBulkMetric' | 'getMetricMetadata' | 'getMetricStats';
const PATH_METHODS: PathMethod[] = [
  'callMetric',
  'callBulkMetric',
  'getMetricMetadata',
  'getMetricStats',
];

describe('param value conversion', () => {
  it('passes strings through unchanged (byte-identical to before)', async () => {
    expect(await urlFor({ a: 'BTC', s: '1609459200', i: '24h' })).toBe(
      `${PRICE}?a=BTC&s=1609459200&i=24h&f=json&api_key=${API_KEY}`
    );
  });

  it.each<[string, number, string]>([
    ['an integer timestamp', 1609459200, '1609459200'],
    ['zero', 0, '0'],
    ['negative zero (as 0)', -0, '0'],
    ['a negative integer', -5, '-5'],
    ['a float (shortest round-trip form)', 0.1, '0.1'],
    ['a float with many digits', 1.2345678901234567, '1.2345678901234567'],
    ['a large safe integer', Number.MAX_SAFE_INTEGER, '9007199254740991'],
    ['a small float above the exponent threshold', 0.000001, '0.000001'],
  ])('converts %s', async (_label, value, expected) => {
    expect(await urlFor({ s: value })).toBe(`${PRICE}?s=${expected}&f=json&api_key=${API_KEY}`);
  });

  it('formats numbers independently of the locale', async () => {
    const spy = vi.spyOn(Number.prototype, 'toLocaleString').mockReturnValue('1.609.459.200');
    try {
      expect(await urlFor({ s: 1609459200 })).toBe(
        `${PRICE}?s=1609459200&f=json&api_key=${API_KEY}`
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('converts booleans to "true"/"false"', async () => {
    expect(await urlFor({ x: true, y: false })).toBe(
      `${PRICE}?x=true&y=false&f=json&api_key=${API_KEY}`
    );
  });

  it('converts a Date to unix seconds', async () => {
    expect(await urlFor({ s: new Date('2021-01-01T00:00:00Z') })).toBe(
      `${PRICE}?s=1609459200&f=json&api_key=${API_KEY}`
    );
  });

  it('floors a Date with milliseconds to the whole second it falls in', async () => {
    expect(
      await urlFor({ s: new Date('2021-01-01T00:00:00.999Z'), u: new Date(1609459201001) })
    ).toBe(`${PRICE}?s=1609459200&u=1609459201&f=json&api_key=${API_KEY}`);
  });

  it('recognises a Date from another realm (e.g. an iframe or vm context)', async () => {
    const foreign = runInNewContext('new Date(1609459200000)') as Date;
    expect(foreign instanceof Date).toBe(false);
    expect(await urlFor({ s: foreign })).toBe(`${PRICE}?s=1609459200&f=json&api_key=${API_KEY}`);
  });

  it('floors pre-1970 Dates towards -Infinity (not towards zero)', async () => {
    expect(await urlFor({ s: new Date(-500) })).toBe(`${PRICE}?s=-1&f=json&api_key=${API_KEY}`);
    expect(await urlFor({ s: new Date(0) })).toBe(`${PRICE}?s=0&f=json&api_key=${API_KEY}`);
  });

  it('omits params whose value is undefined', async () => {
    expect(await urlFor({ a: 'BTC', s: undefined, i: '24h' })).toBe(
      `${PRICE}?a=BTC&i=24h&f=json&api_key=${API_KEY}`
    );
  });

  it('treats an undefined reserved param as absent (api_key, f)', async () => {
    expect(await urlFor({ a: 'BTC', api_key: undefined, f: undefined })).toBe(
      `${PRICE}?a=BTC&f=json&api_key=${API_KEY}`
    );
  });

  it('keeps an undefined `path` from overriding the metric path in the metadata endpoints', async () => {
    const fetchFn = okFetch({ path: '/market/price_usd_close' });
    await client(fetchFn)
      .getMetricMetadata('/market/price_usd_close', { a: 'BTC', path: undefined })
      .catch(() => undefined);
    expect(fetchFn).toHaveBeenCalledWith(
      `${DEFAULT_API_URL}/v1/metadata/metric?path=%2Fmarket%2Fprice_usd_close&a=BTC&api_key=${API_KEY}`
    );
  });

  it('keeps the caller key order, and places converted values in it', async () => {
    expect(await urlFor({ u: new Date(1609545600000), a: 'ETH', s: 1609459200, x: false })).toBe(
      `${PRICE}?u=1609545600&a=ETH&s=1609459200&x=false&f=json&api_key=${API_KEY}`
    );
  });

  it('does not mutate the caller params object', async () => {
    const params = { a: 'BTC', s: new Date(1609459200000), u: undefined };
    await urlFor(params);
    expect(params).toEqual({ a: 'BTC', s: new Date(1609459200000), u: undefined });
  });

  it('treats a "__proto__" key as an ordinary param, not a prototype', async () => {
    const params = JSON.parse('{"__proto__": "x", "a": "BTC"}');
    expect(await urlFor(params)).toBe(`${PRICE}?__proto__=x&a=BTC&f=json&api_key=${API_KEY}`);
  });

  for (const method of PATH_METHODS) {
    it(`${method} converts numbers, booleans and Dates the same way`, async () => {
      const fetchFn = okFetch();
      await (client(fetchFn)[method] as (p: string, q: MetricParams) => Promise<unknown>)(
        '/market/price_usd_close',
        { a: 'BTC', s: new Date(1609459200500), u: 1609545600, x: true }
      ).catch(() => undefined);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0][0]).toContain('a=BTC&s=1609459200&u=1609545600&x=true');
    });
  }
});

describe('invalid param values', () => {
  it.each<[string, unknown, RegExp]>([
    ['NaN', NaN, /finite number/],
    ['Infinity', Infinity, /finite number/],
    ['-Infinity', -Infinity, /finite number/],
    ['an unsafe integer', 2 ** 53, /safe integer range/],
    ['a huge number (exponent form)', 1e21, /safe integer range/],
    ['a tiny number (exponent form)', 1e-7, /exponent notation/],
    ['an invalid Date', new Date('nope'), /invalid Date/],
    ['null', null, /must not be null/],
    ['an object', { v: 1 }, /must be a string, number, boolean or Date/],
    ['an array', ['BTC', 'ETH'], /must be a string, number, boolean or Date/],
    ['a bigint', 10n, /must be a string, number, boolean or Date/],
    ['a symbol', Symbol('x'), /must be a string, number, boolean or Date/],
    ['a function', () => 1, /must be a string, number, boolean or Date/],
  ])('rejects %s before any request', async (_label, value, message) => {
    for (const method of PATH_METHODS) {
      const err = await rejection({ a: 'BTC', s: value }, method);
      expect(err.argument).toBe('params.s');
      expect(err.message).toMatch(message);
    }
  });

  it('names the offending param in the error', async () => {
    const err = await rejection({ a: 'BTC', some_flag: NaN });
    expect(err.argument).toBe('params.some_flag');
    expect(err.message).toContain('some_flag');
  });

  it.each<[string, unknown]>([
    ['a string', 'a=BTC'],
    ['an array', [['a', 'BTC']]],
    ['a number', 42],
  ])('rejects params that is %s', async (_label, params) => {
    for (const method of PATH_METHODS) {
      const err = await rejection(params, method);
      expect(err.argument).toBe('params');
    }
  });

  it('still accepts null or undefined params as "no params"', async () => {
    expect(await urlFor(undefined)).toBe(`${PRICE}?f=json&api_key=${API_KEY}`);
    expect(await urlFor(null)).toBe(`${PRICE}?f=json&api_key=${API_KEY}`);
  });

  it('rejects a non-string f (e.g. true) as non-JSON', async () => {
    const err = await rejection({ f: true });
    expect(err.argument).toBe('params.f');
    expect(err.message).toMatch(/only supports JSON/);
  });

  it('rejects api_key regardless of its value type', async () => {
    for (const value of [1, true, new Date(), null]) {
      const err = await rejection({ api_key: value });
      expect(err.argument).toBe('params.api_key');
    }
  });

  it('rejects a numeric path in the metadata endpoints', async () => {
    const err = await rejection({ path: 1 }, 'getMetricMetadata');
    expect(err.argument).toBe('params.path');
  });
});

describe('MetricParams types', () => {
  it('accepts numbers, booleans and Dates at compile time', async () => {
    const fetchFn = okFetch();
    const api = client(fetchFn);
    // These must compile (tsc -p tsconfig.test.json type-checks this file).
    await api.callMetric('/market/price_usd_close', { a: 'BTC', s: 1609459200 });
    await api.callMetric('/market/price_usd_close', { a: 'BTC', s: new Date(), u: new Date() });
    await api.callMetric('/market/price_usd_close', { a: 'BTC', i: '24h', c: 'usd', e: 'binance' });
    await api.callMetric('/market/price_usd_close', { a: 'BTC', some_flag: true, n: 3 });
    await api.callBulkMetric('/market/marketcap_usd', { a: '*', s: 1609459200 }).catch(() => {});
    await api.getMetricMetadata('/market/price_usd_close', { a: 'BTC', s: 1 }).catch(() => {});
    await api
      .getMetricStats('/market/price_usd_close', { a: 'BTC', u: new Date() })
      .catch(() => {});

    // Existing string-typed callers keep compiling.
    const legacy: Record<string, string> = { a: 'BTC', s: '1609459200' };
    await api.callMetric('/market/price_usd_close', legacy);
    // Optional values may be undefined.
    const since: number | undefined = undefined;
    await api.callMetric('/market/price_usd_close', { a: 'BTC', s: since });

    // The exported helper types.
    const value: MetricParamValue = new Date();
    const time: MetricTime = 1609459200;
    const interval: MetricInterval = '1h';
    const custom: MetricInterval = '3h';
    const params: MetricParams = { a: 'ETH', s: time, i: interval, x: value };
    expect([custom, params]).toHaveLength(2);

    // @ts-expect-error — the asset is a string
    await api.callMetric('/market/price_usd_close', { a: 1 }).catch(() => {});
    // @ts-expect-error — null is not a value (omit the param, or pass undefined)
    await api.callMetric('/market/price_usd_close', { s: null }).catch(() => {});
    // @ts-expect-error — objects are not param values
    await api.callMetric('/market/price_usd_close', { x: { y: 1 } }).catch(() => {});
    // @ts-expect-error — api_key is set by the client (configure apiKey)
    await api.callMetric('/market/price_usd_close', { api_key: 'k' }).catch(() => {});
  });
});
