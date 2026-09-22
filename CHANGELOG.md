# Changelog

## 0.23.1

- Tooling: add a `.prettierignore` that excludes the generated lockfiles (`pnpm-lock.yaml`,
  `examples/package-lock.json`), so `pnpm run format` (and the `version` lifecycle script) no longer
  reformats the pnpm lockfile. Prettier still honors `.gitignore`, and `prettier --check .` now
  passes on the whole repo. No package change.

## 0.23.0

- Added: structured observability hooks — the `hooks` config option,
  `{ onRequest, onResponse, onRetry, onError }` (all optional). Each hook gets one event with a
  per-call `callId` (shared by every attempt of a call), `method`, `endpoint`, the redacted `url`,
  the 1-based `attempt` and `maxAttempts`; `onResponse` adds `status`, `ok` and the attempt's
  `durationMs`; `onRetry` adds `reason` (`'status'` / `'network'` / `'timeout'`), `status`, the
  `error`, `delayMs` and `durationMs`; `onError` fires once per failed call (including a caller
  abort and a response validation error) with the `GlassnodeError` the call rejects with, `status`,
  the last attempt's `durationMs` and the call's `elapsedMs`. Invalid arguments
  (`GlassnodeInputError`) fire no hooks.
- Hooks run synchronously and are never awaited; a hook that throws or rejects is swallowed
  (reported to the `logger` as `Hook <name> failed:`) and never changes the call's result or
  retries. Payloads never carry the API key: the URL is masked and no headers (so no `X-Api-Key`
  or x402 payment headers) are exposed. The `hooks` option is validated at construction (unknown
  hook names and non-functions throw `GlassnodeConfigError`). New exported types:
  `GlassnodeHooks`, `GlassnodeHookEventBase`, `GlassnodeRequestEvent`, `GlassnodeResponseEvent`,
  `GlassnodeRetryEvent`, `GlassnodeRetryReason`, `GlassnodeErrorEvent`. The `logger` output is
  unchanged.

## 0.22.3

- Tooling: `pnpm run lint` now honors `.gitignore`. The ESLint flat config imports its patterns via
  `includeIgnoreFile` (built into ESLint 10, no new dependency), so `eslint .` no longer lints
  gitignored trees such as `.claude/` (including local git worktrees, which are full repository
  copies) or `coverage/`. No package change.

## 0.22.2

