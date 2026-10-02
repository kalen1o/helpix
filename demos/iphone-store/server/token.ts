import { importPKCS8, SignJWT } from 'jose'

export const HELPIX_TOKEN_TTL_S = 3600

let cached: { pem: string; key: ReturnType<typeof importPKCS8> } | null = null

function keyFor(pem: string): ReturnType<typeof importPKCS8> {
  if (cached?.pem !== pem) cached = { pem, key: importPKCS8(pem, 'RS256') }
  return cached.key
}

/**
 * The shopper token Helpix verifies (spec 4b §2): RS256, `sub` = customer ID, `aud` = the tenant's widget key so it
 * cannot be replayed on another Helpix tenant, `exp` one hour after `iat`.
 */
export async function mintHelpixToken(opts: { privateKeyPem: string; customerId: string; widgetKey: string; nowS?: number }): Promise<string> {
  const iat = opts.nowS ?? Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setSubject(opts.customerId)
    .setAudience(opts.widgetKey)
    .setIssuedAt(iat)
    .setExpirationTime(iat + HELPIX_TOKEN_TTL_S)
    .sign(await keyFor(opts.privateKeyPem))
}
