import { describe, it, expect } from 'vitest';
import {
  GlassnodeConfigSchema,
  DEFAULT_API_URL,
  X402_API_URL,
  X402_TESTNET_API_URL,
} from '../src/types/config';

describe('GlassnodeConfigSchema', () => {
  it('exposes the URL constants', () => {
    expect(DEFAULT_API_URL).toBe('https://api.glassnode.com');
    expect(X402_API_URL).toBe('https://x402.glassnode.com');
    expect(X402_TESTNET_API_URL).toBe('https://x402.glassnode.tech');
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
});
