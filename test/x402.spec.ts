import { describe, it, expect } from 'vitest';
import { usdcDecimalToAtomic, createMaxAmountPolicy, createX402Fetch } from '../src/x402';

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
});

describe('createMaxAmountPolicy', () => {
  it('keeps only requirements at or below the cap', () => {
    const policy = createMaxAmountPolicy(60000n);
    const reqs = [{ amount: '50000' }, { amount: '60000' }, { amount: '70000' }];
    expect(policy(2, reqs)).toEqual([{ amount: '50000' }, { amount: '60000' }]);
  });
});

describe('createX402Fetch', () => {
  it('returns a callable fetch using the real x402 client', async () => {
    const account = {
      address: '0x0000000000000000000000000000000000000001' as const,
      signTypedData: async () => '0x' as const,
    };
    const wrapped = await createX402Fetch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account: account as any,
      maxPaymentPerCall: '0.06',
    });
    expect(typeof wrapped).toBe('function');
  });
});
