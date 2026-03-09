const STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Invalid or missing API key',
  403: 'Access forbidden — check your API tier',
  404: 'Endpoint or metric not found',
  429: 'Rate limit exceeded',
};

export class GlassnodeApiError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    const detail = STATUS_MESSAGES[status] ?? statusText;
    super(`API request failed (${status}): ${detail}`);
    this.name = 'GlassnodeApiError';
    this.status = status;
    this.statusText = statusText;
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}
