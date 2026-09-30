import { AppError } from '@helpix/shared'

function invalid(input: string): AppError {
  return new AppError(400, 'invalid_origin', `"${input}" is not an origin. Use the form https://shop.example or http://localhost:5174`)
}

/** Returns `scheme://host[:port]`, or null for blank input. Throws 400 invalid_origin for anything else. */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw invalid(trimmed)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid(trimmed)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw invalid(trimmed)
  return url.origin
}

export function normalizeOrigins(list: string[]): string[] {
  const out: string[] = []
  for (const item of list) {
    const origin = normalizeOrigin(item)
    if (origin && !out.includes(origin)) out.push(origin)
  }
  return out
}

export function tryNormalizeOrigin(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    return normalizeOrigin(input)
  } catch {
    return null
  }
}
