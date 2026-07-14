import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { GlassnodeAPI } from '../src/glassnode-api';
import { X402_TESTNET_API_URL } from '../src/types/config';
import { createX402Fetch } from '../src/x402';

const KEY = process.env.X402_TESTNET_PRIVATE_KEY;

// Requires a Base-Sepolia wallet funded with test USDC. Skipped unless the key is provided.
describe.skipIf(!KEY)('x402 testnet integration', () => {
  it('pays for a metric on the testnet endpoint and returns validated data', async () => {
    const account = privateKeyToAccount(KEY as `0x${string}`);
    const api = new GlassnodeAPI({
      x402: true,
      apiUrl: X402_TESTNET_API_URL,
      fetch: await createX402Fetch({ account, maxPaymentPerCall: '0.06' }),
    });

    const data = await api.callMetric<{ t: number; v: number }[]>('/market/mvrv', {
      a: 'BTC',
      i: '24h',
    });

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(typeof data[0].t).toBe('number');
    expect(typeof data[0].v).toBe('number');
  }, 60_000);
});
