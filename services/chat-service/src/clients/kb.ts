import { HEADERS } from '@helpix/shared'
import type { KbSearchResponse, KbSearchResult } from '@helpix/shared/api-types'

export class KbUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KbUnavailableError'
  }
}

export interface KbClient {
  /** Searches `tenantId`'s knowledge base. Throws KbUnavailableError when kb-service cannot answer. */
  search(tenantId: string, query: string, requestId: string): Promise<KbSearchResult[]>
}

export function createKbClient(opts: {
  baseUrl: string
  internalToken: string
  timeoutMs: number
  fetch?: typeof fetch
}): KbClient {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  return {
    async search(tenantId, query, requestId) {
      let res: Response
      try {
        res = await doFetch(`${opts.baseUrl}/kb/search`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [HEADERS.internalToken]: opts.internalToken,
            [HEADERS.tenantId]: tenantId,
            [HEADERS.requestId]: requestId,
          },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(opts.timeoutMs),
        })
      } catch {
        throw new KbUnavailableError('kb-service did not respond')
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        throw new KbUnavailableError(`kb-service returned HTTP ${res.status}`)
      }
      const json = (await res.json().catch(() => null)) as KbSearchResponse | null
      if (!json || !Array.isArray(json.results)) throw new KbUnavailableError('kb-service returned an unexpected response')
      return json.results
    },
  }
}
