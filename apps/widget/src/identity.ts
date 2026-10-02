import { reactive } from 'vue'

/** Who the widget chats as. The token stays in memory only and is never written to storage. */
export interface Identity {
  token: string | null
  /** The token's `sub`, read without verifying it, only to tell shoppers apart. Null for a guest. */
  customerId: string | null
}

export function createIdentity(): Identity {
  return reactive<Identity>({ token: null, customerId: null })
}

const SUB_MAX = 200

/** The `sub` claim of a JWT, base64url-decoded without checking the signature; null when it cannot be read. */
export function customerIdOf(jwt: string): string | null {
  const parts = jwt.split('.')
  const payload = parts[1]
  if (parts.length !== 3 || !payload) return null
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
    const claims: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    const sub = (claims as { sub?: unknown } | null)?.sub
    return typeof sub === 'string' && sub.length >= 1 && sub.length <= SUB_MAX ? sub : null
  } catch {
    return null
  }
}

/**
 * Switches to the shopper in `jwt`, or to a guest for null. A token the widget cannot read is treated as a guest
 * (the gateway would reject it anyway) and warns once, so a shop's broken sign-in never breaks chat.
 */
export function setToken(identity: Identity, jwt: string | null): void {
  const customerId = typeof jwt === 'string' ? customerIdOf(jwt) : null
  if (jwt !== null && customerId === null) {
    console.warn('[helpix] Helpix.identify() needs a customer token from the shop; chatting as a guest')
  }
  // Token first: the chat reacts to customerId and must already see the matching token.
  identity.token = customerId ? jwt : null
  identity.customerId = customerId
}
