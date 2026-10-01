export interface GatewayConfig {
  port: number
  internalToken: string
  tenantAuthUrl: string
  kbServiceUrl: string
  corsOrigins: string[]
  bodyLimitBytes: number
  /** Body limit for KB uploads (files and pasted text); everything else uses bodyLimitBytes. */
  kbUploadLimitBytes: number
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
  const positiveInt = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`)
    return n
  }
  return {
    port: Number(env.PORT ?? 4000),
    internalToken,
    tenantAuthUrl: required('TENANT_AUTH_URL'),
    kbServiceUrl: required('KB_SERVICE_URL'),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimitBytes: positiveInt('BODY_LIMIT_BYTES', 1_048_576),
    kbUploadLimitBytes: positiveInt('KB_UPLOAD_LIMIT_BYTES', 11 * 1024 * 1024),
    resolveCacheTtlMs: positiveInt('RESOLVE_CACHE_TTL_MS', 30_000),
  }
}
