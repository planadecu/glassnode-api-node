import { z } from 'zod';

/**
 * Logger function type for API call logging
 */
export type Logger = (message: string, ...args: unknown[]) => void;

/**
 * Fetch function type matching the standard fetch API
 */
export type FetchFn = typeof fetch;

/**
 * Zod schema for Glassnode API configuration
 */
export const GlassnodeConfigSchema = z.object({
  /**
   * API key for authentication
   */
  apiKey: z.string().min(1, 'API key is required'),

  /**
   * Base URL for the Glassnode API
   * @default "https://api.glassnode.com"
   */
  apiUrl: z.string().url().default('https://api.glassnode.com'),

  /**
   * Optional logger for API call debugging
   * @example { logger: console.log }
   */
  logger: z.function().optional(),

  /**
   * Optional custom fetch function (e.g. for custom headers, retries, or testing)
   * @default globalThis.fetch
   */
  fetch: z.function().optional(),
});

/**
 * Configuration for the Glassnode API client
 */
export type GlassnodeConfig = z.input<typeof GlassnodeConfigSchema>;
