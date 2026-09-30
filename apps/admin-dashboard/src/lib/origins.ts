/** Splits the allowed-origins textarea. The server does the real validation and normalization. */
export function parseOriginsInput(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
