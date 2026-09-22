import { describe, it, expect, vi } from 'vitest';
import { usdcDecimalToAtomic, createMaxAmountPolicy, createX402Fetch } from '../src/x402';
import { GlassnodeAPI } from '../src/glassnode-api';
import {
  GlassnodeAbortError,
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

  it('payment errors raised before anything was sent have paymentMayHaveSettled = false', async () => {
    const baseFetch = vi.fn(async () => response402(paymentRequired('70000')));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(paidApi(paidFetch).getMetricList())) as GlassnodePaymentError;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.paymentMayHaveSettled).toBe(false);
    expect(err.timedOut).toBe(false);
    expect(err.status).toBeUndefined();
  });
});

/** Whether a base-fetch call carried an x402 payment header (v2 or v1). */
function isPaidCall(call: unknown[]): boolean {
  const req = call[0];
  return (
    req instanceof Request && (req.headers.has('PAYMENT-SIGNATURE') || req.headers.has('X-PAYMENT'))
  );
}

describe('createX402Fetch — never pays twice for one call', () => {
  it('transport failure on the paid request -> GlassnodePaymentError, one payment, not retried', async () => {
    const cause = new TypeError('fetch failed');
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (isPaidCall([input])) throw cause;
      return response402();
    });
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());

    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err).toBeInstanceOf(GlassnodeError);
    expect(err).not.toBeInstanceOf(GlassnodeNetworkError);
    const e = err as GlassnodePaymentError;
    expect(e.paymentMayHaveSettled).toBe(true);
    expect(e.timedOut).toBe(false);
    expect(e.cause).toBe(cause);
    expect(e.message).toMatch(/may have settled/);
    expect(e.status).toBeUndefined();
    expect(e.message).toMatch(/fetch failed/);
    // Exactly one payment signed and one paid request sent; the call was not retried.
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls.filter(isPaidCall)).toHaveLength(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('a non-Error rejection of the paid request is still flagged, not retried', async () => {
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (isPaidCall([input])) throw 'socket hang up';
      return response402();
    });
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(
      paidApi(paidFetch, { maxRetries: 2 }).getMetricList()
    )) as GlassnodePaymentError;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.paymentMayHaveSettled).toBe(true);
    expect(err.cause).toBe('socket hang up');
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('a timeout abort on the paid request -> flagged payment error with timedOut, not retried', async () => {
    // The paid request hangs until the per-request timeout (AbortSignal.timeout) aborts it.
    const baseFetch = vi.fn((input: RequestInfo | URL) => {
      if (!isPaidCall([input])) return Promise.resolve(response402());
      const signal = (input as Request).signal;
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2, timeout: 50 }).getMetricList());

    expect(err).toBeInstanceOf(GlassnodePaymentError);
    const e = err as GlassnodePaymentError;
    expect(e.paymentMayHaveSettled).toBe(true);
    expect(e.timedOut).toBe(true);
    expect((e.cause as { name?: string }).name).toBe('TimeoutError');
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls.filter(isPaidCall)).toHaveLength(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('a mocked TimeoutError rejection on the paid request is reported as timedOut', async () => {
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(response402())
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as unknown as typeof fetch,
    });
    const err = (await caught(
      paidApi(paidFetch, { maxRetries: 2 }).getMetricList()
    )) as GlassnodePaymentError;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.paymentMayHaveSettled).toBe(true);
    expect(err.timedOut).toBe(true);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('transport failures of the unpaid probe are retried; payment is signed only once a probe succeeds', async () => {
    const events: string[] = [];
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      const paid = isPaidCall([input]);
      events.push(paid ? 'paid' : 'probe');
      if (paid) {
        return new Response(JSON.stringify(['/market/price_usd_close']), { status: 200 });
      }
      if (events.length <= 2) throw new TypeError('fetch failed');
      return response402();
    });
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => {
      events.push('sign');
      return FAKE_SIGNATURE;
    });
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const result = await paidApi(paidFetch, { maxRetries: 2 }).getMetricList();

    expect(result).toEqual(['/market/price_usd_close']);
    expect(events).toEqual(['probe', 'probe', 'probe', 'sign', 'paid']);
    expect(signTypedData).toHaveBeenCalledTimes(1);
  });

  it('probe transport failures exhausting retries stay a GlassnodeNetworkError; nothing signed', async () => {
    const baseFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodeNetworkError);
    expect(err).not.toBeInstanceOf(GlassnodePaymentError);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it('separate calls on the same wrapped fetch are tracked independently', async () => {
    // Call 1: paid request fails in transit (flagged). Call 2: probe fails in transit (network
    // error) — the earlier call's paid state must not leak into it.
    let n = 0;
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      n++;
      if (n === 1) return response402();
      if (isPaidCall([input])) throw new TypeError('reset');
      throw new TypeError('probe down');
    });
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const api = paidApi(paidFetch);
    const first = (await caught(api.getMetricList())) as GlassnodePaymentError;
    expect(first).toBeInstanceOf(GlassnodePaymentError);
    expect(first.paymentMayHaveSettled).toBe(true);
    const second = await caught(api.getMetricList());
    expect(second).toBeInstanceOf(GlassnodeNetworkError);
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

describe('createX402Fetch — an HTTP error after payment is never retried', () => {
  /** A base fetch whose probe answers `probe()` and whose paid request answers `paid()`. */
  function scripted(paid: () => Response, probe: () => Response = () => response402()) {
    return vi.fn(async (input: RequestInfo | URL) => (isPaidCall([input]) ? paid() : probe()));
  }

  it('paid request -> 502: GlassnodePaymentError with status, one payment, not retried', async () => {
    const baseFetch = scripted(
      () =>
        new Response(JSON.stringify({ message: 'upstream timed out' }), {
          status: 502,
          statusText: 'Bad Gateway',
        })
    );
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());

    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err).not.toBeInstanceOf(GlassnodeApiError);
    const e = err as GlassnodePaymentError;
    expect(e.paymentMayHaveSettled).toBe(true);
    expect(e.timedOut).toBe(false);
    expect(e.status).toBe(502);
    expect(e.message).toMatch(/502/);
    expect(e.message).toMatch(/upstream timed out/);
    expect(e.message).toMatch(/may have settled/);
    // The HTTP failure is kept on .cause as the GlassnodeApiError the client would have raised.
    expect(e.cause).toBeInstanceOf(GlassnodeApiError);
    const cause = e.cause as GlassnodeApiError;
    expect(cause.status).toBe(502);
    expect(cause.statusText).toBe('Bad Gateway');
    expect(cause.detail).toBe('upstream timed out');
    expect(e.message).not.toContain('ab'.repeat(65));
    // Exactly one payment signed and one paid request sent; the call was not retried.
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls.filter(isPaidCall)).toHaveLength(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('paid request -> 429 with Retry-After: not retried', async () => {
    const baseFetch = scripted(
      () =>
        new Response('', {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Retry-After': '0' },
        })
    );
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(
      paidApi(paidFetch, { maxRetries: 2 }).getMetricList()
    )) as GlassnodePaymentError;

    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.paymentMayHaveSettled).toBe(true);
    expect(err.status).toBe(429);
    expect((err.cause as GlassnodeApiError).status).toBe(429);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls.filter(isPaidCall)).toHaveLength(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('paid request -> 400: GlassnodePaymentError (a signed payment was sent), not retried', async () => {
    const baseFetch = scripted(
      () =>
        new Response(JSON.stringify({ message: 'Resolution 1h is not allowed' }), {
          status: 400,
          statusText: 'Bad Request',
        })
    );
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(
      paidApi(paidFetch, { maxRetries: 2 }).getMetricList()
    )) as GlassnodePaymentError;

    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.paymentMayHaveSettled).toBe(true);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/Resolution 1h is not allowed/);
    expect((err.cause as GlassnodeApiError).detail).toBe('Resolution 1h is not allowed');
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('redacts api_key values echoed in the paid error body', async () => {
    const baseFetch = scripted(
      () =>
        new Response('proxy error for /v1?api_key=SECRET-KEY', {
          status: 500,
          statusText: 'Internal Server Error',
        })
    );
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(
      paidApi(paidFetch, { maxRetries: 2 }).getMetricList()
    )) as GlassnodePaymentError;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.status).toBe(500);
    expect(err.message).not.toContain('SECRET-KEY');
    expect((err.cause as GlassnodeApiError).message).not.toContain('SECRET-KEY');
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('the wrapped fetch itself rejects on an HTTP error after payment (used without GlassnodeAPI)', async () => {
    const baseFetch = scripted(() => new Response('', { status: 503 }));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const err = (await caught(
      paidFetch('https://x402.glassnode.com/v1/metadata/metrics')
    )) as GlassnodePaymentError;
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err.status).toBe(503);
    expect(err.paymentMayHaveSettled).toBe(true);
  });

  it('unpaid probe -> 503 then 402 -> paid 200: probe retried, one payment, success', async () => {
    const events: string[] = [];
    let probes = 0;
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (isPaidCall([input])) {
        events.push('paid');
        return new Response(JSON.stringify(['/market/price_usd_close']), { status: 200 });
      }
      events.push('probe');
      probes++;
      return probes === 1
        ? new Response('', { status: 503, statusText: 'Service Unavailable' })
        : response402();
    });
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => {
      events.push('sign');
      return FAKE_SIGNATURE;
    });
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const result = await paidApi(paidFetch, { maxRetries: 2 }).getMetricList();

    expect(result).toEqual(['/market/price_usd_close']);
    expect(events).toEqual(['probe', 'probe', 'sign', 'paid']);
    expect(signTypedData).toHaveBeenCalledTimes(1);
  });

  it('unpaid probe -> 503 exhausting retries stays a GlassnodeApiError(503); nothing signed', async () => {
    const baseFetch = vi.fn(async () => new Response('', { status: 503 }));
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodeApiError);
    expect(err).not.toBeInstanceOf(GlassnodePaymentError);
    expect((err as GlassnodeApiError).status).toBe(503);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it('paid request -> 200: success unchanged, one payment', async () => {
    const baseFetch = scripted(
      () => new Response(JSON.stringify(['/market/price_usd_close']), { status: 200 })
    );
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const result = await paidApi(paidFetch, { maxRetries: 2 }).getMetricList();
    expect(result).toEqual(['/market/price_usd_close']);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('paid request -> 402 (payment refused) stays a GlassnodeApiError(402), one payment, not retried', async () => {
    const baseFetch = vi.fn(async () => response402());
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const err = await caught(paidApi(paidFetch, { maxRetries: 2 }).getMetricList());
    expect(err).toBeInstanceOf(GlassnodeApiError);
    expect(err).not.toBeInstanceOf(GlassnodePaymentError);
    expect((err as GlassnodeApiError).status).toBe(402);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch.mock.calls.filter(isPaidCall)).toHaveLength(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });
});

describe('createX402Fetch — per-call signal', () => {
  /** A base fetch whose paid (or unpaid) request hangs until its Request signal aborts. */
  function hangOn(paid: boolean) {
    return vi.fn((input: RequestInfo | URL) => {
      if (isPaidCall([input]) !== paid) return Promise.resolve(response402());
      const signal = (input as Request).signal;
      return new Promise<Response>((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
  }

  it('the wrapped fetch receives the per-call signal in init', async () => {
    const baseFetch = vi.fn(async () => new Response('[]', { status: 200 }));
    const paidFetch = await createX402Fetch({
      account: fakeAccount(),
      fetch: baseFetch as typeof fetch,
    });
    const spy = vi.fn(paidFetch);
    const controller = new AbortController();
    await paidApi(spy as typeof fetch).getMetricList({ signal: controller.signal });
    expect(spy.mock.calls[0][1]).toEqual({ signal: controller.signal });
    // ...and @x402/fetch builds its Request from that init, so the base fetch sees it too.
    controller.abort();
    expect((baseFetch.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Request);
    expect(((baseFetch.mock.calls[0] as unknown[])[0] as Request).signal.aborted).toBe(true);
  });

  it('abort on the unpaid probe -> GlassnodeAbortError, nothing signed, not retried', async () => {
    const baseFetch = hangOn(false);
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const controller = new AbortController();
    const pending = caught(
      paidApi(paidFetch, { maxRetries: 2 }).getMetricList({ signal: controller.signal })
    );
    await vi.waitFor(() => expect(baseFetch).toHaveBeenCalledTimes(1));
    controller.abort();
    const err = await pending;
    expect(err).toBeInstanceOf(GlassnodeAbortError);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('abort after the payment was sent -> GlassnodePaymentError (may have settled), one payment, not retried', async () => {
    const baseFetch = hangOn(true);
    const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
    const paidFetch = await createX402Fetch({
      account: fakeAccount(signTypedData),
      fetch: baseFetch as typeof fetch,
    });
    const controller = new AbortController();
    const pending = caught(
      paidApi(paidFetch, { maxRetries: 2, timeout: 60_000 }).getMetricList({
        signal: controller.signal,
      })
    );
    await vi.waitFor(() => expect(baseFetch.mock.calls.filter(isPaidCall)).toHaveLength(1));
    const reason = new Error('user cancelled');
    controller.abort(reason);
    const err = await pending;

    // The money-safety signal wins over the abort classification.
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    expect(err).not.toBeInstanceOf(GlassnodeAbortError);
    const e = err as GlassnodePaymentError;
    expect(e.paymentMayHaveSettled).toBe(true);
    expect(e.timedOut).toBe(false);
    expect(e.cause).toBe(reason);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });
});
