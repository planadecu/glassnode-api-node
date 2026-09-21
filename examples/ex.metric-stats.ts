import { GlassnodeAPI } from '../src';
import 'dotenv/config';

// Create an instance of the API client
const api = new GlassnodeAPI({
  apiKey: process.env.GLASSNODE_API_KEY || '', // Get API key from .env file
});

// Metrics to inspect: (label, metric path, asset, an accent color for the header).
// getMetricStats() reports a metric's current data lag as p50/p90/p95/p99 percentiles
// per resolution over the trailing 30 days. Metadata calls don't consume API quota.
const TARGETS: { label: string; path: string; asset: string; color: number }[] = [
  { label: 'BTC active addresses', path: '/addresses/active_count', asset: 'BTC', color: 214 },
  { label: 'SOL active addresses', path: '/addresses/active_count', asset: 'SOL', color: 141 },
  { label: 'BTC OHLC price', path: '/market/price_usd_ohlc', asset: 'BTC', color: 214 },
  { label: 'SOL OHLC price', path: '/market/price_usd_ohlc', asset: 'SOL', color: 141 },
];

// --- Tiny ANSI helpers (auto-disabled when stdout isn't a terminal) -------------------
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr('1');
const dim = sgr('2');
const green = sgr('38;5;2');
const gray = sgr('38;5;244');
const c256 = (n: number) => sgr(`38;5;${n}`);

// Format a lag in seconds as a compact human-readable string (e.g. "45s", "2m 5s", "1h 3m").
function formatLag(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const BAR_WIDTH = 28;

// A two-tone bar: solid (green) up to p50 (typical lag), dim tail out to p99 (worst case),
// both scaled to `max` (the largest p99 across this metric's resolutions).
function lagBar(p50: number, p99: number, max: number): string {
  if (max <= 0) return ' '.repeat(BAR_WIDTH);
  const p50Len = Math.max(0, Math.min(BAR_WIDTH, Math.round((p50 / max) * BAR_WIDTH)));
  const p99Len = Math.max(p50Len, Math.min(BAR_WIDTH, Math.round((p99 / max) * BAR_WIDTH)));
  const head = green('█'.repeat(p50Len));
  const tail = gray('█'.repeat(p99Len - p50Len));
  const pad = ' '.repeat(BAR_WIDTH - p99Len);
  return `${head}${tail}${pad}`;
}

async function fetchMetricStats(target: (typeof TARGETS)[number]) {
  const { label, path, asset, color } = target;
  const accent = c256(color);
  try {
    // Scope the stats to the asset with the `a` param.
    const stats = await api.getMetricStats(path, { a: asset });

    // Header line for this metric/asset.
    console.log();
    console.log(`${accent('●')} ${bold(label)}  ${dim(`${path} · a=${asset}`)}`);

    if (stats.lag.length === 0) {
      console.log(`  ${gray('No lag statistics reported for this metric/asset.')}`);
      return;
    }

    for (const entry of stats.lag) {
      const fmt = entry.unit === 'seconds' ? formatLag : (v: number) => `${v}`;
      const max = Math.max(...Object.values(entry.resolution).map((p) => p.p99), 0);

      console.log(`  ${dim(`data lag · ${entry.unit} · trailing ${entry.window}`)}`);
      console.log(
        `  ${gray('res '.padEnd(6))}${gray('p50'.padStart(8))}${gray('p90'.padStart(8))}` +
          `${gray('p95'.padStart(8))}${gray('p99'.padStart(8))}   ${gray('p50 ▸ p99')}`
      );

      // resolution is keyed by interval (10m, 1h, 24h, …); one row each.
      for (const [resolution, p] of Object.entries(entry.resolution)) {
        console.log(
          `  ${bold(resolution.padEnd(4))}  ` +
            `${fmt(p.p50).padStart(8)}${fmt(p.p90).padStart(8)}` +
            `${fmt(p.p95).padStart(8)}${fmt(p.p99).padStart(8)}   ` +
            lagBar(p.p50, p.p99, max)
        );
      }
    }
  } catch (error) {
    console.log();
    console.log(`${accent('●')} ${bold(label)}  ${dim(`${path} · a=${asset}`)}`);
    console.error(
      `  ❌ ${gray(`Error: ${error instanceof Error ? error.message : String(error)}`)}`
    );
  }
}

// Execute the example for every target.
async function runExample() {
  console.log(bold('\n📊 Glassnode metric data-lag statistics  (getMetricStats)'));
  console.log(
    dim(
      `   ${green('█')} p50 (typical)  ${gray('█')} p50 ▸ p99 tail (worst case) — bars scaled per metric`
    )
  );

  for (const target of TARGETS) {
    await fetchMetricStats(target);
  }
  console.log();
}

runExample();
