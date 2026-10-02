import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'orchard_session'
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60

const mac = (customerId: string, secret: string) => createHmac('sha256', secret).update(customerId).digest('base64url')

/** `<customerId>.<hmac-sha256 b64url>`. Customer IDs never contain a dot. */
export function signSession(customerId: string, secret: string): string {
  return `${customerId}.${mac(customerId, secret)}`
}

/** The customer ID in a valid session value, otherwise null. */
export function readSession(value: string | undefined, secret: string): string | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const customerId = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1))
  const want = Buffer.from(mac(customerId, secret))
  return given.length === want.length && timingSafeEqual(given, want) ? customerId : null
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const raw = part.slice(eq + 1).trim()
    let value = raw
    try {
      value = decodeURIComponent(raw)
    } catch {
      // Keep the raw value.
    }
    out[part.slice(0, eq).trim()] = value
  }
  return out
}

export const sessionCookie = (value: string): string =>
  `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_MAX_AGE_S}; Path=/; HttpOnly; SameSite=Lax`

export const clearedSessionCookie = (): string => `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
