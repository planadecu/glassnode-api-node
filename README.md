# Glassnode API — TypeScript Client

[![npm version](https://img.shields.io/npm/v/glassnode-api.svg)](https://www.npmjs.com/package/glassnode-api)
[![npm downloads](https://img.shields.io/npm/dm/glassnode-api.svg)](https://www.npmjs.com/package/glassnode-api)
[![minzipped size](https://img.shields.io/bundlejs/size/glassnode-api)](https://bundlejs.com/?q=glassnode-api)
[![types included](https://img.shields.io/npm/types/glassnode-api.svg)](https://www.npmjs.com/package/glassnode-api)
[![CI](https://github.com/planadecu/glassnode-api-node/actions/workflows/ci.yml/badge.svg)](https://github.com/planadecu/glassnode-api-node/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/glassnode-api.svg)](./LICENSE)

A fully-typed **TypeScript client for the [Glassnode API](https://docs.glassnode.com/)** — on-chain and
market data for Bitcoin, Ethereum, and hundreds of crypto assets. Responses are runtime-validated with
[Zod](https://zod.dev/), and it runs in both **Node.js** and the **browser**.

```typescript
import { GlassnodeAPI } from 'glassnode-api';

const api = new GlassnodeAPI({ apiKey: 'YOUR_API_KEY' });
const btcPrice = await api.callMetric('/market/price_usd_close', { a: 'BTC' });
```

## Features

- 🧩 **Fully typed** — complete TypeScript definitions for every request and response
- ✅ **Runtime-validated** — responses parsed and validated with Zod, so bad data fails fast
- 🌐 **Universal** — works in Node.js and the browser (UMD + ESM bundles, tree-shakeable)
- 🔁 **Built-in retries** — automatic retry with exponential backoff for `429` and `5xx`
- 📦 **Bulk endpoints** — fetch every asset in a single call with `callBulkMetric()`
- 🎯 **Typed errors** — `GlassnodeApiError` with `status`, `statusText`, and `isRetryable`
- 🪶 **Lightweight** — a single runtime dependency (`zod`)
- 🔌 **Pluggable** — inject a custom `fetch` implementation and a `logger`

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Methods](#methods)
- [Error Handling](#error-handling)
- [Retries](#retries)
- [Bulk Metrics](#bulk-metrics)
- [Paid calls with x402](#paid-calls-with-x402)
- [Browser](#browser)
- [Examples](#examples)
- [Development](#development)
- [License](#license)

## Installation

```bash
# pnpm
pnpm add glassnode-api

# npm
npm install glassnode-api

# yarn
yarn add glassnode-api
```

You'll need a Glassnode API key — create one from your
[Glassnode account](https://studio.glassnode.com/).

## Quick Start

```typescript
import { GlassnodeAPI } from 'glassnode-api';

const api = new GlassnodeAPI({
  apiKey: 'YOUR_API_KEY',
  // apiUrl: 'https://api.glassnode.com', // optional override
});

// Fetch metadata for all supported assets
const assets = await api.getAssetMetadata();

// Fetch metadata for a specific metric
const metric = await api.getMetricMetadata('/distribution/balance_exchanges', { a: 'BTC' });

// List every available metric path
const metrics = await api.getMetricList();

// Call any metric endpoint directly
const data = await api.callMetric('/market/price_usd_close', {
  a: 'BTC',
  s: '1609459200', // since (unix timestamp)
});
```

## Configuration

`new GlassnodeAPI(config)`

| Option       | Type                                            | Default                     | Description                                                                              |
| ------------ | ----------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `apiKey`     | `string`                                        | — (required unless `x402`)  | Your Glassnode API key                                                                   |
| `apiUrl`     | `string`                                        | `https://api.glassnode.com` | Base URL for the API                                                                     |
| `x402`       | `boolean`                                       | `false`                     | Route through the paid x402 endpoint (see [Paid calls with x402](#paid-calls-with-x402)) |
| `logger`     | `(message: string, ...args: unknown[]) => void` | —                           | Callback for debug logging (e.g. `console.log`)                                          |
| `fetch`      | `typeof fetch`                                  | `globalThis.fetch`          | Custom fetch implementation (or an x402-wrapped fetch)                                   |
| `maxRetries` | `number`                                        | `0`                         | Retries for retryable errors (`429`, `5xx`)                                              |
| `retryDelay` | `number`                                        | `1000`                      | Base delay in ms between retries (doubles each attempt)                                  |

The config is validated at construction time with Zod — an invalid config (e.g. an empty `apiKey`) throws immediately. When `x402` is enabled, `apiKey` is optional but a payment-capable `fetch` is required. Failed requests throw a `GlassnodeApiError` whose message includes the server's error detail (also on `.detail`).

## Methods

| Method                             | Returns                           | Description                                       |
| ---------------------------------- | --------------------------------- | ------------------------------------------------- |
| `getAssetMetadata()`               | `Promise<AssetMetadataResponse>`  | Metadata for all supported assets                 |
| `getMetricMetadata(path, params?)` | `Promise<MetricMetadataResponse>` | Metadata for a specific metric                    |
| `getMetricList()`                  | `Promise<MetricListResponse>`     | List of all available metric paths                |
| `callMetric<T>(path, params?)`     | `Promise<T>`                      | Call any metric endpoint directly                 |
| `callBulkMetric(path, params?)`    | `Promise<BulkResponse>`           | Call a bulk endpoint (all assets in one response) |

All response types are exported and fully typed.

## Error Handling

Failed requests throw a `GlassnodeApiError` with the HTTP status, the status text, and a human-readable
message. Network failures are re-thrown as an `Error` with the original error preserved on `.cause`.

```typescript
import { GlassnodeAPI, GlassnodeApiError } from 'glassnode-api';

try {
  await api.callMetric('/market/price_usd_close', { a: 'BTC' });
} catch (err) {
  if (err instanceof GlassnodeApiError) {
    console.error(err.status); // e.g. 401
    console.error(err.statusText); // e.g. "Unauthorized"
    console.error(err.isRetryable); // true for 429 / 5xx
    console.error(err.message); // "API request failed (401): Invalid or missing API key"
  }
}
```

## Retries

Enable automatic retries with exponential backoff for rate limits (`429`) and server errors (`5xx`):

```typescript
const api = new GlassnodeAPI({
  apiKey: 'YOUR_API_KEY',
  maxRetries: 3, // retry up to 3 times
  retryDelay: 1000, // 1s, then 2s, then 4s
});
```

Non-retryable errors (e.g. `401`, `404`) fail immediately without retrying.

## Bulk Metrics

`callBulkMetric()` returns a value for every asset at each timestamp in a single request — ideal for
snapshots across the whole market:

```typescript
const marketcaps = await api.callBulkMetric('/market/marketcap_usd');
// [{ t: 1609459200, bulk: [{ a: 'BTC', v: 600000000000 }, { a: 'ETH', v: 100000000000 }] }]
```

## Paid calls with x402

Glassnode also serves a **paid, per-call API over the [x402 protocol](https://x402.org)** at
`https://x402.glassnode.com` — no API key required, you pay per request in USDC on Base
($0.01/metadata call, $0.05/metric call). This is **Node-first** and opt-in: the crypto stack
(`@x402/fetch`, `@x402/evm`, `viem`) is an **optional peer dependency**, installed only if you use it.

```bash
pnpm add glassnode-api @x402/fetch @x402/evm viem
```

```typescript
import { GlassnodeAPI } from 'glassnode-api';
import { createX402Fetch } from 'glassnode-api/x402';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const api = new GlassnodeAPI({
  x402: true, // → https://x402.glassnode.com
  fetch: await createX402Fetch({
    account,
    maxPaymentPerCall: '0.06', // USDC per-call ceiling (default)
  }),
});

// Pays $0.05 USDC on Base, transparently:
const mvrv = await api.callMetric('/market/mvrv', { a: 'BTC', i: '24h' });
```

**`createX402Fetch(options)`**

| Option              | Type           | Default            | Description                      |
| ------------------- | -------------- | ------------------ | -------------------------------- |
| `account`           | `LocalAccount` | — (**required**)   | viem account that signs payments |
| `maxPaymentPerCall` | `string`       | `'0.06'`           | Per-call USDC spend ceiling      |
| `fetch`             | `typeof fetch` | `globalThis.fetch` | Base fetch to wrap               |

> **Spend safety:** `maxPaymentPerCall` caps a **single** request — it is **not** a cumulative budget, so
> an agent loop can still spend within that ceiling repeatedly. Use a **dedicated, funded-but-limited**
> wallet (never your primary key), and load the key from the environment — never hardcode it.

**Notes**

- **Bulk metrics are not available over x402** — `callBulkMetric()` only works against the free
  `api.glassnode.com`.
- **Other endpoints:** target a non-default x402 endpoint (e.g. a testnet) by passing its URL as
  `apiUrl`.
- **Browser** signing is not supported yet (planned).

## Browser

The library ships prebuilt UMD and ESM bundles, so it also runs directly in the browser
without a build step.

```html
<!-- UMD -->
<script src="https://unpkg.com/glassnode-api/dist/glassnode-api.umd.min.js"></script>
<script>
  const api = new GlassnodeAPI.GlassnodeAPI({ apiKey: 'YOUR_API_KEY' });
</script>
```

```html
<!-- ESM -->
<script type="module">
  import { GlassnodeAPI } from 'https://unpkg.com/glassnode-api/dist/glassnode-api.esm.min.js';

  const api = new GlassnodeAPI({ apiKey: 'YOUR_API_KEY' });
</script>
```

> Your API key is exposed to end users in browser code. Only ship it in trusted,
> first-party contexts — otherwise proxy Glassnode requests through your own backend.

## Examples

See the [examples directory](./examples/README.md) for detailed usage patterns.

```bash
cd examples
cp .env.example .env  # add your API key
pnpm dlx ts-node ex.metadata.validation.ts
```

## Development

```bash
pnpm install                              # install dependencies
pnpm run build && pnpm run build:browser  # build Node.js + browser bundles
pnpm test                                 # run tests (Vitest)
pnpm run lint                             # lint
pnpm run format                           # format
```

## License

[MIT](./LICENSE)
