import { z } from 'zod';

/**
 * Logger function type for API call logging
 */
export type Logger = (message: string, ...args: unknown[]) => void;

/**
 * Fetch function type matching the standard fetch API
 */
export type FetchFn = typeof fetch;

/** Default free Glassnode API base URL. */
export const DEFAULT_API_URL = 'https://api.glassnode.com';
/** x402 (paid) Glassnode API base URL — Base mainnet. */
export const X402_API_URL = 'https://x402.glassnode.com';
// A testnet/staging x402 endpoint is not hardcoded here — pass its URL via the `apiUrl` config option.

/**
 * Largest timer delay (ms) every runtime supports: 2^31 - 1 (~24.8 days). Larger delays overflow
 * `setTimeout` (Node fires them after 1 ms) and make `AbortSignal.timeout()` throw a RangeError.
 */
const MAX_TIMER_MS = 2_147_483_647;

/** A positive integer delay in ms that fits in a timer. */
const timerMs = () =>
  z
    .number()
    .int()
    .positive()
    .max(MAX_TIMER_MS, `must be at most ${MAX_TIMER_MS} ms (the largest timer delay)`);

/**
 * Zod schema for Glassnode API configuration
 */
export const GlassnodeConfigSchema = z
  .object({
    /** API key for authentication. Required unless `x402` is enabled. */
    apiKey: z.string().min(1, 'API key is required').optional(),

    /**
     * Where the API key is sent: `'query'` (default) as the `api_key` query parameter, or
     * `'header'` as the `X-Api-Key` request header, which keeps the key out of URLs (and so out
     * of access logs, proxies, tracing and transport errors). `'header'` is for server-side use:
     * the Glassnode API's CORS preflight does not allow `X-Api-Key`, so browsers block it.
     */
    apiKeyLocation: z.enum(['query', 'header']).default('query'),

    /** Base URL for the Glassnode API. An explicit value always wins over the `x402` preset. */
    apiUrl: z.string().url().optional(),

    /** Route requests through the x402 paid endpoint (`https://x402.glassnode.com`). */
    x402: z.boolean().default(false),

    /** Optional logger for API call debugging. */
    logger: z.function().optional(),

    /** Optional custom fetch function (e.g. an x402-wrapped fetch, or for testing). */
    fetch: z.function().optional(),

    /** Maximum number of retries for retryable errors (429 and 5xx). */
    maxRetries: z.number().int().nonnegative().default(0),

    /** Base delay in milliseconds between retries (doubles each attempt, then full jitter). */
    retryDelay: timerMs().default(1000),

    /** Upper bound (ms) for a single retry wait, after exponential growth. */
    maxRetryDelay: timerMs().default(30000),

    /**
     * Per-request timeout in milliseconds. When set, each attempt is aborted via
     * `AbortSignal.timeout()` after this many ms (a fresh signal per retry). Unset = no timeout.
     */
    timeout: timerMs().optional(),
  })
  .refine((c) => c.x402 || (c.apiKey !== undefined && c.apiKey.length > 0), {
    message: 'apiKey is required unless x402 is enabled',
    path: ['apiKey'],
  })
  .refine((c) => !c.x402 || c.fetch !== undefined, {
    message:
      'fetch is required when x402 is enabled — pass an x402-capable fetch (see glassnode-api/x402)',
    path: ['fetch'],
  });

/**
 * Configuration for the Glassnode API client
 */
export type GlassnodeConfig = z.input<typeof GlassnodeConfigSchema>;
