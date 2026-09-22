/**
 * Per-call options, accepted as the optional **last** argument of every `GlassnodeAPI` method
 * (e.g. `api.callMetric(path, params, { signal, timeout })`, `api.getMetricList({ signal })`).
 * Validated before any request: an invalid value rejects with a `GlassnodeInputError`
 * (`argument` `options`, `options.signal` or `options.timeout`).
 */
export interface CallOptions {
  /**
   * Cancels the call: the in-flight attempt, any retry wait, and every further retry. The call
   * then rejects with a `GlassnodeAbortError` (never retried) whose `.cause` is the signal's
   * `reason`. An already-aborted signal rejects before any request is sent.
   *
   * For a deadline on the whole call (all attempts and retry waits together), pass
   * `AbortSignal.timeout(ms)` here; `timeout` below applies to each attempt separately.
   *
   * With x402, an abort after a signed payment was sent surfaces as the fetch's
   * `GlassnodePaymentError` (`paymentMayHaveSettled: true`) instead, since the payment may have
   * settled. A custom `fetch` must honor `init.signal` for an in-flight request to be cancelled.
   */
  signal?: AbortSignal;
  /**
   * Per-attempt timeout in ms for this call, overriding the config `timeout` (same semantics:
   * each attempt is aborted after this many ms; the failure is a retryable
   * `GlassnodeNetworkError` with `timedOut: true`). A positive integer up to 2147483647.
   */
  timeout?: number;
}
