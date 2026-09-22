import { describe, it, expect, vi } from 'vitest';
import { GlassnodeAPI } from '../src/glassnode-api';
import { createX402Fetch } from '../src/x402';
import { MIN_RAW_REDACT_LENGTH, redactApiKey, redactSecrets } from '../src/redact';
import {
  GlassnodeApiError,
  GlassnodeNetworkError,
  GlassnodePaymentError,
  GlassnodeValidationError,
} from '../src/errors';
import { mockRawMetricMetadataResponse } from './mocks/metadata.mock';

// Long enough to be raw-masked; contains characters that URL-encoding changes.
const KEY = 'sk-live/abc+def 123';
const LOCATIONS = ['query', 'header'] as const;

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject');
}

/** Every string-valued own property of an error (message, detail, statusText, ...). */
function stringFields(err: unknown): string[] {
  const e = err as Record<string, unknown>;
  const names = new Set([...Object.getOwnPropertyNames(e), 'message', 'name']);
  return [...names].map((n) => e[n]).filter((v): v is string => typeof v === 'string');
}

/** Assert no string field of the error, nor of a library-built error on its `.cause`, has the key. */
function expectNoKey(err: unknown, key = KEY): void {
  const forms = [key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)];
  const errors = [err];
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof GlassnodeApiError) errors.push(cause);
  for (const e of errors) {
    for (const text of stringFields(e)) {
      for (const form of forms) expect(text).not.toContain(form);
    }
  }
}

function errorResponse(body: string, status = 400, statusText = 'Bad Request'): Response {
  return new Response(body, { status, statusText });
}

describe('redactSecrets', () => {
  it('always masks the api_key= query form, whatever the key length', () => {
    expect(redactSecrets('GET /v1?a=BTC&api_key=x&i=24h', ['x'])).toBe(
      'GET /v1?a=BTC&api_key=***&i=24h'
    );
    expect(redactSecrets('bad api_key=zz given', [])).toBe('bad api_key=*** given');
    expect(redactApiKey('https://h/v1?api_key=abc')).toBe('https://h/v1?api_key=***');
  });

  it('masks raw, percent-encoded and form-encoded copies of a long key', () => {
    const text = `raw ${KEY} pct ${encodeURIComponent(KEY)} form ${new URLSearchParams({ k: KEY }).toString().slice(2)}`;
    expect(redactSecrets(text, [KEY])).toBe('raw *** pct *** form ***');
  });

  it(`does not raw-mask keys shorter than ${MIN_RAW_REDACT_LENGTH} characters`, () => {
    const short = 'a'.repeat(MIN_RAW_REDACT_LENGTH - 1);
    expect(redactSecrets(`value ${short} here`, [short])).toBe(`value ${short} here`);
    expect(redactSecrets('Bad request 400', ['400'])).toBe('Bad request 400');
    const exact = 'b'.repeat(MIN_RAW_REDACT_LENGTH);
    expect(redactSecrets(`value ${exact} here`, [exact])).toBe('value *** here');
  });

  it('leaves text without a key unchanged and ignores undefined/empty keys', () => {
    const text = 'Resolution 1h is not allowed';
    expect(redactSecrets(text, [undefined, '', KEY])).toBe(text);
  });
});

