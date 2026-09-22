import { describe, it, expect, vi } from 'vitest';
import { GlassnodeConfigError, GlassnodeError } from '../src/errors.js';

// Simulate the optional peer dep being absent: importing it throws.
vi.mock('@x402/evm', () => {
  throw new Error('Cannot find package @x402/evm');
});

describe('createX402Fetch without optional deps', () => {
  it('throws a clear install error as a GlassnodeConfigError', async () => {
    const { createX402Fetch } = await import('../src/x402.js');
    const account = {
      address: '0x0000000000000000000000000000000000000001' as const,
      signTypedData: async () => '0x' as const,
    };
    const err = await createX402Fetch({ account }).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(GlassnodeConfigError);
    expect(err).toBeInstanceOf(GlassnodeError);
    expect((err as Error).message).toMatch(/optional peer dependencies/);
    expect((err as Error).cause).toBeInstanceOf(Error);
  });
});
