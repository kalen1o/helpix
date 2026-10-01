import type { EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbConfig } from './config'
import type { JobRunner } from './jobs'
import type { ReindexTracker } from './reindex'
import type { FileStorage } from './storage'

export interface KbDeps {
  db: Db
  config: KbConfig
  storage: FileStorage
  embeddings: EmbeddingProvider
  jobs: JobRunner
  reindex: ReindexTracker
}
