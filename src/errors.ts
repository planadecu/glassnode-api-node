const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Invalid or missing API key',
  402: 'Payment required — if using x402, the payment did not complete (check the wallet holds enough USDC on Base and the price is within maxPaymentPerCall); otherwise pass an x402-capable fetch (see glassnode-api/x402)',
  403: 'Access forbidden — check your API tier',
  404: 'Endpoint or metric not found',
  429: 'Rate limit exceeded',
};

/**
 * Base class for every error raised by this library. Catch this to handle any failure from
 * `GlassnodeAPI`; branch on the subclasses to tell the kinds apart.
 *
 * `name` is set explicitly on each class (rather than from `constructor.name`) so it survives
 * minification of the browser bundle.
 */
export class GlassnodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GlassnodeError';
  }
}

/** The API answered with a non-2xx HTTP status. */
export class GlassnodeApiError extends GlassnodeError {
  readonly status: number;
  readonly statusText: string;
  /** Server-provided error detail parsed from the response body, if any. */
  readonly detail?: string;

  constructor(status: number, statusText: string, detail?: string) {
    const base = STATUS_MESSAGES[status] ?? statusText;
    super(`API request failed (${status}): ${base}${detail ? ` — ${detail}` : ''}`);
    this.name = 'GlassnodeApiError';
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
  }

  /** True for 429 and 5xx — the statuses the client retries (when `maxRetries` > 0). */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/**
 * The request never produced an HTTP response: DNS/connection failure, reset, abort, or the
 * per-request `timeout` firing. The original error is on `.cause`. Retried when `maxRetries` > 0.
 */
export class GlassnodeNetworkError extends GlassnodeError {
  /** True when the failure was the per-request `timeout` (an `AbortSignal.timeout()` abort). */
  readonly timedOut: boolean;

  constructor(message: string, options: { cause?: unknown; timedOut: boolean }) {
    super(message, { cause: options.cause });
    this.name = 'GlassnodeNetworkError';
    this.timedOut = options.timedOut;
  }
}

/**
 * A successful (2xx) response could not be used: the body was not valid JSON, or it did not
 * match the expected schema. The underlying `SyntaxError` / `ZodError` is on `.cause`. Never
 * retried — it is not a transient error.
 */
export class GlassnodeValidationError extends GlassnodeError {
  /** API endpoint path (no host or query string) whose response failed validation. */
  readonly endpoint: string;

  constructor(message: string, options: { cause?: unknown; endpoint: string }) {
    super(message, { cause: options.cause });
    this.name = 'GlassnodeValidationError';
    this.endpoint = options.endpoint;
  }
}

/** The configuration passed to the `GlassnodeAPI` constructor is invalid. The `ZodError` is on `.cause`. */
export class GlassnodeConfigError extends GlassnodeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GlassnodeConfigError';
  }
}

/**
 * An argument passed to a client method is invalid (e.g. a malformed metric path, or a query
 * parameter the client controls itself such as `f` or `api_key`). Raised before any request is
 * sent — no network call is made. Never retried.
 */
export class GlassnodeInputError extends GlassnodeError {
  /** Which argument was rejected: `metricPath`, or `params.<name>` for a query parameter. */
  readonly argument: string;

  constructor(message: string, options: { argument: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'GlassnodeInputError';
    this.argument = options.argument;
  }
}
