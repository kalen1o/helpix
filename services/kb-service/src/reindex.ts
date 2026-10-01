import type { KbReindexStatus } from '@helpix/shared/api-types'
import type { KbDeps } from './deps'
import { chunksNeedingReindex, countChunks, markDocumentsModel, updateChunkEmbeddings } from './repos/chunks'

export const REINDEX_BATCH = 64

/** At most one re-index per tenant at a time, in this process. Progress itself is read from the database. */
export interface ReindexTracker {
  isRunning(tenantId: string): boolean
  /** Starts `job` unless one is already running for the tenant. */
  start(tenantId: string, job: () => Promise<void>): void
  /** Resolves once no re-index is running. Used by tests. */
  idle(): Promise<void>
}

export function createReindexTracker(onError: (err: unknown) => void): ReindexTracker {
  const running = new Map<string, Promise<void>>()
  return {
    isRunning: (tenantId) => running.has(tenantId),
    start(tenantId, job) {
      if (running.has(tenantId)) return
      const p = job()
        .catch(onError)
        .finally(() => running.delete(tenantId))
      running.set(tenantId, p)
    },
    async idle() {
      await Promise.all([...running.values()])
    },
  }
}

/**
 * Re-embeds the tenant's chunks that are not on the current model, one batch at a time (spec §4.4). Chunks not yet
 * done drop out of search until they are. A failure stops the run; the next run picks up where it stopped.
 */
export async function reindexTenant(
  deps: Pick<KbDeps, 'db' | 'embeddings'>,
  tenantId: string,
  batchSize = REINDEX_BATCH,
): Promise<void> {
  const model = deps.embeddings.modelId
  for (;;) {
    const batch = await chunksNeedingReindex(deps.db, tenantId, model, batchSize)
    if (batch.length === 0) break
    const vectors = await deps.embeddings.embed(batch.map((c) => c.text))
    await updateChunkEmbeddings(deps.db, tenantId, model, batch.map((c, i) => ({ id: c.id, vector: vectors[i]! })))
  }
  await markDocumentsModel(deps.db, tenantId, model)
}

export async function reindexStatus(
  deps: Pick<KbDeps, 'db' | 'embeddings' | 'reindex'>,
  tenantId: string,
): Promise<KbReindexStatus> {
  const { total, done } = await countChunks(deps.db, tenantId, deps.embeddings.modelId)
  return { running: deps.reindex.isRunning(tenantId), total, done, model: deps.embeddings.modelId }
}
