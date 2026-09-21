# Changelog

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