describe('GlassnodeApiError never carries the API key', () => {
  for (const apiKeyLocation of LOCATIONS) {
    describe(`apiKeyLocation: ${apiKeyLocation}`, () => {
      const api = (fetchFn: unknown) =>
        new GlassnodeAPI({ apiKey: KEY, apiKeyLocation, fetch: fetchFn as typeof fetch });

      it('masks a server JSON message echoing the request URL and the raw key', async () => {
        const url = `https://api.glassnode.com/v1/metadata/metrics?api_key=${encodeURIComponent(KEY)}`;
        const body = JSON.stringify({ message: `bad request to ${url} (key ${KEY})` });
        const err = (await caught(
          api(vi.fn().mockResolvedValue(errorResponse(body))).getMetricList()
        )) as GlassnodeApiError;
        expect(err).toBeInstanceOf(GlassnodeApiError);
        expect(err.detail).toBe(
          'bad request to https://api.glassnode.com/v1/metadata/metrics?api_key=*** (key ***)'
        );
        expect(err.message).toBe(`API request failed (400): Bad request — ${err.detail}`);
        expectNoKey(err);
      });

      it('masks a raw-text (proxy) body echoing the key', async () => {
        const body = `<html>upstream error X-Api-Key: ${KEY}</html>`;
        const err = await caught(
          api(vi.fn().mockResolvedValue(errorResponse(body, 502, 'Bad Gateway'))).getMetricList()
        );
        expect(err).toBeInstanceOf(GlassnodeApiError);
        expect((err as GlassnodeApiError).detail).toBe(
          '<html>upstream error X-Api-Key: ***</html>'
        );
        expectNoKey(err);
      });

      it('masks a key echoed in the status text', async () => {
        const err = await caught(
          api(vi.fn().mockResolvedValue(errorResponse('', 418, `teapot ${KEY}`))).getMetricList()
        );
        expect(err).toBeInstanceOf(GlassnodeApiError);
        expect((err as GlassnodeApiError).statusText).toBe('teapot ***');
        expectNoKey(err);
      });

      it('masks the key on a retried error that ends the loop', async () => {
        const fetchFn = vi
          .fn()
          .mockResolvedValue(errorResponse(`overloaded ${KEY}`, 503, `busy ${KEY}`));
        const err = await caught(
          new GlassnodeAPI({
            apiKey: KEY,
            apiKeyLocation,
            fetch: fetchFn,
            maxRetries: 1,
            retryDelay: 1,
          }).getMetricList()
        );
        expect(err).toBeInstanceOf(GlassnodeApiError);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expectNoKey(err);
      });

      it('masks a key in a transport error (raw and in a URL)', async () => {
        const leaky = new TypeError(`fetch https://h/v1?api_key=${KEY} failed; header ${KEY}`);
        const err = await caught(api(vi.fn().mockRejectedValue(leaky)).getMetricList());
        expect(err).toBeInstanceOf(GlassnodeNetworkError);
        expectNoKey(err);
        // By design the original error stays on `.cause`, unredacted.
        expect((err as Error).cause).toBe(leaky);
      });

      it('masks a key in a schema-validation message (response keys appear in issue paths)', async () => {
        const body = JSON.stringify({
          ...mockRawMetricMetadataResponse,
          parameters: { [KEY]: 'not-an-array' },
        });
        const err = await caught(
          api(vi.fn().mockResolvedValue(new Response(body, { status: 200 }))).getMetricMetadata(
            '/market/price_usd_close'
          )
        );
        expect(err).toBeInstanceOf(GlassnodeValidationError);
        expect((err as Error).message).toContain('parameters.***');
        expectNoKey(err);
      });
    });
  }

  it('leaves normal error details unchanged', async () => {
    const body = JSON.stringify({ message: 'Resolution 1h is not allowed' });
    const err = (await caught(
      new GlassnodeAPI({
        apiKey: KEY,
        fetch: vi.fn().mockResolvedValue(errorResponse(body)),
      }).getMetricList()
    )) as GlassnodeApiError;
    expect(err.detail).toBe('Resolution 1h is not allowed');
    expect(err.statusText).toBe('Bad Request');
    expect(err.message).toBe(
      'API request failed (400): Bad request — Resolution 1h is not allowed'
    );
  });

  it('with a short key: masks the api_key= form but not unrelated text', async () => {
    const shortKey = '400';
    const body = JSON.stringify({
      message: 'Bad request to /v1/metrics?api_key=400&a=BTC: 400 rows',
    });
    const err = (await caught(
      new GlassnodeAPI({
        apiKey: shortKey,
        fetch: vi.fn().mockResolvedValue(errorResponse(body)),
      }).getMetricList()
    )) as GlassnodeApiError;
    expect(err.detail).toBe('Bad request to /v1/metrics?api_key=***&a=BTC: 400 rows');
    expect(err.message).toBe(`API request failed (400): Bad request — ${err.detail}`);
  });
});

// --- x402 ---------------------------------------------------------------------------------

const FAKE_SIGNATURE = `0x${'ab'.repeat(65)}` as const;
function fakeAccount(signTypedData: () => Promise<`0x${string}`> = async () => FAKE_SIGNATURE) {
  return { address: '0x0000000000000000000000000000000000000001' as const, signTypedData };
}
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
function response402(overrides: Record<string, unknown> = {}): Response {
  const body = {
    x402Version: 2,
    resource: { url: 'https://x402.glassnode.com/v1/metadata/metrics' },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '50000',
        asset: BASE_SEPOLIA_USDC,
        payTo: '0x0000000000000000000000000000000000000002',
        maxTimeoutSeconds: 60,
        extra: { name: 'USDC', version: '2' },
        ...overrides,
      },
    ],
  };
  return new Response('{}', {
    status: 402,
    statusText: 'Payment Required',
    headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(body)).toString('base64') },
  });
}
function isPaid(input: unknown): boolean {
  return (
    input instanceof Request &&
    (input.headers.has('PAYMENT-SIGNATURE') || input.headers.has('X-PAYMENT'))
  );
}

