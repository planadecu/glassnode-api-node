export class GlassnodeApiError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`API request failed with status ${status}: ${statusText}`);
    this.name = 'GlassnodeApiError';
    this.status = status;
    this.statusText = statusText;
  }
}
