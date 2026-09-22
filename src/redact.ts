/** Mask every `api_key` query-param value in a string so it never reaches logs or error messages. */
export function redactApiKey(text: string): string {
  return text.replace(/([?&]api_key=)[^&\s"']+/gi, '$1***');
}
