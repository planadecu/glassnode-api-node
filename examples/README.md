# Glassnode API Examples

This directory contains example scripts that demonstrate how to use the Glassnode API Node.js client.

## Setup

Before running the examples:

1. Make sure you have an API key from [Glassnode](https://docs.glassnode.com/)
2. Create a `.env` file in this directory with your API key:
   ```
   GLASSNODE_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Available Examples

### Metadata Validation (`metadata.validation.ts`)

Demonstrates how to:

- Fetch and validate asset metadata
- Get a list of available metrics
- Fetch metadata for specific metrics (exchange balance example)
- Work with metric parameters

Run with:

```bash
npx ts-node metadata.validation.ts
```

### Metric Dumping (`metric.dump.ts`)

Shows how to:

- Fetch a list of all available metrics
- Get metadata for each metric
- Call metrics with parameters
- Process and display the results

Run with:

```bash
npx ts-node metric.dump.ts
```

### x402 Paid Calls — Active Addresses (`ex.x402.active-addresses.ts`)

Demonstrates the **x402 paid API** (no API key — you pay per call in USDC on Base):

- Build a payment-capable `fetch` from a funded Base wallet (`createX402Fetch`)
- Hit the **metadata** endpoint ($0.01) to confirm the asset + resolution are supported
- Fetch **active addresses** for the asset (default **BTC**), last 1 month at `24h` ($0.05)
- Defaults to **mainnet**; point at a different x402 endpoint by setting `X402_API_URL`

Defaults to BTC at `24h` (`active_count` rejects `1h`). The metric/asset/resolution are overridable
via env — see the script header; the metadata check skips the paid query if the asset isn't supported.

Set these in `.env` (see `.env.example`):

```
X402_PRIVATE_KEY=0xyour_funded_wallet_private_key
X402_MAX_PAYMENT=0.06                     # optional, per-call USDC ceiling
X402_API_URL=https://x402.glassnode.com   # x402 endpoint (mainnet); point elsewhere to use another
```

> **Wallet safety:** use a dedicated, funded-but-limited wallet — never a primary key. On mainnet it
> spends real USDC; on a testnet endpoint fund the wallet with Base Sepolia test USDC. `X402_MAX_PAYMENT`
> caps each call, not total spend.

Run with:

```bash
npx ts-node ex.x402.active-addresses.ts
```

## Dependencies

The examples use:

- `dotenv` - For loading environment variables
- `ts-node` - For running TypeScript files directly
- `zod` - For schema validation (used in metadata.validation.ts)
- `@x402/fetch`, `@x402/evm`, `viem` - For the x402 paid-API example (payment signing on Base)

## Adding New Examples

To add a new example:

1. Create a new TypeScript file in this directory
2. Import the Glassnode API client: `import { GlassnodeAPI } from '../src'`
3. Set up the client with your API key
4. Implement your example code
5. Run with `npx ts-node your-example-file.ts`
