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
- 🎯 **Typed errors** — every failure is a `GlassnodeError`; subclasses for HTTP, network/timeout, validation and config errors
- 🪶 **Lightweight** — a single runtime dependency (`zod`)
- 🔌 **Pluggable** — inject a custom `fetch` implementation and a `logger`

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Methods](#methods)
- [Query parameters](#query-parameters)
- [Timestamps](#timestamps)
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

// Inspect a metric's current data lag (percentiles over the past 30d)
const stats = await api.getMetricStats('/institutions/us_spot_etf_balances_all');

// Call any metric endpoint directly
const data = await api.callMetric('/market/price_usd_close', {
  a: 'BTC',
  s: 1609459200, // since, unix seconds — or a Date: new Date('2021-01-01')
  i: '24h',
});
```

## Configuration

`new GlassnodeAPI(config)`

| Option           | Type                                            | Default                     | Description                                                                                           |
| ---------------- | ----------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apiKey`         | `string`                                        | — (required unless `x402`)  | Your Glassnode API key                                                                                |
| `apiUrl`         | `string`                                        | `https://api.glassnode.com` | Base URL for the API                                                                                  |
| `apiKeyLocation` | `'query' \| 'header'`                           | `'query'`                   | Send the key as the `api_key` query parameter or the `X-Api-Key` header (server-side only; see below) |
| `x402`           | `boolean`                                       | `false`                     | Route through the paid x402 endpoint (see [Paid calls with x402](#paid-calls-with-x402))              |
| `logger`         | `(message: string, ...args: unknown[]) => void` | —                           | Callback for debug logging (e.g. `console.log`)                                                       |
| `fetch`          | `typeof fetch`                                  | `globalThis.fetch`          | Custom fetch implementation (or an x402-wrapped fetch)                                                |
| `maxRetries`     | `number`                                        | `0`                         | Retries for retryable errors (`429`, `5xx`)                                                           |
| `retryDelay`     | `number`                                        | `1000`                      | Base retry delay in ms (doubles each attempt, then full jitter)                                       |
| `maxRetryDelay`  | `number`                                        | `30000`                     | Upper bound in ms for a single retry wait                                                             |
| `timeout`        | `number`                                        | — (no timeout)              | Per-request timeout in ms; each attempt aborts via `AbortSignal.timeout()`                            |

The config is validated at construction time — an invalid config (e.g. an empty `apiKey`) throws a `GlassnodeConfigError` immediately. When `x402` is enabled, `apiKey` is optional but a payment-capable `fetch` is required. Failed requests throw a `GlassnodeApiError` whose message includes the server's error detail (also on `.detail`).

### Keeping the API key out of URLs

By default the key is sent as the `api_key` query parameter, so it is part of every request URL —
visible to a custom `fetch`, tracing/instrumentation, proxies and access logs, and to any transport
error that quotes the URL. (The client's own `logger` output and error messages always mask it.)
On a server, set `apiKeyLocation: 'header'` to send it as the `X-Api-Key` header instead; the URL
then carries no key at all:

```typescript
const api = new GlassnodeAPI({ apiKey: process.env.GLASSNODE_API_KEY, apiKeyLocation: 'header' });
```

With `'header'`, a custom `fetch` is called as `fetch(url, { headers: { 'X-Api-Key': key } })`
(plus `signal` when `timeout` is set) and must forward `init.headers` — the fetch returned by
`createX402Fetch()` does. No header is sent when there is no `apiKey` (e.g. `x402` mode).

`'header'` does **not** work in browsers: a custom header triggers a CORS preflight, and the
Glassnode API's `Access-Control-Allow-Headers` does not list `X-Api-Key`, so the browser blocks the
request. That is why `'query'` stays the default.

## Methods

| Method                             | Returns                           | Description                                       |
| ---------------------------------- | --------------------------------- | ------------------------------------------------- |
| `getAssetMetadata()`               | `Promise<AssetMetadataResponse>`  | Metadata for all supported assets                 |
| `getMetricMetadata(path, params?)` | `Promise<MetricMetadataResponse>` | Metadata for a specific metric                    |
| `getMetricList()`                  | `Promise<MetricListResponse>`     | List of all available metric paths                |
| `getMetricStats(path, params?)`    | `Promise<MetricStatsResponse>`    | Data-lag percentiles for a metric (trailing 30d)  |
| `callMetric<T>(path, params?)`     | `Promise<T>`                      | Call any metric endpoint directly                 |
| `callBulkMetric(path, params?)`    | `Promise<BulkResponse>`           | Call a bulk endpoint (all assets in one response) |

All response types are exported and fully typed.

Arguments are checked before any request is sent; invalid input rejects with a
`GlassnodeInputError` and no network call is made:

- **Metric paths** (`path` in every method above) must look like `/market/price_usd_close`: a
  leading `/`, and one or more non-empty segments of letters, digits, `_`, `-` and `.`. The client
  never rewrites a path — a missing leading slash, whitespace, `//` or a trailing `/`, `.`/`..`
  segments, a query string (`/market/price_usd_close?a=BTC`) or a full URL are all rejected
  (a missing slash gets a "did you mean" hint). Pass query parameters via `params`.
- **Parameter values** must be a string, finite number, boolean or valid `Date` (see
  [Query parameters](#query-parameters)); `null`, `NaN`/`Infinity`, unsafe integers, an invalid
  `Date`, objects and arrays are rejected (`argument` is `params.<name>`), and `params` itself
  must be an object.
- **Parameters the client sets itself** cannot be overridden: `api_key` is always rejected (set
  `apiKey` in the config), `f` is rejected unless it is `json` (case-insensitive) in
  `callMetric`, `callBulkMetric`, `getMetricMetadata` and `getMetricStats` (the client only parses
  JSON), and `path` is rejected in `getMetricMetadata`/`getMetricStats` (it comes from the `path`
  argument).

## Query parameters

`params` (the second argument of `callMetric`, `callBulkMetric`, `getMetricMetadata` and
`getMetricStats`) is typed as `MetricParams`. The common Glassnode parameters are typed; any other
parameter a metric documents can be passed as well:

| Param  | Type                       | Meaning                                                      |
| ------ | -------------------------- | ------------------------------------------------------------ |
| `a`    | `string`                   | Asset, e.g. `'BTC'` (`'*'` for all assets on bulk endpoints) |
| `s`    | `number \| string \| Date` | Since — start of the range, unix **seconds**                 |
| `u`    | `number \| string \| Date` | Until — end of the range, unix **seconds**                   |
| `i`    | `string`                   | Interval, e.g. `'10m'`, `'1h'`, `'24h'`, `'1w'`, `'1month'`  |
| `c`    | `string`                   | Currency, e.g. `'native'`, `'usd'`                           |
| `e`    | `string`                   | Exchange, e.g. `'binance'`                                   |
| others | `MetricParamValue`         | `string \| number \| boolean \| Date`                        |

Values are converted to query-string text before the request:

- **string** — sent unchanged (so existing string params produce exactly the same URLs).
- **number** — its shortest round-trip decimal form, independent of locale (`1609459200`, `0.1`;
  `-0` → `0`). `NaN`, `±Infinity`, integers beyond `Number.MAX_SAFE_INTEGER` and numbers that would
  print in exponent notation (e.g. `1e-7`) are rejected — pass those as a string.
- **boolean** — `'true'` / `'false'`.
- **Date** — unix **seconds**, floored to the whole second (milliseconds are dropped:
  `2021-01-01T00:00:00.999Z` → `1609459200`). An invalid `Date` is rejected.
- **undefined** — the parameter is omitted, so optional values can be passed directly
  (`{ a: 'BTC', s: since }` with `since?: number`). `null` is rejected.

Numbers are sent as-is: pass `s`/`u` in **seconds** (not `Date.now()` milliseconds) — or pass a
`Date` and let the client convert it.

```typescript
const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
const recent = await api.callMetric('/market/price_usd_close', {
  a: 'BTC',
  s: oneWeekAgo,
  i: '1h',
});
```

## Timestamps

The API sends every time value as unix **seconds**, and the client passes them through as plain
`number`s — with **one exception**, `MetricMetadata.modified`, which is converted to a `Date`:

| Field                                                  | Type                 |
| ------------------------------------------------------ | -------------------- |
| `MetricMetadata.modified`                              | `Date \| undefined`  |
| `MetricMetadata.timerange.min` / `.max`                | `number` (unix secs) |
| `BulkResponse[number].t`                               | `number` (unix secs) |
| `t` in `callMetric()` results (raw JSON, typed by you) | `number` (unix secs) |

`modified` is `undefined` when the API omits it **or sends `0`** (treated as "not recorded", not as
1970-01-01). Convert any unix-second value with `new Date(t * 1000)`:

```typescript
const [latest] = (await api.callBulkMetric('/market/marketcap_usd')).slice(-1);
const when = new Date(latest.t * 1000);
```

## Error Handling

Every error the client throws is an instance of `GlassnodeError`, so a single `instanceof` check
catches all of them. Branch on the subclasses to tell the kinds of failure apart — no message
matching needed.

### Error types

| Class                      | Thrown when                                                                                                                                                                                                       | Useful properties                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GlassnodeError`           | Base class of all the errors below — catch this to handle any library failure                                                                                                                                     | `message`, `cause`                                                                                                        |
| `GlassnodeApiError`        | The API answered with a non-2xx HTTP status (e.g. `401`, `404`, `429`, `5xx`)                                                                                                                                     | `status`, `statusText`, `detail` (server message), `isRetryable` (429 / 5xx)                                              |
| `GlassnodeNetworkError`    | No HTTP response: connection/DNS failure, abort, or the per-request `timeout` firing. Retried when `maxRetries` > 0                                                                                               | `timedOut` (`true` when `timeout` fired), `cause` (the original fetch error)                                              |
| `GlassnodeValidationError` | A `2xx` response was unusable: the body was not valid JSON, or did not match the expected schema. Never retried                                                                                                   | `endpoint` (API path, e.g. `/v1/metadata/assets`), `cause` (`ZodError` / `SyntaxError`)                                   |
| `GlassnodeConfigError`     | The options passed to `new GlassnodeAPI(...)` are invalid (e.g. empty `apiKey`, `x402` without `fetch`), or `createX402Fetch` cannot load its optional peer dependencies                                          | `message` (lists the invalid fields), `cause` (`ZodError` / import error)                                                 |
| `GlassnodeInputError`      | A method argument is invalid (malformed metric path, a param value that cannot be sent, `f` other than `json`, `api_key`/`path` in `params`, a bad `maxPaymentPerCall`). Raised before any request; never retried | `argument` (`metricPath`, `params.<name>`, `maxPaymentPerCall`)                                                           |
| `GlassnodePaymentError`    | x402 only: the payment could not be made (price above `maxPaymentPerCall`, signer failed, unusable `402`), or the paid request failed in transit after the payment was sent. Never retried                        | `paymentMayHaveSettled` (`true`: a payment was sent and may have been charged; do not blindly retry), `timedOut`, `cause` |

```typescript
import {
  GlassnodeAPI,
  GlassnodeError,
  GlassnodeApiError,
  GlassnodeNetworkError,
  GlassnodeValidationError,
  GlassnodeInputError,
  GlassnodePaymentError,
} from 'glassnode-api';

try {
  await api.callMetric('/market/price_usd_close', { a: 'BTC' });
} catch (err) {
  if (err instanceof GlassnodeApiError) {
    console.error(err.status); // e.g. 401
    console.error(err.statusText); // e.g. "Unauthorized"
    console.error(err.isRetryable); // true for 429 / 5xx
    console.error(err.message); // "API request failed (401): Invalid or missing API key"
  } else if (err instanceof GlassnodeNetworkError) {
    console.error(err.timedOut ? 'request timed out' : 'network failure', err.cause);
  } else if (err instanceof GlassnodeValidationError) {
    console.error(`unexpected response from ${err.endpoint}`, err.cause);
  } else if (err instanceof GlassnodeInputError) {
    console.error(`bad ${err.argument}: ${err.message}`); // fix the call; nothing was sent
  } else if (err instanceof GlassnodePaymentError) {
    if (err.paymentMayHaveSettled) {
      console.error('x402 paid request failed in transit; payment may have settled:', err.cause);
    } else {
      console.error('x402 payment not made:', err.message); // e.g. price above maxPaymentPerCall
    }
  } else if (err instanceof GlassnodeError) {
    // any other library error
  }
}
```

## Retries

Enable automatic retries with exponential backoff for rate limits (`429`) and server errors (`5xx`):

```typescript
const api = new GlassnodeAPI({
  apiKey: 'YOUR_API_KEY',
  maxRetries: 3, // retry up to 3 times
  retryDelay: 1000, // base delay; grows 1s → 2s → 4s …
  maxRetryDelay: 30000, // cap a single wait at 30s (default)
});
```

Each retry wait is the exponential delay capped at `maxRetryDelay`, then **full-jittered** (a random
value between 0 and that cap) to avoid synchronised retries across clients. A `Retry-After` header on a
`429` is honoured for the next wait. A malformed `200` body is **not** retried (it isn't a transient
error) — it fails immediately.

Non-retryable errors (e.g. `401`, `404`) fail immediately without retrying.

With [x402](#paid-calls-with-x402), a connection failure or timeout is retried only while no payment
has been sent. Once a signed payment has gone out, a failure is **never** retried — see
[Errors](#x402-errors) below.

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

<a id="x402-errors"></a>**Errors**

> **One call never pays twice.** Every attempt at a paid call signs a **new** payment (fresh nonce).
> So once a signed payment has been sent, the client never retries the call, whatever `maxRetries`
> is. If the paid request then fails in transit (connection reset, or `timeout` firing after it was
> sent), the server may already have settled the payment. You get a `GlassnodePaymentError` with
> **`paymentMayHaveSettled: true`**. Before retrying it yourself, check the wallet's USDC transfers on
> Base. A retry pays again.

- The server's price is above `maxPaymentPerCall`, the signer throws, or the `402` carries no usable
  payment requirements → `GlassnodePaymentError` with `paymentMayHaveSettled: false` (x402's error on
  `.cause`). **Never retried**, even with `maxRetries` > 0: nothing was paid, and the same request
  would fail again.
- The **paid** request fails in transit (connection error, `timeout`) → `GlassnodePaymentError` with
  `paymentMayHaveSettled: true`. The transport error is on `.cause`, and `timedOut` is `true` when the
  `timeout` fired. **Never retried**, see above.
- The **unpaid** first request fails in transit (connection error, `timeout`), before any payment is
  signed → `GlassnodeNetworkError`, retried as usual. Nothing was paid.
- The server answers `402` even after payment (e.g. insufficient USDC balance, settlement refused)
  → `GlassnodeApiError` with `status` 402 (not retried).
- Invalid `maxPaymentPerCall` → `GlassnodeInputError`; `@x402/fetch` / `@x402/evm` / `viem` not
  installed → `GlassnodeConfigError`. Both are thrown by `createX402Fetch()` itself.

```typescript
try {
  await api.callMetric('/market/mvrv', { a: 'BTC' });
} catch (err) {
  if (err instanceof GlassnodePaymentError && err.paymentMayHaveSettled) {
    // Possibly charged with no data returned. Check on-chain before retrying: a retry pays again.
  }
}
```

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
> Keep the default `apiKeyLocation: 'query'` in the browser (see
> [Keeping the API key out of URLs](#keeping-the-api-key-out-of-urls)).

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
