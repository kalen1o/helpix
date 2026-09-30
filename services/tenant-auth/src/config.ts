export interface Config {
  port: number
  databaseUrl: string
  internalToken: string
  adminJwtSecret: string
  accessTtl: string
  refreshTtlDays: number
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
  return {
    port: Number(env.PORT ?? 4001),
    databaseUrl: required('DATABASE_URL'),
    internalToken,
    adminJwtSecret,
    accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  }
}