- Tests: cover x402 payment detection on `init.headers` (plain object, `Headers`, array of tuples)
  and with header-name casing variations, on cross-realm (`node:vm`) `Headers`/`Request` objects,
  and for concurrent calls on one wrapped fetch (a paid call failing in transit does not change how
  another call's unpaid probe failure is classified).
- Tests: cover a 3xx answer to the paid request (`redirect: 'manual'`) and `maxRetries: 0` with a
  non-2xx paid response — both are `GlassnodePaymentError` with `paymentMayHaveSettled: true`.
- Tests: tripwires that fail if `@x402/fetch` / `@x402/core` emits a payment header that
  `PAYMENT_HEADERS` does not recognise; the constant is documented as tracking
  `encodePaymentSignatureHeader`. No library behavior change.

## 0.22.1

- Fixed: a non-JSON error body (e.g. an HTML page from a proxy) is now redacted before it is cut to
  300 characters for `GlassnodeApiError.detail` and the paid-request `GlassnodePaymentError`. Before,
  the body was cut first, so an API key echoed raw (not as `api_key=…`) across the 300-character
  edge lost its tail, no longer matched the key, and its leading characters reached the error
  message and `detail` unmasked. A hostile proxy could pad the body to leak almost the whole key.
  Because masking shortens the text, the 300 characters can now include text that followed a
  masked key. JSON `message`/`error` values are unchanged (they were never cut).

## 0.22.0

- Added: opt-in response validation for `callMetric`. Pass a Zod schema as `options.schema` —
  `callMetric(path, params, { schema })` — and the body is validated and typed as the schema's
  output (`z.output<S>`, so transforms apply). A mismatch rejects with a
  `GlassnodeValidationError` whose `endpoint` is the metric's API path, like every other method.
  A `schema` that is not a Zod schema rejects with a `GlassnodeInputError` (`argument`
  `options.schema`) before any request. `schema` combines with `signal` and `timeout`.
- Added: exported schemas and types for the two common metric shapes —
  `TimeSeriesPointSchema` / `TimeSeriesResponseSchema` (`{ t: number; v: number | null }[]`) and
  `TimeSeriesObjectPointSchema` / `TimeSeriesObjectResponseSchema`
  (`{ t: number; o: Record<string, number | null> }[]`, e.g. `/market/price_usd_ohlc`) — plus the
  `CallMetricOptions<S>` type. They are lenient to additive server changes: extra fields on a point
  are stripped, `o` accepts any keys, and a `null` value does not fail the series.
- Not observable for existing callers: without `schema`, `callMetric<T>` still returns the parsed
  body unvalidated, cast to `T`, with the same typing and runtime behavior. `schema` is a
  `callMetric`-only option; other methods' `options` type does not accept it.

## 0.21.3

- Fixed: the config options `timeout`, `retryDelay` and `maxRetryDelay` are now capped at
  2147483647 ms (2^31 − 1, the largest timer delay), the same as the per-call `timeout`. A larger
  value now throws a `GlassnodeConfigError` when the client is constructed. Before, an oversized
  `timeout` made every call throw a raw `RangeError` from `AbortSignal.timeout()`, and an oversized
  `maxRetryDelay` let a long `Retry-After` overflow the retry timer, so the client retried after
  about 1 ms instead of waiting.

## 0.21.2

- **Security:** the API key no longer leaks into error messages. Before, a `GlassnodeApiError`
  put the server's error body into `message` and `detail` unredacted, so a server or proxy that
  echoed the request URL (`…?api_key=<key>`) or the key itself put the key into errors that
  callers routinely log. Now every text from outside the library that goes into an error — error
  bodies and status texts, transport errors, schema-issue summaries (whose paths carry response
  keys), and x402 payment-layer, signer, paid-transport and paid-HTTP errors — goes through one
  shared redaction (`src/redact.ts`): `api_key=<value>` becomes `api_key=***` (now also a bare
  `api_key=` not preceded by `?`/`&`), and every raw, percent-encoded or form-encoded copy of the
  key becomes `***`.
- Raw copies are only masked for keys of at least 8 characters: the config accepts any non-empty
  key, and masking e.g. a 3-character key everywhere would blank out unrelated words, numbers and
  status codes. Real Glassnode keys are far longer. The `api_key=` form is always masked.
- `createX402Fetch()` is built separately from the client and never sees its config, so it reads
  the key from each request it is given (the `api_key` query value and/or the `X-Api-Key` header)
  and masks that key in its errors, including the `GlassnodeApiError` on `.cause` of a paid HTTP
  failure (whose `statusText` is now redacted too).
- `.cause` is deliberately **not** redacted: it keeps the original object (fetch error,
  `ZodError`, x402 error). The README and the `GlassnodeError` JSDoc now say not to log `.cause`
  where the key must not appear.
- **Observable for callers:** error `message`, `detail` and `statusText` show `***` where they
  used to contain the configured key; nothing changes for errors that never contained it. Patch
  bump: a bug fix with no API change.

## 0.21.1

- Docs: the README's Browser section now says that, as of September 2026, Glassnode's API only
  allows cross-origin requests from `*.glassnode.com`, so the browser bundles cannot call
  `api.glassnode.com` directly from other origins. It recommends a server-side proxy that injects
  the API key (via `apiUrl`) and never shipping a key to the browser. The intro and "Universal"
  feature claims are qualified to match. No code change.

## 0.21.0

- **New:** per-call options on every method, as a new optional **last** argument:
  `getAssetMetadata(options?)`, `getMetricList(options?)`, and `getMetricMetadata`,
  `getMetricStats`, `callMetric`, `callBulkMetric` as `(path, params?, options?)`. `options` is the
  new exported `CallOptions` type, `{ signal?: AbortSignal; timeout?: number }`.
- `signal` cancels the call: the in-flight request, any retry wait (a backoff is cut short, not
  slept through) and every further retry. An already-aborted signal rejects before any request.
- **New error class `GlassnodeAbortError`** (extends `GlassnodeError`, exported): a cancellation
  through `signal`, with the signal's `reason` on `.cause`. Never retried. It is a separate class
  rather than a flag on `GlassnodeNetworkError` so that code retrying network errors never retries
  a deliberate cancellation, and a timeout (`GlassnodeNetworkError`, `timedOut: true`) stays
  distinguishable. A caller abort while the response body is read is also a `GlassnodeAbortError`,
  not a `GlassnodeValidationError`.
- `timeout` overrides the config `timeout` for one call, with the same per-attempt semantics. With
  both `signal` and a timeout, each attempt aborts on whichever fires first. The two signals are
  combined by a small built-in combiner (`AbortSignal.any()` needs Node 20.3+; the package supports
  Node 18) that removes its listeners from the caller's signal after every attempt, so a long-lived
  signal can be reused across many calls without leaking listeners.
- Invalid options reject with a `GlassnodeInputError` before any request: `argument` is `options`
  (not an object), `options.signal` (not an `AbortSignal`) or `options.timeout` (not a positive
  integer up to `2147483647` ms).
- x402: the per-call signal is passed to the x402 fetch in `init`. An abort before any payment was
  sent is a `GlassnodeAbortError`; an abort after the paid request went out stays a
  `GlassnodePaymentError` with `paymentMayHaveSettled: true`, never retried. `src/x402.ts` is
  unchanged.
- **Observable for callers:** none when no `options` are passed — a custom `fetch` sees exactly
  the same calls as before (a single argument by default). JavaScript callers that passed a stray
  extra argument to a method (e.g. `getMetricList(x)`) now get a `GlassnodeInputError` when that
  argument is not an object (or `null`/`undefined`), or has an invalid `signal` or `timeout`. Minor bump: new feature, new error class
  and new exported type (0.x).
- README: "Cancellation and per-call timeouts" section, method signatures, the error table and the
  x402 errors list. The Node 18 smoke script also checks a per-call abort.

## 0.20.0

- **Fixed a money-safety bug.** In x402 mode with `maxRetries` > 0, a `429` or `5xx` answer to the
  **paid** request was retried like any other retryable status. Each retry re-ran the payment flow
  and signed a new payment (fresh nonce). A gateway `502`/`504` sent after the origin had already
  settled, or a server that settles and then errors, could therefore charge one call more than
  once. Once a request carrying a signed payment has been sent, the call is now never retried,
  whatever the HTTP status.
- A non-2xx answer to the paid request, other than `402`, now raises a `GlassnodePaymentError`
  with `paymentMayHaveSettled: true`. This covers `5xx`, `429` and other `4xx` such as `400`: whether
  a payment settles before the handler runs depends on the server and any proxy, which the client
  cannot see. The equivalent `GlassnodeApiError` (`status`, `statusText`, server `detail`, with
  `api_key` values redacted) is on `.cause`.
- **New:** `GlassnodePaymentError.status` holds the HTTP status of the paid response when that
  response caused the failure. It is `undefined` for payment-layer and transport failures.
- Unchanged: a `402` answer to the paid request (the server refused the payment) is still a
  `GlassnodeApiError` with `status` 402, and it is not retried. A `429`/`5xx` or transport failure
  of the unpaid first request is still retried as before: no payment has been signed at that point.
- **Observable for callers:** with x402, a paid request answered with a non-2xx status other than
  `402` used to surface as a `GlassnodeApiError`, and `429`/`5xx` were retried first. It now raises a
  non-retried `GlassnodePaymentError`; the `GlassnodeApiError` is on `.cause`. Code that
  checked `err instanceof GlassnodeApiError && err.status === …` for such responses must check
  `GlassnodePaymentError` (`err.status`) instead. The fetch returned by `createX402Fetch()` now
  rejects in this case instead of resolving with the error response. Non-x402 use is unaffected.
  Minor bump: a new property, and changed error classification in x402 mode (0.x).
- README: the x402 "Errors" section and the error table cover HTTP errors after payment.

## 0.19.0

- **Fixed a money-safety bug.** In x402 mode with `maxRetries` > 0, a transport failure
  (connection reset, or the `timeout` abort) of the **paid** request was retried as a
  `GlassnodeNetworkError`. Each retry signed and sent a new payment with a fresh nonce, so one
  call could be charged more than once. Once a request carrying a signed payment
  (`PAYMENT-SIGNATURE` / `X-PAYMENT`) has been sent, a failure is now never retried.
- `GlassnodePaymentError` gains `paymentMayHaveSettled` and `timedOut`. A transport failure of the
  paid request now raises a `GlassnodePaymentError` with `paymentMayHaveSettled: true`, the
  original transport error on `.cause`, and `timedOut` set when the `timeout` fired. Check on-chain
  before retrying such a call. Payment failures before anything was sent have
  `paymentMayHaveSettled: false`.
- Transport failures of the unpaid first request (before any payment is signed) are still
  retryable `GlassnodeNetworkError`s.
- **Observable for callers:** with x402, a failed paid request used to be a retried
  `GlassnodeNetworkError`; it is now a non-retried `GlassnodePaymentError`. Non-x402 use is
  unaffected.
- README: the x402 "Errors" section calls out the never-pay-twice behavior and shows how to handle
  `paymentMayHaveSettled`.

## 0.18.0

- **New:** query parameters accept `string | number | boolean | Date` values, not only strings,
  in `callMetric`, `callBulkMetric`, `getMetricMetadata` and `getMetricStats` — e.g.
  `{ a: 'BTC', s: 1609459200 }` or `{ s: new Date('2021-01-01') }` now compile. Values are
  converted before the request: numbers to their shortest round-trip decimal form
  (locale-independent, `-0` → `0`), booleans to `'true'`/`'false'`, a `Date` to unix **seconds**
  floored to the whole second. Strings are sent unchanged, so existing calls produce
  byte-identical URLs.
- **New exported types:** `MetricParams` (the `params` type: typed `a`, `s`, `u`, `i`, `c`, `e`,
  `f` plus an index signature for any other parameter; `api_key` is typed `never`),
  `MetricParamValue`, `MetricTime` (`number | string | Date`) and `MetricInterval`.
- A param whose value is `undefined` is now **omitted** (it used to be sent as the literal
  `undefined`). An `undefined` `api_key`, `f` or `path` counts as absent, so it is no longer
  rejected.
- Values that cannot be sent are rejected with `GlassnodeInputError` (`argument`
  `params.<name>`) before any request: `NaN`, `±Infinity`, integers beyond
  `Number.MAX_SAFE_INTEGER`, numbers that would print in exponent notation (e.g. `1e-7`), an
  invalid `Date`, `null`, and objects/arrays/bigints/symbols/functions. `params` that is not an
  object (e.g. a string or an array) is rejected with `argument` `params`.
- **Observable for callers:** typed string callers see no change. Untyped (JavaScript) callers
  that passed `null`, an array (e.g. `['BTC', 'ETH']`, previously sent as `BTC,ETH`) or another
  non-primitive now get a `GlassnodeInputError` instead of a stringified value (pass a
  comma-joined string instead), and `undefined` values are dropped rather than sent. A literal
  `{ api_key: '…' }` in `params` is now a compile error as well as the existing runtime
  rejection. Minor bump: widened parameter types and new exports.

## 0.17.1

- Fixed stale advice in the HTTP 402 `GlassnodeApiError` message. It told callers to check that
  the price was within `maxPaymentPerCall`, but `createX402Fetch()` now rejects an over-ceiling
  price with `GlassnodePaymentError` before any paid request, so that case never surfaces as a 402. The message now names the two causes a 402 can still have — the fetch is not x402-capable
  (use `createX402Fetch` from `glassnode-api/x402`), or the server refused the payment (e.g.
  insufficient USDC on Base) — and points to `GlassnodePaymentError` for the price ceiling. Only
  the message text changes; `status`, `detail` and retry behavior are unchanged.

## 0.17.0

- **New:** `apiKeyLocation` config option (`'query'` | `'header'`, default `'query'`). With
  `'header'`, the API key is sent as the `X-Api-Key` request header instead of the `api_key` query
  parameter, so it no longer appears in request URLs (custom `fetch`, tracing, proxies, access
  logs, transport errors that quote the URL). A custom `fetch` is then called as
  `fetch(url, { headers: { 'X-Api-Key': key } })`, merged with `signal` when `timeout` is set; no
  header is sent when there is no `apiKey` (e.g. `x402` mode). The fetch from `createX402Fetch()`
  forwards the header.
- `'header'` is opt-in, not the default, because it breaks browsers: the Glassnode API's CORS
  preflight (`Access-Control-Allow-Headers`) does not allow `X-Api-Key`.
- Transport error messages now also mask a raw occurrence of the configured key (not only an
  `api_key=` query value).
- Not observable for existing callers: with the default, URLs and the single-argument `fetch` call
  are unchanged. Minor bump: new config option.

## 0.16.0

- **New:** `GlassnodePaymentError` (extends `GlassnodeError`, exported from the package entry).
  The fetch returned by `createX402Fetch()` now rejects with it when the x402 payment layer fails
  before a paid response is obtained — the server's price is above `maxPaymentPerCall` (or x402's
  own spend controls), the signer throws, or the `402` carries no usable payment requirements. The
  message is x402's own (with any `api_key=` value redacted) and x402's error is on `.cause`.
