/**
 * x402 paid-API example: active addresses (configurable metric/asset/resolution).
 *
 * Flow:
 *   1. Build a payment-capable fetch from a funded Base wallet (viem account).
 *   2. Hit the METADATA endpoint ($0.01) to confirm the metric supports the asset + resolution.
 *   3. Hit the METRIC endpoint ($0.05) for the last month of data at that resolution.
 *
 * Defaults to mainnet. Set X402_API_URL to point at a different x402 endpoint (e.g. a
 * testnet); the same wallet/account works on either since payment schemes for both Base
 * mainnet and Base Sepolia are registered.
 *
 * Notes:
 *   - active_count only allows 24h/1w/1month on the x402 endpoint — i=1h returns HTTP 403
 *     "Resolution 1h is not allowed" (the metadata `parameters.i` list can be broader than
 *     what the endpoint actually serves).
 *   - Some assets (e.g. SUI) may only be offered on certain endpoints for a given metric —
 *     the metadata check reports this and skips the paid query.
 *   - X402_SKIP_METADATA=1 makes a single paid metric call (no metadata call first).
 *
 * Env (examples/.env):
 *   X402_API_URL        optional x402 endpoint override (default: built-in mainnet)
 *   X402_METRIC         metric path                (default: /addresses/active_count)
 *   X402_ASSET          asset symbol               (default: BTC)
 *   X402_RESOLUTION     24h | 1w | 1month          (default: 24h; 1h is not allowed)
 *   X402_SKIP_METADATA  1 to skip the metadata call (default: 0)
 *   X402_PRIVATE_KEY    0x-prefixed key of a funded Base wallet (required)
 *   X402_MAX_PAYMENT    per-call USDC ceiling       (default: 0.06)
 *
 * Run:  npx ts-node ex.x402.active-addresses.ts
 */
import { GlassnodeAPI } from '../src';
import { createX402Fetch } from '../src/x402';
import { privateKeyToAccount } from 'viem/accounts';
import 'dotenv/config';

const PRIVATE_KEY = process.env.X402_PRIVATE_KEY;
const API_URL = process.env.X402_API_URL; // optional endpoint override; unset → built-in mainnet
const MAX_PAYMENT = process.env.X402_MAX_PAYMENT ?? '0.06';
const METRIC = process.env.X402_METRIC ?? '/addresses/active_count';
const ASSET = (process.env.X402_ASSET ?? 'BTC').toUpperCase();
const RESOLUTION = process.env.X402_RESOLUTION ?? '24h';
const SKIP_METADATA = process.env.X402_SKIP_METADATA === '1';
const ONE_MONTH_SECONDS = 30 * 24 * 60 * 60;

async function main(): Promise<void> {
  if (!PRIVATE_KEY) {
    throw new Error(
      'X402_PRIVATE_KEY is required — set it in examples/.env to a funded Base wallet private key (0x...).'
    );
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  console.log(`x402 ${API_URL ? 'endpoint override' : 'mainnet'} — wallet ${account.address}`);
  console.log(`${METRIC}  asset=${ASSET}  i=${RESOLUTION}  cap=$${MAX_PAYMENT}\n`);

  const api = new GlassnodeAPI({
    x402: true, // defaults to the built-in mainnet endpoint
    ...(API_URL ? { apiUrl: API_URL } : {}),
    fetch: await createX402Fetch({ account, maxPaymentPerCall: MAX_PAYMENT }),
    logger: console.log,
  });

  // 1) Metadata ($0.01): confirm the metric supports the asset and resolution.
  //    Skip with X402_SKIP_METADATA=1 to make a single paid metric call.
  if (!SKIP_METADATA) {
    console.log(`\nChecking metadata for ${METRIC} ...`);
    const meta = await api.getMetricMetadata(METRIC);
    const assets = meta.parameters?.a ?? [];
    const resolutions = meta.parameters?.i ?? [];
    const hasAsset = assets.includes(ASSET);
    const hasResolution = resolutions.includes(RESOLUTION);
    console.log(
      `  supported assets: ${assets.length} — ${ASSET} ${hasAsset ? 'present ✓' : 'MISSING ✗'}`
    );
    console.log(
      `  resolutions: ${resolutions.join(', ') || '(none listed)'} — ${RESOLUTION} ${hasResolution ? '✓' : 'not listed'}`
    );

    // Skip the $0.05 metric call if the metadata already says the asset is unsupported.
    if (!hasAsset) {
      const sample = assets.slice(0, 12).join(', ');
      console.warn(
        `\n⚠ ${ASSET} is not supported for ${METRIC} on this endpoint. Try one of: ${sample}${
          assets.length > 12 ? ', …' : ''
        }`
      );
      console.warn('  Set X402_ASSET=<symbol> and re-run.');
      return;
    }
  }

  // 2) Metric ($0.05): last month of data at the chosen resolution.
  const since = Math.floor(Date.now() / 1000) - ONE_MONTH_SECONDS;
  console.log(`\nFetching ${ASSET} ${METRIC}, last 1 month @ ${RESOLUTION} ...`);
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
    console.log(`  average: ${Math.round(avg)}`);
  }
}

main().catch((err) => {
  console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
