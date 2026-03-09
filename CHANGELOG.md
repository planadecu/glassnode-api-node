# Changelog

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
