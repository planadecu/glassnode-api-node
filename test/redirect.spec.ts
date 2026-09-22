/**
 * Cross-origin redirects must never carry the API key header or a signed x402 payment.
 *
 * Node's `fetch` (undici), with the default `redirect: 'follow'`, resends custom request headers
 * (`X-Api-Key`, `PAYMENT-SIGNATURE`) to whatever origin a 3xx `Location` names — only
 * `Authorization`/`Cookie`-style headers are dropped on a cross-origin hop. These tests run two
 * real local HTTP servers (A redirects to B, on another host and port) and the real global
 * `fetch`, so they exercise the actual redirect handling rather than a mock of it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GlassnodeAPI } from '../src/glassnode-api';
import { createX402Fetch } from '../src/x402';
import { GlassnodeApiError, GlassnodePaymentError } from '../src/errors';

const KEY = 'redirect-test-key-0123456789abcdef';
const FAKE_SIGNATURE = `0x${'ab'.repeat(65)}` as const;

interface Hit {
  url: string;
  headers: http.IncomingHttpHeaders;
}

function listen(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function paymentRequiredHeader(): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: 'http://127.0.0.1/v1/metadata/metrics' },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:84532',
          amount: '50000',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          payTo: '0x0000000000000000000000000000000000000002',
          maxTimeoutSeconds: 60,
          extra: { name: 'USDC', version: '2' },
        },
      ],
    })
  ).toString('base64');
}

// Server A (the configured apiUrl) and B (the redirect target, a different origin).
let serverA: http.Server;
let serverB: http.Server;
let aUrl: string;
let bOrigin: string;
const hitsA: Hit[] = [];
const hitsB: Hit[] = [];
// What A does: `redirect` always redirects; `x402` answers the unpaid request with a 402 and
// redirects the paid one; `x402-probe` redirects the unpaid request itself.
let modeA: 'redirect' | 'x402' | 'x402-probe' = 'redirect';
let redirectStatus = 307;

beforeAll(async () => {
  serverB = await listen((req, res) => {
    hitsB.push({ url: req.url ?? '', headers: req.headers });
    if (modeA === 'x402-probe' && !req.headers['payment-signature']) {
      res.writeHead(402, { 'PAYMENT-REQUIRED': paymentRequiredHeader() });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
  bOrigin = `http://localhost:${(serverB.address() as AddressInfo).port}`;
  serverA = await listen((req, res) => {
    hitsA.push({ url: req.url ?? '', headers: req.headers });
    const paid = req.headers['payment-signature'] !== undefined;
    if (modeA === 'x402' && !paid) {
      res.writeHead(402, { 'PAYMENT-REQUIRED': paymentRequiredHeader() });
      res.end('{}');
      return;
    }
    // Keep the path but not the query: the redirect target is chosen by the server alone.
    res.writeHead(redirectStatus, { Location: `${bOrigin}${(req.url ?? '').split('?')[0]}` });
    res.end();
  });
  aUrl = `http://127.0.0.1:${(serverA.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all(
    [serverA, serverB].map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
  );
});

beforeEach(() => {
  hitsA.length = 0;
  hitsB.length = 0;
  modeA = 'redirect';
  redirectStatus = 307;
});

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected promise to reject');
}

function fakeAccount() {
  const signTypedData = vi.fn(async (): Promise<`0x${string}`> => FAKE_SIGNATURE);
  return {
    account: { address: '0x0000000000000000000000000000000000000001' as const, signTypedData },
    signTypedData,
  };
}

describe("apiKeyLocation: 'header' — no cross-origin redirect with the key", () => {
  it.each([301, 302, 303, 307, 308])(
    'a %i is not followed: the redirect target never receives X-Api-Key',
    async (status) => {
      redirectStatus = status;
      const api = new GlassnodeAPI({ apiKey: KEY, apiUrl: aUrl, apiKeyLocation: 'header' });
      const err = await caught(api.getMetricList());

      expect(hitsA).toHaveLength(1);
      expect(hitsA[0].headers['x-api-key']).toBe(KEY);
      expect(hitsB).toHaveLength(0);
      expect(err).toBeInstanceOf(GlassnodeApiError);
      expect((err as GlassnodeApiError).status).toBe(status);
      expect((err as GlassnodeApiError).isRetryable).toBe(false);
      expect((err as Error).message).toMatch(/redirect not followed/i);
      expect((err as Error).message).not.toContain(KEY);
      expect(JSON.stringify(err)).not.toContain(KEY);
      expect((err as Error).message).not.toContain(bOrigin);
    }
  );

  it('a 3xx is not retried, even with maxRetries', async () => {
    const api = new GlassnodeAPI({
      apiKey: KEY,
      apiUrl: aUrl,
      apiKeyLocation: 'header',
      maxRetries: 2,
      retryDelay: 1,
    });
    const err = await caught(api.getMetricList());
    expect(err).toBeInstanceOf(GlassnodeApiError);
    expect(hitsA).toHaveLength(1);
    expect(hitsB).toHaveLength(0);
  });

  it("passes redirect: 'manual' to a custom fetch together with the key header", async () => {
    const fetchFn = vi.fn(async () => Response.json([]));
    const api = new GlassnodeAPI({
      apiKey: KEY,
      apiUrl: aUrl,
      apiKeyLocation: 'header',
      fetch: fetchFn,
    });
    await api.getMetricList();
    expect((fetchFn.mock.calls[0] as unknown[])[1]).toEqual({
      headers: { 'X-Api-Key': KEY },
      redirect: 'manual',
    });
  });
});

describe("apiKeyLocation: 'query' (default) — unchanged", () => {
  it('still follows redirects; the target gets only what the server put in Location', async () => {
    const api = new GlassnodeAPI({ apiKey: KEY, apiUrl: aUrl });
    await api.getMetricList();

    expect(hitsA[0].url).toContain(`api_key=${KEY}`);
    expect(hitsB).toHaveLength(1);
    // fetch adds nothing of its own: no key in the redirected URL (A dropped the query) or headers.
    expect(hitsB[0].url).not.toContain(KEY);
    expect(JSON.stringify(hitsB[0].headers)).not.toContain(KEY);
  });

  it('a custom fetch is still called with the URL alone', async () => {
    const fetchFn = vi.fn(async () => Response.json([]));
    await new GlassnodeAPI({ apiKey: KEY, apiUrl: aUrl, fetch: fetchFn }).getMetricList();
    expect(fetchFn.mock.calls[0]).toHaveLength(1);
  });
});

describe('x402 — a signed payment is never sent to a redirect target', () => {
  it('a 3xx to the paid request is not followed: one payment, the target never sees it', async () => {
    modeA = 'x402';
    const { account, signTypedData } = fakeAccount();
    const api = new GlassnodeAPI({
      x402: true,
      apiUrl: aUrl,
      fetch: await createX402Fetch({ account }),
      maxRetries: 2,
      retryDelay: 1,
    });
    const err = await caught(api.getMetricList());

    expect(hitsB).toHaveLength(0);
    expect(hitsA).toHaveLength(2);
    const signature = hitsA[1].headers['payment-signature'] as string;
    expect(signature).toBeTruthy();
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(GlassnodePaymentError);
    const e = err as GlassnodePaymentError;
    expect(e.status).toBe(307);
    expect(e.paymentMayHaveSettled).toBe(true);
    expect(e.message).not.toContain(signature);
    expect(e.message).not.toContain(FAKE_SIGNATURE);
    expect(String((e.cause as Error).message)).not.toContain(signature);
  });

  it('a 3xx to the unpaid request is not followed: nothing signed, target never hit', async () => {
    modeA = 'x402-probe';
    const { account, signTypedData } = fakeAccount();
    const api = new GlassnodeAPI({
      x402: true,
      apiUrl: aUrl,
      fetch: await createX402Fetch({ account }),
    });
    const err = await caught(api.getMetricList());

    // Followed, B's own 402 would be paid (to B's payTo) and the payment sent to B.
    expect(hitsB).toHaveLength(0);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(GlassnodeApiError);
    expect((err as GlassnodeApiError).status).toBe(307);
  });

  it("keeps a caller's redirect: 'error' (also never follows)", async () => {
    modeA = 'x402-probe';
    const { account, signTypedData } = fakeAccount();
    const paidFetch = await createX402Fetch({ account });
    await caught(paidFetch(`${aUrl}/v1/metadata/metrics`, { redirect: 'error' }));
    expect(hitsB).toHaveLength(0);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("overrides a caller's redirect: 'follow'", async () => {
    modeA = 'x402';
    const { account } = fakeAccount();
    const paidFetch = await createX402Fetch({ account });
    await caught(paidFetch(`${aUrl}/v1/metadata/metrics`, { redirect: 'follow' }));
    expect(hitsB).toHaveLength(0);
  });
});
