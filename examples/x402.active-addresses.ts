/**
 * x402 paid-API example: SUI active addresses (last 1 month, 1h resolution).
 *
 * Flow:
 *   1. Build a payment-capable fetch from a funded Base wallet (viem account).
 *   2. Hit the METADATA endpoint ($0.01) to confirm the metric supports SUI and 1h.
 *   3. Hit the METRIC endpoint ($0.05) for SUI active addresses over the last month @ 1h.
 *
 * Runs against the testnet (Base Sepolia) or mainnet (Base) depending on X402_NETWORK.
 * Start on testnet with a Sepolia-funded test-USDC wallet, then flip to mainnet.
 *
 * Env (examples/.env):
 *   X402_NETWORK       testnet | mainnet   (default: testnet)
 *   X402_PRIVATE_KEY   0x-prefixed private key of a funded Base wallet (required)
 *   X402_MAX_PAYMENT   per-call USDC ceiling (default: 0.06)
 *
 * Run:  npx ts-node x402.active-addresses.ts
 */
import { GlassnodeAPI, X402_TESTNET_API_URL } from '../src';
import { createX402Fetch } from '../src/x402';
import { privateKeyToAccount } from 'viem/accounts';
import 'dotenv/config';

const NETWORK = (process.env.X402_NETWORK ?? 'testnet').toLowerCase();
const PRIVATE_KEY = process.env.X402_PRIVATE_KEY;
const MAX_PAYMENT = process.env.X402_MAX_PAYMENT ?? '0.06';

const ASSET = 'SUI';
const METRIC = '/addresses/active_count';
const RESOLUTION = '1h';
const ONE_MONTH_SECONDS = 30 * 24 * 60 * 60;

async function main(): Promise<void> {
  if (!PRIVATE_KEY) {
    throw new Error(
      'X402_PRIVATE_KEY is required — set it in examples/.env to a funded Base wallet private key (0x...).'
    );
  }
  if (NETWORK !== 'testnet' && NETWORK !== 'mainnet') {
    throw new Error(`X402_NETWORK must be "testnet" or "mainnet" (got "${NETWORK}").`);
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`x402 ${NETWORK} — wallet ${account.address}`);
  console.log(`Per-call cap: $${MAX_PAYMENT} USDC\n`);

  const api = new GlassnodeAPI({
    x402: true, // defaults to mainnet (https://x402.glassnode.com)
    ...(NETWORK === 'testnet' ? { apiUrl: X402_TESTNET_API_URL } : {}),
    fetch: await createX402Fetch({ account, maxPaymentPerCall: MAX_PAYMENT }),
    logger: console.log,
  });

  // 1) Metadata ($0.01): confirm the metric supports SUI and 1h resolution.
  console.log(`\nChecking metadata for ${METRIC} ...`);
  const meta = await api.getMetricMetadata(METRIC);
  const assets = meta.parameters?.a ?? [];
  const resolutions = meta.parameters?.i ?? [];
  const hasSui = assets.includes(ASSET);
  const has1h = resolutions.includes(RESOLUTION);
  console.log(
    `  supported assets: ${assets.length} — ${ASSET} ${hasSui ? 'present ✓' : 'MISSING ✗'}`
  );
  console.log(
    `  resolutions: ${resolutions.join(', ') || '(none listed)'} — ${RESOLUTION} ${has1h ? '✓' : 'not listed'}`
  );
  if (!hasSui) console.warn(`  ⚠ ${ASSET} not listed for ${METRIC}; querying anyway.`);

  // 2) Metric ($0.05): SUI active addresses, last 1 month @ 1h.
  const since = Math.floor(Date.now() / 1000) - ONE_MONTH_SECONDS;
  console.log(`\nFetching ${ASSET} active addresses, last 1 month @ ${RESOLUTION} ...`);
  const data = await api.callMetric<{ t: number; v: number }[]>(METRIC, {
    a: ASSET,
    i: RESOLUTION,
    s: String(since),
  });

  console.log(`\n${data.length} data points`);
  if (data.length > 0) {
    const first = data[0];
    const last = data[data.length - 1];
    const avg = data.reduce((sum, d) => sum + d.v, 0) / data.length;
    console.log(`  first: ${new Date(first.t * 1000).toISOString()} → ${first.v}`);
    console.log(`  last:  ${new Date(last.t * 1000).toISOString()} → ${last.v}`);
    console.log(`  avg active addresses: ${Math.round(avg)}`);
  }
}

main().catch((err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
