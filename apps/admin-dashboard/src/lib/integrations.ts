import type { OrderLookupStatus } from '@helpix/shared/orders'

// The same limits tenant-auth enforces (4b spec §3.2); checked here so the admin sees the problem before saving.
export const BASE_URL_MAX = 500
export const API_KEY_MIN = 8
export const API_KEY_MAX = 500
export const PUBLIC_KEY_MAX = 10240
export const TEST_CUSTOMER_MAX = 200

/** Why tenant-auth would reject this order API base URL, in plain words; null when it looks fine. */
export function baseUrlProblem(input: string): string | null {
  const value = input.trim()
  if (!value) return 'Enter the base URL of your order API.'
  if (value.length > BASE_URL_MAX) return `The URL is limited to ${BASE_URL_MAX} characters.`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Enter a full URL, like https://shop.example/api.'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use an https:// (or http://) URL.'
  if (url.username || url.password) return "Don't put a username or password in the URL. The API key is sent separately."
  if (url.search || url.hash || /[?#]/.test(value)) return 'Remove the ? query or # part. Helpix adds /orders to this URL itself.'
  return null
}

/** `required` is true until a key is stored; after that an empty field means "keep the stored key". */
export function apiKeyProblem(key: string, required: boolean): string | null {
  if (!key) return required ? 'Enter the API key your shop gave Helpix.' : null
  if (key.length < API_KEY_MIN) return `The API key must be at least ${API_KEY_MIN} characters.`
  if (key.length > API_KEY_MAX) return `The API key is limited to ${API_KEY_MAX} characters.`
  return null
}

/** tenant-auth's words when the base URL moves to another host without a new key. */
export const HOST_CHANGED_KEY_PROBLEM = 'Enter the API key again when changing the order API host.'

/**
 * True when a URL is saved and the typed one has another origin (scheme, host or port). tenant-auth only sends the
 * stored key to the origin it was entered for, so then the key must be entered again.
 */
export function hostChanged(saved: string | null | undefined, typed: string): boolean {
  if (!saved) return false
  try {
    return new URL(saved).origin !== new URL(typed.trim()).origin
  } catch {
    return false
  }
}

/** Client-side sanity check only; tenant-auth parses the key and checks it is RSA ≥ 2048 bits. */
export function publicKeyProblem(pem: string): string | null {
  const value = pem.trim()
  if (!value) return 'Paste or upload the public key.'
  if (/PRIVATE KEY/.test(value)) return 'This is a private key. Keep it on your shop and paste the public key instead.'
  if (value.length > PUBLIC_KEY_MAX) return 'That is too large for a public key (10 KB at most).'
  if (!value.includes('-----BEGIN PUBLIC KEY-----')) return 'Paste a PEM public key that starts with -----BEGIN PUBLIC KEY-----.'
  return null
}

/** The headline above a "Test connection" result; tenant-auth's message gives the detail. */
export const TEST_HEADLINE: Record<OrderLookupStatus, string> = {
  ok: 'Connection works',
  not_found: 'Connected, but the order API answered "not found"',
  misconfigured: 'The shop refused the request',
  unavailable: "Couldn't reach the order API",
  not_configured: 'Save the order API first',
}