- **Behavior change (observable for callers using x402):** these payment failures used to surface
  as `GlassnodeNetworkError` and were retried when `maxRetries` > 0 (each retry repeating the
  unpaid request and failing again). They are now a `GlassnodePaymentError` and are **never
  retried**. Code catching `GlassnodeNetworkError` for them must catch `GlassnodePaymentError`
  (or the `GlassnodeError` base) instead. Unchanged: a transport failure of the underlying fetch is
  still a retried `GlassnodeNetworkError`, and a `402` returned after payment is still a
  `GlassnodeApiError` (status 402).
- **Behavior change (observable):** `request()` now rethrows any `GlassnodeError` a custom
  `fetch` rejects with unchanged and does not retry it; previously it was wrapped in a
  `GlassnodeNetworkError` (message prefixed `Glassnode API error:`) and retried.
- **Behavior change (observable):** the x402 setup helpers now throw library errors instead of
  plain `Error`: an invalid USDC amount is a `GlassnodeInputError` (`argument: 'maxPaymentPerCall'`
  from `createX402Fetch()`, `'value'` from `usdcDecimalToAtomic()`), and missing optional peer
  dependencies are a `GlassnodeConfigError`. Messages are unchanged and both still extend `Error`.
- Minor bump: new export plus changed error classes (the project is 0.x).

