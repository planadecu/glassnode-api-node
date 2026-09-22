import { redactSecrets } from './redact.js';

/** Longest detail kept from a non-JSON (e.g. HTML proxy page) error body. */
export const MAX_RAW_DETAIL_LENGTH = 300;

/**
 * Best-effort extraction of a human-readable message from an error response body, with the API
 * key masked (see `redactSecrets`; `keys` are the raw keys to mask).
 * Glassnode returns `{ "message": "..." }` (or `{ "error": "..." }`) on failures.
 * A non-JSON body is returned as text, cut to {@link MAX_RAW_DETAIL_LENGTH} characters. It is
 * redacted *before* it is cut: cutting first could split a key at the edge and leave its prefix,
 * which no longer matches the full key, unmasked.
 * Never throws — returns undefined if the body is empty or unreadable.
 */
export async function readErrorDetail(
  response: Response,
  keys: ReadonlyArray<string | undefined> = []
): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text.trim()) return undefined;
    try {
      const parsed = JSON.parse(text);
      const message = parsed?.message ?? parsed?.error;
      // Valid JSON: only use a string message/error — never dump the raw JSON (e.g. "null").
      return typeof message === 'string' && message.trim()
        ? redactSecrets(message.trim(), keys)
        : undefined;
    } catch {
      // Non-JSON body — the raw text, redacted, then cut.
      return redactSecrets(text.trim(), keys).slice(0, MAX_RAW_DETAIL_LENGTH);
    }
  } catch {
    return undefined;
  }
}
