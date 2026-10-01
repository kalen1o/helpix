const MAX_TITLE = 200

/** Strips control characters, collapses whitespace and caps the length (in characters, like Postgres). */
export function cleanTitle(raw: string): string {
  const flat = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(flat).slice(0, MAX_TITLE).join('').trim()
}

/** "../../dir/Return Policy.md" → "Return Policy". Browsers may send a full Windows path. */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  return cleanTitle(base.replace(/\.[^.]*$/, '')) || 'Untitled'
}

/** RFC 6266: a plain-ASCII `filename` fallback plus the exact name as RFC 5987 `filename*`. */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_')
    .trim()
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii || 'download'}"; filename*=UTF-8''${encoded}`
}
