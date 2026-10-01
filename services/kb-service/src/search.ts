import type { KbSearchResult } from '@helpix/shared/api-types'
import type { KbDeps } from './deps'
import { searchChunks } from './repos/chunks'

/** Tenant-scoped vector search over the current model's chunks, dropping results below `minScore` (spec §4.3). */
export async function search(
  deps: Pick<KbDeps, 'db' | 'embeddings' | 'config'>,
  tenantId: string,
  query: string,
  limit: number,
): Promise<KbSearchResult[]> {
  const [vector] = await deps.embeddings.embed([query])
  const rows = await searchChunks(deps.db, { tenantId, model: deps.embeddings.modelId, vector: vector!, limit })
  return rows.filter((r) => r.score >= deps.config.minScore)
}
