/**
 * A query parameter value. Converted to a string before the request is sent:
 *
 * - `string` — sent unchanged.
 * - `number` — its shortest round-trip decimal form (`String(n)`, locale-independent), e.g.
 *   `1609459200`, `0.1`; `-0` is sent as `0`. `NaN`, `±Infinity`, integers outside the safe
 *   range (`|n| > Number.MAX_SAFE_INTEGER`) and values that would print in exponent notation
 *   (e.g. `1e-7`) are rejected — pass such values as a string.
 * - `boolean` — `'true'` / `'false'`.
 * - `Date` — unix **seconds**, floored to the whole second the instant falls in (milliseconds are
 *   dropped; `2021-01-01T00:00:00.999Z` → `1609459200`). An invalid Date is rejected.
 * - `undefined` — the parameter is omitted (as if the key were absent).
 *
 * `null` and any other type (objects, bigints, …) are rejected. Rejections are a
 * `GlassnodeInputError` with `argument` `params.<name>`, raised before any request is sent.
 *
 * To send several values for one parameter, pass an array of these values (see
 * {@link MetricParams}): it is sent as the parameter **repeated**, e.g. `a=BTC&a=ETH`.
 */
export type MetricParamValue = string | number | boolean | Date;

/**
 * A point in time for `s` / `u`: unix **seconds** as a `number` (or its decimal `string`), or a
 * `Date` (converted to unix seconds, floored).
 */
export type MetricTime = number | string | Date;

/**
 * Resolution for `i`. The literals are the common Glassnode intervals (which ones a metric
 * supports varies — see `getMetricMetadata()`); any other string is accepted as well.
 */
// `string & {}` keeps editor autocompletion for the literals while still accepting any string.
export type MetricInterval = '10m' | '1h' | '24h' | '1w' | '1month' | (string & {});

/**
 * Query parameters for `callMetric`, `callBulkMetric`, `getMetricMetadata` and `getMetricStats`.
 * The common Glassnode parameters are typed below; any other parameter a metric documents can be
 * passed too (see {@link MetricParamValue} for how values are converted).
 *
 * **Multiple values:** an array is sent as the parameter repeated once per element, in order —
 * `{ a: ['BTC', 'ETH'] }` → `a=BTC&a=ETH` (Glassnode's form for multi-value filters such as `a`,
 * `e` or `network` on bulk endpoints; a comma-joined string is *not* equivalent). Each element is
 * converted like a single value. An empty array, an `undefined`/`null`/array/object element, and an
 * array for the single-valued `s`, `u`, `i`, `c` or `f` are rejected with a `GlassnodeInputError`.
 *
 * Set by the client and so not accepted here: `api_key` (configure `apiKey`), `f` other than
 * `'json'`, and — in `getMetricMetadata` / `getMetricStats` — `path` (it comes from the
 * `metricPath` argument).
 */
export interface MetricParams {
  /**
   * Asset symbol, e.g. `'BTC'`, `'ETH'` (`'*'` for all assets on bulk endpoints), or several as an
   * array (`['BTC', 'ETH']` → `a=BTC&a=ETH`).
   */
  a?: string | readonly string[];
  /** Since: start of the time range, unix seconds or a `Date`. */
  s?: MetricTime;
  /** Until: end of the time range, unix seconds or a `Date`. */
  u?: MetricTime;
  /** Interval (resolution), e.g. `'1h'`, `'24h'`. */
  i?: MetricInterval;
  /** Currency of the values, e.g. `'native'` or `'usd'` (metric-dependent). */
  c?: string;
  /** Exchange, for exchange-specific metrics, e.g. `'binance'`, or several as an array. */
  e?: string | readonly string[];
  /** Response format. Only `'json'` (case-insensitive) is supported; the client sets it anyway. */
  f?: string;
  /** Not allowed — set `apiKey` in the `GlassnodeAPI` config instead. */
  api_key?: never;
  /**
   * Any other parameter documented for the metric; an array sends it repeated. `undefined` omits
   * it.
   */
  [name: string]: MetricParamValue | readonly MetricParamValue[] | undefined;
}
