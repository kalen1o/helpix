import { createHash, randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import type { ResolvedAdmin } from '@helpix/shared/api-types'

const ISSUER = 'helpix'
const AUDIENCE = 'helpix-admin'

export function createTokenService(secret: string, accessTtl: string) {
  const key = new TextEncoder().encode(secret)
  return {
    signAccess(c: ResolvedAdmin): Promise<string> {
      return new SignJWT({ role: c.role, tid: c.tenantId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(c.adminId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(accessTtl)
        .sign(key)
    },
    async verifyAccess(token: string): Promise<ResolvedAdmin | null> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] })
        const role = payload.role
        if (typeof payload.sub !== 'string' || (role !== 'super_admin' && role !== 'tenant_admin')) return null
        return { adminId: payload.sub, role, tenantId: typeof payload.tid === 'string' ? payload.tid : null }
      } catch {
        return null
      }
    },
  }
}

export type TokenService = ReturnType<typeof createTokenService>

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function newWidgetKey(): string {
  return `wk_${randomBytes(24).toString('base64url')}`
}
