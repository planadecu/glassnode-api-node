import { describe, it, expect, vi } from 'vitest';
import { usdcDecimalToAtomic, createMaxAmountPolicy, createX402Fetch } from '../src/x402';
import { GlassnodeAPI } from '../src/glassnode-api';
import {
  GlassnodeError,
  GlassnodeApiError,
  GlassnodeInputError,
  GlassnodeNetworkError,
  GlassnodePaymentError,
} from '../src/errors';

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject');
}

describe('usdcDecimalToAtomic', () => {
  it('converts USDC decimals to 6-decimal atomic units', () => {
    expect(usdcDecimalToAtomic('0.06')).toBe(60000n);
    expect(usdcDecimalToAtomic('0.05')).toBe(50000n);
    expect(usdcDecimalToAtomic('0.01')).toBe(10000n);
    expect(usdcDecimalToAtomic('1')).toBe(1000000n);
    expect(usdcDecimalToAtomic('0')).toBe(0n);
  });

  it('truncates beyond 6 decimals and rejects bad input', () => {
    expect(usdcDecimalToAtomic('0.1234567')).toBe(123456n);
    expect(() => usdcDecimalToAtomic('abc')).toThrow(/Invalid USDC amount/);
    expect(() => usdcDecimalToAtomic('-1')).toThrow(/Invalid USDC amount/);
  });

  it('rejects bad input with a GlassnodeInputError', () => {
    let err: unknown;
    try {
      usdcDecimalToAtomic('1e3');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GlassnodeInputError);
    expect(err).toBeInstanceOf(GlassnodeError);
    expect((err as GlassnodeInputError).argument).toBe('value');
  });
});

describe('createMaxAmountPolicy', () => {
  it('keeps only requirements at or below the cap', () => {
    const policy = createMaxAmountPolicy(60000n);
    const reqs = [{ amount: '50000' }, { amount: '60000' }, { amount: '70000' }];
    expect(policy(2, reqs)).toEqual([{ amount: '50000' }, { amount: '60000' }]);
  });
});

// A signer that never touches a real key. Returns a syntactically valid (fake) signature.
const FAKE_SIGNATURE = `0x${'ab'.repeat(65)}` as const;
function fakeAccount(signTypedData: () => Promise<`0x${string}`> = async () => FAKE_SIGNATURE) {
  return { address: '0x0000000000000000000000000000000000000001' as const, signTypedData };
}

// Base Sepolia USDC — a default asset, so x402's built-in spend controls accept it.
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function paymentRequired(amount: string, overrides: Record<string, unknown> = {}) {
  return {
    x402Version: 2,
    resource: { url: 'https://x402.glassnode.com/v1/metadata/metrics' },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:84532',
        amount,
        asset: BASE_SEPOLIA_USDC,
        payTo: '0x0000000000000000000000000000000000000002',
        maxTimeoutSeconds: 60,
        extra: { name: 'USDC', version: '2' },
        ...overrides,
      },
    ],
  };
}

function response402(body = paymentRequired('50000')): Response {
  return new Response('{}', {
    status: 402,
    statusText: 'Payment Required',
    headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(body)).toString('base64') },
  });
}

function paidApi(paidFetch: typeof fetch, extra: Record<string, unknown> = {}) {
  return new GlassnodeAPI({ x402: true, fetch: paidFetch, retryDelay: 1, ...extra });
}

describe('createX402Fetch', () => {
  it('returns a callable fetch using the real x402 client', async () => {
    const wrapped = await createX402Fetch({ account: fakeAccount(), maxPaymentPerCall: '0.06' });
    expect(typeof wrapped).toBe('function');
  });

  it('rejects an invalid maxPaymentPerCall with a GlassnodeInputError', async () => {
    const err = await caught(
      createX402Fetch({ account: fakeAccount(), maxPaymentPerCall: 'lots' })
    );
    expect(err).toBeInstanceOf(GlassnodeInputError);
    expect((err as GlassnodeInputError).argument).toBe('maxPaymentPerCall');
    expect((err as Error).message).toMatch(/Invalid USDC amount/);
  });

  it('price above maxPaymentPerCall -> GlassnodePaymentError, not retried', async () => {
    const baseFetch = vi.fn(async () => response402(paymentRequired('70000')));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      maxPaymentPerCall: '0.06',
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 3 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err).toBeInstanceOf(GlassnodeError);
    expect(err).not.toBeInstanceOf(GlassnodeNetworkError);
    const e = err as GlassnodePaymentError;
    expect(e.name).toBe('GlassnodePaymentError');
    expect(e.message).toMatch(/filtered out by policies/);
    expect(e.message).toMatch(/maxPaymentPerCall/);
    expect(e.cause).toBeInstanceOf(Error);
    // One unpaid request, no payment attempt, no retry.
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('signer failure -> GlassnodePaymentError, not retried, cause preserved', async () => {
    const baseFetch = vi.fn(async () => response402());
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => {
      throw new Error('hardware wallet disconnected');
    });
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect((err as Error).message).toMatch(/hardware wallet disconnected/);
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('a malformed 402 (no payment requirements) -> GlassnodePaymentError', async () => {
    const baseFetch = vi.fn(async () => new Response('{}', { status: 402 }));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('redacts api_key query values from payment error messages', async () => {
    // x402 dumps the offered requirements into some messages; one echoing a URL must not leak a key.
    const body = paymentRequired('50000', {
      network: 'eip155:1',
      extra: { resource: 'https://x402.glassnode.com/v1?api_key=SECRET-KEY' },
    });
    const baseFetch = vi.fn(async () => response402(body));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(paidApi(paidFetch).getMetricList())) as Error;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.message).toMatch(/No network\/scheme registered/);
    expect(err.message).not.toContain('SECRET-KEY');
  });

  it('base-fetch transport failure stays a retried GlassnodeNetworkError', async () => {
    const cause = new TypeError('fetch failed');
    const baseFetch = vi.fn(async () => {
      throw cause;
    });
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodeNetworkError);
    expect(err).not.toBeInstanceOf(GlassnodePaymentError);
    expect((err as GlassnodeNetworkError).cause).toBe(cause);
    expect((err as GlassnodeNetworkError).timedOut).toBe(false);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it('base-fetch transport failure on the paid request is also a network error', async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(response402())
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as unknown as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch).getMetricList());
    expect(err).toBeInstanceOf(GlassnodeNetworkError);
    expect((err as GlassnodeNetworkError).timedOut).toBe(true);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('a 402 after payment is still a GlassnodeApiError(402)', async () => {
    const baseFetch = vi.fn(async () => response402());
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodeApiError);
    expect((err as GlassnodeApiError).status).toBe(402);
    expect((err as GlassnodeApiError).isRetryable).toBe(false);
    // Unpaid request + paid request; 402 is not retried.
    expect(baseFetch).toHaveBeenCalledTimes(2);
    const paid = baseFetch.mock.calls[1] as unknown as [Request];
    expect(paid[0].headers.get('PAYMENT-SIGNATURE')).toBeTruthy();
  });

  it('never puts signature material into a payment error message', async () => {
    // Paid request carries a signature; make the payment layer fail afterwards by sending the
    // signed request back through the wrapper ("Payment already attempted").
    const baseFetch = vi.fn(async () => response402());
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(
      paidFetch('https://x402.glassnode.com/v1/metadata/metrics', {
        headers: { 'PAYMENT-SIGNATURE': 'already-signed' },
      })
    )) as Error;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.message).not.toContain('ab'.repeat(65));
  });
});
