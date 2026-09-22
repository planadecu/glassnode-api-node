/**
 * Best-effort extraction of a human-readable message from an error response body.
 * Glassnode returns `{ "message": "..." }` (or `{ "error": "..." }`) on failures.
 * Never throws — returns undefined if the body is empty or unreadable.
 */
export async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text.trim()) return undefined;
    try {
      const parsed = JSON.parse(text);
      const message = parsed?.message ?? parsed?.error;
      // Valid JSON: only use a string message/error — never dump the raw JSON (e.g. "null").
      return typeof message === 'string' && message.trim() ? message.trim() : undefined;
    } catch {
      // Non-JSON body — return the raw text.
      return text.trim().slice(0, 300);
    }
  } catch {
    return undefined;
  }
}
