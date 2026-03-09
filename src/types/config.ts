import { z } from 'zod';

/**
 * Logger function type for API call logging
 */
export type Logger = (message: string, ...args: unknown[]) => void;

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
});

/**
 * Configuration for the Glassnode API client
 */
export type GlassnodeConfig = z.input<typeof GlassnodeConfigSchema>;