describe('GlassnodePaymentError never carries the API key', () => {
  for (const apiKeyLocation of LOCATIONS) {
    describe(`apiKeyLocation: ${apiKeyLocation}`, () => {
      const paidApi = (paidFetch: typeof fetch) =>
        new GlassnodeAPI({ x402: true, apiKey: KEY, apiKeyLocation, fetch: paidFetch });

      it('payment-layer failure echoing the key (raw and in a URL)', async () => {
        const baseFetch = vi.fn(async () =>
          response402({
            network: 'eip155:1',
            extra: { resource: `https://x402.glassnode.com/v1?api_key=${KEY}`, echo: KEY },
          })
        );
        const paidFetch = await createX402Fetch({
          account: fakeAccount(),
          fetch: baseFetch as typeof fetch,
        });
        const err = await caught(paidApi(paidFetch).getMetricList());
        expect(err).toBeInstanceOf(GlassnodePaymentError);
        expect((err as Error).message).toMatch(/No network\/scheme registered/);
        expectNoKey(err);
      });

      it('signer failure echoing the key', async () => {
        const paidFetch = await createX402Fetch({
          account: fakeAccount(async () => {
            throw new Error(`signer saw ${KEY}`);
          }),
          fetch: vi.fn(async () => response402()) as typeof fetch,
        });
        const err = await caught(paidApi(paidFetch).getMetricList());
        expect(err).toBeInstanceOf(GlassnodePaymentError);
        expect((err as Error).message).toMatch(/signer saw \*\*\*/);
        expectNoKey(err);
      });

      it('paid HTTP error whose body and status text echo the key', async () => {
        const baseFetch = vi.fn(async (input: RequestInfo | URL) =>
          isPaid(input)
            ? errorResponse(
                JSON.stringify({ message: `upstream failed for ?api_key=${KEY} / ${KEY}` }),
                502,
                `Bad Gateway ${KEY}`
              )
            : response402()
        );
        const paidFetch = await createX402Fetch({
          account: fakeAccount(),
          fetch: baseFetch as typeof fetch,
        });
        const err = (await caught(paidApi(paidFetch).getMetricList())) as GlassnodePaymentError;
        expect(err).toBeInstanceOf(GlassnodePaymentError);
        expect(err.status).toBe(502);
        expect((err.cause as GlassnodeApiError).detail).toBe(
          'upstream failed for ?api_key=*** / ***'
        );
        expectNoKey(err);
      });

      it('paid transport failure echoing the key', async () => {
        const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
          if (isPaid(input)) throw new TypeError(`socket closed (${KEY})`);
          return response402();
        });
        const paidFetch = await createX402Fetch({
          account: fakeAccount(),
          fetch: baseFetch as typeof fetch,
        });
        const err = await caught(paidApi(paidFetch).getMetricList());
        expect(err).toBeInstanceOf(GlassnodePaymentError);
        expect((err as GlassnodePaymentError).paymentMayHaveSettled).toBe(true);
        expectNoKey(err);
      });

      it('402 refused after payment, body echoing the key -> GlassnodeApiError without it', async () => {
        const baseFetch = vi.fn(async (input: RequestInfo | URL) =>
          isPaid(input)
            ? errorResponse(`insufficient funds for ${KEY}`, 402, 'Payment Required')
            : response402()
        );
        const paidFetch = await createX402Fetch({
          account: fakeAccount(),
          fetch: baseFetch as typeof fetch,
        });
        const err = await caught(paidApi(paidFetch).getMetricList());
        expect(err).toBeInstanceOf(GlassnodeApiError);
        expect((err as GlassnodeApiError).status).toBe(402);
        expectNoKey(err);
      });
    });
  }

  it('the x402 fetch used on its own masks the key it was sent (header and query)', async () => {
    for (const init of [{ headers: { 'X-Api-Key': KEY } }, undefined]) {
      const url = init
        ? 'https://x402.glassnode.com/v1/metadata/metrics'
        : `https://x402.glassnode.com/v1/metadata/metrics?api_key=${encodeURIComponent(KEY)}`;
      const paidFetch = await createX402Fetch({
        account: fakeAccount(async () => {
          throw new Error(`signer saw ${KEY}`);
        }),
        fetch: vi.fn(async () => response402()) as typeof fetch,
      });
      const err = await caught(paidFetch(url, init));
      expect(err).toBeInstanceOf(GlassnodePaymentError);
      expectNoKey(err);
    }
  });
});
