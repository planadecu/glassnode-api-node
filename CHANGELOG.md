# Changelog

## 0.14.2

- CI now type-checks the `examples/` scripts against `src/` (`tsconfig.examples.json`, run via
  `pnpm exec tsc -p tsconfig.examples.json`), so an example can no longer silently drift from the
  public API. Examples resolve their dependencies from the root install; no extra install step.
  Tooling only; no package change.

## 0.14.1

- **Deprecated:** `MetricTierSchema` / `MetricTier` and `MetricDataTypeSchema` / `MetricDataType`
  are now marked `@deprecated` and will be removed in the next major release (1.0). No schema or
  client method uses them, and `MetricTier` does not match the API: `MetricMetadata.tier` is a
  number (e.g. `2`), not a `'free' | 'tierN'` string. Use `MetricMetadata['tier']` to type it
  instead. No runtime change.

## 0.14.0

- **Invalid input is rejected before any request is sent.** New exported error class
  `GlassnodeInputError` (extends `GlassnodeError`, with `argument`: `metricPath` or
  `params.<name>`). Methods are `async`, so it arrives as a rejected promise; `fetch` is never
  called. A new class was added because none of the existing ones fit: `GlassnodeConfigError` is
  about constructor options and `GlassnodeValidationError` about server responses (its `endpoint`
  refers to a request that was made).
