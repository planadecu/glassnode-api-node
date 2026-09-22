import { describe, it, expect } from 'vitest';
import { GlassnodeConfigSchema, DEFAULT_API_URL, X402_API_URL } from '../src/types/config';
import { GlassnodeAPI } from '../src/glassnode-api';
import { GlassnodeConfigError } from '../src/errors';

describe('GlassnodeConfigSchema', () => {
  it('exposes the URL constants', () => {
    expect(DEFAULT_API_URL).toBe('https://api.glassnode.com');
    expect(X402_API_URL).toBe('https://x402.glassnode.com');
  });

  it('requires apiKey when x402 is not enabled', () => {
    expect(() => GlassnodeConfigSchema.parse({})).toThrow(/apiKey/);
    expect(GlassnodeConfigSchema.parse({ apiKey: 'k' }).apiKey).toBe('k');
  });

  it('allows omitting apiKey when x402 is enabled, but then requires fetch', () => {
    const fetchFn = (async () => new Response()) as unknown as typeof fetch;
    expect(() => GlassnodeConfigSchema.parse({ x402: true })).toThrow(/fetch/);
    const parsed = GlassnodeConfigSchema.parse({ x402: true, fetch: fetchFn });
    expect(parsed.x402).toBe(true);
    expect(parsed.apiKey).toBeUndefined();
  });

  it('defaults x402 to false and apiUrl to undefined', () => {
    const parsed = GlassnodeConfigSchema.parse({ apiKey: 'k' });
    expect(parsed.x402).toBe(false);
    expect(parsed.apiUrl).toBeUndefined();
  });

  describe('timer bounds (timeout, retryDelay, maxRetryDelay)', () => {
    // Timers only take a 32-bit signed delay; larger values overflow (Node fires them after 1 ms)
    // and `AbortSignal.timeout()` throws a RangeError above 2^32 - 1.
    const MAX_TIMER_MS = 2_147_483_647;
    const fields = ['timeout', 'retryDelay', 'maxRetryDelay'] as const;

    it.each(fields)('accepts %s at the largest timer delay (2^31 - 1 ms)', (field) => {
      const parsed = GlassnodeConfigSchema.parse({ apiKey: 'k', [field]: MAX_TIMER_MS });
      expect(parsed[field]).toBe(MAX_TIMER_MS);
    });

    it.each(fields)('rejects %s above the largest timer delay', (field) => {
      for (const value of [MAX_TIMER_MS + 1, 5_000_000_000]) {
        const result = GlassnodeConfigSchema.safeParse({ apiKey: 'k', [field]: value });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual([field]);
        expect(result.error?.issues[0].message).toMatch(/2147483647/);
      }
    });

    it.each(fields)(
      'surfaces an oversized %s as a GlassnodeConfigError at construction',
      (field) => {
        let err: unknown;
        try {
          new GlassnodeAPI({ apiKey: 'k', [field]: 5_000_000_000 });
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(GlassnodeConfigError);
        expect((err as Error).message).toContain(field);
        expect((err as Error).message).toContain('2147483647');
      }
    );
  });
});
