// Records real Glassnode API responses as contract-test fixtures in test/fixtures/contract/.
// Run once (and again only to refresh the fixtures) with the owner's API key; only the recorded
// response bodies and a manifest are written — never the key. Not published (package.json `files`
// is dist-only). See README "Development" → "Recording contract fixtures".
//
// Usage: GLASSNODE_API_KEY=... node scripts/record-fixtures.mjs [--base-url <url>] [--out-dir <dir>]
//
// - The key is read ONLY from the GLASSNODE_API_KEY env var (there is deliberately no CLI flag
//   for it, which would land in shell history) and sent ONLY as the X-Api-Key header, so it never
//   appears in a URL.
// - --base-url (or GLASSNODE_API_URL) defaults to https://api.glassnode.com; plain http is only
//   allowed for localhost, so the key is never sent unencrypted to a remote host.
// - Redirects are never followed (`redirect: 'manual'`): fetch would resend the X-Api-Key header
//   to whatever host a 3xx names — including over plain http — so any 3xx aborts the run instead.
// - Every response is captured before anything is written: any HTTP, network or JSON error aborts
//   the run with no files written, as does finding the key anywhere in the output.
/* global process, console, setTimeout, AbortSignal, URL, URLSearchParams, Buffer */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE_URL = 'https://api.glassnode.com';
const DEFAULT_OUT_DIR = path.join(ROOT, 'test', 'fixtures', 'contract');
const DELAY_MS = 1000; // pause between calls, to stay well clear of rate limits
const TIMEOUT_MS = 60_000; // per request

// Size policy: a fixture whose pretty-printed JSON exceeds MAX_FIXTURE_BYTES is trimmed to a
// representative subset (see trimAssets / trimArray) and the manifest records that it was. If a
// response cannot be trimmed below the limit (no array to trim, or still too large after
// trimming) the run aborts rather than writing an oversized fixture.
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
const TRIM_KEEP_FIRST = 200;

// A fixed, short window (3 daily points) so a re-capture yields a stable, reviewable diff.
const WINDOW = { s: '1735689600', u: '1735862400' }; // 2025-01-01T00:00Z .. 2025-01-03T00:00Z

// The fixed set of calls. Metadata calls do not consume API quota; the last three (metric data)
// do, so they are kept to one short window each. `params` is an array of [name, value] pairs so a
// repeated parameter (`a` on the bulk call) is recorded exactly as sent.
const CALLS = [
  {
    // getAssetMetadata() → AssetMetadataResponseSchema (external_ids, blockchains, …)
    name: 'asset-metadata',
    endpoint: '/v1/metadata/assets',
    params: [],
    trim: trimAssets,
  },
  {
    // getMetricList() → MetricListResponseSchema
    name: 'metric-list',
    endpoint: '/v1/metadata/metrics',
    params: [],
  },
  {
    // getMetricMetadata() without `a`: the unscoped shape (all assets listed in `parameters`)
    name: 'metric-metadata-price-usd-close',
    endpoint: '/v1/metadata/metric',
    params: [['path', '/market/price_usd_close']],
  },
  {
    // getMetricMetadata() with `a`: the asset-scoped shape (`queried` carries the asset)
    name: 'metric-metadata-balance-exchanges-btc',
    endpoint: '/v1/metadata/metric',
    params: [
      ['path', '/distribution/balance_exchanges'],
      ['a', 'BTC'],
    ],
  },
  {
    // getMetricMetadata() for a metric that is not per-asset (institutional/ETF), without `a`
    name: 'metric-metadata-us-spot-etf-balances-all',
    endpoint: '/v1/metadata/metric',
    params: [['path', '/institutions/us_spot_etf_balances_all']],
  },
  {
    // getMetricStats() without `a` → MetricStatsResponseSchema
    name: 'metric-stats-us-spot-etf-balances-all',
    endpoint: '/v1/metadata/metric/stats',
    params: [['path', '/institutions/us_spot_etf_balances_all']],
  },
  {
    // getMetricStats() with `a`
    name: 'metric-stats-active-count-btc',
    endpoint: '/v1/metadata/metric/stats',
    params: [
      ['path', '/addresses/active_count'],
      ['a', 'BTC'],
    ],
  },
  {
    // callMetric() `{ t, v }` series → TimeSeriesResponseSchema
    name: 'timeseries-price-usd-close-btc',
    endpoint: '/v1/metrics/market/price_usd_close',
    params: [
      ['a', 'BTC'],
      ['i', '24h'],
      ['s', WINDOW.s],
      ['u', WINDOW.u],
    ],
  },
  {
    // callMetric() `{ t, o }` series → TimeSeriesObjectResponseSchema
    name: 'timeseries-price-usd-ohlc-btc',
    endpoint: '/v1/metrics/market/price_usd_ohlc',
    params: [
      ['a', 'BTC'],
      ['i', '24h'],
      ['s', WINDOW.s],
      ['u', WINDOW.u],
    ],
  },
  {
    // callBulkMetric() with repeated `a` → BulkResponseSchema
    name: 'bulk-marketcap-usd',
    endpoint: '/v1/metrics/market/marketcap_usd/bulk',
    params: [
      ['a', 'BTC'],
      ['a', 'ETH'],
      ['a', 'SOL'],
      ['i', '24h'],
      ['s', WINDOW.s],
      ['u', WINDOW.u],
    ],
  },
];

