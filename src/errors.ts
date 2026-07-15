const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Invalid or missing API key',
  402: 'Payment required — if using x402, the payment did not complete (check the wallet holds enough USDC on Base and the price is within maxPaymentPerCall); otherwise pass an x402-capable fetch (see glassnode-api/x402)',
  403: 'Access forbidden — check your API tier',
  404: 'Endpoint or metric not found',
  429: 'Rate limit exceeded',
};

export class GlassnodeApiError extends Error {
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

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}
