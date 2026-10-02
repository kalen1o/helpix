import { importSPKI, jwtVerify, type JWTPayload } from 'jose'
import { AppError } from '@helpix/shared'

export const CUSTOMER_TOKEN_MAX = 4096
export const CUSTOMER_ID_MAX = 200
const MAX_LIFETIME_S = 3600
const CLOCK_TOLERANCE_S = 30

export const invalidCustomerToken = () => new AppError(401, 'invalid_customer_token', 'Invalid or expired customer token')

/**
 * Verifies a shop-signed shopper JWT (4b spec §2): RS256 with the shop's key, `aud` = the tenant's widget key,
 * `sub` 1–200 characters, `iat` and `exp` required and at most an hour apart, 30 s clock tolerance.
 * Every failure is the same 401 so callers learn nothing about which check failed.
 */
export async function verifyCustomerToken(
  token: string,
  opts: { pem: string; audience: string },
): Promise<{ customerId: string; exp: number }> {
  if (typeof token !== 'string' || token.length === 0 || token.length > CUSTOMER_TOKEN_MAX) throw invalidCustomerToken()
  let payload: JWTPayload
  try {
    const key = await importSPKI(opts.pem, 'RS256')
    ;({ payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      audience: opts.audience,
      clockTolerance: CLOCK_TOLERANCE_S,
      requiredClaims: ['iat', 'exp', 'sub'],
    }))
  } catch {
    throw invalidCustomerToken()
  }
  const { sub, iat, exp, aud } = payload
  // jose accepts an array `aud` that merely contains the audience; the binding is that it EQUALS the widget key.
  if (aud !== opts.audience) throw invalidCustomerToken()
  if (typeof sub !== 'string' || sub.length < 1 || sub.length > CUSTOMER_ID_MAX) throw invalidCustomerToken()
  if (typeof iat !== 'number' || typeof exp !== 'number') throw invalidCustomerToken()
  if (exp <= iat || exp - iat > MAX_LIFETIME_S) throw invalidCustomerToken()
  if (iat > Math.floor(Date.now() / 1000) + CLOCK_TOLERANCE_S) throw invalidCustomerToken()
  return { customerId: sub, exp }
}
