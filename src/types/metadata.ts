/**
 * Metadata response types
 */
import { z } from 'zod';

/**
 * Known external identifier sources schema.
 *
 * Not a closed set: the API may return other sources, which `ExternalIdsSchema` accepts.
 */
export const ExternalIdSourceSchema = z.enum(['ccdata', 'coinmarketcap', 'coingecko']);

/**
 * Known external identifier sources type
 */
export type ExternalIdSource = z.infer<typeof ExternalIdSourceSchema>;

/**
 * External identifiers for an asset schema.
 *
 * Known sources are typed as optional properties; any other source the API adds is
 * accepted and preserved (as a string) instead of failing validation.
 */
export const ExternalIdsSchema = z
  .object({
    ccdata: z.string().optional(),
    coinmarketcap: z.string().optional(),
    coingecko: z.string().optional(),
  } satisfies Record<ExternalIdSource, z.ZodType>)
  .catchall(z.string());

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
 *
 * @deprecated Not used by any schema or client method, and it does not match the API:
 * the `tier` field on metric metadata is a number (e.g. `2`), not one of these strings.
 * Use `MetricMetadata['tier']` (a `number`) to type it instead. This export will be
 * removed in the next major release (1.0).
 */
export const MetricTierSchema = z.enum(['free', 'tier1', 'tier2', 'tier3', 'tier4', 'tier5']);

/**
 * Metric tier type
 *
 * @deprecated Does not match the API: the `tier` field on metric metadata is a number
 * (e.g. `2`), not one of these strings. Use `MetricMetadata['tier']` (a `number`) instead.
 * This export will be removed in the next major release (1.0).
 */
export type MetricTier = z.infer<typeof MetricTierSchema>;

/**
 * Metric data type schema
 *
 * @deprecated Not used by any schema or client method and not validated against any
 * API response. If you need these values, define your own enum. This export will be
 * removed in the next major release (1.0).
 */
export const MetricDataTypeSchema = z.enum(['average', 'sum', 'count', 'percentage', 'ratio']);

/**
 * Metric data type
 *
 * @deprecated Not used by any schema or client method and not validated against any
 * API response. If you need these values, define your own type. This export will be
 * removed in the next major release (1.0).
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
   * Access tier required for this metric, as a non-negative integer (e.g. `2`).
   * Type it as `MetricMetadata['tier']`; the deprecated string-based `MetricTier`
   * does not describe this field.
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
 * Lag percentiles schema (p50/p90/p95/p99 for one resolution).
 *
 * Each percentile is optional: if the API omits one for a resolution, the rest of the
 * stats still parse and the missing percentile is `undefined`.
 */
export const LagPercentilesSchema = z.object({
  p50: z.number().optional(),
  p90: z.number().optional(),
  p95: z.number().optional(),
  p99: z.number().optional(),
});

/**
 * Lag percentiles type
 */
export type LagPercentiles = z.infer<typeof LagPercentilesSchema>;

/**
 * Metric lag entry schema (one measurement window of data-lag stats).
 * `resolution` is keyed by interval (e.g. "10m", "1h", "24h") — kept open
 * as a record so new resolutions don't break validation.
 */
export const MetricLagEntrySchema = z.object({
  /**
   * Measurement unit (e.g. "seconds")
   */
  unit: z.string(),

  /**
   * Time window over which the stats are computed (e.g. "30d")
   */
  window: z.string(),

  /**
   * Lag percentiles keyed by resolution interval
   */
  resolution: z.record(z.string(), LagPercentilesSchema),
});

/**
 * Metric lag entry type
 */
export type MetricLagEntry = z.infer<typeof MetricLagEntrySchema>;

/**
 * Metric stats response schema (data-lag percentiles over the trailing 30d)
 */
export const MetricStatsResponseSchema = z.object({
  lag: z.array(MetricLagEntrySchema),
});

/**
 * Metric stats response type
 */
export type MetricStatsResponse = z.infer<typeof MetricStatsResponseSchema>;

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
