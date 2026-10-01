import { fileURLToPath } from 'node:url'
import { createEmbeddingProvider } from '@helpix/llm'
import { createPool, migrate } from '@helpix/shared'
import { buildApp } from './app'
import { loadConfig } from './config'
import { createJobRunner } from './jobs'
import { createReindexTracker } from './reindex'
import { sweepStuckDocuments } from './repos/documents'
import { createLocalStorage } from './storage'

const config = loadConfig()
const db = createPool(config.databaseUrl)
const applied = await migrate(db, { schema: 'kb', dir: fileURLToPath(new URL('../migrations', import.meta.url)) })
if (applied.length) console.log(`kb-service: applied migrations ${applied.join(', ')}`)
const swept = await sweepStuckDocuments(db)
if (swept) console.log(`kb-service: marked ${swept} interrupted document(s) as failed`)

const embeddings = createEmbeddingProvider(config.embedding)
console.log(`kb-service: embeddings ${embeddings.modelId}, files in ${config.storageDir}`)

const onError = (err: unknown) => console.error('kb-service: background job failed', err)
const app = await buildApp(
  {
    db,
    config,
    storage: createLocalStorage(config.storageDir),
    embeddings,
    jobs: createJobRunner({ concurrency: config.jobConcurrency, onError }),
    reindex: createReindexTracker(onError),
  },
  { logger: true },
)
await app.listen({ port: config.port, host: '0.0.0.0' })
