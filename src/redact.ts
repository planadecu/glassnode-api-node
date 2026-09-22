/** Replacement for a masked API key. */
const MASK = '***';

/**
 * Shortest key that is also masked where it appears *raw* (outside an `api_key=` query value).
 * Masking a raw substring of every error message is only safe for a string long enough not to
 * occur by chance: a 1-3 character key (the config accepts any non-empty string) would mask
 * unrelated words, digits and status codes everywhere and make messages unreadable. Real
 * Glassnode keys are far longer than this, so the floor only affects test/placeholder keys; the
 * `api_key=<value>` form is always masked, whatever the key's length.
 */
export const MIN_RAW_REDACT_LENGTH = 8;

/**
 * Mask every `api_key` query-param value in a string so it never reaches logs or error messages.
 * Matches `api_key=` at a word boundary (so also a bare `api_key=…` echoed without its URL), up
 * to the next `&`, whitespace or quote.
 */
export function redactApiKey(text: string): string {
  return text.replace(/\b(api_key=)[^&\s"']+/gi, `$1${MASK}`);
}

/**
 * The shared redaction for every error text that can come from outside the library (server
 * bodies, status texts, transport errors, x402/signer messages, URLs). Masks every raw
 * occurrence of each given key that is at least {@link MIN_RAW_REDACT_LENGTH} characters long, in
 * its raw and URL-encoded forms, then applies {@link redactApiKey}. Raw masking runs first so a
 * key that contains a space or quote, echoed unencoded after `api_key=`, is masked whole rather
 * than cut at that character. `undefined` and empty keys are ignored.
 */
export function redactSecrets(text: string, keys: ReadonlyArray<string | undefined> = []): string {
  let out = text;
  for (const key of keys) {
    if (!key || key.length < MIN_RAW_REDACT_LENGTH) continue;
    // Raw, percent-encoded (encodeURIComponent) and form-encoded (URLSearchParams, `+` for space)
    // spellings, so a key with special characters is masked however the text quoted it.
    // Longest first, so a form that contains another is masked whole.
    const forms = [
      ...new Set([
        key,
        encodeURIComponent(key),
        new URLSearchParams({ k: key }).toString().slice(2),
      ]),
    ].sort((a, b) => b.length - a.length);
    for (const form of forms) out = out.split(form).join(MASK);
  }
  return redactApiKey(out);
}