## 0.15.0

- **Behavior change (observable for callers):** `getMetricMetadata()` and `getMetricStats()` now
  apply the same JSON-only `f` rule as `callMetric()`/`callBulkMetric()`. Passing `f` other than
  `json` (case-insensitive; e.g. `{ f: 'csv' }`) rejects with a `GlassnodeInputError`
  (`argument: 'params.f'`) before any request is sent. Previously the request was sent and failed
  later as a `GlassnodeValidationError` or a JSON parse error. An explicit `f: 'json'` is still
  accepted and passed through unchanged. Minor bump: a call that already could not succeed now
  fails earlier and with a different error class.

## 0.14.4

- Documented how timestamps are represented in responses. `MetricMetadata.modified` is the only
  field converted to a `Date`; `MetricMetadata.timerange.min`/`max`, bulk `t` and `callMetric()`
  time-series `t` stay unix seconds as `number`s. Added JSDoc to every time field and a
  "Timestamps" section to the README, including how to convert (`new Date(t * 1000)`).
- Documented and tested that `modified` is `undefined` when the API omits it or sends `0` (`0`
  means "not recorded", not 1970-01-01). No behavior change.

## 0.14.3

- **Fix:** transport failures are classified by the rejection's shape, not `instanceof Error`. A
  `fetch` rejection that is not an `Error` but is named `TimeoutError` (e.g. a DOMException from
  another realm, a polyfill, or a custom `fetch` rejecting with a plain object) is now a
  `GlassnodeNetworkError` with `timedOut: true` and is retried like any other network error;
  one named `AbortError` is retried with `timedOut: false`. Previously both became
  `'Unknown error occurred'` (`timedOut: false`) and were not retried. Other non-`Error`
  rejections (strings, objects without such a `name`) are unchanged: `'Unknown error occurred'`,
  not retried. `Error` rejections keep their message verbatim. The error message now has any
  `api_key=` query value redacted; the original rejection stays on `.cause`.
- CI: the `compat-node18` job now also runs `scripts/smoke-timeout.mjs` (plain Node, no test
  framework) against the built CJS entry, proving a real `AbortSignal.timeout()` abort surfaces as
  `GlassnodeNetworkError` with `timedOut === true` on Node 18. The script is not published.

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
