# Changelog

## 0.8.0

- Add opt-in, Node-first **x402 payment support**: `x402: true` config preset (routes to
  `https://x402.glassnode.com`) and a new `glassnode-api/x402` subpath export with
  `createX402Fetch({ account, maxPaymentPerCall })`. The crypto stack (`@x402/fetch`, `@x402/evm`,
  `viem`) is an optional peer dependency; the core package stays `zod`-only.
- `apiKey` is now optional when `x402` is enabled; `fetch` is required in that mode.
- Add a friendly `402` error message. Bulk metrics remain free-API only (unsupported over x402).

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
