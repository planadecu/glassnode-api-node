# Glassnode API Examples

This directory contains example scripts that demonstrate how to use the Glassnode API TypeScript client (Node.js and browsers).

## Setup

Before running the examples:

1. Install the root dependencies (the examples import the client straight from `../src`, which
   needs `zod` from the root install):
   ```bash
   pnpm install   # in the repository root
   ```
2. Install the examples' own dependencies in this directory with `npm ci`, which installs exactly
   what `package-lock.json` pins, as CI does:
   ```bash
   npm ci
   ```
   `examples/.npmrc` disables install scripts. To add or update a dependency, only accept versions
   published at least 7 days ago (the repo's supply-chain rule), then commit the updated lockfile:
   ```bash
   npm install <package>@<range> --before="$(date -u -v-7d +%F)"   # macOS; GNU: date -u -d '7 days ago' +%F
   ```
3. Copy `.env.example` to `.env` and fill in what the example needs — `GLASSNODE_API_KEY` (from
   [Glassnode](https://docs.glassnode.com/basic-api/api-key)) for the API-key examples, or the
   `X402_*` variables for the x402 example:
   ```bash
   cp .env.example .env
   ```

## Available Examples

### Metadata Validation (`ex.metadata.validation.ts`)

Demonstrates how to:

- Fetch and validate asset metadata
- Get a list of available metrics
- Fetch metadata for specific metrics (exchange balance example)
- Work with metric parameters

Run with:

```bash
npx ts-node ex.metadata.validation.ts
```

### Metric Dumping (`ex.metric.dump.ts`)

Shows how to:

- Fetch the list of all available metrics
- Get metadata for the first 10 metrics
- Call each one with the first allowed value of every parameter
- Print the first data point of each result

Run with:

```bash
npx ts-node ex.metric.dump.ts
```

### Bulk Market Cap Ranking (`ex.bulk.market-cap.ts`)

Uses `callBulkMetric()` to fetch `/market/marketcap_usd` for all assets at once (`a: '*'`, `24h`
resolution, last day), then ranks the latest entry and prints the top 20 assets by market cap.

Run with:

```bash
npx ts-node ex.bulk.market-cap.ts
```

### Metric Stats — Data-Lag Visualization (`ex.metric-stats.ts`)

Uses the `getMetricStats()` method (the `/v1/metadata/metric/stats` endpoint) to show a metric's
current **data lag** as `p50`/`p90`/`p95`/`p99` percentiles per resolution over the trailing 30 days,
and renders a colored in-console visualization. It inspects four metric/asset pairs:

- **BTC** and **SOL** active addresses (`/addresses/active_count`)
- **BTC** and **SOL** OHLC price (`/market/price_usd_ohlc`)

Each resolution gets a two-tone bar — solid = typical lag (`p50`), dim tail = worst case (`p99`) —
scaled per metric. Colors auto-disable when the output isn't a terminal (or set `NO_COLOR=1`).
Metadata calls don't consume API quota.

Run with:

```bash
npx ts-node ex.metric-stats.ts
```

### x402 Paid Calls — Active Addresses (`ex.x402.active-addresses.ts`)

Demonstrates the **x402 paid API** (no API key — you pay per call in USDC on Base):

- Build a payment-capable `fetch` from a funded Base wallet (`createX402Fetch`)
- Hit the **metadata** endpoint ($0.01) to confirm the asset + resolution are supported
- Fetch **active addresses** for the asset (default **BTC**), last 1 month at `24h` ($0.05)
- Defaults to **mainnet**; point at a different x402 endpoint by setting `X402_API_URL`

Defaults to BTC at `24h` (`active_count` rejects `1h`). The metadata check skips the paid query if
the asset isn't supported.

Set these in `.env` (see `.env.example`):

```
X402_PRIVATE_KEY=0xyour_funded_wallet_private_key   # required
X402_MAX_PAYMENT=0.06                     # optional, per-call USDC ceiling (default 0.06)
X402_API_URL=https://x402.glassnode.com   # optional, x402 endpoint (default: mainnet)
```

Optional overrides (see the script header): `X402_METRIC` (default `/addresses/active_count`),
`X402_ASSET` (default `BTC`), `X402_RESOLUTION` (`24h` | `1w` | `1month`, default `24h`), and
`X402_SKIP_METADATA=1` to make a single paid metric call without the metadata check.

> **Wallet safety:** use a dedicated, funded-but-limited wallet — never a primary key. On mainnet it
> spends real USDC; on a testnet endpoint fund the wallet with Base Sepolia test USDC. `X402_MAX_PAYMENT`
> caps each call, not total spend.

Run with:

```bash
npx ts-node ex.x402.active-addresses.ts
```

## Dependencies

`examples/package.json` declares:

- `dotenv` - For loading environment variables from `.env`
- `ts-node` (dev dependency) - For running TypeScript files directly
- `@x402/fetch`, `@x402/evm`, `viem` - For the x402 paid-API example (payment signing on Base)

`examples/tsconfig.json` configures ts-node: it enables `experimentalResolver`, which maps the
`.js` import specifiers in `../src` to their `.ts` sources. Run the examples from this directory so
ts-node picks it up; otherwise they fail with `Cannot find module './glassnode-api.js'`.

`zod` (used directly in `ex.metadata.validation.ts`) is not listed there — it's a dependency of the
client itself and resolves from the root install.

## Adding New Examples

To add a new example:

1. Create a new TypeScript file in this directory
2. Import the Glassnode API client: `import { GlassnodeAPI } from '../src'`
3. Load `.env` with `import 'dotenv/config'` and set up the client with
   `process.env.GLASSNODE_API_KEY`
4. Implement your example code
5. Run with `npx ts-node your-example-file.ts`
