import { describe, it, expect, vi } from 'vitest';

// Simulate the optional peer dep being absent: importing it throws.
vi.mock('@x402/evm', () => {
  throw new Error('Cannot find package @x402/evm');
});

describe('createX402Fetch without optional deps', () => {
  it('throws a clear install error', async () => {
    const { createX402Fetch } = await import('../src/x402');
    const account = {
      address: '0x0000000000000000000000000000000000000001' as const,
      signTypedData: async () => '0x' as const,
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createX402Fetch({ account: account as any })
    ).rejects.toThrow(/optional peer dependencies/);
  });
});
