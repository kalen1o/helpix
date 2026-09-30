/** Lowercase ASCII slug matching the server pattern ^[a-z0-9]+(-[a-z0-9]+)*$, max 50 chars. Strips diacritics (incl. Vietnamese đ). */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
}
