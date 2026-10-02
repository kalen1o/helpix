export interface Config {
  port: number
  databaseUrl: string
  internalToken: string
  adminJwtSecret: string
  accessTtl: string
  refreshTtlDays: number
  /** AES-256-GCM key for stored secrets (order API keys). 32 bytes. */
  secretsMasterKey: Buffer
  /** Lets a shop's order API be http:// or resolve to a private address. Local demos only; false in production. */
  orderApiAllowPrivateHosts: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (key: string): string => {
    const v = env[key]
    if (!v) throw new Error(`Missing required env var ${key}`)
    return v
  }
  const adminJwtSecret = required('ADMIN_JWT_SECRET')
  if (adminJwtSecret.length < 32) throw new Error('ADMIN_JWT_SECRET must be at least 32 characters')
  const internalToken = required('INTERNAL_TOKEN')
  if (internalToken.length < 32) throw new Error('INTERNAL_TOKEN must be at least 32 characters')
  const masterKeyB64 = required('SECRETS_MASTER_KEY').trim()
  const secretsMasterKey = Buffer.from(masterKeyB64, 'base64')
  if (secretsMasterKey.length !== 32 || secretsMasterKey.toString('base64') !== masterKeyB64) {
    throw new Error('SECRETS_MASTER_KEY must be base64 of exactly 32 bytes (generate one with: openssl rand -base64 32)')
  }
  return {
    port: Number(env.PORT ?? 4001),
    databaseUrl: required('DATABASE_URL'),
    internalToken,
    adminJwtSecret,
    accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    secretsMasterKey,
    orderApiAllowPrivateHosts: env.ORDER_API_ALLOW_PRIVATE_HOSTS === 'true',
  }
}
