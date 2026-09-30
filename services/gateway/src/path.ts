import { AppError } from '@helpix/shared'

/**
 * Route matching runs on the raw request path, but the upstream URL is built with WHATWG URL parsing, which
 * resolves `.`/`..` segments (including percent-encoded ones). Anything that could be re-interpreted that way
 * is rejected here, so the path that was matched is exactly the path that is forwarded.
 */
const FORBIDDEN_RAW = /\\|%2f|%5c/i

function notFound(): AppError {
  return new AppError(404, 'not_found', 'Route not found')
}

/** True when the pathname equals `prefix`, or sits under it (`prefix` given without a trailing slash). */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * Validates the raw `req.url` against the route prefix it was matched by (e.g. `/auth`, `/me`, `/admin`) and
 * returns the path and query to forward, unchanged. Throws a 404 `not_found` AppError on anything suspicious.
 */
export function canonicalPath(rawUrl: string, routePrefix: string): { pathname: string; search: string } {
  const q = rawUrl.indexOf('?')
  const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q)
  const search = q === -1 ? '' : rawUrl.slice(q)

  if (!pathname.startsWith('/') || FORBIDDEN_RAW.test(pathname)) throw notFound()
  for (const segment of pathname.split('/')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      throw notFound()
    }
    if (decoded === '.' || decoded === '..') throw notFound()
  }
  let parsed: URL
  try {
    parsed = new URL(pathname, 'http://gw')
  } catch {
    throw notFound()
  }
  if (parsed.pathname !== pathname) throw notFound()
  if (!isUnder(pathname, routePrefix) || isUnder(pathname, '/internal')) throw notFound()
  return { pathname, search }
}

/** Builds the upstream URL and re-checks the pathname the HTTP client will actually send. */
export function upstreamUrl(target: string, path: { pathname: string; search: string }, routePrefix: string): string {
  const basePath = new URL(target).pathname.replace(/\/$/, '')
  const url = new URL(target.replace(/\/$/, '') + path.pathname + path.search)
  if (
    url.pathname !== basePath + path.pathname ||
    !isUnder(path.pathname, routePrefix) ||
    isUnder(path.pathname, '/internal')
  ) {
    throw notFound()
  }
  return url.href
}
