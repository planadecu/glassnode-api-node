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
 * Metric descriptors schema (human-readable names, tags, descriptions)
 */
export const MetricDescriptorsSchema = z.object({
  name: z.string().optional(),
  short_name: z.string().optional(),
  group: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.record(z.string(), z.string()).optional(),
  data_sharing_group: z.string().optional(),
});

/**
 * Metric descriptors type
 */
export type MetricDescriptors = z.infer<typeof MetricDescriptorsSchema>;

/**
 * Metric metadata schema
 */
export const MetricMetadataSchema = z.object({
  /**
   * Metric path
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
   * Whether this is a point-in-time metric
   */
  is_pit: z.boolean().optional(),

  /**
   * Whether bulk queries are supported for this metric
   */
  bulk_supported: z.boolean().optional(),

  /**
   * Available time range for this metric (Unix timestamps)
   */
  timerange: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .optional(),

  /**
   * Reference links for this metric
   */
  refs: z.object({
    docs: z.string().optional(),
    studio: z.string().optional(),
    metric_variant: z
      .object({
        base: z.string().optional(),
        bulk: z.string().optional(),
        pit: z.string().optional(),
      })
      .optional(),
  }),

  /**
   * Queried parameters for the metric
   */
  queried: z.record(z.string(), z.any()),

  /**
   * List of all allowed parameters and their values for the metric
   */
  parameters: z.record(z.string(), z.array(z.string())),

  /**
   * Human-readable descriptors (name, tags, description)
   */
  descriptors: MetricDescriptorsSchema.optional(),
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

/**
 * Bulk entry schema (one asset's value in a bulk response)
 */
export const BulkEntrySchema = z.object({
  a: z.string(),
  v: z.number(),
  network: z.string().optional(),
});

/**
 * Bulk entry type
 */
export type BulkEntry = z.infer<typeof BulkEntrySchema>;

/**
 * Bulk response schema (array of timestamped bulk entries)
 */
export const BulkResponseSchema = z.array(
  z.object({
    t: z.number(),
    bulk: z.array(BulkEntrySchema),
  })
);

/**
 * Bulk response type
 */
export type BulkResponse = z.infer<typeof BulkResponseSchema>;
