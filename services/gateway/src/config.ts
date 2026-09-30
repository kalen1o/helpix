export interface GatewayConfig {
  port: number
  internalToken: string
  tenantAuthUrl: string
  corsOrigins: string[]
  bodyLimitBytes: number
  resolveCacheTtlMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const required = (key: string): string => {
    const v = env[key]
    if (!v) throw new Error(`Missing required env var ${key}`)
    return v
  }
  const internalToken = required('INTERNAL_TOKEN')
  if (internalToken.length < 32) throw new Error('INTERNAL_TOKEN must be at least 32 characters')
  return {
    port: Number(env.PORT ?? 4000),
    internalToken,
    tenantAuthUrl: required('TENANT_AUTH_URL'),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimitBytes: Number(env.BODY_LIMIT_BYTES ?? 1_048_576),
    resolveCacheTtlMs: Number(env.RESOLVE_CACHE_TTL_MS ?? 30_000),
  }
}
