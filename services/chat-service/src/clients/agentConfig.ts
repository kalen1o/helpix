import { AppError, HEADERS, INTERNAL_CALLER_CHAT, TtlCache } from '@helpix/shared'
import type { PublishedAgentConfig } from '@helpix/shared/api-types'

export interface AgentConfigSource {
  /** The live agent config and shop name (spec §3.1 step 3), cached briefly. */
  getPublished(tenantId: string, requestId: string): Promise<PublishedAgentConfig>
}

const unavailable = () => new AppError(503, 'config_unavailable', 'The assistant is unavailable right now')

export function createAgentConfigClient(opts: {
  baseUrl: string
  internalToken: string
  cacheTtlMs: number
  fetch?: typeof fetch
}): AgentConfigSource {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  const cache = new TtlCache<PublishedAgentConfig>(opts.cacheTtlMs)
  return {
    async getPublished(tenantId, requestId) {
      const cached = cache.get(tenantId)
      if (cached) return cached
      let res: Response
      try {
        res = await doFetch(`${opts.baseUrl}/internal/agent-config/${encodeURIComponent(tenantId)}`, {
          headers: {
            [HEADERS.internalToken]: opts.internalToken,
            [HEADERS.internalCaller]: INTERNAL_CALLER_CHAT,
            [HEADERS.requestId]: requestId,
          },
          signal: AbortSignal.timeout(5000),
        })
      } catch {
        throw unavailable()
      }
      const json = (await res.json().catch(() => null)) as (PublishedAgentConfig & { error?: { code?: string } }) | null
      if (res.status === 403 && json?.error?.code === 'tenant_suspended') {
        throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      }
      if (res.status === 404) throw new AppError(404, 'tenant_not_found', 'Unknown shop')
      if (!res.ok || !json?.config) throw unavailable()
      const published: PublishedAgentConfig = { tenantName: json.tenantName, config: json.config }
      cache.set(tenantId, published)
      return published
    },
  }
}
