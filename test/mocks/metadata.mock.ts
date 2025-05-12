import {
  AssetMetadataResponse,
  MetricMetadataResponse,
  MetricListResponse,
} from '../../src/types/metadata';
import { z } from 'zod';
import { MetricMetadataSchema } from '../../src/types/metadata';

// Input type for metric metadata (before transform)
type MetricMetadataInput = z.input<typeof MetricMetadataSchema>;

// Mock asset metadata response
export const mockAssetMetadataResponse: AssetMetadataResponse = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    asset_type: 'coin',
    external_ids: {
      coingecko: 'bitcoin',
    },
    blockchains: [
      {
        blockchain: 'bitcoin',
        address: '',
        decimals: 8,
        on_chain_support: true,
      },
    ],
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    asset_type: 'coin',
    external_ids: {
      coingecko: 'ethereum',
    },
    blockchains: [
      {
        blockchain: 'ethereum',
        address: '',
        decimals: 18,
        on_chain_support: true,
      },
    ],
  },
];

// Mock raw metric metadata response (before transformation)
export const mockRawMetricMetadataResponse: MetricMetadataInput = {
  path: '/distribution/balance_exchanges',
  tier: 2,
  parameters: {
    c: ['native', 'usd'],
    e: [
      'aggregated',
      'binance',
      'bitfinex',
      'bitget',
      'bithumb',
      'bitmex',
      'bitstamp',
      'bittrex',
      'bybit',
      'coinbase',
      'coincheck',
      'coinex',
      'crypto.com',
      'deribit',
      'ftx',
      'gate.io',
      'gemini',
      'hitbtc',
      'huobi',
      'korbit',
      'kraken',
      'kucoin',
      'luno',
      'okex',
      'poloniex',
      'swissborg',
    ],
    f: ['csv', 'json'],
    i: ['10m', '1h', '24h'],
  },
  queried: {
    a: 'BTC',
    path: '/distribution/balance_exchanges',
  },
  refs: {
    docs: 'https://docs.glassnode.com/basic-api/endpoints/distribution#distribution.balanceexchanges',
    studio: 'https://studio.glassnode.com/charts/distribution.BalanceExchanges',
  },
  modified: 1733829848,
  next_param: undefined,
};

// Transformed metric metadata response
export const mockMetricMetadataResponse: MetricMetadataResponse = MetricMetadataSchema.parse(
  mockRawMetricMetadataResponse
);

// Mock metric list response
export const mockMetricListResponse: MetricListResponse = [
  '/distribution/balance_exchanges',
  '/market/price_usd',
  '/market/volume_usd',
  '/indicators/sopr',
];
