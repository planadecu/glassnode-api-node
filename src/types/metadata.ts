/**
 * Metadata response types
 */
import { z } from 'zod';

/**
 * External identifier sources schema
 */
export const ExternalIdSourceSchema = z.enum(['ccdata', 'coinmarketcap', 'coingecko']);

/**
 * External identifier sources type
 */
export type ExternalIdSource = z.infer<typeof ExternalIdSourceSchema>;

/**
 * External identifiers for an asset schema
 */
export const ExternalIdsSchema = z.record(ExternalIdSourceSchema, z.string().optional());

/**
 * External identifiers for an asset type
 */
export type ExternalIds = z.infer<typeof ExternalIdsSchema>;

/**
 * Blockchain information for an asset schema
 */
export const AssetBlockchainSchema = z.object({
  /**
   * Blockchain name
   */
  blockchain: z.string(),

  /**
   * Token address on the blockchain
   */
  address: z.string(),

  /**
   * Number of decimal places
   */
  decimals: z.number().int().nonnegative(),

  /**
   * Whether on-chain metrics are supported
   */
  on_chain_support: z.boolean(),
});

/**
 * Blockchain information for an asset type
 */
export type AssetBlockchain = z.infer<typeof AssetBlockchainSchema>;

/**
 * Asset metadata schema
 */
export const AssetMetadataSchema = z.object({
  /**
   * Asset identifier
   */
  id: z.string(),

  /**
   * Asset symbol (e.g., "BTC", "ETH")
   */
  symbol: z.string(),

  /**
   * Asset name (e.g., "Bitcoin", "Ethereum")
   */
  name: z.string(),

  /**
   * Type of asset (e.g., "coin", "token")
   */
  asset_type: z.string(),

  /**
   * External identifiers for this asset
   */
  external_ids: ExternalIdsSchema,

  /**
   * Blockchain information for this asset
   */
  blockchains: z.array(AssetBlockchainSchema),
});

/**
 * Asset metadata type
 */
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

/**
 * Asset metadata response schema
 */
export const AssetMetadataResponseSchema = z.array(AssetMetadataSchema);

/**
 * Asset metadata response type
 */
export type AssetMetadataResponse = z.infer<typeof AssetMetadataResponseSchema>;

/**
 * Metric tier schema
 */
export const MetricTierSchema = z.enum(['free', 'tier1', 'tier2', 'tier3', 'tier4', 'tier5']);

/**
 * Metric tier type
 */
export type MetricTier = z.infer<typeof MetricTierSchema>;

/**
 * Metric data type schema
 */
export const MetricDataTypeSchema = z.enum(['average', 'sum', 'count', 'percentage', 'ratio']);

/**
 * Metric data type
 */
export type MetricDataType = z.infer<typeof MetricDataTypeSchema>;

/**
 * Metric metadata schema
 */
export const MetricMetadataSchema = z.object({
  /**
   * Metric name
   */
  path: z.string(),

  /**
   * Access tier required for this metric
   */
  tier: z.number().int().nonnegative(),

  /**
   * The last date that the metadata was updated
   */
  modified: z
    .number()
    .optional()
    .transform((val) => (val ? new Date(val * 1000) : undefined)),

  /**
   * Next parameter for the metric
   */
  next_param: z.string().optional(),

  /**
   * Available assets for this metric
   */
  refs: z.object({
    docs: z.string().optional(),
    studio: z.string().optional(),
  }),

  /**
   * Queried parameters for the metric
   */
  queried: z.record(z.string(), z.any()),

  /**
   * List of all allowed parameters and their values for the metric
   */
  parameters: z.record(z.string(), z.array(z.string())),
});

/**
 * Metric metadata type
 */
export type MetricMetadata = z.infer<typeof MetricMetadataSchema>;

/**
 * Metric metadata response schema
 */
export const MetricMetadataResponseSchema = MetricMetadataSchema;

/**
 * Metric list response schema
 */
export const MetricListResponseSchema = z.array(z.string().startsWith('/'));

/**
 * Metric metadata response type
 */
export type MetricMetadataResponse = z.infer<typeof MetricMetadataResponseSchema>;

/**
 * Metric list response type
 */
export type MetricListResponse = z.infer<typeof MetricListResponseSchema>;