- **One metric-path policy for `callMetric`, `callBulkMetric`, `getMetricMetadata` and
  `getMetricStats`: validate, never rewrite.** A path must be `/segment[/segment...]` with
  segments of letters, digits, `_`, `-`, `.`. Rejected: non-strings, empty string, a missing
  leading `/` (the message suggests the fixed path), whitespace anywhere, empty segments (`/`,
  `//x`, `/a//b`, trailing `/`), `.`/`..` segments, a query string or `#`, a full URL, and any
  other character (`%`, `\`, ...). Previously `callMetric('market/price_usd_close')` requested
  `/v1/metricsmarket/price_usd_close` and failed later as a confusing 404, and `..` segments could
  reach other endpoints.
- **Parameters the client controls are no longer silently overridden:**
  - `f` in `callMetric` / `callBulkMetric`: anything other than `json` (case-insensitive) is
    rejected; previously e.g. `f: 'csv'` was silently replaced with `json`. `f: 'json'` still
    works.
  - `api_key` in `params` (any method taking `params`): always rejected — set `apiKey` in the
    config. Previously it was silently replaced by the configured key (or, in x402 mode without
    `apiKey`, sent as-is).
  - `path` in `params` of `getMetricMetadata` / `getMetricStats`: rejected. Previously it
    silently overrode the `metricPath` argument.
- **Observable changes for existing callers:** calls with the inputs above, which previously sent
  a request (and usually failed with a `GlassnodeApiError`, or silently used different parameters
  than requested), now reject with `GlassnodeInputError` without a request. Valid calls are
  unchanged: the same URLs are requested. Released as a minor bump under 0.x, consistent with
  previous 0.x releases.
- README: input rules under "Methods" and a `GlassnodeInputError` row in the "Error types" table.

## 0.13.0

- **One error hierarchy for every failure.** All errors thrown by `GlassnodeAPI` now extend a new
  exported base class, `GlassnodeError`, so callers can catch one type and branch on subclasses
  instead of matching message text. New exports: `GlassnodeError`, `GlassnodeNetworkError`,
  `GlassnodeValidationError`, `GlassnodeConfigError`.
  - HTTP error status → `GlassnodeApiError` (now `extends GlassnodeError`). Unchanged otherwise:
    same constructor, `status` / `statusText` / `detail` / `isRetryable`, and message format.
  - Network failure or timeout → `GlassnodeNetworkError` (was a plain `Error`). Same message
    (`Glassnode API error: <msg>`), original error still on `.cause`, plus `timedOut: boolean`:
    `true` when the per-request `timeout` fired (`AbortSignal.timeout()` rejects with a
    `TimeoutError`). A non-`Error` rejection from a custom `fetch` is also a
    `GlassnodeNetworkError` (message `Unknown error occurred`).
  - Response that fails schema validation → `GlassnodeValidationError` (was a raw `ZodError`). The
    `ZodError` is on `.cause`, the failing API path on `.endpoint` (e.g. `/v1/metadata/assets`;
    never includes the query string or API key), and the message names the endpoint and the first
    few issues.
  - `200` body that is not valid JSON → `GlassnodeValidationError` (was a plain `Error`), same
    message, parse error on `.cause`, with `.endpoint`.
  - Invalid constructor config → `GlassnodeConfigError` (was a raw `ZodError`). The `ZodError` is
    on `.cause`; the message lists every invalid field
    (`Invalid GlassnodeAPI config: apiKey: API key is required; ...`).
- Retry behaviour is unchanged: 429/5xx and network errors are retried; validation and JSON-parse
  errors never are.
- **Observable changes for existing callers:** code that did `err instanceof ZodError` (or read
  `err.issues`) for invalid responses or an invalid config must now check
  `GlassnodeValidationError` / `GlassnodeConfigError` and use `err.cause` (the same `ZodError`).
  Code that checked `err.name === 'Error'` or `err.constructor === Error` for network or JSON
  failures now sees the new subclasses (they still extend `Error`; messages are unchanged). The
  config error message text also changed (Zod's JSON-formatted issue list is replaced by the
  summary above). `GlassnodeConfigSchema.parse()` itself still throws `ZodError`. Released as a
  minor bump under 0.x, consistent with previous 0.x releases.
- README: new "Error types" table in the error-handling section.

## 0.12.1

- **CI now actually type-checks the test files.** `tsconfig.test.json` inherited
  `"exclude": ["node_modules", "dist", "test"]` from `tsconfig.json`, and an inherited `exclude`
  still filters the child's `include`, so `tsc -p tsconfig.test.json --noEmit` (the "type-check
  test files" step in `ci.yml` / `publish.yml`) only checked `src/` and never saw `test/`. It now
  overrides `exclude` to `["node_modules", "dist"]`; the CJS build (`tsconfig.json`) still
  excludes tests. The check does not read `dist/`, so it keeps running before `pnpm run build`.
- Fixed the latent error this exposed: `test/x402.missing-deps.spec.ts` dynamically imported
  `'../src/x402'` without the `.js` extension required under `NodeNext` (TS2835).
- Tooling/tests only; no change to the published library.

## 0.12.0

- **Response schemas tolerate additive server changes** (rule of thumb: strict enums for inputs,
  lenient for outputs).
  - `ExternalIdsSchema` no longer rejects unknown sources. Previously it was a Zod v4 enum-keyed
    record, which fails on unrecognized keys, so a single asset with a new source (e.g.
    `{ coingecko: 'bitcoin', defillama: '…' }`) made the **whole** `getAssetMetadata()` call throw
    `Unrecognized key`. It is now an object with the known sources as optional string properties
    plus a string catch-all; unknown sources are kept (not stripped). Values must still be strings.
    - **Type-level:** `ExternalIds` changes from `Record<ExternalIdSource, string | undefined>`
      (all three keys required) to optional known keys plus a string index signature:
      `{ ccdata?: string; coinmarketcap?: string; coingecko?: string; [source: string]: string }`.
      Reading `ids.coingecko` is still `string | undefined`; building a value no longer requires
      listing every known source. `ExternalIdSourceSchema` /
      `ExternalIdSource` are kept and now document the _known_ sources, not a closed set.
  - `LagPercentilesSchema` (used by `getMetricStats()`): `p50`/`p90`/`p95`/`p99` are each
    **optional**. If the API omits a percentile for a resolution, the response still parses and
    that field is `undefined`, instead of the whole call throwing. Chosen over dropping the
    resolution or defaulting to a number, which would hide or invent data.
    - **Type-level (source-breaking for some readers):** `LagPercentiles` fields are now
      `number | undefined`. Code using them as `number` (arithmetic, `Math.max`, formatting) must
      handle `undefined` (e.g. `p.p99 ?? 0`). No runtime change for complete responses. Released as
      a minor bump under 0.x; `examples/ex.metric-stats.ts` updated accordingly.

## 0.11.0

- `glassnode-api/x402`'s public types no longer depend on `viem`. `X402FetchOptions.account` is now
  typed as a new structural `X402SignerAccount` interface (`{ address, signTypedData }`) instead of
  viem's `LocalAccount`. A viem account (`privateKeyToAccount(pk)`) is still assignable (verified by
  the type-checked integration test), and consumers on `moduleResolution: node16` with
  `skipLibCheck: false` no longer pull in `viem`'s type chain — clearing `TS1541` and ~12 transitive
  errors from the shipped `.d.ts`.
  - No runtime change. **Type-level note:** the accepted input is wider but the _read_ type is
    narrower — code that extracted `X402FetchOptions['account']` and called viem-specific methods on
    it will no longer compile (fine under 0.x; pass/keep a viem account as before and nothing
    changes).
  - Guarded by a new CI fixture (`typecheck/x402-node16/`) that type-checks a `node16` consumer of
    `glassnode-api/x402` with `skipLibCheck:false` — the leak attw cannot detect.

## 0.10.0

- **Real Node ESM entry.** The `import` condition now resolves to an unbundled ESM build
  (`dist/esm/`, emitted by `tsc -p tsconfig.esm.json`) with `zod` **externalized**, instead of the
  minified browser bundle with `zod` inlined. This fixes `arethetypeswrong`'s
  `node16 (from ESM): Unexpected module syntax` / `Masquerading as CJS`, removes the
  `MODULE_TYPELESS_PACKAGE_JSON` warning, and lets ESM + CJS consumers share one `zod` instance.
- `exports` now uses per-condition `types` (ESM `.d.ts` under `import`, CJS under `require`), adds a
  `typesVersions` map for the `./x402` subpath under legacy `node10` resolution, and the package
  declares `"type": "commonjs"`. `publint` and `@arethetypeswrong/cli` are now **green across all
  module modes** and enforced as hard CI gates.
- Relative imports in `src/` carry explicit `.js` extensions (required for Node ESM; harmless for
  CJS). No public API change.

## 0.9.12

- Stop shipping browser-bundle source maps (they were ~84% of the tarball). Rollup now emits
  `sourcemap: 'hidden'` (maps still generated locally, but no `sourceMappingURL` comment in the
  published bundle, so no dangling reference) and `.map` is dropped from the `files` allowlist.
  Published tarball shrinks from ~339 KB packed / 1.34 MB unpacked to **~70 KB packed / 0.25 MB
  unpacked** (17 files). Runtime code is unchanged.

## 0.9.11

- CI hardening: enforce coverage thresholds (`test:coverage` replaces `pnpm test` in CI and the
  publish workflow), type-check the test files (`tsc -p tsconfig.test.json --noEmit`), add a
  **Node 18 compat job** that builds and smoke-imports the CJS entry (proving `engines: ">=18"`),
  add `concurrency` cancel-in-progress, and run `publint` + `@arethetypeswrong/cli` as advisory
  packaging audits (they currently flag the bundled ESM entry; they become hard gates once that is
  reworked). No package/runtime change.

## 0.9.10

- Supply chain: the Husky pre-commit hook now runs `pnpm exec lint-staged` (the pinned
  devDependency) instead of `pnpm dlx lint-staged`, which fetched an unpinned latest version from
  the registry on every commit — bypassing both the version pin and the `.npmrc` quarantine.
- Drop the stale `jest.config.mjs` entry from `.npmignore` (the project migrated to Vitest).

## 0.9.9

- Export-map hygiene: list `types` first in each `exports` condition (TypeScript resolves
  conditions in order) and add a `"./package.json"` export so tooling can read the manifest.

## 0.9.8

- Packaging hygiene: `build` now cleans `dist/` first (new `clean` script) so a stale local build
  can never be published, and the `files` allowlist is narrowed to
  `dist/**/*.{js,d.ts,js.map}`. Verified: `npm pack` ships 19 files (~339 KB packed) with no stale
  bundles. (Note: CI already built from a clean checkout, so released tarballs were never affected;
  this closes the gap for a local `npm publish`.)

## 0.9.7

- Harden retries: cap each wait at the new `maxRetryDelay` config (default 30s), apply **full
  jitter** to avoid synchronised retries across clients, and honour a `Retry-After` header on
  `429` for the next wait.
- A malformed `200` response body is **no longer retried** — JSON parsing now happens outside the
  retry scope and fails immediately (previously a bad body was retried as if it were a network
  error). Replace the `throw lastError` tail with a definitive throw.

## 0.9.6

- Add a `timeout` config option (ms). When set, each request attempt is aborted via
  `AbortSignal.timeout()` (a fresh signal per retry), so a stalled connection no longer hangs
  indefinitely. Unset by default; the no-timeout path still calls a custom `fetch` with the URL
  only, preserving existing behavior.

## 0.9.5

- Add `examples/ex.metric-stats.ts`: a console example for `getMetricStats()` that fetches the
  data-lag percentiles for BTC/SOL active addresses and BTC/SOL OHLC price, and renders a colored
  in-terminal visualization (two-tone p50▸p99 bars, scaled per metric). Docs in `examples/README.md`.

## 0.9.3

- CI/infra fix: the new `.npmrc` `ignore-scripts=true` broke the `pnpm/action-setup` bootstrap
  in CI and publish workflows — the standalone `@pnpm/exe` needs its `preinstall` to select the
  platform binary. Re-enable scripts (`npm_config_ignore_scripts=false`) for that bootstrap step
  only; project installs still run with `ignore-scripts=true`. No package/runtime change.

## 0.9.2

- **Security (dev-only):** resolve the 4 open Dependabot alerts (all medium, development scope).
  The `vitest`/`@vitest/mocker` path-traversal advisory (< 4.1.11) is cleared by the move to
  vitest 5.0.0. Add `pnpm.overrides` for the two remaining transitive deps: `postcss` `>=8.5.23`
  (resolves to 8.5.28 — sourceMappingURL arbitrary `.map` read) and `@humanfs/node` `>=0.16.8`
  (resolves to 0.17.0 — recursive copy follows symlinks). No runtime/consumer impact.

## 0.9.1

- Dependency maintenance: bump dev and runtime deps to their latest versions allowed by the
  repo's `.npmrc` supply-chain policy (`minimum-release-age`, 7 days): `zod` 4.6.5,
  `typescript-eslint` 8.70.0, `eslint` 10.10.0, `vitest` + `@vitest/coverage-v8` 5.0.0,
  `rollup` 4.63.2, `viem` 2.56.5, `@x402/{fetch,evm}` 2.25.0, `lint-staged` 17.5.1,
  `prettier` 3.9.6. `typescript` stays on 6.x (`typescript-eslint`'s peer still caps at
  `<6.1.0`).
- Pin `@types/node` to the **Node 18 floor** (`^18`) rather than the latest, so the compiler
  enforces the package's `>=18` runtime support instead of merely tracking the dev runtime.
- Docs: clarify in `CLAUDE.md` that the library targets Node **>=18** for consumers while the
  dev environment runs Node **24** (vitest 5 requires dev Node >=22.12); refresh the
  TypeScript-6.x pin rationale.

## 0.9.0

- Add `getMetricStats(path, params?)` for the `/v1/metadata/metric/stats` endpoint: returns a
  metric's current data lag as aggregated percentiles (`p50`/`p90`/`p95`/`p99`) per resolution over
  the trailing 30 days. Optional `a` param scopes stats to a single asset. New exported types:
  `MetricStatsResponse`, `MetricLagEntry`, `LagPercentiles` (and their Zod schemas).

## 0.8.3

- Add a checked-in `.npmrc` with supply-chain hardening defaults: `ignore-scripts=true` (block
  install-time lifecycle scripts) and `minimum-release-age=10080` (require dependencies to be at
  least 7 days old before install). Repo-config only; not published in the package tarball.

## 0.8.0

- Add opt-in, Node-first **x402 payment support**: `x402: true` config preset (routes to
  `https://x402.glassnode.com`) and a new `glassnode-api/x402` subpath export with
  `createX402Fetch({ account, maxPaymentPerCall })`. The crypto stack (`@x402/fetch`, `@x402/evm`,
  `viem`) is an optional peer dependency; the core package stays `zod`-only.
- `apiKey` is now optional when `x402` is enabled; `fetch` is required in that mode.
- Add a friendly `402` error message. Bulk metrics remain free-API only (unsupported over x402).
- `GlassnodeApiError` now surfaces the server's error-body message (e.g. "Resolution 1h is not
  allowed") and exposes it on `.detail`, instead of only a generic status message.
- **Security:** redact the `api_key` query-param value in URLs passed to the optional `logger`
  (previously the key could leak into log sinks).

## 0.7.7

- Fix transitive dev-dependency vulnerabilities via `pnpm.overrides`: `flatted` ≥3.4.2 (high), `serialize-javascript` ≥7.0.5, `picomatch` ≥4.0.4, `brace-expansion` ≥5.0.6 — `pnpm audit` now clean
- README: lead with the Node.js/console usage; move browser (UMD/ESM) usage into its own section
- Replace the broken Bundlephobia size badge with a bundlejs min+gzip bundle-size badge

## 0.7.6

- Migrate test runner from Jest to Vitest (`vitest.config.ts`, `test:watch`/`test:coverage` scripts); remove `jest`, `ts-jest`, `@types/jest`
- Upgrade dependencies: `zod` 4.4.3, `typescript` 6.0.3, `eslint` 10.7.0, `typescript-eslint` 8.64.0, `prettier` 3.9.5, `rollup` 4.62.2, `@types/node` 26.1.1, `lint-staged` 17.0.8, `@rollup/plugin-commonjs` 29.0.3
- Publish via npm Trusted Publishing (OIDC) with provenance instead of an `NPM_TOKEN` secret; align CI/publish workflows with standalone pnpm
- Add package metadata: `homepage`, `bugs`, `engines`, `sideEffects`, `exports`, `publishConfig`, `keywords`, and expanded `author`
- Rewrite README for discoverability (badges, features, and complete API / configuration / error-handling / retry / bulk docs); add MIT `LICENSE` file
- Add `packageManager` field so the standalone pnpm setup in CI/publish workflows resolves the pnpm version

## 0.7.0

- Fix `callBulkMetric()` URL from `/v1/bulk/...` to `/v1/metrics/.../bulk`
- Fix bulk response envelope unwrapping (`{ data }`)
- Add `is_pit`, `bulk_supported`, `timerange`, and `refs.metric_variant` fields to `MetricMetadata`
- Remove unused `next_param` field from `MetricMetadata`
- Fix Zod 4 `error.errors` → `error.issues` in examples

## 0.6.2

- Fix dependency lib issues

## 0.6.1

- CI publish workflow version bump

## 0.6.0

- Add `MetricDescriptors` schema (name, short_name, group, tags, description)
- Add `descriptors` optional field to `MetricMetadata`
- Add CI workflow for PRs (lint, test, build)
- Add npm publish workflow on push to main

## 0.5.0

- Add configurable retry with exponential backoff (`maxRetries`, `retryDelay`)

## 0.4.0

- Add specific error messages for common HTTP status codes (400, 401, 403, 404, 429)
- Add `isRetryable` getter on `GlassnodeApiError`

## 0.3.0

- Add `callBulkMetric()` for `/v1/bulk/*` endpoints with Zod-validated `BulkResponse`
- Add market cap ranking example

## 0.2.0

- Add browser support (UMD and ESM bundles via Rollup)
- Add optional `logger` callback (replaces hardcoded `console.log`)
- Add optional `fetch` injection for testing and custom HTTP behavior
- Add `GlassnodeApiError` typed error class with `status` and `statusText`
- Migrate from npm to pnpm
- Upgrade all dependencies (Zod 4, Jest 30, ESLint 10, TypeScript 5.9)

## 0.1.0

- Initial release
- `GlassnodeAPI` client with `getAssetMetadata()`, `getMetricMetadata()`, `getMetricList()`, `callMetric()`
- Zod runtime validation for all API responses
- TypeScript types exported for all schemas