function fail(message) {
  console.error(`record-fixtures: ${message}`);
  console.error('No fixtures were written.');
  process.exit(1);
}

function parseCli() {
  try {
    const { values } = parseArgs({
      options: {
        'base-url': { type: 'string' },
        'out-dir': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    });
    return values;
  } catch (error) {
    fail(
      `${error.message}\nUsage: GLASSNODE_API_KEY=... node scripts/record-fixtures.mjs ` +
        '[--base-url <url>] [--out-dir <dir>] (the key is only read from the environment)'
    );
  }
}

function resolveBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`invalid base URL: ${raw}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    fail(
      `refusing to send the API key to ${url.origin}: use https (plain http only for localhost)`
    );
  }
  if (url.search || url.hash) fail(`the base URL must not carry a query or fragment: ${raw}`);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// Every form in which the key could leak into the output: raw, URL-encoded and JSON-escaped.
function leakNeedles(key) {
  return [...new Set([key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)])];
}

function mask(text, needles) {
  return needles.reduce((out, needle) => out.split(needle).join('***'), text);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describe(call) {
  const query = new URLSearchParams(call.params).toString();
  return query ? `${call.endpoint}?${query}` : call.endpoint;
}

// The redirect target for an error message: origin and path only (a query or fragment may carry
// a token), with the key masked in case the server reflected it into the Location.
function describeLocation(response, needles) {
  const location = response.headers.get('location');
  if (!location) return '(no Location header)';
  try {
    const url = new URL(location, response.url);
    return mask(url.origin + url.pathname, needles);
  } catch {
    return '(unparseable Location header)';
  }
}

async function capture(call, baseUrl, key, needles) {
  const target = describe(call);
  let response;
  let text;
  try {
    response = await fetch(`${baseUrl}${target}`, {
      headers: { 'X-Api-Key': key, Accept: 'application/json' },
      // Never follow a redirect: fetch would resend X-Api-Key to the Location host (undici keeps
      // custom headers across origins), possibly over plain http. 'manual' hands back the 3xx
      // itself — nothing is sent to the Location — so it can be reported below.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      fail(
        `HTTP ${response.status} redirect for ${target} to ${describeLocation(response, needles)}; ` +
          'redirects are not followed, so the API key is never sent to another URL. ' +
          'Point --base-url at the final URL instead.'
      );
    }
    text = await response.text();
  } catch (error) {
    fail(`request failed for ${target}: ${mask(String(error?.cause ?? error), needles)}`);
  }
  if (!response.ok) {
    const snippet = mask(text.slice(0, 500), needles);
    fail(`HTTP ${response.status} ${response.statusText} for ${target}\n${snippet}`);
  }
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    fail(`response for ${target} (HTTP ${response.status}) is not valid JSON`);
  }
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Shape signature of an asset entry: which keys it has, which external_ids sources, how many
// blockchains. Entries whose signature is not among the first TRIM_KEEP_FIRST are kept too, so a
// trimmed fixture still contains every distinct shape (e.g. a new external_ids source).
function assetShape(asset) {
  if (asset === null || typeof asset !== 'object') return `non-object:${typeof asset}`;
  const ids = asset.external_ids;
  const chains = asset.blockchains;
  return JSON.stringify({
    keys: Object.keys(asset).sort(),
    asset_type: asset.asset_type,
    external_ids:
      ids && typeof ids === 'object' ? Object.keys(ids).sort() : `non-object:${typeof ids}`,
    blockchains: Array.isArray(chains)
      ? Math.min(chains.length, 2) // 0, 1 or "several"
      : `non-array:${typeof chains}`,
    chainKeys: Array.isArray(chains)
      ? [...new Set(chains.flatMap((c) => (c && typeof c === 'object' ? Object.keys(c) : [])))]
          .sort()
          .join(',')
      : '',
  });
}

function trimAssets(body) {
  if (!Array.isArray(body)) return trimArray(body);
  const kept = body.slice(0, TRIM_KEEP_FIRST);
  const seen = new Set(kept.map(assetShape));
  for (const asset of body.slice(TRIM_KEEP_FIRST)) {
    const shape = assetShape(asset);
    if (!seen.has(shape)) {
      seen.add(shape);
      kept.push(asset);
    }
  }
  return {
    body: kept,
    originalCount: body.length,
    keptCount: kept.length,
    note: `first ${TRIM_KEEP_FIRST} entries plus one entry per additional distinct shape (keys, asset_type, external_ids sources, blockchain count/keys)`,
  };
}

// A top-level array keeps its first TRIM_KEEP_FIRST entries. An object (e.g. the bulk response,
// `{ data: [...] }`) keeps its first TRIM_KEEP_FIRST entries of each top-level array property,
// with every other property as returned. Anything else is returned as undefined: not trimmable.
function trimArray(body) {
  if (Array.isArray(body)) {
    const kept = body.slice(0, TRIM_KEEP_FIRST);
    return {
      body: kept,
      originalCount: body.length,
      keptCount: kept.length,
      note: `first ${TRIM_KEEP_FIRST} entries`,
    };
  }
  if (body === null || typeof body !== 'object') return undefined;
  const fields = Object.keys(body).filter(
    (field) => Array.isArray(body[field]) && body[field].length > TRIM_KEEP_FIRST
  );
  if (fields.length === 0) return undefined;
  const kept = { ...body };
  for (const field of fields) kept[field] = body[field].slice(0, TRIM_KEEP_FIRST);
  const count = (object) => fields.reduce((sum, field) => sum + object[field].length, 0);
  return {
    body: kept,
    originalCount: count(body),
    keptCount: count(kept),
    note: `first ${TRIM_KEEP_FIRST} entries of ${fields.map((field) => `\`${field}\``).join(', ')}`,
  };
}

async function main() {
  const cli = parseCli();
  if (cli.help) {
    console.log(
      'Usage: GLASSNODE_API_KEY=... node scripts/record-fixtures.mjs [--base-url <url>] [--out-dir <dir>]'
    );
    return;
  }
  const key = process.env.GLASSNODE_API_KEY;
  if (!key || !key.trim()) {
    fail('GLASSNODE_API_KEY is not set. The key is only read from the environment.');
  }
  const needles = leakNeedles(key);
  const baseUrl = resolveBaseUrl(
    cli['base-url'] ?? process.env.GLASSNODE_API_URL ?? DEFAULT_BASE_URL
  );
  const outDir = path.resolve(cli['out-dir'] ?? DEFAULT_OUT_DIR);
  const { version: clientVersion } = JSON.parse(
    await readFile(path.join(ROOT, 'package.json'), 'utf8')
  );
  const capturedAt = new Date().toISOString();

  console.log(`Recording ${CALLS.length} responses from ${baseUrl} into ${outDir}`);
  const files = new Map(); // file name → contents; written only once everything succeeded
  const fixtures = [];
  for (const [index, call] of CALLS.entries()) {
    if (index > 0) await sleep(DELAY_MS);
    const { status, body } = await capture(call, baseUrl, key, needles);
    let data = body;
    let trimmed;
    const fullBytes = Buffer.byteLength(serialize(body));
    if (fullBytes > MAX_FIXTURE_BYTES) {
      const result = (call.trim ?? trimArray)(body);
      if (!result) {
        fail(
          `the response for ${describe(call)} is ${fullBytes} bytes (over ${MAX_FIXTURE_BYTES}) ` +
            'and has no array to trim; narrow the call or extend the trim policy.'
        );
      }
      data = result.body;
      trimmed = {
        originalCount: result.originalCount,
        keptCount: result.keptCount,
        originalBytes: fullBytes,
        policy: result.note,
      };
    }
    const file = `${call.name}.json`;
    const contents = serialize(data);
    if (Buffer.byteLength(contents) > MAX_FIXTURE_BYTES) {
      fail(
        `the response for ${describe(call)} is still ${Buffer.byteLength(contents)} bytes after ` +
          `trimming (over ${MAX_FIXTURE_BYTES}); narrow the call or tighten the trim policy.`
      );
    }
    files.set(file, contents);
    fixtures.push({
      name: call.name,
      file,
      endpoint: call.endpoint,
      params: call.params.map(([name, value]) => ({ name, value })),
      status,
      capturedAt,
      clientVersion,
      bytes: Buffer.byteLength(contents),
      ...(trimmed ? { trimmed } : {}),
    });
    const size = `${(Buffer.byteLength(contents) / 1024).toFixed(1)} KiB`;
    console.log(`  ${status} ${describe(call)} → ${file} (${size}${trimmed ? ', trimmed' : ''})`);
  }

  const manifest = {
    description:
      'Real Glassnode API responses recorded by scripts/record-fixtures.mjs for contract tests. ' +
      'Response bodies are stored as returned (pretty-printed), except where `trimmed` is set.',
    capturedAt,
    clientVersion,
    baseUrl,
    sizePolicy: `a fixture over ${MAX_FIXTURE_BYTES} bytes is trimmed to a representative subset (recorded in its \`trimmed\` field); a response that cannot be trimmed below that aborts the run`,
    fixtures,
  };
  files.set('manifest.json', serialize(manifest));

  // Defense in depth: the key is only ever sent as a header, but abort if any output contains it
  // (e.g. a server that echoes the request headers back).
  for (const [file, contents] of files) {
    if (needles.some((needle) => contents.includes(needle))) {
      fail(`the API key occurs in the output for ${file}; aborting.`);
    }
  }

  await mkdir(outDir, { recursive: true });
  for (const [file, contents] of files) await writeFile(path.join(outDir, file), contents);
  console.log(`Wrote ${files.size} files. Review the diff before committing (git diff --stat).`);
}

await main();
