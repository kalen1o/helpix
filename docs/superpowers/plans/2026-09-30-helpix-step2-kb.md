# Helpix Step 2 (Knowledge Base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant admins can upload PDF, DOCX, Markdown and TXT files or paste text into a per-tenant knowledge base. Each document is extracted, chunked, embedded and stored in pgvector, can be browsed and previewed in the dashboard, and can be searched (tenant-scoped) and re-indexed.

**Architecture:** A new Fastify service, `services/kb-service`, owns the `kb` Postgres schema (`documents`, `chunks` with `vector(1024)` + HNSW) and the original files, stored on disk behind a `FileStorage` interface. Uploads return immediately. A small in-process job runner then extracts text (unpdf, mammoth), chunks it (~500 tokens, ~50 overlap, breaking at headings and paragraphs) and embeds it through a new `packages/llm` embedding adapter. The adapter supports an OpenAI-compatible HTTP client for GLM `embedding-3` and a deterministic fake for tests and keyless dev. The gateway forwards `/kb/*` for tenant admins, with a larger body limit on uploads only. The dashboard gets a Knowledge base page with upload, a file table, preview and re-index.

**Tech Stack:** Node 22, TypeScript, Fastify 5, `@fastify/multipart` 10, `unpdf` 1.8, `mammoth` 1.13, `pg`, pgvector 0.8 (`pgvector/pgvector:pg16`), Vitest, `pdf-lib` + `docx` (test fixtures only), Vue 3, Tailwind v4, `marked` 18 + `dompurify` 3 (Markdown preview).

**Spec:** `docs/superpowers/specs/2026-09-30-helpix-design.md` (build order step 2). Read sections 2.2, 2.4, 3.6 (embed only), 4 (all), 5 (Knowledge base bullet), 9 and 10 before starting. The step 1 plan (`docs/superpowers/plans/2026-09-30-helpix-step1-foundation.md`) shows the conventions this plan follows.

## Global Constraints

- All services return errors as `{ error: { code, message, requestId } }` using `AppError` and `registerErrorHandler` from `@helpix/shared` (spec §9).
- The tenant comes only from the gateway-supplied `x-tenant-id` header, never from a request body or query (spec §2.4). Every kb query filters by `tenant_id`, and vector search filters by `tenant_id` before ranking.
- One Postgres schema per service: kb-service uses schema `kb` and never reads `tenant_auth` (spec §2.2). There is no cross-schema foreign key to tenants.
- Every kb-service route requires `x-internal-token` (`requireInternalToken`). Document and re-index routes also require role `tenant_admin`. `POST /kb/search` requires only a tenant, because chat-service (step 3) calls it with the internal token and `x-tenant-id`.
- File storage goes through `FileStorage` (`put`, `get`, `delete`), so S3 can replace it later (spec §2.2).
- Accepted uploads: PDF, DOCX, Markdown, TXT and pasted text. Per-file cap 10 MB (`KB_MAX_FILE_BYTES`). Per-tenant document cap 200 (`KB_MAX_DOCUMENTS`) (spec §4.1).
- Chunking targets about 500 tokens with about 50 tokens of overlap, breaking on headings and paragraphs where possible (spec §4.1).
- Embeddings: GLM `embedding-3` at 1024 dimensions by default. The column is `vector(1024)`. kb-service refuses to start with any other `EMBEDDING_DIMENSIONS` (spec §4.4).
- `embedding_model` is stored per chunk, and search only compares vectors whose `embedding_model` equals the current provider's `modelId` (spec §4.4).
- Search returns the top 5 by cosine similarity and drops results below a similarity threshold (`KB_MIN_SCORE`) (spec §4.3).
- The embedding API key is never logged and never appears in error messages.
- **GLM embedding facts (spec §12 open item, verified 2026-09-30 against docs.bigmodel.cn):** `POST https://open.bigmodel.cn/api/paas/v4/embeddings` with `{ model, input: string | string[], dimensions }`, an OpenAI-shaped `data[].embedding` response. `embedding-3` accepts `dimensions` of 256, 512, 1024 or 2048 (default 2048, so always send 1024), at most 64 inputs per request and 3072 tokens per request. The docs are ambiguous about whether the 3072-token limit is per item or per request. This plan batches at no more than 64 items **and** about 3000 estimated tokens per request to be safe. No Zhipu-specific call is needed.
- Postgres is on host port **5433**. Tests use the `helpix_test` database (`TEST_DATABASE_URL`), which already has the `vector` extension (`docker/postgres/init.sql`).
- Frontend: Vue 3 + Tailwind, components from `@helpix/ui`, no component library. Branding per `brand/brand-sheet.html` v1 (Mint is the only accent, Mint 700 `#08705F` for small text and primary buttons).
- Out of scope: chat-service and the agent (step 3), hybrid keyword search, S3 storage, a real job queue, rate limits (step 5).

## Review Focus

1. **A document deleted while its background job is still running.** The job must exit quietly: no chunks left behind, no error logged, and the file deleted. Test: Task 4 (`deleted mid-processing`).
2. **A file whose bytes don't match its name**, such as a `.pdf` that is really text, a `.txt` that is binary or not UTF-8, or a 0-byte file. These must be refused at upload with 415 `unsupported_file_type` or 400 `empty_file`, never accepted and then failed later or crash the job. Test: Task 3 (`detectKind`) and Task 5 (upload route).
3. **A PDF with no extractable text (scanned) or a text file with only whitespace.** The document must end up `failed` with a message that says why, not `ready` with 0 chunks. Test: Task 3 (extract) and Task 4 (pipeline).
4. **Hostile or non-ASCII file names**, such as `../../etc/Return Policy.md` or `báo giá "mới".txt`. The title must be cleaned, the storage key must not be affected, and the download must send a valid `Content-Disposition` with the exact UTF-8 name. Test: Task 5.
5. **The embedding provider failing (429, 5xx, timeout) or returning wrong-sized vectors.** Ingestion must mark the document `failed` with a retryable message and **Retry** must then succeed. Search must return 503 `embedding_unavailable`, not 500. A partial re-index must report accurate progress and resume on the next run. Test: Task 1 (adapter), Task 4, Task 6.

---

## File Structure

```
helpix/
  .env.example  .gitignore  docker-compose.yml  Makefile  README.md   (modified)
  scripts/smoke-step2.mjs                  end-to-end KB check through the gateway
  packages/shared/src/api-types.ts         + KB DTOs (modified)
  packages/llm/                            NEW: provider adapter (embeddings now, chat in step 3)
    src/tokens.ts                          estimateTokens, charTokens
    src/types.ts                           EmbeddingProvider, EmbeddingConfig, EmbeddingError
    src/config.ts                          loadEmbeddingConfig
    src/batch.ts                           batchTexts
    src/openaiCompatible.ts                GLM / OpenAI-compatible /embeddings client with retries
    src/fake.ts                            deterministic bag-of-words embeddings
    src/index.ts                           exports + createEmbeddingProvider
    test/*.test.ts
  packages/ui/src/components/DialogContent.vue   + dialogClass prop (modified)
  services/kb-service/                     NEW
    migrations/001_init.sql                kb.documents, kb.chunks (vector(1024), HNSW)
    src/config.ts                          KbConfig, loadConfig, VECTOR_DIMENSIONS
    src/storage.ts                         FileStorage, createLocalStorage, storageKey
    src/deps.ts                            KbDeps
    src/app.ts                             buildApp
    src/server.ts                          migrate, sweep, listen
    src/jobs.ts                            createJobRunner
    src/lib/names.ts                       cleanTitle, titleFromFilename, contentDisposition
    src/lib/context.ts                     adminTenant, scopedTenant
    src/ingest/chunker.ts                  normalizeText, chunkText
    src/ingest/extract.ts                  detectKind, extractText, KIND_INFO, kindFromMime, ExtractionError
    src/ingest/pipeline.ts                 processDocument
    src/repos/documents.ts                 document queries + toDocumentView + sweepStuckDocuments
    src/repos/chunks.ts                    replaceChunksAndMarkReady, searchChunks, re-index queries
    src/search.ts                          search
    src/reindex.ts                         createReindexTracker, reindexTenant, reindexStatus
    src/routes/documents.ts  src/routes/search.ts  src/routes/reindex.ts
    test/helpers.ts  test/fixtures.ts  test/*.test.ts
  services/gateway/src/{config,app,forward}.ts   /kb/* routing + upload body limit (modified)
  apps/admin-dashboard/
    src/api/client.ts                      + del, upload(FormData), blob (modified)
    src/auth/guard.ts  src/router.ts  src/layouts/AppLayout.vue   (modified)
    src/pages/TenantHomePage.vue           deleted (replaced by the KB page)
    src/pages/KnowledgeBasePage.vue
    src/components/kb/UploadDialog.vue  DocumentPreviewDialog.vue  ReindexCard.vue
    src/lib/kb.ts  src/lib/polling.ts  src/lib/download.ts  src/lib/markdown.ts
    src/styles.css                         + .kb-markdown styles (modified)
    test/*.test.ts
```

---

### Task 1: `packages/llm` embedding adapter

**Files:**
- Create: `packages/llm/package.json`, `packages/llm/tsconfig.json`
- Create: `packages/llm/src/{tokens,types,config,batch,openaiCompatible,fake,index}.ts`
- Test: `packages/llm/test/tokens.test.ts`, `packages/llm/test/batch.test.ts`, `packages/llm/test/config.test.ts`, `packages/llm/test/fake.test.ts`, `packages/llm/test/openaiCompatible.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (import from `@helpix/llm`):
  - `estimateTokens(text: string): number`, `charTokens(ch: string): number`
  - `interface EmbeddingProvider { readonly modelId: string; readonly dimensions: number; embed(texts: string[]): Promise<number[][]> }`
  - `class EmbeddingError extends Error { retryable: boolean }` — `new EmbeddingError(message, retryable)`
  - `interface EmbeddingConfig { provider: 'openai-compatible' | 'fake'; baseUrl: string; apiKey: string; model: string; dimensions: number; batchMaxItems: number; batchMaxTokens: number; timeoutMs: number }`
  - `loadEmbeddingConfig(env?: NodeJS.ProcessEnv): EmbeddingConfig`
  - `batchTexts(texts: string[], maxItems: number, maxTokens: number): string[][]`
  - `createEmbeddingProvider(config: EmbeddingConfig, fetchImpl?: typeof fetch): EmbeddingProvider`
  - `createFakeEmbeddings(config: { model: string; dimensions: number }): EmbeddingProvider` — `modelId` is `fake:<model>:<dimensions>`
  - `createOpenAICompatibleEmbeddings(config: EmbeddingConfig, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>): EmbeddingProvider` — `modelId` is `openai-compatible:<model>:<dimensions>`

- [ ] **Step 1: Create the package**

`packages/llm/package.json`:
```json
{
  "name": "@helpix/llm",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/llm/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

Run: `npm install` (links the new workspace).

- [ ] **Step 2: Write the failing tests**

`packages/llm/test/tokens.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../src/tokens'

describe('estimateTokens', () => {
  it('counts about four Latin characters per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('counts each CJK character as one token', () => {
    expect(estimateTokens('你好')).toBe(2)
    expect(estimateTokens('こんにちは')).toBe(5)
    expect(estimateTokens('hello 你好')).toBe(4) // 6 × 0.25 + 2 = 3.5
  })

  it('treats an astral-plane emoji as one character', () => {
    expect(estimateTokens('😀😀😀😀')).toBe(1)
  })
})
```

`packages/llm/test/batch.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { batchTexts } from '../src/batch'

describe('batchTexts', () => {
  it('splits on the item limit and keeps order', () => {
    const texts = Array.from({ length: 5 }, (_, i) => `t${i}`)
    expect(batchTexts(texts, 2, 1000)).toEqual([['t0', 't1'], ['t2', 't3'], ['t4']])
  })

  it('splits on the token budget', () => {
    const t = 'x'.repeat(400) // 100 tokens
    expect(batchTexts([t, t, t], 64, 250).map((b) => b.length)).toEqual([2, 1])
  })

  it('puts a single over-budget text in its own batch', () => {
    const big = 'x'.repeat(4000) // 1000 tokens
    expect(batchTexts(['a', big, 'b'], 64, 100).map((b) => b.length)).toEqual([1, 1, 1])
  })

  it('returns no batches for no texts', () => {
    expect(batchTexts([], 64, 100)).toEqual([])
  })
})
```

`packages/llm/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loadEmbeddingConfig } from '../src/config'

describe('loadEmbeddingConfig', () => {
  it('defaults to the fake provider at 1024 dimensions', () => {
    expect(loadEmbeddingConfig({})).toMatchObject({ provider: 'fake', model: 'hash', dimensions: 1024, batchMaxItems: 64, batchMaxTokens: 3000 })
  })

  it('defaults the openai-compatible provider to GLM embedding-3', () => {
    const c = loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k' })
    expect(c).toMatchObject({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3', dimensions: 1024 })
  })

  it('strips a trailing slash from the base URL', () => {
    const c = loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k', EMBEDDING_BASE_URL: 'http://x/v1/' })
    expect(c.baseUrl).toBe('http://x/v1')
  })

  it('requires an API key for the openai-compatible provider', () => {
    expect(() => loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'openai-compatible' })).toThrow('EMBEDDING_API_KEY is required')
  })

  it('rejects an unknown provider and non-positive integers', () => {
    expect(() => loadEmbeddingConfig({ EMBEDDING_PROVIDER: 'glm' })).toThrow('EMBEDDING_PROVIDER must be')
    expect(() => loadEmbeddingConfig({ EMBEDDING_DIMENSIONS: '0' })).toThrow('EMBEDDING_DIMENSIONS must be a positive integer')
    expect(() => loadEmbeddingConfig({ EMBEDDING_BATCH_MAX_ITEMS: 'ten' })).toThrow('EMBEDDING_BATCH_MAX_ITEMS must be a positive integer')
  })
})
```

`packages/llm/test/fake.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../src/fake'

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0)
const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })

describe('fake embeddings', () => {
  it('names its vector space', () => {
    expect(fake.modelId).toBe('fake:hash:1024')
  })

  it('is deterministic and unit length', async () => {
    const [a, b] = await fake.embed(['Refunds within 30 days', 'Refunds within 30 days'])
    expect(a).toEqual(b)
    expect(a).toHaveLength(1024)
    expect(Math.abs(cosine(a!, a!) - 1)).toBeLessThan(1e-9)
  })

  it('scores texts that share words above unrelated texts', async () => {
    const [q, related, unrelated] = await fake.embed([
      'refund window',
      'Our refund window is 30 days from delivery.',
      'We ship phones in recyclable boxes.',
    ])
    expect(cosine(q!, related!)).toBeGreaterThan(cosine(q!, unrelated!))
    expect(cosine(q!, related!)).toBeGreaterThan(0.2)
  })

  it('never returns a zero vector, even for empty text', async () => {
    const [v] = await fake.embed([''])
    expect(v!.some((x) => x !== 0)).toBe(true)
  })

  it('tokenises CJK per character', async () => {
    const [q, doc] = await fake.embed(['退货', '我们的退货政策是三十天'])
    expect(cosine(q!, doc!)).toBeGreaterThan(0)
  })
})
```

`packages/llm/test/openaiCompatible.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleEmbeddings } from '../src/openaiCompatible'
import { EmbeddingError, type EmbeddingConfig } from '../src/types'

const CONFIG: EmbeddingConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://llm.test/v4',
  apiKey: 'sk-secret-key',
  model: 'embedding-3',
  dimensions: 4,
  batchMaxItems: 64,
  batchMaxTokens: 3000,
  timeoutMs: 1000,
}

const vec = (n: number) => [n, 0, 0, 0]

/** Replies to each call with the given status, or 200 with one vector per input (in reverse index order). */
function fakeFetch(statuses: number[] = []) {
  const calls: { url: string; init: RequestInit; body: any }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body))
    calls.push({ url: String(url), init, body })
    const status = statuses[calls.length - 1] ?? 200
    if (status !== 200) return new Response('{"error":"nope"}', { status })
    const data = (body.input as string[]).map((_, i) => ({ index: i, object: 'embedding', embedding: vec(i) })).reverse()
    return Response.json({ model: body.model, object: 'list', data })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const noSleep = async () => {}

describe('openai-compatible embeddings', () => {
  it('posts model, input and dimensions with a bearer key and returns vectors in input order', async () => {
    const { fetch, calls } = fakeFetch()
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep)
    expect(p.modelId).toBe('openai-compatible:embedding-3:4')
    expect(await p.embed(['a', 'b', 'c'])).toEqual([vec(0), vec(1), vec(2)])
    expect(calls[0]!.url).toBe('http://llm.test/v4/embeddings')
    expect(calls[0]!.body).toEqual({ model: 'embedding-3', input: ['a', 'b', 'c'], dimensions: 4 })
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer sk-secret-key')
  })

  it('splits into batches of at most batchMaxItems', async () => {
    const { fetch, calls } = fakeFetch()
    const p = createOpenAICompatibleEmbeddings({ ...CONFIG, batchMaxItems: 64 }, fetch, noSleep)
    const out = await p.embed(Array.from({ length: 70 }, (_, i) => `t${i}`))
    expect(out).toHaveLength(70)
    expect(calls.map((c) => c.body.input.length)).toEqual([64, 6])
  })

  it('retries 429 and 5xx, then succeeds', async () => {
    const { fetch, calls } = fakeFetch([429, 503])
    const sleep = vi.fn(noSleep)
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, sleep)
    expect(await p.embed(['a'])).toEqual([vec(0)])
    expect(calls).toHaveLength(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after three attempts with a retryable EmbeddingError', async () => {
    const { fetch, calls } = fakeFetch([500, 500, 500])
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep)
    const err = await p.embed(['a']).catch((e) => e)
    expect(err).toBeInstanceOf(EmbeddingError)
    expect(err.retryable).toBe(true)
    expect(calls).toHaveLength(3)
  })

  it('does not retry a 400 and never puts the API key in the error', async () => {
    const { fetch, calls } = fakeFetch([400])
    const p = createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep)
    const err = await p.embed(['a']).catch((e) => e)
    expect(err).toMatchObject({ retryable: false })
    expect(err.message).toContain('400')
    expect(err.message).not.toContain('sk-secret-key')
    expect(calls).toHaveLength(1)
  })

  it('treats a network failure as retryable', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof globalThis.fetch
    const err = await createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep).embed(['a']).catch((e) => e)
    expect(err).toMatchObject({ name: 'EmbeddingError', retryable: true })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects vectors of the wrong dimension or count', async () => {
    const wrongDims = vi.fn(async () => Response.json({ data: [{ index: 0, embedding: [1, 2] }] })) as unknown as typeof globalThis.fetch
    await expect(createOpenAICompatibleEmbeddings(CONFIG, wrongDims, noSleep).embed(['a'])).rejects.toThrow('not 4-dimensional')
    const wrongCount = vi.fn(async () => Response.json({ data: [] })) as unknown as typeof globalThis.fetch
    await expect(createOpenAICompatibleEmbeddings(CONFIG, wrongCount, noSleep).embed(['a'])).rejects.toThrow('unexpected response')
  })

  it('makes no request for no texts', async () => {
    const { fetch, calls } = fakeFetch()
    expect(await createOpenAICompatibleEmbeddings(CONFIG, fetch, noSleep).embed([])).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w packages/llm`
Expected: FAIL with "Failed to resolve import" for `../src/tokens` and the other source files.

- [ ] **Step 4: Implement**

`packages/llm/src/tokens.ts`:
```ts
// A rough token estimate without shipping a tokenizer. CJK characters are about one token each; other text averages
// about four characters per token. Callers use it to stay under provider limits, so rounding up is deliberate.
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export function charTokens(ch: string): number {
  return WIDE.test(ch) ? 1 : 0.25
}

export function estimateTokens(text: string): number {
  let n = 0
  for (const ch of text) n += charTokens(ch)
  return Math.ceil(n)
}
```

`packages/llm/src/types.ts`:
```ts
export interface EmbeddingProvider {
  /** Names the vector space, e.g. `openai-compatible:embedding-3:1024`. Vectors with different ids are not comparable. */
  readonly modelId: string
  readonly dimensions: number
  /** One vector per input text, in input order. */
  embed(texts: string[]): Promise<number[][]>
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

export interface EmbeddingConfig {
  provider: 'openai-compatible' | 'fake'
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
  batchMaxItems: number
  batchMaxTokens: number
  timeoutMs: number
}
```

`packages/llm/src/config.ts`:
```ts
import type { EmbeddingConfig } from './types'

export function loadEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const provider = env.EMBEDDING_PROVIDER ?? 'fake'
  if (provider !== 'openai-compatible' && provider !== 'fake') {
    throw new Error(`EMBEDDING_PROVIDER must be "openai-compatible" or "fake", got "${provider}"`)
  }
  const apiKey = env.EMBEDDING_API_KEY ?? ''
  if (provider === 'openai-compatible' && !apiKey) {
    throw new Error('EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=openai-compatible')
  }
  const int = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`)
    return n
  }
  return {
    provider,
    baseUrl: (env.EMBEDDING_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    apiKey,
    model: env.EMBEDDING_MODEL ?? (provider === 'fake' ? 'hash' : 'embedding-3'),
    dimensions: int('EMBEDDING_DIMENSIONS', 1024),
    // GLM embedding-3: at most 64 inputs and 3072 tokens per request.
    batchMaxItems: int('EMBEDDING_BATCH_MAX_ITEMS', 64),
    batchMaxTokens: int('EMBEDDING_BATCH_MAX_TOKENS', 3000),
    timeoutMs: int('EMBEDDING_TIMEOUT_MS', 30_000),
  }
}
```

`packages/llm/src/batch.ts`:
```ts
import { estimateTokens } from './tokens'

/** Groups texts into batches under both limits, keeping order. A single text over the token budget gets its own batch. */
export function batchTexts(texts: string[], maxItems: number, maxTokens: number): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let tokens = 0
  for (const text of texts) {
    const t = estimateTokens(text)
    if (current.length > 0 && (current.length >= maxItems || tokens + t > maxTokens)) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push(text)
    tokens += t
  }
  if (current.length > 0) batches.push(current)
  return batches
}
```

`packages/llm/src/openaiCompatible.ts`:
```ts
import { batchTexts } from './batch'
import { EmbeddingError, type EmbeddingConfig, type EmbeddingProvider } from './types'

const RETRY_DELAYS_MS = [500, 2000]

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `POST {baseUrl}/embeddings` in the OpenAI shape, which GLM (Zhipu) also serves. */
export function createOpenAICompatibleEmbeddings(
  config: EmbeddingConfig,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
  sleep: (ms: number) => Promise<void> = defaultSleep,
): EmbeddingProvider {
  async function once(input: string[]): Promise<number[][]> {
    let res: Response
    try {
      res = await fetchImpl(`${config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, input, dimensions: config.dimensions }),
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch {
      throw new EmbeddingError('Embedding service did not respond', true)
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new EmbeddingError(`Embedding service returned HTTP ${res.status}`, res.status === 429 || res.status >= 500)
    }
    const json = (await res.json().catch(() => null)) as { data?: { index: number; embedding: number[] }[] } | null
    const data = json?.data
    if (!Array.isArray(data) || data.length !== input.length) {
      throw new EmbeddingError('Embedding service returned an unexpected response', false)
    }
    const vectors = [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    if (vectors.some((v) => !Array.isArray(v) || v.length !== config.dimensions)) {
      throw new EmbeddingError(`Embedding service returned vectors that are not ${config.dimensions}-dimensional`, false)
    }
    return vectors
  }

  async function withRetry(input: string[]): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(input)
      } catch (e) {
        if (!(e instanceof EmbeddingError) || !e.retryable || attempt >= RETRY_DELAYS_MS.length) throw e
        await sleep(RETRY_DELAYS_MS[attempt]!)
      }
    }
  }

  return {
    modelId: `openai-compatible:${config.model}:${config.dimensions}`,
    dimensions: config.dimensions,
    async embed(texts) {
      const out: number[][] = []
      for (const batch of batchTexts(texts, config.batchMaxItems, config.batchMaxTokens)) {
        out.push(...(await withRetry(batch)))
      }
      return out
    },
  }
}
```

`packages/llm/src/fake.ts`:
```ts
import type { EmbeddingProvider } from './types'

// Deterministic bag-of-words vectors for tests and keyless local development. Texts that share words get a higher
// cosine similarity, which is enough to exercise upload → search end to end. Not for production.
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function fakeVector(text: string, dimensions: number): number[] {
  const v = new Array<number>(dimensions).fill(0)
  for (const token of text.toLowerCase().match(TOKEN) ?? []) {
    const h = fnv1a(token)
    const i = h % dimensions
    v[i] = v[i]! + (h & 0x80000000 ? -1 : 1)
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  if (norm === 0) {
    // pgvector cannot compute a cosine distance for a zero vector.
    v[0] = 1
    return v
  }
  return v.map((x) => x / norm)
}

export function createFakeEmbeddings(config: { model: string; dimensions: number }): EmbeddingProvider {
  return {
    modelId: `fake:${config.model}:${config.dimensions}`,
    dimensions: config.dimensions,
    embed: async (texts) => texts.map((t) => fakeVector(t, config.dimensions)),
  }
}
```

`packages/llm/src/index.ts`:
```ts
import { createFakeEmbeddings } from './fake'
import { createOpenAICompatibleEmbeddings } from './openaiCompatible'
import type { EmbeddingConfig, EmbeddingProvider } from './types'

export * from './types'
export * from './tokens'
export { batchTexts } from './batch'
export { loadEmbeddingConfig } from './config'
export { createFakeEmbeddings } from './fake'
export { createOpenAICompatibleEmbeddings } from './openaiCompatible'

export function createEmbeddingProvider(config: EmbeddingConfig, fetchImpl?: typeof fetch): EmbeddingProvider {
  return config.provider === 'fake' ? createFakeEmbeddings(config) : createOpenAICompatibleEmbeddings(config, fetchImpl)
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -w packages/llm && npm run typecheck -w packages/llm`
Expected: all PASS, no type errors. If the fake "scores texts that share words" assertion `> 0.2` fails, check the tokeniser first. The query has two tokens and both occur in the related sentence, so the cosine should be about 0.5.

- [ ] **Step 6: Commit**

```bash
git add packages/llm package-lock.json
git commit -m "feat(llm): embedding provider adapter with GLM/OpenAI-compatible client and deterministic fake"
```

---

### Task 2: kb-service scaffold: config, schema, storage, app shell, shared KB types

**Files:**
- Modify: `packages/shared/src/api-types.ts` (append KB types)
- Create: `services/kb-service/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `services/kb-service/migrations/001_init.sql`
- Create: `services/kb-service/src/{config,storage,deps,app}.ts`
- Test: `services/kb-service/test/helpers.ts`, `test/config.test.ts`, `test/storage.test.ts`, `test/schema.test.ts`, `test/app.test.ts`

**Interfaces:**
- Consumes: `EmbeddingConfig`, `EmbeddingProvider`, `loadEmbeddingConfig`, `createFakeEmbeddings` (Task 1); `createPool`, `migrate`, `Db`, `HEADERS`, `registerErrorHandler`, `requireInternalToken` (`@helpix/shared`).
- Produces:
  - `@helpix/shared/api-types`: `DocumentStatus`, `KbDocumentView`, `KbSearchResult`, `KbSearchResponse`, `KbReindexStatus`, `KbDocumentText`
  - `VECTOR_DIMENSIONS = 1024`; `interface KbConfig`; `loadConfig(env?): KbConfig` (`src/config.ts`)
  - `interface FileStorage { put(key, data: Buffer): Promise<void>; get(key): Promise<Buffer | null>; delete(key): Promise<void> }`, `createLocalStorage(root: string): FileStorage`, `storageKey(tenantId: string, documentId: string): string` (`src/storage.ts`)
  - `interface KbDeps { db: Db; config: KbConfig; storage: FileStorage; embeddings: EmbeddingProvider }` (`src/deps.ts`; Tasks 4 and 6 add fields)
  - `buildApp(deps: KbDeps, opts?: { logger?: boolean }): Promise<FastifyInstance>` (`src/app.ts`)
  - Test helpers: `TEST_CONFIG`, `TENANT_A`, `TENANT_B`, `setupTestDb()`, `resetDb(db)`, `tempDir()`, `makeDeps(db, storageDir, overrides?)`, `internalHeaders()`, `tenantHeaders(tenantId)`, `serviceHeaders(tenantId)`

- [ ] **Step 1: Add the KB API types**

Append to `packages/shared/src/api-types.ts`:
```ts
export type DocumentStatus = 'processing' | 'ready' | 'failed'

export interface KbDocumentView {
  id: string
  title: string
  mimeType: string
  sizeBytes: number
  status: DocumentStatus
  /** Why processing failed; null unless status is 'failed'. */
  error: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface KbDocumentText {
  text: string
}

export interface KbSearchResult {
  documentId: string
  title: string
  position: number
  text: string
  /** Cosine similarity, higher is closer. */
  score: number
}

export interface KbSearchResponse {
  results: KbSearchResult[]
}

export interface KbReindexStatus {
  running: boolean
  /** All of the tenant's chunks. */
  total: number
  /** Chunks already embedded with the current model. */
  done: number
  /** The current embedding model id. */
  model: string
}
```

- [ ] **Step 2: Create the package**

`services/kb-service/package.json`:
```json
{
  "name": "@helpix/kb-service",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@helpix/llm": "*",
    "@helpix/shared": "*",
    "fastify": "^5.12.5",
    "pg": "^8.23.0",
    "tsx": "^4.23.15"
  },
  "devDependencies": {
    "@types/pg": "^8.23.1"
  }
}
```

`services/kb-service/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`services/kb-service/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { fileParallelism: false },
})
```

Run: `npm install`

- [ ] **Step 3: Write the migration**

`services/kb-service/migrations/001_init.sql`:
```sql
-- init.sql already creates it; kept here so a fresh database without init.sql still works.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE kb.documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error text,
  extracted_text text,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Target of the chunks foreign key, so a chunk's tenant must equal its document's tenant.
  UNIQUE (id, tenant_id)
);
CREATE INDEX documents_tenant_created_idx ON kb.documents (tenant_id, created_at DESC);

CREATE TABLE kb.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  text text NOT NULL,
  embedding vector(1024) NOT NULL,
  embedding_model text NOT NULL,
  FOREIGN KEY (document_id, tenant_id) REFERENCES kb.documents (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (document_id, position)
);
CREATE INDEX chunks_tenant_model_idx ON kb.chunks (tenant_id, embedding_model);
CREATE INDEX chunks_embedding_hnsw_idx ON kb.chunks USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 4: Write the test helpers and failing tests**

`services/kb-service/test/helpers.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeEmbeddings } from '@helpix/llm'
import { createPool, HEADERS, migrate, type Db } from '@helpix/shared'
import { TEST_DATABASE_URL } from '@helpix/shared/testing'
import type { KbConfig } from '../src/config'
import type { KbDeps } from '../src/deps'
import { createLocalStorage } from '../src/storage'

export const TENANT_A = '00000000-0000-4000-8000-00000000000a'
export const TENANT_B = '00000000-0000-4000-8000-00000000000b'

export const TEST_CONFIG: KbConfig = {
  port: 0,
  databaseUrl: TEST_DATABASE_URL,
  internalToken: 'kb-service-test-internal-token-0123456789',
  storageDir: '',
  maxFileBytes: 64 * 1024,
  maxDocumentsPerTenant: 5,
  searchTopK: 5,
  minScore: 0.05,
  jobConcurrency: 1,
  embedding: {
    provider: 'fake',
    baseUrl: '',
    apiKey: '',
    model: 'hash',
    dimensions: 1024,
    batchMaxItems: 64,
    batchMaxTokens: 3000,
    timeoutMs: 1000,
  },
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export async function setupTestDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL)
  await migrate(db, { schema: 'kb', dir: MIGRATIONS_DIR })
  return db
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('TRUNCATE kb.chunks, kb.documents')
}

export function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'helpix-kb-'))
}

export function makeDeps(db: Db, storageDir: string, overrides: Partial<KbDeps> = {}): KbDeps {
  return {
    db,
    config: { ...TEST_CONFIG, storageDir },
    storage: createLocalStorage(storageDir),
    embeddings: createFakeEmbeddings({ model: 'hash', dimensions: 1024 }),
    ...overrides,
  }
}

export function internalHeaders(): Record<string, string> {
  return { [HEADERS.internalToken]: TEST_CONFIG.internalToken }
}

/** What the gateway sends for a tenant admin. */
export function tenantHeaders(tenantId: string): Record<string, string> {
  return {
    ...internalHeaders(),
    [HEADERS.role]: 'tenant_admin',
    [HEADERS.adminId]: randomUUID(),
    [HEADERS.tenantId]: tenantId,
  }
}

/** What chat-service (step 3) sends: the internal token and a tenant, no admin. */
export function serviceHeaders(tenantId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.tenantId]: tenantId }
}
```

`services/kb-service/test/config.test.ts`:
```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const ENV = { DATABASE_URL: 'postgres://x/y', INTERNAL_TOKEN: 'i'.repeat(32) }

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(ENV)
    expect(c).toMatchObject({
      port: 4002,
      maxFileBytes: 10 * 1024 * 1024,
      maxDocumentsPerTenant: 200,
      searchTopK: 5,
      jobConcurrency: 2,
      embedding: { provider: 'fake', dimensions: 1024 },
    })
    expect(c.storageDir.endsWith(path.join('.data', 'kb'))).toBe(true)
  })

  it('uses a lower default similarity threshold for the fake provider', () => {
    expect(loadConfig(ENV).minScore).toBe(0.05)
    expect(loadConfig({ ...ENV, EMBEDDING_PROVIDER: 'openai-compatible', EMBEDDING_API_KEY: 'k' }).minScore).toBe(0.3)
    expect(loadConfig({ ...ENV, KB_MIN_SCORE: '0.5' }).minScore).toBe(0.5)
  })

  it('refuses an embedding dimension other than 1024', () => {
    expect(() => loadConfig({ ...ENV, EMBEDDING_DIMENSIONS: '2048' })).toThrow('EMBEDDING_DIMENSIONS must be 1024')
  })

  it('validates required values', () => {
    expect(() => loadConfig({ ...ENV, DATABASE_URL: undefined })).toThrow('Missing required env var DATABASE_URL')
    expect(() => loadConfig({ ...ENV, INTERNAL_TOKEN: 'short' })).toThrow('INTERNAL_TOKEN must be at least 32 characters')
    expect(() => loadConfig({ ...ENV, KB_MIN_SCORE: '2' })).toThrow('KB_MIN_SCORE must be between -1 and 1')
    expect(() => loadConfig({ ...ENV, KB_MAX_FILE_BYTES: '-5' })).toThrow('KB_MAX_FILE_BYTES must be a positive integer')
  })

  it('resolves KB_STORAGE_DIR to an absolute path', () => {
    expect(loadConfig({ ...ENV, KB_STORAGE_DIR: '/data/kb' }).storageDir).toBe('/data/kb')
    expect(path.isAbsolute(loadConfig({ ...ENV, KB_STORAGE_DIR: 'rel/kb' }).storageDir)).toBe(true)
  })
})
```

`services/kb-service/test/storage.test.ts`:
```ts
import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createLocalStorage, storageKey } from '../src/storage'
import { TENANT_A, tempDir } from './helpers'

const DOC = '11111111-1111-4111-8111-111111111111'

describe('local file storage', () => {
  it('round-trips bytes and deletes them', async () => {
    const storage = createLocalStorage(await tempDir())
    const key = storageKey(TENANT_A, DOC)
    await storage.put(key, Buffer.from('hello'))
    expect((await storage.get(key))!.toString()).toBe('hello')
    await storage.delete(key)
    expect(await storage.get(key)).toBeNull()
  })

  it('treats deleting a missing file as success', async () => {
    const storage = createLocalStorage(await tempDir())
    await expect(storage.delete(storageKey(TENANT_A, DOC))).resolves.toBeUndefined()
  })

  it('leaves no temp files behind', async () => {
    const root = await tempDir()
    await createLocalStorage(root).put(storageKey(TENANT_A, DOC), Buffer.from('x'))
    expect(await readdir(`${root}/${TENANT_A}`)).toEqual([DOC])
  })

  it('refuses keys that could escape the root', async () => {
    const storage = createLocalStorage(await tempDir())
    for (const key of ['../x', `${TENANT_A}/../../etc/passwd`, '/etc/passwd', `${TENANT_A}/${DOC}/x`]) {
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key')
    }
  })
})
```

`services/kb-service/test/schema.test.ts`:
```ts
import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, setupTestDb, TENANT_A, TENANT_B } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const DOC = '22222222-2222-4222-8222-222222222222'
const vector = (n = 1024) => `[${Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`

async function insertDoc() {
  await db.query(
    `INSERT INTO kb.documents (id, tenant_id, title, storage_key, mime_type, size_bytes) VALUES ($1, $2, 'T', 'k', 'text/plain', 1)`,
    [DOC, TENANT_A],
  )
}

describe('kb schema', () => {
  it("refuses a chunk whose tenant differs from its document's tenant", async () => {
    await insertDoc()
    await expect(
      db.query(
        `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model) VALUES ($1, $2, 0, 't', $3::vector, 'm')`,
        [TENANT_B, DOC, vector()],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('refuses a vector of the wrong dimension', async () => {
    await insertDoc()
    await expect(
      db.query(
        `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model) VALUES ($1, $2, 0, 't', $3::vector, 'm')`,
        [TENANT_A, DOC, vector(3)],
      ),
    ).rejects.toThrow(/expected 1024 dimensions/)
  })

  it('deletes chunks with their document', async () => {
    await insertDoc()
    await db.query(
      `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model) VALUES ($1, $2, 0, 't', $3::vector, 'm')`,
      [TENANT_A, DOC, vector()],
    )
    await db.query('DELETE FROM kb.documents WHERE id = $1', [DOC])
    expect((await db.query('SELECT count(*)::int AS n FROM kb.chunks')).rows[0].n).toBe(0)
  })
})
```

`services/kb-service/test/app.test.ts`:
```ts
import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { internalHeaders, makeDeps, setupTestDb, tempDir } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })

describe('kb-service app', () => {
  it('requires the internal token on every route', async () => {
    const app = await buildApp(makeDeps(db, await tempDir()))
    const res = await app.inject({ method: 'GET', url: '/kb/health' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
    expect((await app.inject({ method: 'GET', url: '/kb/health', headers: internalHeaders() })).json()).toEqual({ ok: true })
    await app.close()
  })

  it('echoes the gateway request id in errors', async () => {
    const app = await buildApp(makeDeps(db, await tempDir()))
    const res = await app.inject({ method: 'GET', url: '/kb/nope', headers: { ...internalHeaders(), 'x-request-id': 'req-123' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.requestId).toBe('req-123')
    await app.close()
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `make db && npm test -w services/kb-service`
Expected: FAIL. The imports of `../src/config`, `../src/storage`, `../src/deps` and `../src/app` do not resolve.

- [ ] **Step 6: Implement**

`services/kb-service/src/config.ts`:
```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEmbeddingConfig, type EmbeddingConfig } from '@helpix/llm'

/** The pgvector column is vector(1024). Another dimension needs a migration (spec §4.4), so it is refused at startup. */
export const VECTOR_DIMENSIONS = 1024

export interface KbConfig {
  port: number
  databaseUrl: string
  internalToken: string
  storageDir: string
  maxFileBytes: number
  maxDocumentsPerTenant: number
  searchTopK: number
  /** Results with a cosine similarity below this are dropped. */
  minScore: number
  jobConcurrency: number
  embedding: EmbeddingConfig
}

// <repo>/.data/kb, so `make dev` works without extra settings. Docker sets KB_STORAGE_DIR to a volume.
const DEFAULT_STORAGE_DIR = fileURLToPath(new URL('../../../.data/kb', import.meta.url))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KbConfig {
  const required = (key: string): string => {
    const v = env[key]
    if (!v) throw new Error(`Missing required env var ${key}`)
    return v
  }
  const int = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`)
    return n
  }
  const internalToken = required('INTERNAL_TOKEN')
  if (internalToken.length < 32) throw new Error('INTERNAL_TOKEN must be at least 32 characters')
  const embedding = loadEmbeddingConfig(env)
  if (embedding.dimensions !== VECTOR_DIMENSIONS) {
    throw new Error(`EMBEDDING_DIMENSIONS must be ${VECTOR_DIMENSIONS}; changing it needs a database migration (spec §4.4)`)
  }
  // Fake bag-of-words vectors score much lower than real embeddings for the same relevance.
  const minScore = Number(env.KB_MIN_SCORE ?? (embedding.provider === 'fake' ? 0.05 : 0.3))
  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) throw new Error('KB_MIN_SCORE must be between -1 and 1')
  return {
    port: Number(env.PORT ?? 4002),
    databaseUrl: required('DATABASE_URL'),
    internalToken,
    storageDir: path.resolve(env.KB_STORAGE_DIR || DEFAULT_STORAGE_DIR),
    maxFileBytes: int('KB_MAX_FILE_BYTES', 10 * 1024 * 1024),
    maxDocumentsPerTenant: int('KB_MAX_DOCUMENTS', 200),
    searchTopK: 5,
    minScore,
    jobConcurrency: int('KB_JOB_CONCURRENCY', 2),
    embedding,
  }
}
```

`services/kb-service/src/storage.ts`:
```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Where original KB files live. The local implementation can be swapped for S3 without touching callers. */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>
  /** Returns null when nothing is stored under `key`. */
  get(key: string): Promise<Buffer | null>
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY_RE = new RegExp(`^${UUID}/${UUID}$`)

export function storageKey(tenantId: string, documentId: string): string {
  return `${tenantId}/${documentId}`
}

export function createLocalStorage(root: string): FileStorage {
  const resolve = (key: string): string => {
    if (!KEY_RE.test(key)) throw new Error(`Invalid storage key: ${key}`)
    return path.join(root, key)
  }
  return {
    async put(key, data) {
      const file = resolve(key)
      await mkdir(path.dirname(file), { recursive: true })
      // Write then rename, so a crash never leaves a half-written file under the real key.
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, data)
      await rename(tmp, file)
    },
    async get(key) {
      try {
        return await readFile(resolve(key))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true })
    },
  }
}
```

`services/kb-service/src/deps.ts`:
```ts
import type { EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbConfig } from './config'
import type { FileStorage } from './storage'

export interface KbDeps {
  db: Db
  config: KbConfig
  storage: FileStorage
  embeddings: EmbeddingProvider
}
```

`services/kb-service/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler, requireInternalToken } from '@helpix/shared'
import type { KbDeps } from './deps'

export async function buildApp(deps: KbDeps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.addHook('onRequest', requireInternalToken(deps.config.internalToken))

  app.get('/kb/health', async () => ({ ok: true }))
  return app
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test -w services/kb-service && npm run typecheck -w services/kb-service && npm run typecheck -w packages/shared`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/api-types.ts services/kb-service package-lock.json
git commit -m "feat(kb): kb-service scaffold with config, pgvector schema, local file storage and KB API types"
```

---
### Task 3: Text extraction and chunking

**Files:**
- Create: `services/kb-service/src/ingest/chunker.ts`, `services/kb-service/src/ingest/extract.ts`
- Create: `services/kb-service/test/fixtures.ts`
- Test: `services/kb-service/test/chunker.test.ts`, `services/kb-service/test/extract.test.ts`

**Interfaces:**
- Consumes: `estimateTokens`, `charTokens` (Task 1).
- Produces:
  - `src/ingest/chunker.ts`: `interface Chunk { position: number; text: string }`, `interface ChunkOptions { maxTokens: number; overlapTokens: number }`, `DEFAULT_CHUNK_OPTIONS` (500 / 50), `normalizeText(raw: string): string`, `chunkText(text: string, opts?: ChunkOptions): Chunk[]`
  - `src/ingest/extract.ts`: `type KbFileKind = 'pdf' | 'docx' | 'markdown' | 'text'`, `KIND_INFO: Record<KbFileKind, { mimeType: string; extension: string }>`, `kindFromMime(mime: string): KbFileKind | null`, `detectKind(filename: string, data: Buffer): KbFileKind | null`, `extractText(kind: KbFileKind, data: Buffer): Promise<string>`, `class ExtractionError extends Error` (its message is shown to admins)
  - `test/fixtures.ts`: `makePdf(lines: string[]): Promise<Buffer>`, `makeDocx(paragraphs: string[]): Promise<Buffer>`, `longText(words: number): string`

- [ ] **Step 1: Install the dependencies**

Run:
```bash
npm install -w services/kb-service unpdf@^1.8.1 mammoth@^1.13.0
npm install -w services/kb-service -D pdf-lib docx
```

- [ ] **Step 2: Write the fixtures and failing tests**

`services/kb-service/test/fixtures.ts`:
```ts
import { Document, Packer, Paragraph } from 'docx'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/** A one-page PDF with each line drawn as real text (extractable, like an exported document). */
export async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage()
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 20, size: 12, font }))
  return Buffer.from(await doc.save())
}

export async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: paragraphs.map((p) => new Paragraph(p)) }] })
  return Packer.toBuffer(doc)
}

/** `words` unique words (w0, w1, …) in sentences of 10 words and paragraphs of 5 sentences. */
export function longText(words: number): string {
  const all = Array.from({ length: words }, (_, i) => `w${i}`)
  const sentences: string[] = []
  for (let i = 0; i < all.length; i += 10) sentences.push(`${all.slice(i, i + 10).join(' ')}.`)
  const paragraphs: string[] = []
  for (let i = 0; i < sentences.length; i += 5) paragraphs.push(sentences.slice(i, i + 5).join(' '))
  return paragraphs.join('\n\n')
}
```

`services/kb-service/test/chunker.test.ts`:
```ts
import { estimateTokens } from '@helpix/llm'
import { describe, expect, it } from 'vitest'
import { chunkText, normalizeText } from '../src/ingest/chunker'
import { longText } from './fixtures'

describe('normalizeText', () => {
  it('strips a BOM and NULs, unifies line endings and collapses blank runs', () => {
    expect(normalizeText('﻿a\r\nb\rc\u0000\n\n\n\nd  \n')).toBe('a\nb\nc\n\nd')
  })
})

describe('chunkText', () => {
  it('returns nothing for empty or blank text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText(' \n\n \t ')).toEqual([])
  })

  it('keeps a short text as one chunk', () => {
    expect(chunkText('Refunds within 30 days.\n\nShipping is free.')).toEqual([
      { position: 0, text: 'Refunds within 30 days.\n\nShipping is free.' },
    ])
  })

  it('keeps every chunk within the token budget and numbers them in order', () => {
    const chunks = chunkText(longText(3000))
    expect(chunks.length).toBeGreaterThan(5)
    chunks.forEach((c, i) => {
      expect(c.position).toBe(i)
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(500)
    })
  })

  it('loses no words', () => {
    const joined = chunkText(longText(3000)).map((c) => c.text).join(' ')
    for (let i = 0; i < 3000; i++) expect(joined).toMatch(new RegExp(`\\bw${i}\\b`))
  })

  it('overlaps consecutive chunks within a section', () => {
    const chunks = chunkText(longText(3000))
    for (let i = 0; i + 1 < chunks.length; i++) {
      const firstWord = chunks[i + 1]!.text.split(/\s+/)[0]!
      // The next chunk opens with words from the end of this one (~50 tokens ≈ 200 characters).
      expect(chunks[i]!.text.slice(-400)).toContain(firstWord)
      expect(chunks[i]!.text.startsWith(firstWord)).toBe(false)
    }
  })

  it('starts a new chunk at each heading, with no overlap across it', () => {
    const chunks = chunkText('# Returns\n\nReturns within 30 days.\n\n## Shipping\n\nShips in 2 days.')
    expect(chunks.map((c) => c.text)).toEqual(['# Returns\n\nReturns within 30 days.', '## Shipping\n\nShips in 2 days.'])
  })

  it('splits CJK text without spaces within the budget', () => {
    const chunks = chunkText('这是一个测试句子。'.repeat(400))
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(500)
  })

  it('hard-splits a single enormous word', () => {
    const chunks = chunkText('x'.repeat(5000))
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(500)
  })

  it('respects custom options', () => {
    const chunks = chunkText(longText(200), { maxTokens: 40, overlapTokens: 5 })
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(40)
  })
})
```

`services/kb-service/test/extract.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { detectKind, ExtractionError, extractText, kindFromMime, KIND_INFO } from '../src/ingest/extract'
import { makeDocx, makePdf } from './fixtures'

describe('detectKind', () => {
  it('accepts real PDF, DOCX, Markdown and text files, case-insensitively', async () => {
    expect(detectKind('Policy.PDF', await makePdf(['Hello']))).toBe('pdf')
    expect(detectKind('faq.docx', await makeDocx(['Hello']))).toBe('docx')
    expect(detectKind('README.md', Buffer.from('# Hi'))).toBe('markdown')
    expect(detectKind('notes.markdown', Buffer.from('# Hi'))).toBe('markdown')
    expect(detectKind('notes.txt', Buffer.from('hi'))).toBe('text')
  })

  it('refuses files whose bytes do not match the extension', async () => {
    expect(detectKind('fake.pdf', Buffer.from('just text'))).toBeNull()
    expect(detectKind('fake.docx', Buffer.from('just text'))).toBeNull()
    expect(detectKind('binary.txt', Buffer.from([0x68, 0x00, 0x69]))).toBeNull()
    expect(detectKind('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBeNull()
  })

  it('refuses unsupported extensions and files without one', () => {
    expect(detectKind('setup.exe', Buffer.from('MZ'))).toBeNull()
    expect(detectKind('noext', Buffer.from('hi'))).toBeNull()
    expect(detectKind('old.doc', Buffer.from('hi'))).toBeNull()
  })
})

describe('kindFromMime', () => {
  it('maps stored MIME types back to kinds', () => {
    for (const [kind, info] of Object.entries(KIND_INFO)) expect(kindFromMime(info.mimeType)).toBe(kind)
    expect(kindFromMime('image/png')).toBeNull()
  })
})

describe('extractText', () => {
  it('extracts PDF text', async () => {
    const text = await extractText('pdf', await makePdf(['Return policy', 'Refunds within 30 days']))
    expect(text).toContain('Return policy')
    expect(text).toContain('Refunds within 30 days')
  })

  it('extracts DOCX paragraphs', async () => {
    const text = await extractText('docx', await makeDocx(['Shipping', 'Orders ship in 2 days.']))
    expect(text).toContain('Shipping')
    expect(text).toContain('Orders ship in 2 days.')
  })

  it('decodes UTF-8 text and normalises it', async () => {
    expect(await extractText('text', Buffer.from('﻿Café\r\n\r\n\r\nNext', 'utf8'))).toBe('Café\n\nNext')
  })

  it('fails a PDF with no text layer with a helpful message', async () => {
    await expect(extractText('pdf', await makePdf([]))).rejects.toThrow(/No text found in this PDF/)
  })

  it('fails a whitespace-only text file', async () => {
    await expect(extractText('text', Buffer.from('  \n\n  '))).rejects.toThrow('This file contains no text.')
  })

  it('wraps parser failures in ExtractionError', async () => {
    const err = await extractText('pdf', Buffer.from('%PDF-1.7\nnot really a pdf')).catch((e) => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect(err.message).toMatch(/Could not read this file/)
    await expect(extractText('docx', Buffer.from('PK\u0003\u0004garbage'))).rejects.toBeInstanceOf(ExtractionError)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w services/kb-service -- chunker extract`
Expected: FAIL. `../src/ingest/chunker` and `../src/ingest/extract` do not resolve.

- [ ] **Step 4: Implement the chunker**

`services/kb-service/src/ingest/chunker.ts`:
```ts
import { charTokens, estimateTokens } from '@helpix/llm'

export interface Chunk {
  position: number
  text: string
}

export interface ChunkOptions {
  maxTokens: number
  overlapTokens: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxTokens: 500, overlapTokens: 50 }

const HEADING = /^#{1,6}\s/
// Latin sentence ends are followed by whitespace; CJK full stops usually are not.
const SENTENCE_END = /(?<=[.!?])\s+|(?<=[。！？])/u

export function normalizeText(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Paragraph blocks grouped into sections; a Markdown heading starts a new section. */
function sections(text: string): string[][] {
  const out: string[][] = []
  let current: string[] = []
  for (const raw of text.split(/\n\s*\n/)) {
    const block = raw.trim()
    if (!block) continue
    if (HEADING.test(block) && current.length > 0) {
      out.push(current)
      current = []
    }
    current.push(block)
  }
  if (current.length > 0) out.push(current)
  return out
}

/** Cuts text into pieces of at most `max` tokens, preferring whitespace boundaries. */
function hardSplit(text: string, max: number): string[] {
  const chars = Array.from(text)
  const out: string[] = []
  let start = 0
  while (start < chars.length) {
    let end = start
    let cost = 0
    let lastSpace = -1
    while (end < chars.length && cost + charTokens(chars[end]!) <= max) {
      cost += charTokens(chars[end]!)
      if (/\s/.test(chars[end]!)) lastSpace = end
      end++
    }
    if (end < chars.length && lastSpace > start) end = lastSpace
    const piece = chars.slice(start, end).join('').trim()
    if (piece) out.push(piece)
    start = end
    while (start < chars.length && /\s/.test(chars[start]!)) start++
  }
  return out
}

/** A block that fits is kept whole; otherwise it is split into sentences, and oversized sentences are hard-cut. */
function fitBlock(block: string, max: number): string[] {
  if (estimateTokens(block) <= max) return [block]
  const out: string[] = []
  for (const sentence of block.split(SENTENCE_END)) {
    const s = sentence.trim()
    if (!s) continue
    out.push(...(estimateTokens(s) <= max ? [s] : hardSplit(s, max)))
  }
  return out
}

/** The last `budget` tokens of `text`, starting at a word boundary when one exists. */
function tail(text: string, budget: number): string {
  if (budget <= 0) return ''
  const chars = Array.from(text)
  let i = chars.length
  let cost = 0
  while (i > 0 && cost + charTokens(chars[i - 1]!) <= budget) {
    cost += charTokens(chars[i - 1]!)
    i--
  }
  let s = chars.slice(i).join('')
  if (i > 0 && !/\s/.test(chars[i - 1]!)) {
    const space = s.search(/\s/)
    if (space > 0) s = s.slice(space)
  }
  return s.trim()
}

/**
 * Packs paragraphs (or, for oversized ones, sentences) into chunks of at most `maxTokens`. Each chunk after the first
 * in a section starts with the last `overlapTokens` of the previous one. Chunks never span a heading.
 */
export function chunkText(text: string, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  // Pieces leave room for an overlap prefix plus one joiner, so a chunk can always take at least one piece.
  const pieceMax = Math.max(1, opts.maxTokens - opts.overlapTokens - 1)
  const out: string[] = []
  for (const section of sections(normalizeText(text))) {
    const units = section.flatMap((block) =>
      fitBlock(block, pieceMax).map((piece, i) => ({ text: piece, joiner: i === 0 ? '\n\n' : ' ' })),
    )
    let body = ''
    // Counted conservatively: every joiner costs one token and every part is rounded up.
    let tokens = 0
    let hasNew = false
    let previous: string | null = null
    for (const unit of units) {
      const t = estimateTokens(unit.text)
      if (hasNew && tokens + 1 + t > opts.maxTokens) {
        out.push(body)
        previous = body
        body = ''
        tokens = 0
        hasNew = false
      }
      if (!body && previous) {
        body = tail(previous, opts.overlapTokens)
        tokens = estimateTokens(body)
      }
      body = body ? body + unit.joiner + unit.text : unit.text
      tokens += (tokens > 0 ? 1 : 0) + t
      hasNew = true
    }
    if (hasNew) out.push(body)
  }
  return out.map((t, position) => ({ position, text: t }))
}
```

- [ ] **Step 5: Implement extraction**

`services/kb-service/src/ingest/extract.ts`:
```ts
import path from 'node:path'
import mammoth from 'mammoth'
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf'
import { normalizeText } from './chunker'

export type KbFileKind = 'pdf' | 'docx' | 'markdown' | 'text'

export const KIND_INFO: Record<KbFileKind, { mimeType: string; extension: string }> = {
  pdf: { mimeType: 'application/pdf', extension: '.pdf' },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
  markdown: { mimeType: 'text/markdown', extension: '.md' },
  text: { mimeType: 'text/plain', extension: '.txt' },
}

const BY_EXTENSION: Record<string, KbFileKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/** A failure whose message is safe and useful to show to the tenant admin. */
export class ExtractionError extends Error {
  override name = 'ExtractionError'
}

export function kindFromMime(mime: string): KbFileKind | null {
  const hit = (Object.entries(KIND_INFO) as [KbFileKind, { mimeType: string }][]).find(([, info]) => info.mimeType === mime)
  return hit ? hit[0] : null
}

function decodeUtf8(data: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/** Picks the kind from the file extension, then checks the bytes agree. Returns null for anything unsupported. */
export function detectKind(filename: string, data: Buffer): KbFileKind | null {
  const kind = BY_EXTENSION[path.extname(filename).toLowerCase()]
  if (!kind) return null
  if (kind === 'pdf') return data.subarray(0, 5).toString('latin1') === '%PDF-' ? kind : null
  if (kind === 'docx') return data.subarray(0, 4).equals(ZIP_MAGIC) ? kind : null
  return decodeUtf8(data) === null ? null : kind
}

export async function extractText(kind: KbFileKind, data: Buffer): Promise<string> {
  let raw: string
  try {
    if (kind === 'pdf') {
      // Copy: pdf.js may transfer (detach) the buffer it is given.
      const pdf = await getDocumentProxy(new Uint8Array(data))
      raw = (await extractPdfText(pdf, { mergePages: true })).text
    } else if (kind === 'docx') {
      raw = (await mammoth.extractRawText({ buffer: data })).value
    } else {
      raw = decodeUtf8(data) ?? ''
    }
  } catch {
    throw new ExtractionError('Could not read this file. It may be damaged or password-protected.')
  }
  const text = normalizeText(raw)
  if (!text) {
    throw new ExtractionError(
      kind === 'pdf' ? 'No text found in this PDF. Scanned PDFs are not supported.' : 'This file contains no text.',
    )
  }
  return text
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm test -w services/kb-service -- chunker extract && npm run typecheck -w services/kb-service`
Expected: all PASS. If `import mammoth from 'mammoth'` fails to typecheck, use `import * as mammoth from 'mammoth'`. Both work at runtime under tsx.

- [ ] **Step 7: Commit**

```bash
git add services/kb-service package-lock.json
git commit -m "feat(kb): text extraction for PDF/DOCX/Markdown/TXT and heading-aware chunker with overlap"
```

---

### Task 4: Document repository, job runner and ingestion pipeline

**Files:**
- Create: `services/kb-service/src/repos/documents.ts`, `services/kb-service/src/repos/chunks.ts`
- Create: `services/kb-service/src/jobs.ts`, `services/kb-service/src/ingest/pipeline.ts`
- Create: `services/kb-service/test/seed.ts`
- Test: `services/kb-service/test/jobs.test.ts`, `services/kb-service/test/documentsRepo.test.ts`, `services/kb-service/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `KbDeps`, `storageKey`, `FileStorage` (Task 2); `chunkText`, `Chunk`, `extractText`, `detectKind`, `kindFromMime`, `KIND_INFO`, `ExtractionError` (Task 3); `EmbeddingProvider`, `EmbeddingError` (Task 1).
- Produces:
  - `src/repos/documents.ts`: `interface DocumentRow`, `toDocumentView(row): KbDocumentView`, `documentNotFound(): AppError`, `insertDocument(db, { id, tenantId, title, mimeType, sizeBytes, maxDocuments }): Promise<DocumentRow>`, `listDocuments(db, tenantId): Promise<DocumentRow[]>`, `getDocument(db, tenantId, id): Promise<DocumentRow | null>`, `deleteDocument(db, tenantId, id): Promise<{ storageKey: string } | null>`, `markProcessingForRetry(db, tenantId, id): Promise<'ok' | 'not_found' | 'not_failed'>`, `markFailed(db, tenantId, id, message): Promise<void>`, `getExtractedText(db, tenantId, id): Promise<{ status: DocumentStatus; text: string | null } | null>`, `sweepStuckDocuments(db): Promise<number>`
  - `src/repos/chunks.ts`: `toVectorLiteral(v: number[]): string`, `replaceChunksAndMarkReady(db, { tenantId, documentId, chunks, vectors, model, text }): Promise<boolean>`
  - `src/jobs.ts`: `interface JobRunner { run(job: () => Promise<void>): void; idle(): Promise<void> }`, `createJobRunner({ concurrency, onError }): JobRunner`
  - `src/ingest/pipeline.ts`: `interface Logger { error(obj: object, msg: string): void }`, `interface IngestDeps { db; storage; embeddings; log: Logger }`, `processDocument(deps: IngestDeps, tenantId: string, documentId: string): Promise<void>`, `MAX_CHUNKS_PER_DOCUMENT = 2000`
  - `test/seed.ts`: `silentLog`, `seedDocument(deps, tenantId, { filename, data, title? }): Promise<string>`, `seedReadyDocument(deps, tenantId, { filename, data, title? }): Promise<string>`

- [ ] **Step 1: Write the failing job-runner test**

`services/kb-service/test/jobs.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { createJobRunner } from '../src/jobs'

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('createJobRunner', () => {
  it('never runs more than `concurrency` jobs at once and runs them all', async () => {
    const jobs = createJobRunner({ concurrency: 2, onError: vi.fn() })
    let active = 0
    let peak = 0
    let done = 0
    for (let i = 0; i < 6; i++) {
      jobs.run(async () => {
        active++
        peak = Math.max(peak, active)
        await tick()
        active--
        done++
      })
    }
    await jobs.idle()
    expect(done).toBe(6)
    expect(peak).toBe(2)
  })

  it('reports a failing job and keeps going', async () => {
    const onError = vi.fn()
    const jobs = createJobRunner({ concurrency: 1, onError })
    const ran: number[] = []
    jobs.run(async () => { throw new Error('boom') })
    jobs.run(async () => { ran.push(2) })
    await jobs.idle()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
    expect(ran).toEqual([2])
  })

  it('is idle immediately when nothing was queued', async () => {
    await expect(createJobRunner({ concurrency: 1, onError: vi.fn() }).idle()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Implement the job runner and run its test**

`services/kb-service/src/jobs.ts`:
```ts
/**
 * In-process background work (spec §4.1): uploads return immediately and processing happens here. It can be replaced
 * by a real queue without changing the API. Work in flight is lost on restart; the startup sweep marks it failed.
 */
export interface JobRunner {
  /** Queues `job`. A rejection goes to `onError`; it is never thrown to the caller. */
  run(job: () => Promise<void>): void
  /** Resolves once nothing is queued or running. Used by tests. */
  idle(): Promise<void>
}

export function createJobRunner(opts: { concurrency: number; onError: (err: unknown) => void }): JobRunner {
  const queue: (() => Promise<void>)[] = []
  let active = 0
  let waiters: (() => void)[] = []

  function settle() {
    if (active > 0 || queue.length > 0) return
    const resolve = waiters
    waiters = []
    for (const r of resolve) r()
  }

  function pump() {
    while (active < opts.concurrency && queue.length > 0) {
      const job = queue.shift()!
      active++
      void (async () => {
        try {
          await job()
        } catch (err) {
          opts.onError(err)
        } finally {
          active--
          pump()
          settle()
        }
      })()
    }
  }

  return {
    run(job) {
      queue.push(job)
      pump()
    },
    idle() {
      if (active === 0 && queue.length === 0) return Promise.resolve()
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}
```

Run: `npm test -w services/kb-service -- jobs`
Expected: PASS.

- [ ] **Step 3: Write the failing repository and pipeline tests**

`services/kb-service/test/seed.ts`:
```ts
import { randomUUID } from 'node:crypto'
import type { KbDeps } from '../src/deps'
import { detectKind, KIND_INFO } from '../src/ingest/extract'
import { processDocument } from '../src/ingest/pipeline'
import { insertDocument } from '../src/repos/documents'

export const silentLog = { error: () => {} }

/** Inserts a document row and stores its file, as the upload route does, without processing it. */
export async function seedDocument(
  deps: KbDeps,
  tenantId: string,
  input: { filename: string; data: Buffer | string; title?: string },
): Promise<string> {
  const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data)
  const kind = detectKind(input.filename, data)
  if (!kind) throw new Error(`Fixture ${input.filename} is not a supported file`)
  const id = randomUUID()
  const row = await insertDocument(deps.db, {
    id,
    tenantId,
    title: input.title ?? input.filename,
    mimeType: KIND_INFO[kind].mimeType,
    sizeBytes: data.length,
    maxDocuments: 1000,
  })
  await deps.storage.put(row.storage_key, data)
  return id
}

export async function seedReadyDocument(
  deps: KbDeps,
  tenantId: string,
  input: { filename: string; data: Buffer | string; title?: string },
): Promise<string> {
  const id = await seedDocument(deps, tenantId, input)
  await processDocument({ ...deps, log: silentLog }, tenantId, id)
  return id
}
```

`services/kb-service/test/documentsRepo.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDocument,
  getDocument,
  insertDocument,
  listDocuments,
  markFailed,
  markProcessingForRetry,
  sweepStuckDocuments,
} from '../src/repos/documents'
import { resetDb, setupTestDb, TENANT_A, TENANT_B } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const insert = (tenantId: string, maxDocuments = 10) =>
  insertDocument(db, { id: randomUUID(), tenantId, title: 'Doc', mimeType: 'text/plain', sizeBytes: 3, maxDocuments })

describe('documents repository', () => {
  it('inserts a processing document with a tenant-prefixed storage key', async () => {
    const row = await insert(TENANT_A)
    expect(row).toMatchObject({ tenant_id: TENANT_A, status: 'processing', chunk_count: 0, error: null })
    expect(row.storage_key).toBe(`${TENANT_A}/${row.id}`)
  })

  it('enforces the per-tenant cap, per tenant', async () => {
    await insert(TENANT_A, 2)
    await insert(TENANT_A, 2)
    await expect(insert(TENANT_A, 2)).rejects.toMatchObject({ status: 409, code: 'document_limit_reached' })
    await expect(insert(TENANT_B, 2)).resolves.toBeTruthy()
  })

  it('holds the cap under concurrent inserts', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => insert(TENANT_A, 2)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })

  it('scopes reads and deletes by tenant', async () => {
    const row = await insert(TENANT_A)
    expect(await getDocument(db, TENANT_B, row.id)).toBeNull()
    expect(await listDocuments(db, TENANT_B)).toEqual([])
    expect(await deleteDocument(db, TENANT_B, row.id)).toBeNull()
    expect(await deleteDocument(db, TENANT_A, row.id)).toEqual({ storageKey: row.storage_key })
    expect(await getDocument(db, TENANT_A, row.id)).toBeNull()
  })

  it('retries only failed documents', async () => {
    const row = await insert(TENANT_A)
    expect(await markProcessingForRetry(db, TENANT_A, row.id)).toBe('not_failed')
    await markFailed(db, TENANT_A, row.id, 'boom')
    expect((await getDocument(db, TENANT_A, row.id))!).toMatchObject({ status: 'failed', error: 'boom' })
    expect(await markProcessingForRetry(db, TENANT_B, row.id)).toBe('not_found')
    expect(await markProcessingForRetry(db, TENANT_A, row.id)).toBe('ok')
    expect((await getDocument(db, TENANT_A, row.id))!).toMatchObject({ status: 'processing', error: null })
  })

  it('sweeps documents left processing by a crash', async () => {
    const stuck = await insert(TENANT_A)
    const failed = await insert(TENANT_A)
    await markFailed(db, TENANT_A, failed.id, 'earlier failure')
    expect(await sweepStuckDocuments(db)).toBe(1)
    expect((await getDocument(db, TENANT_A, stuck.id))!).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted/) })
    expect((await getDocument(db, TENANT_A, failed.id))!.error).toBe('earlier failure')
  })
})
```

`services/kb-service/test/pipeline.test.ts`:
```ts
import { EmbeddingError, createFakeEmbeddings, type EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDeps } from '../src/deps'
import { processDocument } from '../src/ingest/pipeline'
import { deleteDocument, getDocument } from '../src/repos/documents'
import { longText } from './fixtures'
import { makeDeps, resetDb, setupTestDb, tempDir, TENANT_A } from './helpers'
import { seedDocument, silentLog } from './seed'

let db: Db
let deps: KbDeps
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  deps = makeDeps(db, await tempDir())
})

const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })
const chunkRows = (id: string) =>
  db.query<{ tenant_id: string; position: number; embedding_model: string }>(
    'SELECT tenant_id, position, embedding_model FROM kb.chunks WHERE document_id = $1 ORDER BY position',
    [id],
  )

describe('processDocument', () => {
  it('extracts, chunks and embeds a document, then marks it ready', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'policy.md', data: `# Returns\n\n${longText(1500)}` })
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    const doc = (await getDocument(db, TENANT_A, id))!
    expect(doc).toMatchObject({ status: 'ready', error: null, embedding_model: 'fake:hash:1024' })
    expect(doc.chunk_count).toBeGreaterThan(1)
    const { rows } = await chunkRows(id)
    expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i))
    expect(rows.every((r) => r.tenant_id === TENANT_A && r.embedding_model === 'fake:hash:1024')).toBe(true)
    const stored = await db.query('SELECT extracted_text FROM kb.documents WHERE id = $1', [id])
    expect(stored.rows[0].extracted_text).toMatch(/^# Returns/)
  })

  it('fails a file with no text, with a message', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'blank.txt', data: '  \n\n  ' })
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({ status: 'failed', error: 'This file contains no text.', chunk_count: 0 })
  })

  it('fails with a retryable message when embeddings are unavailable, without logging an error', async () => {
    const down: EmbeddingProvider = { ...fake, embed: async () => { throw new EmbeddingError('HTTP 503', true) } }
    const log = { error: vi.fn() }
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'Refunds within 30 days.' })
    await processDocument({ ...deps, embeddings: down, log }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({
      status: 'failed',
      error: 'The embedding service is unavailable. Try again later.',
      chunk_count: 0,
    })
    expect(log.error).not.toHaveBeenCalled()
  })

  it('fails when the stored file is missing', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    await deps.storage.delete(`${TENANT_A}/${id}`)
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!.error).toMatch(/stored file is missing/)
  })

  it('logs and fails on an unexpected error', async () => {
    const broken: EmbeddingProvider = { ...fake, embed: async () => { throw new Error('bug') } }
    const log = { error: vi.fn() }
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    await processDocument({ ...deps, embeddings: broken, log }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!).toMatchObject({ status: 'failed', error: 'Processing failed. Try again.' })
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('exits quietly when the document is deleted mid-processing', async () => {
    const log = { error: vi.fn() }
    let id = ''
    const deleting: EmbeddingProvider = {
      ...fake,
      embed: async (texts) => {
        await deleteDocument(db, TENANT_A, id)
        return fake.embed(texts)
      },
    }
    id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'Refunds within 30 days.' })
    await expect(processDocument({ ...deps, embeddings: deleting, log }, TENANT_A, id)).resolves.toBeUndefined()
    expect((await chunkRows(id)).rows).toHaveLength(0)
    expect(log.error).not.toHaveBeenCalled()
  })

  it('replaces chunks rather than duplicating them when a document is processed again', async () => {
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.md', data: longText(1500) })
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    const first = (await getDocument(db, TENANT_A, id))!.chunk_count
    await db.query("UPDATE kb.documents SET status = 'processing' WHERE id = $1", [id])
    await processDocument({ ...deps, log: silentLog }, TENANT_A, id)
    expect((await getDocument(db, TENANT_A, id))!.chunk_count).toBe(first)
  })

  it('does nothing for a document that is not processing', async () => {
    const embed = vi.fn(fake.embed)
    const id = await seedDocument(deps, TENANT_A, { filename: 'a.txt', data: 'hello' })
    await db.query("UPDATE kb.documents SET status = 'ready' WHERE id = $1", [id])
    await processDocument({ ...deps, embeddings: { ...fake, embed }, log: silentLog }, TENANT_A, id)
    expect(embed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -w services/kb-service -- documentsRepo pipeline`
Expected: FAIL. `../src/repos/documents` and `../src/ingest/pipeline` do not resolve.

- [ ] **Step 5: Implement the repositories**

`services/kb-service/src/repos/documents.ts`:
```ts
import { AppError, type Db } from '@helpix/shared'
import type { DocumentStatus, KbDocumentView } from '@helpix/shared/api-types'
import { storageKey } from '../storage'

export interface DocumentRow {
  id: string
  tenant_id: string
  title: string
  storage_key: string
  mime_type: string
  size_bytes: number
  status: DocumentStatus
  error: string | null
  embedding_model: string | null
  chunk_count: number
  created_at: Date
  updated_at: Date
}

const COLUMNS = `d.id, d.tenant_id, d.title, d.storage_key, d.mime_type, d.size_bytes, d.status, d.error, d.embedding_model,
  d.created_at, d.updated_at, (SELECT count(*) FROM kb.chunks c WHERE c.document_id = d.id)::int AS chunk_count`

export function toDocumentView(r: DocumentRow): KbDocumentView {
  return {
    id: r.id,
    title: r.title,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    status: r.status,
    error: r.error,
    chunkCount: r.chunk_count,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

export function documentNotFound(): AppError {
  return new AppError(404, 'document_not_found', 'Document not found')
}

export async function insertDocument(
  db: Db,
  input: { id: string; tenantId: string; title: string; mimeType: string; sizeBytes: number; maxDocuments: number },
): Promise<DocumentRow> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // Serialises inserts per tenant, so concurrent uploads cannot both pass the cap check.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kb.documents:${input.tenantId}`])
    const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM kb.documents WHERE tenant_id = $1', [
      input.tenantId,
    ])
    if (rows[0]!.n >= input.maxDocuments) {
      throw new AppError(
        409,
        'document_limit_reached',
        `This knowledge base already has the maximum of ${input.maxDocuments} documents. Delete one first.`,
      )
    }
    await client.query(
      `INSERT INTO kb.documents (id, tenant_id, title, storage_key, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.tenantId, input.title, storageKey(input.tenantId, input.id), input.mimeType, input.sizeBytes],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return (await getDocument(db, input.tenantId, input.id))!
}

export async function listDocuments(db: Db, tenantId: string): Promise<DocumentRow[]> {
  const { rows } = await db.query<DocumentRow>(
    `SELECT ${COLUMNS} FROM kb.documents d WHERE d.tenant_id = $1 ORDER BY d.created_at DESC, d.id`,
    [tenantId],
  )
  return rows
}

export async function getDocument(db: Db, tenantId: string, id: string): Promise<DocumentRow | null> {
  const { rows } = await db.query<DocumentRow>(`SELECT ${COLUMNS} FROM kb.documents d WHERE d.tenant_id = $1 AND d.id = $2`, [
    tenantId,
    id,
  ])
  return rows[0] ?? null
}

export async function deleteDocument(db: Db, tenantId: string, id: string): Promise<{ storageKey: string } | null> {
  const { rows } = await db.query<{ storage_key: string }>(
    'DELETE FROM kb.documents WHERE tenant_id = $1 AND id = $2 RETURNING storage_key',
    [tenantId, id],
  )
  return rows[0] ? { storageKey: rows[0].storage_key } : null
}

export async function markProcessingForRetry(db: Db, tenantId: string, id: string): Promise<'ok' | 'not_found' | 'not_failed'> {
  const { rowCount } = await db.query(
    `UPDATE kb.documents SET status = 'processing', error = NULL, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'failed'`,
    [tenantId, id],
  )
  if (rowCount) return 'ok'
  return (await getDocument(db, tenantId, id)) ? 'not_failed' : 'not_found'
}

/** Only a document still processing can fail; a deleted or finished one is left alone. */
export async function markFailed(db: Db, tenantId: string, id: string, message: string): Promise<void> {
  await db.query(
    `UPDATE kb.documents SET status = 'failed', error = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'processing'`,
    [tenantId, id, message],
  )
}

export async function getExtractedText(
  db: Db,
  tenantId: string,
  id: string,
): Promise<{ status: DocumentStatus; text: string | null } | null> {
  const { rows } = await db.query<{ status: DocumentStatus; extracted_text: string | null }>(
    'SELECT status, extracted_text FROM kb.documents WHERE tenant_id = $1 AND id = $2',
    [tenantId, id],
  )
  return rows[0] ? { status: rows[0].status, text: rows[0].extracted_text } : null
}

/** At startup no job is running, so anything still `processing` was interrupted (spec §4.1). */
export async function sweepStuckDocuments(db: Db): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE kb.documents SET status = 'failed', error = 'Processing was interrupted. Retry to process it again.', updated_at = now()
     WHERE status = 'processing'`,
  )
  return rowCount ?? 0
}
```

`services/kb-service/src/repos/chunks.ts`:
```ts
import type { Db } from '@helpix/shared'
import type { Chunk } from '../ingest/chunker'

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}

/**
 * Atomically stores a document's chunks and marks it ready. Returns false, writing nothing, when the document was
 * deleted or is no longer processing. The UPDATE runs first and locks the row, so a concurrent delete waits for us.
 */
export async function replaceChunksAndMarkReady(
  db: Db,
  input: { tenantId: string; documentId: string; chunks: Chunk[]; vectors: number[][]; model: string; text: string },
): Promise<boolean> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rowCount } = await client.query(
      `UPDATE kb.documents SET status = 'ready', error = NULL, extracted_text = $3, embedding_model = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'processing'`,
      [input.tenantId, input.documentId, input.text, input.model],
    )
    if (!rowCount) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query('DELETE FROM kb.chunks WHERE tenant_id = $1 AND document_id = $2', [input.tenantId, input.documentId])
    await client.query(
      `INSERT INTO kb.chunks (tenant_id, document_id, position, text, embedding, embedding_model)
       SELECT $1, $2, u.position, u.text, u.embedding::vector, $3
       FROM unnest($4::int[], $5::text[], $6::text[]) AS u(position, text, embedding)`,
      [
        input.tenantId,
        input.documentId,
        input.model,
        input.chunks.map((c) => c.position),
        input.chunks.map((c) => c.text),
        input.vectors.map(toVectorLiteral),
      ],
    )
    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
```

- [ ] **Step 6: Implement the pipeline**

`services/kb-service/src/ingest/pipeline.ts`:
```ts
import { EmbeddingError, type EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import { replaceChunksAndMarkReady } from '../repos/chunks'
import { getDocument, markFailed } from '../repos/documents'
import type { FileStorage } from '../storage'
import { chunkText } from './chunker'
import { ExtractionError, extractText, kindFromMime } from './extract'

export const MAX_CHUNKS_PER_DOCUMENT = 2000

export interface Logger {
  error(obj: object, msg: string): void
}

export interface IngestDeps {
  db: Db
  storage: FileStorage
  embeddings: EmbeddingProvider
  log: Logger
}

function failureMessage(err: unknown): string {
  if (err instanceof ExtractionError) return err.message
  if (err instanceof EmbeddingError) return 'The embedding service is unavailable. Try again later.'
  return 'Processing failed. Try again.'
}

/** Extract → chunk → embed → store, for one `processing` document. Never throws; failures mark the document failed. */
export async function processDocument(deps: IngestDeps, tenantId: string, documentId: string): Promise<void> {
  const doc = await getDocument(deps.db, tenantId, documentId)
  if (!doc || doc.status !== 'processing') return
  try {
    const data = await deps.storage.get(doc.storage_key)
    if (!data) throw new ExtractionError('The stored file is missing. Delete this document and upload it again.')
    const kind = kindFromMime(doc.mime_type)
    if (!kind) throw new ExtractionError('This file type is not supported.')
    const text = await extractText(kind, data)
    const chunks = chunkText(text)
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      throw new ExtractionError(`This document is too long (over ${MAX_CHUNKS_PER_DOCUMENT} chunks). Split it into smaller files.`)
    }
    const vectors = await deps.embeddings.embed(chunks.map((c) => c.text))
    // false means the document was deleted meanwhile: nothing to do.
    await replaceChunksAndMarkReady(deps.db, { tenantId, documentId, chunks, vectors, model: deps.embeddings.modelId, text })
  } catch (err) {
    await markFailed(deps.db, tenantId, documentId, failureMessage(err))
    if (!(err instanceof ExtractionError) && !(err instanceof EmbeddingError)) {
      deps.log.error({ err, documentId }, 'document processing failed')
    }
  }
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test -w services/kb-service && npm run typecheck -w services/kb-service`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add services/kb-service
git commit -m "feat(kb): document repository, in-process job runner and extract-chunk-embed pipeline"
```

---
### Task 5: Document routes (upload, paste, list, get, file, text, delete, retry)

**Files:**
- Create: `services/kb-service/src/lib/names.ts`, `services/kb-service/src/lib/context.ts`, `services/kb-service/src/routes/documents.ts`
- Modify: `services/kb-service/src/deps.ts`, `services/kb-service/src/app.ts`, `services/kb-service/test/helpers.ts`
- Create: `services/kb-service/test/multipart.ts`
- Test: `services/kb-service/test/names.test.ts`, `services/kb-service/test/documents.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces:
  - HTTP (all need `x-internal-token` and a `tenant_admin` identity):
    - `POST /kb/documents`: `multipart/form-data` with an optional `title` field **before** a single `file` part. Returns `202 KbDocumentView`. Errors: 415 `multipart_required`, 400 `file_required`, 400 `empty_file`, 413 `file_too_large`, 415 `unsupported_file_type`, 409 `document_limit_reached`.
    - `POST /kb/documents/text`: JSON `{ title, text }` (text up to 200,000 characters). Returns `202 KbDocumentView`. Error: 400 `empty_text`.
    - `GET /kb/documents` returns `{ documents: KbDocumentView[] }`, newest first.
    - `GET /kb/documents/:id` returns `KbDocumentView`. `GET /kb/documents/:id/file` returns the original bytes. `GET /kb/documents/:id/text` returns `KbDocumentText`, or 409 `document_not_ready`.
    - `DELETE /kb/documents/:id` returns 204. `POST /kb/documents/:id/retry` returns `202 KbDocumentView`, or 409 `document_not_failed`.
    - Unknown or other-tenant id returns 404 `document_not_found`. A malformed id returns 400 `validation_error`.
  - `adminTenant(req): string`, `scopedTenant(req): string` (`src/lib/context.ts`)
  - `cleanTitle(raw)`, `titleFromFilename(filename)`, `contentDisposition(filename)` (`src/lib/names.ts`)
  - `KbDeps` gains `jobs: JobRunner`; `makeDeps` provides one; new helper `buildTestApp(deps)`
  - `test/multipart.ts`: `multipart(parts: { name: string; filename?: string; contentType?: string; data: Buffer | string }[]): { payload: Buffer; headers: Record<string, string> }`

- [ ] **Step 1: Install multipart support**

Run: `npm install -w services/kb-service @fastify/multipart@^10.1.2`

- [ ] **Step 2: Write the failing tests**

`services/kb-service/test/names.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cleanTitle, contentDisposition, titleFromFilename } from '../src/lib/names'

describe('names', () => {
  it('cleans titles: control characters, whitespace runs, length', () => {
    expect(cleanTitle('  Return\u0000\tPolicy \n v2  ')).toBe('Return Policy v2')
    expect(Array.from(cleanTitle('é'.repeat(300)))).toHaveLength(200)
  })

  it('derives a title from a file name without its path or extension', () => {
    expect(titleFromFilename('../../etc/Return Policy.md')).toBe('Return Policy')
    expect(titleFromFilename('C:\\Users\\me\\faq.final.pdf')).toBe('faq.final')
    expect(titleFromFilename('.txt')).toBe('Untitled')
  })

  it('writes an RFC 6266 content-disposition with an ASCII fallback', () => {
    expect(contentDisposition('báo giá "mới".txt')).toBe(
      `attachment; filename="bao gia _moi_.txt"; filename*=UTF-8''b%C3%A1o%20gi%C3%A1%20%22m%E1%BB%9Bi%22.txt`,
    )
    expect(contentDisposition('退货.pdf')).toBe(`attachment; filename=".pdf"; filename*=UTF-8''%E9%80%80%E8%B4%A7.pdf`)
    expect(contentDisposition("it's (v2)*.md")).toContain(`filename*=UTF-8''it%27s%20%28v2%29%2A.md`)
  })
})
```

`services/kb-service/test/multipart.ts`:
```ts
import { randomUUID } from 'node:crypto'

/** Builds a multipart/form-data body the way a browser does (UTF-8 file names, parts in order). */
export function multipart(parts: { name: string; filename?: string; contentType?: string; data: Buffer | string }[]) {
  const boundary = `----helpix${randomUUID()}`
  const chunks: Buffer[] = []
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename !== undefined) head += `; filename="${p.filename}"`
    head += '\r\n'
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`
    chunks.push(Buffer.from(`${head}\r\n`), Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
```

Modify `services/kb-service/test/helpers.ts`. Add the imports:
```ts
import { buildApp } from '../src/app'
import { createJobRunner } from '../src/jobs'
```
Replace `makeDeps` and add `buildTestApp`:
```ts
export function makeDeps(db: Db, storageDir: string, overrides: Partial<KbDeps> = {}): KbDeps {
  return {
    db,
    config: { ...TEST_CONFIG, storageDir },
    storage: createLocalStorage(storageDir),
    embeddings: createFakeEmbeddings({ model: 'hash', dimensions: 1024 }),
    jobs: createJobRunner({ concurrency: 1, onError: (err) => console.error(err) }),
    ...overrides,
  }
}

export function buildTestApp(deps: KbDeps) {
  return buildApp(deps, { logger: false })
}
```

`services/kb-service/test/documents.test.ts`:
```ts
import { EmbeddingError, createFakeEmbeddings } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbDocumentView } from '@helpix/shared/api-types'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KbDeps } from '../src/deps'
import { makeDocx, makePdf } from './fixtures'
import { buildTestApp, internalHeaders, makeDeps, resetDb, setupTestDb, tempDir, tenantHeaders, TENANT_A } from './helpers'
import { multipart } from './multipart'
import { seedDocument } from './seed'

let db: Db
let deps: KbDeps
let app: FastifyInstance
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  deps = makeDeps(db, await tempDir())
  app = await buildTestApp(deps)
})
afterEach(async () => {
  await deps.jobs.idle()
  await app.close()
})

const A = () => tenantHeaders(TENANT_A)

function upload(filename: string, data: Buffer | string, title?: string) {
  const body = multipart([...(title !== undefined ? [{ name: 'title', data: title }] : []), { name: 'file', filename, data }])
  return app.inject({ method: 'POST', url: '/kb/documents', headers: { ...A(), ...body.headers }, payload: body.payload })
}

const get = (url: string) => app.inject({ method: 'GET', url, headers: A() })
const list = async () => (await get('/kb/documents')).json().documents as KbDocumentView[]

describe('POST /kb/documents (file upload)', () => {
  it('accepts a Markdown file, returns 202 processing, then becomes ready', async () => {
    const res = await upload('Returns.md', '# Returns\n\nRefunds within 30 days.')
    expect(res.statusCode).toBe(202)
    const doc = res.json() as KbDocumentView
    expect(doc).toMatchObject({ title: 'Returns', mimeType: 'text/markdown', status: 'processing', sizeBytes: 34 })
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}`)).json()).toMatchObject({ status: 'ready', error: null, chunkCount: 1 })
  })

  it('accepts PDF and DOCX files', async () => {
    expect((await upload('policy.pdf', await makePdf(['Refunds within 30 days']))).json().mimeType).toBe('application/pdf')
    expect((await upload('faq.docx', await makeDocx(['Ships in 2 days']))).statusCode).toBe(202)
    await deps.jobs.idle()
    expect((await list()).map((d) => d.status)).toEqual(['ready', 'ready'])
  })

  it('uses the title field when given', async () => {
    expect((await upload('x.txt', 'hello', '  Shipping   FAQ ')).json().title).toBe('Shipping FAQ')
  })

  it('derives the title from a hostile path without affecting storage', async () => {
    const doc = (await upload('../../etc/Return Policy.md', 'hello')).json() as KbDocumentView
    expect(doc.title).toBe('Return Policy')
    expect(await deps.storage.get(`${TENANT_A}/${doc.id}`)).not.toBeNull()
  })

  it('keeps a UTF-8 file name and serves it back with a valid content-disposition', async () => {
    // Browsers send the raw UTF-8 bytes in the filename parameter (quotes are covered by names.test.ts).
    const doc = (await upload('báo giá mới.txt', 'Giá: 100k')).json() as KbDocumentView
    expect(doc.title).toBe('báo giá mới')
    const file = await get(`/kb/documents/${doc.id}/file`)
    expect(file.headers['content-disposition']).toBe(
      `attachment; filename="bao gia moi.txt"; filename*=UTF-8''b%C3%A1o%20gi%C3%A1%20m%E1%BB%9Bi.txt`,
    )
  })

  it('refuses files whose type is unsupported or does not match their bytes', async () => {
    for (const [name, data] of [
      ['setup.exe', 'MZ'],
      ['fake.pdf', 'plain text'],
      ['bad.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])],
    ] as const) {
      const res = await upload(name, data)
      expect(res.statusCode).toBe(415)
      expect(res.json().error.code).toBe('unsupported_file_type')
    }
    expect(await list()).toEqual([])
  })

  it('refuses an empty file', async () => {
    const res = await upload('empty.txt', '')
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('empty_file')
  })

  it('refuses a file over the size cap without creating a document', async () => {
    const res = await upload('big.txt', 'x'.repeat(deps.config.maxFileBytes + 1))
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('file_too_large')
    expect(await list()).toEqual([])
  })

  it('refuses a request with no file part, or a non-multipart body', async () => {
    const body = multipart([{ name: 'title', data: 'x' }])
    const noFile = await app.inject({ method: 'POST', url: '/kb/documents', headers: { ...A(), ...body.headers }, payload: body.payload })
    expect(noFile.json().error.code).toBe('file_required')
    const json = await app.inject({ method: 'POST', url: '/kb/documents', headers: A(), payload: { title: 'x' } })
    expect(json.statusCode).toBe(415)
    expect(json.json().error.code).toBe('multipart_required')
  })

  it('enforces the per-tenant document cap', async () => {
    for (let i = 0; i < deps.config.maxDocumentsPerTenant; i++) expect((await upload(`d${i}.txt`, 'hi')).statusCode).toBe(202)
    const res = await upload('one-more.txt', 'hi')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('document_limit_reached')
  })
})

describe('POST /kb/documents/text (pasted text)', () => {
  const paste = (payload: unknown) => app.inject({ method: 'POST', url: '/kb/documents/text', headers: A(), payload: payload as object })

  it('stores pasted text as a text/plain document', async () => {
    const res = await paste({ title: 'Opening hours', text: 'Mon–Fri 9–5' })
    expect(res.statusCode).toBe(202)
    const doc = res.json() as KbDocumentView
    expect(doc).toMatchObject({ title: 'Opening hours', mimeType: 'text/plain' })
    await deps.jobs.idle()
    const file = await get(`/kb/documents/${doc.id}/file`)
    expect(file.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(file.body).toBe('Mon–Fri 9–5')
  })

  it('refuses blank text and a missing title', async () => {
    expect((await paste({ title: 'x', text: '   ' })).json().error.code).toBe('empty_text')
    expect((await paste({ text: 'hello' })).json().error.code).toBe('validation_error')
  })
})

describe('reading, deleting and retrying documents', () => {
  it('lists newest first', async () => {
    await upload('first.txt', 'a')
    await upload('second.txt', 'b')
    expect((await list()).map((d) => d.title)).toEqual(['second', 'first'])
  })

  it('serves the original file with safe headers', async () => {
    const pdf = await makePdf(['Hello'])
    const doc = (await upload('p.pdf', pdf)).json() as KbDocumentView
    const res = await get(`/kb/documents/${doc.id}/file`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.rawPayload.equals(pdf)).toBe(true)
  })

  it('returns extracted text once ready, and 409 before', async () => {
    const pending = await seedDocument(deps, TENANT_A, { filename: 'p.txt', data: 'pending' })
    expect((await get(`/kb/documents/${pending}/text`)).json().error.code).toBe('document_not_ready')
    const doc = (await upload('faq.docx', await makeDocx(['Ships in 2 days']))).json() as KbDocumentView
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}/text`)).json().text).toContain('Ships in 2 days')
  })

  it('deletes the row, its chunks and its file', async () => {
    const doc = (await upload('a.txt', 'hello world')).json() as KbDocumentView
    await deps.jobs.idle()
    const del = await app.inject({ method: 'DELETE', url: `/kb/documents/${doc.id}`, headers: A() })
    expect(del.statusCode).toBe(204)
    expect(await deps.storage.get(`${TENANT_A}/${doc.id}`)).toBeNull()
    expect((await db.query('SELECT count(*)::int AS n FROM kb.chunks')).rows[0].n).toBe(0)
    expect((await app.inject({ method: 'DELETE', url: `/kb/documents/${doc.id}`, headers: A() })).statusCode).toBe(404)
  })

  it('retries a failed document until it is ready', async () => {
    let down = true
    const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })
    const flaky = { ...fake, embed: async (t: string[]) => { if (down) throw new EmbeddingError('HTTP 503', true); return fake.embed(t) } }
    await app.close()
    deps = makeDeps(db, await tempDir(), { embeddings: flaky })
    app = await buildTestApp(deps)

    const doc = (await upload('a.txt', 'hello')).json() as KbDocumentView
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}`)).json()).toMatchObject({ status: 'failed', error: expect.stringMatching(/embedding service/) })

    down = false
    const retry = await app.inject({ method: 'POST', url: `/kb/documents/${doc.id}/retry`, headers: A() })
    expect(retry.statusCode).toBe(202)
    expect(retry.json().status).toBe('processing')
    await deps.jobs.idle()
    expect((await get(`/kb/documents/${doc.id}`)).json().status).toBe('ready')

    const again = await app.inject({ method: 'POST', url: `/kb/documents/${doc.id}/retry`, headers: A() })
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('document_not_failed')
  })

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const unknown = await get('/kb/documents/33333333-3333-4333-8333-333333333333')
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error.code).toBe('document_not_found')
    expect((await get('/kb/documents/not-a-uuid')).statusCode).toBe(400)
  })

  it('requires a tenant admin', async () => {
    expect((await app.inject({ method: 'GET', url: '/kb/documents', headers: internalHeaders() })).statusCode).toBe(403)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w services/kb-service -- names documents`
Expected: FAIL. `names.test.ts` cannot import `../src/lib/names`, and every `/kb/documents` request in `documents.test.ts` returns 404 `not_found` because no routes are registered yet.

- [ ] **Step 4: Implement the helpers**

`services/kb-service/src/lib/names.ts`:
```ts
const MAX_TITLE = 200

/** Strips control characters, collapses whitespace and caps the length (in characters, like Postgres). */
export function cleanTitle(raw: string): string {
  const flat = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(flat).slice(0, MAX_TITLE).join('').trim()
}

/** "../../dir/Return Policy.md" → "Return Policy". Browsers may send a full Windows path. */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  return cleanTitle(base.replace(/\.[^.]*$/, '')) || 'Untitled'
}

/** RFC 6266: a plain-ASCII `filename` fallback plus the exact name as RFC 5987 `filename*`. */
export function contentDisposition(filename: string): string {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_')
    .trim()
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii || 'download'}"; filename*=UTF-8''${encoded}`
}
```

`services/kb-service/src/lib/context.ts`:
```ts
import type { FastifyRequest } from 'fastify'
import { AppError, readContext, requireRole } from '@helpix/shared'

/** The tenant of a tenant admin, from gateway headers. Super-admins have no tenant and are refused. */
export function adminTenant(req: FastifyRequest): string {
  const ctx = readContext(req)
  requireRole(ctx, 'tenant_admin')
  return ctx.tenantId!
}

/** The tenant of any trusted caller: a tenant admin via the gateway, or an internal service such as chat-service. */
export function scopedTenant(req: FastifyRequest): string {
  const { tenantId } = readContext(req)
  if (!tenantId) throw new AppError(403, 'forbidden', 'Missing tenant context')
  return tenantId
}
```

- [ ] **Step 5: Add the job runner to the deps**

`services/kb-service/src/deps.ts`:
```ts
import type { EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbConfig } from './config'
import type { JobRunner } from './jobs'
import type { FileStorage } from './storage'

export interface KbDeps {
  db: Db
  config: KbConfig
  storage: FileStorage
  embeddings: EmbeddingProvider
  jobs: JobRunner
}
```

- [ ] **Step 6: Implement the routes**

`services/kb-service/src/routes/documents.ts`:
```ts
import { randomUUID } from 'node:crypto'
import multipart, { type MultipartFile } from '@fastify/multipart'
import type { FastifyPluginAsync } from 'fastify'
import { AppError } from '@helpix/shared'
import type { KbDocumentText, KbDocumentView } from '@helpix/shared/api-types'
import type { KbDeps } from '../deps'
import { detectKind, KIND_INFO, kindFromMime, type KbFileKind } from '../ingest/extract'
import { processDocument } from '../ingest/pipeline'
import { adminTenant } from '../lib/context'
import { cleanTitle, contentDisposition, titleFromFilename } from '../lib/names'
import {
  deleteDocument,
  documentNotFound,
  getDocument,
  getExtractedText,
  insertDocument,
  listDocuments,
  markProcessingForRetry,
  toDocumentView,
} from '../repos/documents'

const MAX_PASTED_TEXT_CHARS = 200_000

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const pasteBody = {
  type: 'object',
  required: ['title', 'text'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    text: { type: 'string', minLength: 1, maxLength: MAX_PASTED_TEXT_CHARS },
  },
} as const

type IdRequest = { Params: { id: string } }

function fieldValue(part: MultipartFile, name: string): string {
  const field = part.fields[name]
  const one = Array.isArray(field) ? field[0] : field
  return one && one.type === 'field' && typeof one.value === 'string' ? one.value : ''
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`
}

export const documentRoutes: FastifyPluginAsync<KbDeps> = async (app, deps) => {
  const { db, config, storage, jobs } = deps
  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: config.maxFileBytes, files: 1, fields: 2, fieldSize: 1000, parts: 3 },
  })

  const enqueue = (tenantId: string, id: string) => jobs.run(() => processDocument({ ...deps, log: app.log }, tenantId, id))

  async function create(tenantId: string, title: string, kind: KbFileKind, data: Buffer): Promise<KbDocumentView> {
    const id = randomUUID()
    const row = await insertDocument(db, {
      id,
      tenantId,
      title,
      mimeType: KIND_INFO[kind].mimeType,
      sizeBytes: data.length,
      maxDocuments: config.maxDocumentsPerTenant,
    })
    try {
      await storage.put(row.storage_key, data)
    } catch (e) {
      await deleteDocument(db, tenantId, id)
      throw e
    }
    enqueue(tenantId, id)
    return toDocumentView(row)
  }

  async function mustGet(tenantId: string, id: string) {
    const doc = await getDocument(db, tenantId, id)
    if (!doc) throw documentNotFound()
    return doc
  }

  app.post('/kb/documents', async (req, reply) => {
    const tenantId = adminTenant(req)
    if (!req.isMultipart()) throw new AppError(415, 'multipart_required', 'Upload the file as multipart/form-data')
    const part = await req.file()
    if (!part) throw new AppError(400, 'file_required', 'No file was uploaded')
    let data: Buffer
    try {
      data = await part.toBuffer()
    } catch (e) {
      if (e instanceof app.multipartErrors.RequestFileTooLargeError) {
        throw new AppError(413, 'file_too_large', `Files must be ${formatSize(config.maxFileBytes)} or smaller`)
      }
      throw e
    }
    if (data.length === 0) throw new AppError(400, 'empty_file', 'The file is empty')
    const kind = detectKind(part.filename, data)
    if (!kind) throw new AppError(415, 'unsupported_file_type', 'Upload a PDF, DOCX, Markdown or TXT file')
    const title = cleanTitle(fieldValue(part, 'title')) || titleFromFilename(part.filename)
    return reply.code(202).send(await create(tenantId, title, kind, data))
  })

  app.post<{ Body: { title: string; text: string } }>(
    '/kb/documents/text',
    { schema: { body: pasteBody }, bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
      const tenantId = adminTenant(req)
      if (!req.body.text.trim()) throw new AppError(400, 'empty_text', 'Paste some text first')
      const title = cleanTitle(req.body.title) || 'Untitled'
      return reply.code(202).send(await create(tenantId, title, 'text', Buffer.from(req.body.text, 'utf8')))
    },
  )

  app.get('/kb/documents', async (req): Promise<{ documents: KbDocumentView[] }> => {
    const rows = await listDocuments(db, adminTenant(req))
    return { documents: rows.map(toDocumentView) }
  })

  app.get<IdRequest>('/kb/documents/:id', { schema: { params: idParams } }, async (req): Promise<KbDocumentView> => {
    return toDocumentView(await mustGet(adminTenant(req), req.params.id))
  })

  app.get<IdRequest>('/kb/documents/:id/file', { schema: { params: idParams } }, async (req, reply) => {
    const doc = await mustGet(adminTenant(req), req.params.id)
    const data = await storage.get(doc.storage_key)
    if (!data) throw new AppError(404, 'file_missing', 'The stored file is missing')
    const kind = kindFromMime(doc.mime_type) ?? 'text'
    const binary = kind === 'pdf' || kind === 'docx'
    return reply
      .header('content-type', binary ? doc.mime_type : `${doc.mime_type}; charset=utf-8`)
      .header('content-disposition', contentDisposition(doc.title + KIND_INFO[kind].extension))
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(data)
  })

  app.get<IdRequest>('/kb/documents/:id/text', { schema: { params: idParams } }, async (req): Promise<KbDocumentText> => {
    const found = await getExtractedText(db, adminTenant(req), req.params.id)
    if (!found) throw documentNotFound()
    if (found.status !== 'ready') throw new AppError(409, 'document_not_ready', 'The text is available once the document is ready')
    return { text: found.text ?? '' }
  })

  app.delete<IdRequest>('/kb/documents/:id', { schema: { params: idParams } }, async (req, reply) => {
    const deleted = await deleteDocument(db, adminTenant(req), req.params.id)
    if (!deleted) throw documentNotFound()
    try {
      await storage.delete(deleted.storageKey)
    } catch (err) {
      // The row is gone, so the document is deleted for the admin; an orphaned file is only a disk-space issue.
      req.log.error({ err, storageKey: deleted.storageKey }, 'could not delete stored file')
    }
    return reply.code(204).send()
  })

  app.post<IdRequest>('/kb/documents/:id/retry', { schema: { params: idParams } }, async (req, reply) => {
    const tenantId = adminTenant(req)
    const result = await markProcessingForRetry(db, tenantId, req.params.id)
    if (result === 'not_found') throw documentNotFound()
    if (result === 'not_failed') throw new AppError(409, 'document_not_failed', 'Only failed documents can be retried')
    enqueue(tenantId, req.params.id)
    return reply.code(202).send(toDocumentView(await mustGet(tenantId, req.params.id)))
  })
}
```

Register it in `services/kb-service/src/app.ts`. Add the import `import { documentRoutes } from './routes/documents'`, then add this line after the health route:
```ts
  await app.register(documentRoutes, deps)
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test -w services/kb-service && npm run typecheck -w services/kb-service`
Expected: all PASS.

If only the UTF-8 file-name test fails with a garbled title (for example `bÃ¡o`), busboy is decoding header parameters as Latin-1. Fix it by adding `defParamCharset: 'utf8'` to the `app.register(multipart, { ... })` options (`@fastify/multipart` passes busboy options through), then re-run.

- [ ] **Step 8: Commit**

```bash
git add services/kb-service package-lock.json
git commit -m "feat(kb): document upload, paste, list, file, text, delete and retry routes"
```

---

### Task 6: Search and re-indexing

**Files:**
- Modify: `services/kb-service/src/repos/chunks.ts` (append), `services/kb-service/src/deps.ts`, `services/kb-service/src/app.ts`, `services/kb-service/test/helpers.ts`
- Create: `services/kb-service/src/search.ts`, `services/kb-service/src/reindex.ts`, `services/kb-service/src/routes/search.ts`, `services/kb-service/src/routes/reindex.ts`
- Test: `services/kb-service/test/search.test.ts`, `services/kb-service/test/reindex.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - HTTP:
    - `POST /kb/search`, body `{ query: string (1–2000), limit?: 1–10 }`, returns `KbSearchResponse`. It needs only a tenant (`scopedTenant`), so chat-service can call it in step 3. Returns 503 `embedding_unavailable`.
    - `POST /kb/reindex` returns `202 KbReindexStatus` and starts a re-index unless one is already running for the tenant. `GET /kb/reindex` returns `KbReindexStatus`. Both need a tenant admin.
  - `src/repos/chunks.ts`: `searchChunks(db, { tenantId, model, vector, limit }): Promise<KbSearchResult[]>`, `chunksNeedingReindex(db, tenantId, model, limit): Promise<{ id: string; text: string }[]>`, `updateChunkEmbeddings(db, tenantId, model, items: { id: string; vector: number[] }[]): Promise<void>`, `markDocumentsModel(db, tenantId, model): Promise<void>`, `countChunks(db, tenantId, model): Promise<{ total: number; done: number }>`
  - `src/search.ts`: `search(deps: Pick<KbDeps, 'db' | 'embeddings' | 'config'>, tenantId, query, limit): Promise<KbSearchResult[]>`
  - `src/reindex.ts`: `interface ReindexTracker { isRunning(tenantId): boolean; start(tenantId, job: () => Promise<void>): void; idle(): Promise<void> }`, `createReindexTracker(onError): ReindexTracker`, `REINDEX_BATCH = 64`, `reindexTenant(deps: Pick<KbDeps, 'db' | 'embeddings'>, tenantId, batchSize?): Promise<void>`, `reindexStatus(deps: Pick<KbDeps, 'db' | 'embeddings' | 'reindex'>, tenantId): Promise<KbReindexStatus>`
  - `KbDeps` gains `reindex: ReindexTracker`

- [ ] **Step 1: Add the tracker to the deps and helpers**

In `services/kb-service/src/deps.ts`, add `import type { ReindexTracker } from './reindex'` and the field `reindex: ReindexTracker` to `KbDeps`.

In `services/kb-service/test/helpers.ts`, add `import { createReindexTracker } from '../src/reindex'` and this line to the object `makeDeps` returns, before `...overrides`:
```ts
    reindex: createReindexTracker((err) => console.error(err)),
```

- [ ] **Step 2: Write the failing tests**

`services/kb-service/test/search.test.ts`:
```ts
import { EmbeddingError, createFakeEmbeddings } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { KbSearchResult } from '@helpix/shared/api-types'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KbDeps } from '../src/deps'
import { buildTestApp, internalHeaders, makeDeps, resetDb, serviceHeaders, setupTestDb, tempDir, tenantHeaders, TENANT_A } from './helpers'
import { seedReadyDocument } from './seed'

let db: Db
let deps: KbDeps
let app: FastifyInstance
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  deps = makeDeps(db, await tempDir())
  app = await buildTestApp(deps)
})
afterEach(async () => { await app.close() })

const search = (payload: object, headers = serviceHeaders(TENANT_A)) =>
  app.inject({ method: 'POST', url: '/kb/search', headers, payload })
const results = async (payload: object) => (await search(payload)).json().results as KbSearchResult[]

async function seedPolicies() {
  const returns = await seedReadyDocument(deps, TENANT_A, { filename: 'returns.md', title: 'Returns', data: 'Our refund window is 30 days from delivery.' })
  const shipping = await seedReadyDocument(deps, TENANT_A, { filename: 'shipping.md', title: 'Shipping', data: 'We ship phones in recyclable boxes within 2 days.' })
  return { returns, shipping }
}

describe('POST /kb/search', () => {
  it('returns the closest chunk first, with its source title, position and score', async () => {
    const { returns } = await seedPolicies()
    const [top] = await results({ query: 'refund window' })
    expect(top).toMatchObject({ documentId: returns, title: 'Returns', position: 0, text: 'Our refund window is 30 days from delivery.' })
    expect(top!.score).toBeGreaterThan(0.05)
    expect(top!.score).toBeLessThanOrEqual(1)
  })

  it('drops results below the similarity threshold', async () => {
    await seedPolicies()
    expect(await results({ query: 'zebra giraffe' })).toEqual([])
  })

  it('caps results at the limit (default 5)', async () => {
    for (let i = 0; i < 7; i++) await seedReadyDocument(deps, TENANT_A, { filename: `d${i}.txt`, data: `refund policy number ${i}` })
    expect(await results({ query: 'refund policy' })).toHaveLength(5)
    expect(await results({ query: 'refund policy', limit: 2 })).toHaveLength(2)
  })

  it('ignores chunks embedded with a different model', async () => {
    await seedPolicies()
    await db.query("UPDATE kb.chunks SET embedding_model = 'old-model'")
    expect(await results({ query: 'refund window' })).toEqual([])
  })

  it('ignores documents that are not ready', async () => {
    const { returns } = await seedPolicies()
    await db.query("UPDATE kb.documents SET status = 'processing' WHERE id = $1", [returns])
    expect((await results({ query: 'refund window' })).map((r) => r.documentId)).not.toContain(returns)
  })

  it('answers 503 when the embedding service is down', async () => {
    await app.close()
    const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })
    deps = makeDeps(db, await tempDir(), { embeddings: { ...fake, embed: async () => { throw new EmbeddingError('HTTP 503', true) } } })
    app = await buildTestApp(deps)
    const res = await search({ query: 'refund' })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('embedding_unavailable')
  })

  it('accepts a tenant admin or an internal service, and refuses a caller with no tenant', async () => {
    await seedPolicies()
    expect((await search({ query: 'refund' }, tenantHeaders(TENANT_A))).statusCode).toBe(200)
    expect((await search({ query: 'refund' }, internalHeaders())).statusCode).toBe(403)
  })

  it('validates the query', async () => {
    expect((await search({ query: '' })).statusCode).toBe(400)
    expect((await search({ query: '   ' })).statusCode).toBe(400)
    expect((await search({ query: 'x', limit: 11 })).statusCode).toBe(400)
  })
})
```

`services/kb-service/test/reindex.test.ts`:
```ts
import { EmbeddingError, createFakeEmbeddings, type EmbeddingProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDeps } from '../src/deps'
import { reindexStatus, reindexTenant } from '../src/reindex'
import { buildTestApp, makeDeps, resetDb, setupTestDb, tempDir, tenantHeaders, TENANT_A } from './helpers'
import { seedReadyDocument } from './seed'

let db: Db
let dir: string
let oldDeps: KbDeps
let app: FastifyInstance | undefined
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  dir = await tempDir()
  oldDeps = makeDeps(db, dir)
  await seedReadyDocument(oldDeps, TENANT_A, { filename: 'a.txt', data: 'Our refund window is 30 days.' })
  await seedReadyDocument(oldDeps, TENANT_A, { filename: 'b.txt', data: 'We ship in 2 days.' })
  await seedReadyDocument(oldDeps, TENANT_A, { filename: 'c.txt', data: 'Phones come with a charger.' })
})
afterEach(async () => { await app?.close(); app = undefined })

const modelB = createFakeEmbeddings({ model: 'b', dimensions: 1024 })
const withModel = (embeddings: EmbeddingProvider) => makeDeps(db, dir, { embeddings })

describe('re-indexing', () => {
  it('reports progress against the current model', async () => {
    const deps = withModel(modelB)
    expect(await reindexStatus(deps, TENANT_A)).toEqual({ running: false, total: 3, done: 0, model: 'fake:b:1024' })
    expect(await reindexStatus(oldDeps, TENANT_A)).toMatchObject({ total: 3, done: 3 })
  })

  it('re-embeds every chunk and updates the documents, via the API', async () => {
    const deps = withModel(modelB)
    app = await buildTestApp(deps)
    const start = await app.inject({ method: 'POST', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    expect(start.statusCode).toBe(202)
    await deps.reindex.idle()
    const status = await app.inject({ method: 'GET', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    expect(status.json()).toEqual({ running: false, total: 3, done: 3, model: 'fake:b:1024' })
    const docs = await db.query('SELECT DISTINCT embedding_model FROM kb.documents')
    expect(docs.rows).toEqual([{ embedding_model: 'fake:b:1024' }])
    const search = await app.inject({ method: 'POST', url: '/kb/search', headers: tenantHeaders(TENANT_A), payload: { query: 'refund window' } })
    expect(search.json().results.length).toBeGreaterThan(0)
  })

  it('stops on an embedding failure with accurate progress, and resumes on the next run', async () => {
    let calls = 0
    const failing: EmbeddingProvider = {
      ...modelB,
      embed: async (t) => {
        if (++calls === 2) throw new EmbeddingError('HTTP 503', true)
        return modelB.embed(t)
      },
    }
    await expect(reindexTenant(withModel(failing), TENANT_A, 1)).rejects.toBeInstanceOf(EmbeddingError)
    expect(await reindexStatus(withModel(modelB), TENANT_A)).toMatchObject({ total: 3, done: 1 })
    await reindexTenant(withModel(modelB), TENANT_A, 1)
    expect(await reindexStatus(withModel(modelB), TENANT_A)).toMatchObject({ total: 3, done: 3 })
  })

  it('runs at most one re-index per tenant at a time', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const embed = vi.fn(async (t: string[]) => { await gate; return modelB.embed(t) })
    const deps = withModel({ ...modelB, embed })
    app = await buildTestApp(deps)
    const first = await app.inject({ method: 'POST', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    expect(first.json().running).toBe(true)
    await app.inject({ method: 'POST', url: '/kb/reindex', headers: tenantHeaders(TENANT_A) })
    release()
    await deps.reindex.idle()
    expect(embed).toHaveBeenCalledTimes(1) // 3 chunks fit in one batch of 64
  })

  it('does nothing when every chunk already uses the current model', async () => {
    const embed = vi.fn(oldDeps.embeddings.embed)
    await reindexTenant({ ...oldDeps, embeddings: { ...oldDeps.embeddings, embed } }, TENANT_A)
    expect(embed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w services/kb-service -- search reindex`
Expected: FAIL. `../src/reindex` does not resolve.

- [ ] **Step 4: Implement the chunk queries**

Append to `services/kb-service/src/repos/chunks.ts`. First add `import type { KbSearchResult } from '@helpix/shared/api-types'` to its imports.
```ts
export async function searchChunks(
  db: Db,
  input: { tenantId: string; model: string; vector: number[]; limit: number },
): Promise<KbSearchResult[]> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // pgvector ≥ 0.8: keep walking the HNSW graph until `limit` rows pass the tenant/model filter, instead of
    // filtering a fixed candidate list (which can return too few rows for a small tenant).
    await client.query('SET LOCAL hnsw.iterative_scan = strict_order')
    const { rows } = await client.query<{ document_id: string; title: string; position: number; text: string; score: number }>(
      `SELECT c.document_id, d.title, c.position, c.text, 1 - (c.embedding <=> $1::vector) AS score
       FROM kb.chunks c
       JOIN kb.documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
       WHERE c.tenant_id = $2 AND c.embedding_model = $3 AND d.status = 'ready'
       ORDER BY c.embedding <=> $1::vector
       LIMIT $4`,
      [toVectorLiteral(input.vector), input.tenantId, input.model, input.limit],
    )
    await client.query('COMMIT')
    return rows.map((r) => ({ documentId: r.document_id, title: r.title, position: r.position, text: r.text, score: Number(r.score) }))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function chunksNeedingReindex(db: Db, tenantId: string, model: string, limit: number): Promise<{ id: string; text: string }[]> {
  const { rows } = await db.query<{ id: string; text: string }>(
    'SELECT id, text FROM kb.chunks WHERE tenant_id = $1 AND embedding_model <> $2 ORDER BY id LIMIT $3',
    [tenantId, model, limit],
  )
  return rows
}

export async function updateChunkEmbeddings(
  db: Db,
  tenantId: string,
  model: string,
  items: { id: string; vector: number[] }[],
): Promise<void> {
  await db.query(
    `UPDATE kb.chunks c SET embedding = u.embedding::vector, embedding_model = $2
     FROM unnest($3::uuid[], $4::text[]) AS u(id, embedding)
     WHERE c.id = u.id AND c.tenant_id = $1`,
    [tenantId, model, items.map((i) => i.id), items.map((i) => toVectorLiteral(i.vector))],
  )
}

/** Records the model on ready documents whose chunks are all on it. */
export async function markDocumentsModel(db: Db, tenantId: string, model: string): Promise<void> {
  await db.query(
    `UPDATE kb.documents d SET embedding_model = $2, updated_at = now()
     WHERE d.tenant_id = $1 AND d.status = 'ready' AND d.embedding_model IS DISTINCT FROM $2
       AND NOT EXISTS (SELECT 1 FROM kb.chunks c WHERE c.document_id = d.id AND c.embedding_model <> $2)`,
    [tenantId, model],
  )
}

export async function countChunks(db: Db, tenantId: string, model: string): Promise<{ total: number; done: number }> {
  const { rows } = await db.query<{ total: number; done: number }>(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE embedding_model = $2))::int AS done
     FROM kb.chunks WHERE tenant_id = $1`,
    [tenantId, model],
  )
  return rows[0]!
}
```

- [ ] **Step 5: Implement search and re-index**

`services/kb-service/src/search.ts`:
```ts
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
```

`services/kb-service/src/reindex.ts`:
```ts
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
```

- [ ] **Step 6: Implement the routes**

`services/kb-service/src/routes/search.ts`:
```ts
import { EmbeddingError } from '@helpix/llm'
import type { FastifyPluginAsync } from 'fastify'
import { AppError } from '@helpix/shared'
import type { KbSearchResponse } from '@helpix/shared/api-types'
import type { KbDeps } from '../deps'
import { scopedTenant } from '../lib/context'
import { search } from '../search'

const searchBody = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  },
} as const

export const searchRoutes: FastifyPluginAsync<KbDeps> = async (app, deps) => {
  app.post<{ Body: { query: string; limit?: number } }>(
    '/kb/search',
    { schema: { body: searchBody } },
    async (req): Promise<KbSearchResponse> => {
      const tenantId = scopedTenant(req)
      try {
        return { results: await search(deps, tenantId, req.body.query, req.body.limit ?? deps.config.searchTopK) }
      } catch (e) {
        if (e instanceof EmbeddingError) throw new AppError(503, 'embedding_unavailable', 'The embedding service is unavailable')
        throw e
      }
    },
  )
}
```

`services/kb-service/src/routes/reindex.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify'
import type { KbReindexStatus } from '@helpix/shared/api-types'
import type { KbDeps } from '../deps'
import { adminTenant } from '../lib/context'
import { reindexStatus, reindexTenant } from '../reindex'

export const reindexRoutes: FastifyPluginAsync<KbDeps> = async (app, deps) => {
  app.post('/kb/reindex', async (req, reply) => {
    const tenantId = adminTenant(req)
    deps.reindex.start(tenantId, () => reindexTenant(deps, tenantId))
    return reply.code(202).send(await reindexStatus(deps, tenantId))
  })

  app.get('/kb/reindex', async (req): Promise<KbReindexStatus> => reindexStatus(deps, adminTenant(req)))
}
```

In `services/kb-service/src/app.ts`, import both and register them after `documentRoutes`:
```ts
  await app.register(searchRoutes, deps)
  await app.register(reindexRoutes, deps)
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test -w services/kb-service && npm run typecheck -w services/kb-service`
Expected: all PASS. If `drops results below the similarity threshold` fails because an unrelated query scores ≥ 0.05, check for a hash collision between the query words and the seeded texts. Change the query words (for example `zebra giraffe`) rather than the threshold.

- [ ] **Step 8: Commit**

```bash
git add services/kb-service
git commit -m "feat(kb): tenant-scoped vector search with threshold and model filter, and resumable re-indexing"
```

---

### Task 7: Tenant isolation suite (kb-service)

This task adds tests only, for the highest-priority requirement in spec §10. If any test fails, fix the source in the task that owns it (routes in Task 5 or 6, queries in Task 4 or 6), and do not weaken the test.

**Files:**
- Test: `services/kb-service/test/isolation.test.ts`

**Interfaces:**
- Consumes: the HTTP routes from Tasks 5–6; `seedReadyDocument` (Task 4); helpers (Tasks 2, 5, 6).
- Produces: nothing new.

- [ ] **Step 1: Write the isolation tests**

`services/kb-service/test/isolation.test.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { createFakeEmbeddings } from '@helpix/llm'
import { HEADERS, type Db } from '@helpix/shared'
import type { KbDocumentView, KbSearchResult } from '@helpix/shared/api-types'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KbDeps } from '../src/deps'
import { buildTestApp, internalHeaders, makeDeps, resetDb, setupTestDb, tempDir, tenantHeaders, TENANT_A, TENANT_B, TEST_CONFIG } from './helpers'
import { seedReadyDocument } from './seed'

let db: Db
let dir: string
let deps: KbDeps
let app: FastifyInstance
let aDoc: string
let bDoc: string
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  dir = await tempDir()
  // No similarity threshold: any leak would show up in results.
  deps = makeDeps(db, dir, { config: { ...TEST_CONFIG, storageDir: dir, minScore: -1 } })
  app = await buildTestApp(deps)
  aDoc = await seedReadyDocument(deps, TENANT_A, { filename: 'a.md', title: 'A policy', data: 'Zebra returns policy: zebras may be returned within 30 days.' })
  bDoc = await seedReadyDocument(deps, TENANT_B, { filename: 'b.md', title: 'B policy', data: 'Giraffe shipping policy: giraffes ship in 2 days.' })
})
afterEach(async () => {
  await deps.jobs.idle()
  await app.close()
})

const as = (tenantId: string) => tenantHeaders(tenantId)
const superAdmin = () => ({ ...internalHeaders(), [HEADERS.role]: 'super_admin', [HEADERS.adminId]: randomUUID() })

async function aIsIntact() {
  const res = await app.inject({ method: 'GET', url: `/kb/documents/${aDoc}`, headers: as(TENANT_A) })
  expect(res.json()).toMatchObject({ id: aDoc, status: 'ready', chunkCount: 1 })
  expect(await deps.storage.get(`${TENANT_A}/${aDoc}`)).not.toBeNull()
}

describe('kb-service tenant isolation', () => {
  it("lists only the caller's documents", async () => {
    const res = await app.inject({ method: 'GET', url: '/kb/documents', headers: as(TENANT_B) })
    expect((res.json().documents as KbDocumentView[]).map((d) => d.id)).toEqual([bDoc])
  })

  it.each([
    ['GET', ''],
    ['GET', '/file'],
    ['GET', '/text'],
    ['POST', '/retry'],
    ['DELETE', ''],
  ] as const)("%s /kb/documents/:id%s on another tenant's document is 404 and changes nothing", async (method, suffix) => {
    const res = await app.inject({ method, url: `/kb/documents/${aDoc}${suffix}`, headers: as(TENANT_B) })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('document_not_found')
    await aIsIntact()
  })

  it("never returns another tenant's chunks from search, even with no threshold", async () => {
    const res = await app.inject({ method: 'POST', url: '/kb/search', headers: as(TENANT_B), payload: { query: 'zebra returns policy', limit: 10 } })
    const results = res.json().results as KbSearchResult[]
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.documentId === bDoc)).toBe(true)
  })

  it('ignores a tenant id in the body or query string', async () => {
    const search = await app.inject({
      method: 'POST',
      url: `/kb/search?tenantId=${TENANT_A}`,
      headers: as(TENANT_B),
      payload: { query: 'zebra', tenantId: TENANT_A },
    })
    expect((search.json().results as KbSearchResult[]).every((r) => r.documentId === bDoc)).toBe(true)

    const paste = await app.inject({
      method: 'POST',
      url: `/kb/documents/text?tenantId=${TENANT_A}`,
      headers: as(TENANT_B),
      payload: { title: 'Sneaky', text: 'hello' },
    })
    expect(paste.statusCode).toBe(202)
    await deps.jobs.idle()
    const bList = await app.inject({ method: 'GET', url: '/kb/documents', headers: as(TENANT_B) })
    expect((bList.json().documents as KbDocumentView[]).some((d) => d.title === 'Sneaky')).toBe(true)
    const aList = await app.inject({ method: 'GET', url: '/kb/documents', headers: as(TENANT_A) })
    expect((aList.json().documents as KbDocumentView[]).map((d) => d.id)).toEqual([aDoc])
  })

  it("re-indexing one tenant leaves the other's chunks alone", async () => {
    const other = makeDeps(db, dir, { embeddings: createFakeEmbeddings({ model: 'b', dimensions: 1024 }) })
    const otherApp = await buildTestApp(other)
    await otherApp.inject({ method: 'POST', url: '/kb/reindex', headers: as(TENANT_B) })
    await other.reindex.idle()
    await otherApp.close()
    const { rows } = await db.query('SELECT tenant_id, embedding_model FROM kb.chunks ORDER BY tenant_id')
    expect(rows).toEqual([
      { tenant_id: TENANT_A, embedding_model: 'fake:hash:1024' },
      { tenant_id: TENANT_B, embedding_model: 'fake:b:1024' },
    ])
  })

  const ROUTES = [
    ['GET', '/kb/documents', undefined],
    ['POST', '/kb/documents/text', { title: 't', text: 'x' }],
    ['GET', '/kb/documents/:id', undefined],
    ['GET', '/kb/documents/:id/file', undefined],
    ['GET', '/kb/documents/:id/text', undefined],
    ['DELETE', '/kb/documents/:id', undefined],
    ['POST', '/kb/documents/:id/retry', undefined],
    ['POST', '/kb/search', { query: 'zebra' }],
    ['POST', '/kb/reindex', undefined],
    ['GET', '/kb/reindex', undefined],
  ] as const

  it.each(ROUTES)('%s %s refuses a caller with no tenant (internal-only or super-admin)', async (method, path, payload) => {
    const url = path.replace(':id', aDoc)
    for (const headers of [internalHeaders(), superAdmin()]) {
      const res = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) })
      expect(res.statusCode).toBe(403)
    }
    await aIsIntact()
  })

  it.each(ROUTES)('%s %s refuses a request without the internal token', async (method, path, payload) => {
    const { [HEADERS.internalToken]: _dropped, ...headers } = as(TENANT_A)
    const res = await app.inject({ method, url: path.replace(':id', aDoc), headers, ...(payload ? { payload } : {}) })
    expect(res.statusCode).toBe(401)
  })

  it('stores each file under its own tenant prefix', async () => {
    expect(await deps.storage.get(`${TENANT_B}/${aDoc}`)).toBeNull()
    expect(await deps.storage.get(`${TENANT_A}/${aDoc}`)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the suite**

Run: `npm test -w services/kb-service -- isolation`
Expected: PASS. A failure is a real isolation bug. Fix the source and never loosen the assertion.

- [ ] **Step 3: Commit**

```bash
git add services/kb-service/test/isolation.test.ts
git commit -m "test(kb): tenant isolation suite for documents, files, chunks, search and re-index"
```

---
### Task 8: kb-service server, gateway `/kb/*` routing and stack wiring

**Files:**
- Create: `services/kb-service/src/server.ts`
- Modify: `services/gateway/src/config.ts`, `services/gateway/src/forward.ts`, `services/gateway/src/app.ts`
- Modify: `services/gateway/test/helpers.ts`, `services/gateway/test/config.test.ts`
- Test: `services/gateway/test/kb.test.ts`
- Modify: `docker-compose.yml`, `.env.example`, `.gitignore`, `Makefile`

**Interfaces:**
- Consumes: `buildApp`, `loadConfig`, `createJobRunner`, `createReindexTracker`, `sweepStuckDocuments`, `createLocalStorage` (kb-service); `createEmbeddingProvider` (Task 1).
- Produces:
  - `GatewayConfig` gains `kbServiceUrl: string` (env `KB_SERVICE_URL`, required) and `kbUploadLimitBytes: number` (env `KB_UPLOAD_LIMIT_BYTES`, default 11 MiB = 10 MB file plus multipart overhead).
  - `enforceBodyLimit(limit: number | ((req: FastifyRequest) => number))`
  - The gateway forwards `/kb/*` (GET, POST, PUT, PATCH, DELETE) to kb-service with the resolved admin identity. `POST /kb/documents` and `POST /kb/documents/text` get `kbUploadLimitBytes`. Every other request keeps `bodyLimitBytes`.
  - `testConfig(tenantAuthUrl: string, kbServiceUrl?: string)` in gateway test helpers.

- [ ] **Step 1: Write the failing gateway tests**

In `services/gateway/test/helpers.ts`, replace `testConfig` with:
```ts
export function testConfig(tenantAuthUrl: string, kbServiceUrl: string = tenantAuthUrl): GatewayConfig {
  return {
    port: 0,
    internalToken: TEST_INTERNAL_TOKEN,
    tenantAuthUrl,
    kbServiceUrl,
    corsOrigins: ['http://localhost:5173'],
    bodyLimitBytes: 1024,
    kbUploadLimitBytes: 4096,
    resolveCacheTtlMs: 30_000,
  }
}
```

In `services/gateway/test/config.test.ts`, change `ENV` to include the new variable and add a test:
```ts
const ENV = { INTERNAL_TOKEN: 'i'.repeat(32), TENANT_AUTH_URL: 'http://tenant-auth:4001', KB_SERVICE_URL: 'http://kb-service:4002' }
```
```ts
  it('requires KB_SERVICE_URL and defaults the upload limit to 11 MiB', () => {
    expect(() => loadConfig({ ...ENV, KB_SERVICE_URL: undefined })).toThrow('Missing required env var KB_SERVICE_URL')
    expect(loadConfig(ENV).kbUploadLimitBytes).toBe(11 * 1024 * 1024)
  })
```

`services/gateway/test/kb.test.ts`:
```ts
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { rawRequest, startEcho, testConfig } from './helpers'

let auth: Awaited<ReturnType<typeof startEcho>>
let kb: Awaited<ReturnType<typeof startEcho>>
let gw: FastifyInstance

const tenantAuth: TenantAuthClient = {
  resolveAdmin: vi.fn(async (token: string) => {
    if (token !== 'tenant-token') throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
    return { adminId: 'admin-a', role: 'tenant_admin' as const, tenantId: 'tenant-a' }
  }),
}

beforeEach(async () => {
  auth = await startEcho()
  kb = await startEcho()
  gw = await buildGateway({ config: testConfig(auth.url, kb.url), tenantAuth })
})
afterEach(async () => {
  await gw.close()
  await auth.close()
  await kb.close()
})

const bearer = { authorization: 'Bearer tenant-token' }
const post = (url: string, bytes: number) =>
  gw.inject({ method: 'POST', url, headers: { ...bearer, 'content-type': 'text/plain' }, payload: 'x'.repeat(bytes) })

describe('gateway /kb/* routes', () => {
  it('forwards to kb-service with the tenant identity and without the bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/kb/documents?x=1', headers: { ...bearer, 'x-tenant-id': 'tenant-b' } })
    expect(res.statusCode).toBe(200)
    expect(auth.calls).toHaveLength(0)
    expect(kb.calls).toHaveLength(1)
    const call = kb.calls[0]!
    expect(call.url).toBe('/kb/documents?x=1')
    expect(call.headers['x-tenant-id']).toBe('tenant-a')
    expect(call.headers['x-helpix-role']).toBe('tenant_admin')
    expect(call.headers['x-internal-token']).toBeDefined()
    expect(call.headers.authorization).toBeUndefined()
  })

  it('requires a bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/kb/documents' })
    expect(res.statusCode).toBe(401)
    expect(kb.calls).toHaveLength(0)
  })

  it('allows larger bodies only for KB uploads', async () => {
    expect((await post('/kb/documents', 3000)).statusCode).toBe(200)
    expect((await post('/kb/documents/text', 3000)).statusCode).toBe(200)
    expect((await post('/kb/documents', 5000)).statusCode).toBe(413)
    expect((await post('/kb/search', 3000)).statusCode).toBe(413)
    expect((await post('/kb/documents/abc/retry', 3000)).statusCode).toBe(413)
    expect((await post('/admin/tenants', 3000)).statusCode).toBe(413)
  })

  it('rejects path traversal out of /kb before resolving the token', async () => {
    await gw.listen({ port: 0, host: '127.0.0.1' })
    const { port } = gw.server.address() as AddressInfo
    for (const path of ['/kb/../admin/tenants', '/kb/%2e%2e/internal/resolve-admin']) {
      const res = await rawRequest(port, { method: 'GET', path, headers: bearer })
      expect(res.status).toBe(404)
    }
    expect(kb.calls).toHaveLength(0)
    expect(auth.calls).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the gateway tests to verify they fail**

Run: `npm test -w services/gateway`
Expected: FAIL. The `/kb/*` requests get 404 `not_found`, the config test reports that `kbUploadLimitBytes` is undefined, and the upload body-limit expectations fail.

- [ ] **Step 3: Implement the gateway changes**

`services/gateway/src/config.ts`: add to the interface
```ts
  kbServiceUrl: string
  /** Body limit for KB uploads (files and pasted text); everything else uses bodyLimitBytes. */
  kbUploadLimitBytes: number
```
and to the returned object
```ts
    kbServiceUrl: required('KB_SERVICE_URL'),
    kbUploadLimitBytes: Number(env.KB_UPLOAD_LIMIT_BYTES ?? 11 * 1024 * 1024),
```

`services/gateway/src/forward.ts`: replace `enforceBodyLimit` with
```ts
export function enforceBodyLimit(limit: number | ((req: FastifyRequest) => number)) {
  return async (req: FastifyRequest): Promise<void> => {
    const max = typeof limit === 'number' ? limit : limit(req)
    const len = req.headers['content-length']
    if (len !== undefined && Number(len) > max) {
      throw new AppError(413, 'payload_too_large', `Request body exceeds ${max} bytes`)
    }
    if (len === undefined && req.headers['transfer-encoding']) {
      throw new AppError(411, 'length_required', 'Content-Length is required')
    }
  }
}
```

`services/gateway/src/app.ts`:
1. Add this function above `buildGateway`:
```ts
/** KB uploads (a file up to 10 MB, or pasted text) are the only requests allowed past the default body limit. */
function isKbUpload(req: FastifyRequest): boolean {
  if (req.method !== 'POST') return false
  const q = req.url.indexOf('?')
  const pathname = q === -1 ? req.url : req.url.slice(0, q)
  return pathname === '/kb/documents' || pathname === '/kb/documents/text'
}
```
2. Replace `app.addHook('onRequest', enforceBodyLimit(config.bodyLimitBytes))` with:
```ts
  app.addHook('onRequest', enforceBodyLimit((req) => (isKbUpload(req) ? config.kbUploadLimitBytes : config.bodyLimitBytes)))
```
3. Replace the `/me` + `/admin/*` loop with one that also routes `/kb/*` to kb-service:
```ts
  for (const [url, routePrefix, target] of [
    ['/me', '/me', config.tenantAuthUrl],
    ['/admin/*', '/admin', config.tenantAuthUrl],
    ['/kb/*', '/kb', config.kbServiceUrl],
  ] as const) {
    app.route({
      method: [...METHODS],
      url,
      handler: async (req, reply) => {
        // Validate the path before resolving the bearer token so a traversal attempt never reaches a backend.
        const path = canonicalPath(req.url, routePrefix)
        return forward(req, reply, {
          target,
          internalToken: config.internalToken,
          routePrefix,
          path,
          identity: await adminIdentity(req),
        })
      },
    })
  }
```

- [ ] **Step 4: Run the gateway tests**

Run: `npm test -w services/gateway && npm run typecheck -w services/gateway`
Expected: all PASS, including the existing admin, forward and traversal tests.

- [ ] **Step 5: Write the kb-service entry point**

`services/kb-service/src/server.ts`:
```ts
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
```

- [ ] **Step 6: Wire the stack**

`docker-compose.yml`: add this service after `tenant-auth`:
```yaml
  kb-service:
    build:
      context: .
      dockerfile: docker/node-service.Dockerfile
    env_file: .env
    environment:
      SERVICE: kb-service
      PORT: "4002"
      DATABASE_URL: postgres://helpix:helpix@postgres:5432/helpix
      KB_STORAGE_DIR: /data/kb
    volumes:
      - kbfiles:/data/kb
    depends_on:
      postgres:
        condition: service_healthy
```
In the `gateway` service, add `KB_SERVICE_URL: http://kb-service:4002` under `environment` and `- kb-service` under `depends_on`. Replace the bottom `volumes:` block with:
```yaml
volumes:
  pgdata: {}
  kbfiles: {}
```

`.env.example`: append
```
KB_SERVICE_URL=http://localhost:4002
# Embeddings. "fake" works offline (keyword-overlap vectors; fine for development and tests, not for real answers).
# For GLM set EMBEDDING_PROVIDER=openai-compatible and EMBEDDING_API_KEY to your Zhipu key.
# EMBEDDING_BASE_URL defaults to https://open.bigmodel.cn/api/paas/v4 and EMBEDDING_MODEL to embedding-3.
EMBEDDING_PROVIDER=fake
EMBEDDING_API_KEY=
```
Then add the same lines to your local `.env`, because `make setup` only copies `.env.example` when `.env` is missing. Without `KB_SERVICE_URL`, the gateway will not start.

`.gitignore`: append `.data/` (where `make dev` keeps uploaded files).

`Makefile`:
- `start` help text: `## Docker stack (postgres, tenant-auth, kb-service, gateway :4000) + dashboard dev server :5173`
- `dev` target:
```make
dev: .env db ## Hot reload: postgres in Docker; tenant-auth, kb-service, gateway and dashboard run locally (Ctrl-C stops all)
	docker compose stop gateway tenant-auth kb-service
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	PORT=4001 npm run dev -w services/tenant-auth & \
	PORT=4002 npm run dev -w services/kb-service & \
	PORT=4000 npm run dev -w services/gateway & \
	npm run dev -w apps/admin-dashboard & \
	wait
```
- `reset-db` prompt text: `This permanently deletes all Helpix data (tenants, admins, KB documents and files, test DB). Type 'yes' to continue: `

- [ ] **Step 7: Bring the stack up and check it**

Run:
```bash
make up
docker compose logs kb-service | grep "kb-service: embeddings"
curl -s http://localhost:4000/kb/documents
```
Expected: `make up` prints `Ready`. The log line reads `kb-service: embeddings fake:hash:1024, files in /data/kb`. The curl prints `{"error":{"code":"unauthorized","message":"Missing bearer token",...}}`.

- [ ] **Step 8: Commit**

```bash
git add services/kb-service/src/server.ts services/gateway docker-compose.yml .env.example .gitignore Makefile
git commit -m "feat(gateway): route /kb/* to kb-service with a larger upload limit; add kb-service to the stack"
```

---

### Task 9: Dashboard API client (upload, blob, delete) and KB helpers

**Files:**
- Modify: `apps/admin-dashboard/src/api/client.ts`
- Create: `apps/admin-dashboard/src/lib/kb.ts`, `apps/admin-dashboard/src/lib/download.ts`, `apps/admin-dashboard/src/lib/polling.ts`
- Test: `apps/admin-dashboard/test/client.test.ts` (extend), `apps/admin-dashboard/test/kb.test.ts`, `apps/admin-dashboard/test/polling.test.ts`

**Interfaces:**
- Consumes: KB types from `@helpix/shared/api-types` (Task 2).
- Produces:
  - `ApiClient` gains `del(path): Promise<void>`, `upload<T>(path, form: FormData): Promise<T>` and `blob(path): Promise<Blob>`. All three share the refresh-on-401 and `ApiError` behaviour.
  - `src/lib/kb.ts`: `MAX_UPLOAD_BYTES`, `ACCEPTED_EXTENSIONS`, `ACCEPT_ATTR`, `type PreviewKind`, `previewKind(mime)`, `typeLabel(mime)`, `downloadName(doc)`, `validateUpload(file)`, `formatBytes(n)`, `hasPending(docs)`, `STATUS_LABEL`, `reindexSummary(status)`, `reindexPercent(status)`
  - `src/lib/download.ts`: `saveBlob(blob: Blob, filename: string): void`
  - `src/lib/polling.ts`: `usePolling(tick: () => Promise<void>, intervalMs: number, active: Ref<boolean>): void`

- [ ] **Step 1: Write the failing tests**

In `apps/admin-dashboard/test/client.test.ts`, add a `/file` branch to `fakeBackend`, directly after the `/empty` line:
```ts
    if (u.endsWith('/file')) return new Response('PDFDATA', { status: 200, headers: { 'content-type': 'application/pdf' } })
```
and add these tests inside `describe('createApiClient', …)`:
```ts
  it('uploads FormData as-is, letting fetch set the multipart content type', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    const form = new FormData()
    form.append('title', 'FAQ')
    await api.upload('/kb/documents', form)
    const headers = new Headers(calls[0]!.init.headers)
    expect(calls[0]!.init.body).toBe(form)
    expect(headers.get('content-type')).toBeNull()
    expect(headers.get('authorization')).toBe('Bearer new-access')
  })

  it('re-sends the same FormData after a token refresh', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'old-access', refreshToken: 'r1' }), fetch })
    const form = new FormData()
    await api.upload('/kb/documents', form)
    expect(calls.map((c) => c.url)).toEqual(['http://gw/kb/documents', 'http://gw/auth/refresh', 'http://gw/kb/documents'])
    expect(calls[2]!.init.body).toBe(form)
  })

  it('fetches binary responses as a Blob and maps errors', async () => {
    const { fetch } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    const blob = await api.blob('/kb/documents/1/file')
    expect(await blob.text()).toBe('PDFDATA')
    await expect(api.blob('/conflict')).rejects.toMatchObject({ status: 409, code: 'slug_taken' })
  })

  it('sends DELETE and resolves 204 to undefined', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    expect(await api.del('/empty')).toBeUndefined()
    expect(calls[0]!.init.method).toBe('DELETE')
  })
```

`apps/admin-dashboard/test/kb.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import {
  downloadName,
  formatBytes,
  hasPending,
  previewKind,
  reindexPercent,
  reindexSummary,
  typeLabel,
  validateUpload,
} from '../src/lib/kb'

const doc = (over: Partial<KbDocumentView>): KbDocumentView => ({
  id: '1', title: 'Returns', mimeType: 'text/markdown', sizeBytes: 10, status: 'ready', error: null,
  chunkCount: 1, createdAt: '', updatedAt: '', ...over,
})

describe('kb helpers', () => {
  it('maps MIME types to preview kinds, labels and download names', () => {
    expect(previewKind('application/pdf')).toBe('pdf')
    expect(previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
    expect(previewKind('text/markdown')).toBe('markdown')
    expect(previewKind('text/plain')).toBe('text')
    expect(previewKind('image/png')).toBeNull()
    expect(typeLabel('application/pdf')).toBe('PDF')
    expect(typeLabel('image/png')).toBe('File')
    expect(downloadName(doc({ title: 'Return policy', mimeType: 'application/pdf' }))).toBe('Return policy.pdf')
  })

  it('validates uploads before sending them', () => {
    expect(validateUpload({ name: 'faq.PDF', size: 100 })).toBeNull()
    expect(validateUpload({ name: 'notes.markdown', size: 100 })).toBeNull()
    expect(validateUpload({ name: 'setup.exe', size: 100 })).toBe('Choose a PDF, DOCX, Markdown or TXT file.')
    expect(validateUpload({ name: 'noext', size: 100 })).toBe('Choose a PDF, DOCX, Markdown or TXT file.')
    expect(validateUpload({ name: 'a.txt', size: 0 })).toBe('This file is empty.')
    expect(validateUpload({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 })).toBe('Files must be 10 MB or smaller.')
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024)).toBe('20 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB')
  })

  it('knows when documents are still processing', () => {
    expect(hasPending([doc({}), doc({ status: 'failed' })])).toBe(false)
    expect(hasPending([doc({}), doc({ status: 'processing' })])).toBe(true)
  })

  it('summarises re-index status', () => {
    const s = { running: false, total: 12, done: 12, model: 'm' }
    expect(reindexSummary({ ...s, total: 0, done: 0 })).toBe('Nothing indexed yet.')
    expect(reindexSummary(s)).toBe('Up to date: all 12 chunks use the current embedding model.')
    expect(reindexSummary({ ...s, total: 1, done: 1 })).toBe('Up to date: all 1 chunk uses the current embedding model.')
    expect(reindexSummary({ ...s, done: 3 })).toBe('3 of 12 chunks use the current embedding model. Re-index so search includes the rest.')
    expect(reindexSummary({ ...s, done: 3, running: true })).toBe('Re-indexing… 3 of 12 chunks done.')
    expect(reindexPercent({ ...s, done: 3 })).toBe(25)
    expect(reindexPercent({ ...s, total: 0, done: 0 })).toBe(100)
  })
})
```

`apps/admin-dashboard/test/polling.test.ts`:
```ts
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { usePolling } from '../src/lib/polling'

function host(tick: () => Promise<void>, active: Ref<boolean>, intervalMs = 1000) {
  return mount(defineComponent({ setup() { usePolling(tick, intervalMs, active); return () => null } }))
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('usePolling', () => {
  it('ticks while active, pauses when inactive and stops on unmount', async () => {
    const tick = vi.fn(async () => {})
    const active = ref(true)
    const w = host(tick, active)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(3)
    active.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(3)
    active.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(tick).toHaveBeenCalledTimes(4)
    w.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(tick).toHaveBeenCalledTimes(4)
  })

  it('never overlaps a slow tick and survives a failing one', async () => {
    let calls = 0
    const tick = vi.fn(async () => {
      calls++
      if (calls === 1) await new Promise((r) => setTimeout(r, 5000))
      if (calls === 2) throw new Error('network')
    })
    host(tick, ref(true))
    await vi.advanceTimersByTimeAsync(1000) // first tick starts, runs 5 s
    await vi.advanceTimersByTimeAsync(4500)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1500) // finished at 6 s, next at 7 s (fails)
    expect(tick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000) // keeps polling after a failure
    expect(tick).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w apps/admin-dashboard -- client kb polling`
Expected: FAIL. `api.upload`, `api.blob` and `api.del` are not functions, and `../src/lib/kb` and `../src/lib/polling` do not resolve.

- [ ] **Step 3: Extend the API client**

In `apps/admin-dashboard/src/api/client.ts`:

Replace `send` with:
```ts
  function send(method: Method, path: string, body: unknown, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = {}
    // For FormData, fetch sets multipart/form-data with the boundary itself.
    const form = body instanceof FormData
    if (body !== undefined && !form) headers['content-type'] = 'application/json'
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    return doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    })
  }
```

Replace `request` with `fetchOk` + `request`:
```ts
  /** Sends with the current token, refreshing once on 401. Throws ApiError for any non-2xx response. */
  async function fetchOk(method: Method, path: string, body?: unknown): Promise<Response> {
    let res = await send(method, path, body, opts.tokens.get()?.accessToken)
    if (res.status === 401 && opts.tokens.get()) {
      if (await refreshOnce()) res = await send(method, path, body, opts.tokens.get()?.accessToken)
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; requestId?: string } } | null
      throw new ApiError(res.status, err?.error?.code ?? 'http_error', err?.error?.message ?? res.statusText, err?.error?.requestId)
    }
    return res
  }

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const res = await fetchOk(method, path, body)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }
```

Replace the returned object with:
```ts
  return {
    request,
    invalidate,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
    del: (path: string) => request<void>('DELETE', path),
    /** Posts multipart form data, e.g. a file upload. */
    upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
    /** Fetches a binary response, e.g. a stored file to preview or download. */
    blob: async (path: string): Promise<Blob> => (await fetchOk('GET', path)).blob(),
  }
```

- [ ] **Step 4: Write the helpers**

`apps/admin-dashboard/src/lib/kb.ts`:
```ts
import type { DocumentStatus, KbDocumentView, KbReindexStatus } from '@helpix/shared/api-types'

// Mirrors kb-service's KB_MAX_FILE_BYTES default; the server checks again.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt'] as const
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',')

export type PreviewKind = 'pdf' | 'docx' | 'markdown' | 'text'

const KIND_BY_MIME: Record<string, PreviewKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/markdown': 'markdown',
  'text/plain': 'text',
}
const LABEL: Record<PreviewKind, string> = { pdf: 'PDF', docx: 'Word', markdown: 'Markdown', text: 'Text' }
const EXTENSION: Record<PreviewKind, string> = { pdf: '.pdf', docx: '.docx', markdown: '.md', text: '.txt' }

export const STATUS_LABEL: Record<DocumentStatus, string> = { processing: 'Processing', ready: 'Ready', failed: 'Failed' }

export function previewKind(mimeType: string): PreviewKind | null {
  return KIND_BY_MIME[mimeType] ?? null
}

export function typeLabel(mimeType: string): string {
  const kind = previewKind(mimeType)
  return kind ? LABEL[kind] : 'File'
}

export function downloadName(doc: Pick<KbDocumentView, 'title' | 'mimeType'>): string {
  const kind = previewKind(doc.mimeType)
  return doc.title + (kind ? EXTENSION[kind] : '')
}

/** Returns an error message, or null when the file may be uploaded. */
export function validateUpload(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.')
  const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase()
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) return 'Choose a PDF, DOCX, Markdown or TXT file.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 10 MB or smaller.'
  return null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function hasPending(docs: KbDocumentView[]): boolean {
  return docs.some((d) => d.status === 'processing')
}

const chunks = (n: number) => `${n} chunk${n === 1 ? '' : 's'}`

export function reindexSummary(s: KbReindexStatus): string {
  if (s.total === 0) return 'Nothing indexed yet.'
  if (s.running) return `Re-indexing… ${s.done} of ${chunks(s.total)} done.`
  if (s.done === s.total) return `Up to date: all ${chunks(s.total)} ${s.total === 1 ? 'uses' : 'use'} the current embedding model.`
  return `${s.done} of ${chunks(s.total)} use the current embedding model. Re-index so search includes the rest.`
}

export function reindexPercent(s: KbReindexStatus): number {
  return s.total === 0 ? 100 : Math.floor((s.done / s.total) * 100)
}
```

`apps/admin-dashboard/src/lib/download.ts`:
```ts
/** Saves a blob as a file through a temporary object URL. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

`apps/admin-dashboard/src/lib/polling.ts`:
```ts
import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Calls `tick` every `intervalMs` while `active` is true, never overlapping a slow tick. Stops on unmount. */
export function usePolling(tick: () => Promise<void>, intervalMs: number, active: Ref<boolean>): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  function schedule() {
    clearTimeout(timer)
    timer = undefined
    if (!stopped && active.value) timer = setTimeout(run, intervalMs)
  }

  async function run() {
    try {
      await tick()
    } catch {
      // The next tick tries again; the page shows its own load errors.
    } finally {
      schedule()
    }
  }

  watch(active, schedule, { immediate: true })
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -w apps/admin-dashboard && npm run typecheck -w apps/admin-dashboard`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat(dashboard): API client upload/blob/delete, KB formatting helpers and polling"
```

---

### Task 10: Knowledge base page with upload, table, download, retry and delete

**Files:**
- Modify: `apps/admin-dashboard/src/auth/guard.ts`, `apps/admin-dashboard/src/router.ts`, `apps/admin-dashboard/src/layouts/AppLayout.vue`
- Delete: `apps/admin-dashboard/src/pages/TenantHomePage.vue`
- Create: `apps/admin-dashboard/src/components/kb/UploadDialog.vue`, `apps/admin-dashboard/src/pages/KnowledgeBasePage.vue`
- Test: `apps/admin-dashboard/test/guard.test.ts` (update), `apps/admin-dashboard/test/uploadDialog.test.ts`, `apps/admin-dashboard/test/knowledgeBasePage.test.ts`

**Interfaces:**
- Consumes: `api.get/post/del/upload/blob` (Task 9); `validateUpload`, `formatBytes`, `ACCEPT_ATTR`, `typeLabel`, `downloadName`, `hasPending`, `STATUS_LABEL` (Task 9); `saveBlob`, `usePolling` (Task 9); `ConfirmDialog` (step 1); KB HTTP routes (Tasks 5, 8).
- Produces:
  - Route `/kb` (tenant admins' home). `/home` redirects to `/kb`. `homeFor(tenantMe) === '/kb'`.
  - `UploadDialog.vue`: props `open: boolean`; emits `update:open`, `created(doc: KbDocumentView)`
  - `KnowledgeBasePage.vue` (Task 11 adds preview and the re-index card)

- [ ] **Step 1: Update the guard tests and write the failing component tests**

In `apps/admin-dashboard/test/guard.test.ts`, change the three `'/home'` expectations to `'/kb'`.

`apps/admin-dashboard/test/uploadDialog.test.ts`:
```ts
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import UploadDialog from '../src/components/kb/UploadDialog.vue'

vi.mock('@/auth/session', () => ({ api: { upload: vi.fn(), post: vi.fn() } }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})
beforeEach(() => {
  vi.mocked(api.upload).mockReset()
  vi.mocked(api.post).mockReset()
})

async function pick(w: VueWrapper, file: File) {
  const input = w.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

const submitButton = (w: VueWrapper) => w.find('button[type="submit"]')

describe('UploadDialog', () => {
  it('refuses an unsupported file before uploading', async () => {
    const w = mount(UploadDialog, { props: { open: true } })
    await pick(w, new File(['MZ'], 'setup.exe'))
    expect(w.find('[role="alert"]').text()).toBe('Choose a PDF, DOCX, Markdown or TXT file.')
    expect(submitButton(w).attributes('disabled')).toBeDefined()
  })

  it('uploads a file with the title field first, then closes', async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: 'd1' } as KbDocumentView)
    const w = mount(UploadDialog, { props: { open: true } })
    await pick(w, new File(['# Hi'], 'faq.md'))
    await w.find('#kb-title').setValue('FAQ')
    await w.find('form').trigger('submit')
    await flushPromises()
    const [path, form] = vi.mocked(api.upload).mock.calls[0]!
    expect(path).toBe('/kb/documents')
    expect([...(form as FormData).keys()]).toEqual(['title', 'file'])
    expect(w.emitted('created')![0]).toEqual([{ id: 'd1' }])
    expect(w.emitted('update:open')!.at(-1)).toEqual([false])
  })

  it('posts pasted text', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 'd2' } as KbDocumentView)
    const w = mount(UploadDialog, { props: { open: true } })
    await w.findAll('[role="tab"]')[1]!.trigger('click')
    await w.find('#kb-title').setValue('Hours')
    await w.find('#kb-text').setValue('Open Mon–Fri')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/kb/documents/text', { title: 'Hours', text: 'Open Mon–Fri' })
  })

  it('shows the server error and stays open', async () => {
    vi.mocked(api.upload).mockRejectedValue(new ApiError(409, 'document_limit_reached', 'This knowledge base already has the maximum of 200 documents.'))
    const w = mount(UploadDialog, { props: { open: true } })
    await pick(w, new File(['hi'], 'a.txt'))
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('maximum of 200 documents')
    expect(w.emitted('update:open')).toBeUndefined()
  })
})
```

`apps/admin-dashboard/test/knowledgeBasePage.test.ts`:
```ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { api } from '../src/auth/session'
import KnowledgeBasePage from '../src/pages/KnowledgeBasePage.vue'

vi.mock('@/auth/session', () => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), upload: vi.fn(), blob: vi.fn() },
  session: { state: { me: { tenant: { name: 'Teen Fashion' } } } },
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})

const doc = (over: Partial<KbDocumentView>): KbDocumentView => ({
  id: 'd1', title: 'Returns', mimeType: 'text/markdown', sizeBytes: 2048, status: 'ready', error: null,
  chunkCount: 3, createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z', ...over,
})

beforeEach(() => {
  for (const fn of Object.values(api)) vi.mocked(fn as (...a: unknown[]) => unknown).mockReset()
})

function getReturns(documents: KbDocumentView[]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/kb/documents') return { documents }
    if (path === '/kb/reindex') return { running: false, total: 3, done: 3, model: 'fake:hash:1024' }
    throw new Error(`unexpected GET ${path}`)
  })
}

describe('KnowledgeBasePage', () => {
  it('shows an empty state when there are no documents', async () => {
    getReturns([])
    const w = mount(KnowledgeBasePage)
    await flushPromises()
    expect(w.text()).toContain('No documents yet')
  })

  it('lists documents with status, and shows the failure reason and Retry only for failed ones', async () => {
    getReturns([doc({}), doc({ id: 'd2', title: 'Scan', status: 'failed', error: 'No text found in this PDF.' })])
    const w = mount(KnowledgeBasePage)
    await flushPromises()
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Ready')
    expect(rows[0]!.text()).not.toContain('Retry')
    expect(rows[1]!.text()).toContain('No text found in this PDF.')
    expect(rows[1]!.text()).toContain('Retry')
  })

  it('retries a failed document and shows it processing', async () => {
    getReturns([doc({ status: 'failed', error: 'x' })])
    vi.mocked(api.post).mockResolvedValue(doc({ status: 'processing' }))
    const w = mount(KnowledgeBasePage)
    await flushPromises()
    await w.findAll('tbody tr button').find((b) => b.text() === 'Retry')!.trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/kb/documents/d1/retry')
    expect(w.find('tbody tr').text()).toContain('Processing')
  })

  it('deletes a document after confirmation', async () => {
    getReturns([doc({})])
    vi.mocked(api.del).mockResolvedValue(undefined)
    const w = mount(KnowledgeBasePage, { attachTo: document.body })
    await flushPromises()
    await w.findAll('tbody tr button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()
    const confirm = w.findAll('dialog button').find((b) => b.text() === 'Delete')!
    await confirm.trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/kb/documents/d1')
    expect(w.findAll('tbody tr')).toHaveLength(0)
    w.unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w apps/admin-dashboard -- guard uploadDialog knowledgeBasePage`
Expected: FAIL. The guard still returns `/home`, and the two component files do not exist.

- [ ] **Step 3: Route tenant admins to the KB page**

`apps/admin-dashboard/src/auth/guard.ts`: change `homeFor` to return `'/kb'` for tenant admins:
```ts
export function homeFor(me: MeResponse): string {
  return me.admin.role === 'super_admin' ? '/tenants' : '/kb'
}
```

`apps/admin-dashboard/src/router.ts`: replace the `home` child route with:
```ts
        { path: 'kb', component: () => import('@/pages/KnowledgeBasePage.vue'), meta: { role: 'tenant_admin' } },
        // Step 1 sent tenant admins to /home; keep old bookmarks working.
        { path: 'home', redirect: '/kb' },
```

Delete the old page: `git rm apps/admin-dashboard/src/pages/TenantHomePage.vue`

`apps/admin-dashboard/src/layouts/AppLayout.vue`: replace the logo `RouterLink` with a group that also holds the tenant-admin nav:
```vue
        <div class="flex items-center gap-6">
          <RouterLink to="/" aria-label="helpix home" class="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <HelpixLogo class="h-6" />
          </RouterLink>
          <nav v-if="session.state.me?.admin.role === 'tenant_admin'" aria-label="Main" class="flex items-center gap-1 text-sm">
            <RouterLink
              to="/kb"
              class="rounded-md px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              active-class="bg-secondary text-foreground"
            >
              Knowledge base
            </RouterLink>
          </nav>
        </div>
```

- [ ] **Step 4: Write the upload dialog**

`apps/admin-dashboard/src/components/kb/UploadDialog.vue`:
```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { ACCEPT_ATTR, formatBytes, validateUpload } from '@/lib/kb'

type Mode = 'file' | 'text'
const MODES: { value: Mode; label: string }[] = [
  { value: 'file', label: 'Upload file' },
  { value: 'text', label: 'Paste text' },
]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [doc: KbDocumentView] }>()

const mode = ref<Mode>('file')
const file = ref<File | null>(null)
const title = ref('')
const text = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// Every opening starts clean.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    mode.value = 'file'
    file.value = null
    title.value = ''
    text.value = ''
    error.value = null
  },
)

const canSubmit = computed(
  () => !busy.value && (mode.value === 'file' ? file.value !== null : title.value.trim() !== '' && text.value.trim() !== ''),
)

function setMode(m: Mode) {
  mode.value = m
  error.value = null
}

function onFileChange(event: Event) {
  const picked = (event.target as HTMLInputElement).files?.[0] ?? null
  error.value = picked ? validateUpload(picked) : null
  file.value = picked && !error.value ? picked : null
}

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = null
  try {
    let doc: KbDocumentView
    if (mode.value === 'file') {
      const form = new FormData()
      // The title must come before the file: the server only sees fields sent ahead of the file part.
      if (title.value.trim()) form.append('title', title.value.trim())
      form.append('file', file.value!)
      doc = await api.upload<KbDocumentView>('/kb/documents', form)
    } else {
      doc = await api.post<KbDocumentView>('/kb/documents/text', { title: title.value.trim(), text: text.value })
    }
    emit('created', doc)
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'The upload failed. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add to knowledge base</DialogTitle>
        <DialogDescription>The agent answers from these documents. Processing takes a few seconds.</DialogDescription>
      </DialogHeader>

      <div role="tablist" aria-label="Source" class="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          role="tab"
          :aria-selected="mode === m.value"
          class="rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="setMode(m.value)"
        >
          {{ m.label }}
        </button>
      </div>

      <form id="kb-upload" class="grid gap-4" @submit.prevent="submit">
        <div v-if="mode === 'file'" class="grid gap-2">
          <Label for="kb-file">File</Label>
          <input
            id="kb-file"
            type="file"
            :accept="ACCEPT_ATTR"
            class="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
            @change="onFileChange"
          />
          <p class="text-xs text-muted-foreground">
            PDF, DOCX, Markdown or TXT, up to 10 MB.
            <template v-if="file">Selected: {{ file.name }} ({{ formatBytes(file.size) }})</template>
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="kb-title">
            Title<span v-if="mode === 'file'" class="font-normal text-muted-foreground"> (optional)</span>
          </Label>
          <Input
            id="kb-title"
            v-model="title"
            maxlength="200"
            :placeholder="mode === 'file' ? 'Defaults to the file name' : 'e.g. Return policy'"
          />
        </div>
        <div v-if="mode === 'text'" class="grid gap-2">
          <Label for="kb-text">Text</Label>
          <Textarea id="kb-text" v-model="text" rows="10" maxlength="200000" placeholder="Paste a policy, FAQ or product notes" />
        </div>
      </form>

      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
        <Button type="submit" form="kb-upload" :disabled="!canSubmit">{{ busy ? 'Adding…' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 5: Write the page**

`apps/admin-dashboard/src/pages/KnowledgeBasePage.vue`:
```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api, session } from '@/auth/session'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import UploadDialog from '@/components/kb/UploadDialog.vue'
import { saveBlob } from '@/lib/download'
import { formatDate } from '@/lib/format'
import { downloadName, formatBytes, hasPending, STATUS_LABEL, typeLabel } from '@/lib/kb'
import { usePolling } from '@/lib/polling'

const BADGE = { processing: 'secondary', ready: 'positive', failed: 'negative' } as const

const docs = ref<KbDocumentView[]>([])
const loaded = ref(false)
const pageError = ref<string | null>(null)
const rowError = ref<string | null>(null)
const uploadOpen = ref(false)

// Kept after the dialog closes so its title does not change while it fades out.
const toDelete = ref<KbDocumentView | null>(null)
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

async function load() {
  try {
    docs.value = (await api.get<{ documents: KbDocumentView[] }>('/kb/documents')).documents
    pageError.value = null
  } catch (e) {
    pageError.value = message(e, 'Could not load the knowledge base')
  } finally {
    loaded.value = true
  }
}

// Refresh while anything is processing, so statuses flip to Ready or Failed on their own.
usePolling(load, 2000, computed(() => hasPending(docs.value)))

function replace(doc: KbDocumentView) {
  docs.value = docs.value.map((d) => (d.id === doc.id ? doc : d))
}

function onCreated(doc: KbDocumentView) {
  docs.value = [doc, ...docs.value]
}

async function retry(doc: KbDocumentView) {
  rowError.value = null
  try {
    replace(await api.post<KbDocumentView>(`/kb/documents/${doc.id}/retry`))
  } catch (e) {
    rowError.value = message(e, 'Could not retry the document')
  }
}

async function download(doc: KbDocumentView) {
  rowError.value = null
  try {
    saveBlob(await api.blob(`/kb/documents/${doc.id}/file`), downloadName(doc))
  } catch (e) {
    rowError.value = message(e, 'Could not download the file')
  }
}

function askDelete(doc: KbDocumentView) {
  toDelete.value = doc
  deleteError.value = null
  deleteOpen.value = true
}

async function confirmDelete() {
  const doc = toDelete.value
  if (!doc) return
  deleting.value = true
  deleteError.value = null
  try {
    await api.del(`/kb/documents/${doc.id}`)
    docs.value = docs.value.filter((d) => d.id !== doc.id)
    deleteOpen.value = false
  } catch (e) {
    deleteError.value = message(e, 'Could not delete the document')
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="grid gap-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="grid gap-1">
        <p class="text-sm text-muted-foreground">{{ session.state.me?.tenant?.name }}</p>
        <h1 class="text-2xl font-semibold">Knowledge base</h1>
        <p class="text-sm text-muted-foreground">Documents the agent answers from. Only your shop can see them.</p>
      </div>
      <Button @click="uploadOpen = true">Add document</Button>
    </div>

    <p v-if="pageError" class="text-sm text-destructive" role="alert">{{ pageError }}</p>
    <p v-if="rowError" class="text-sm text-destructive" role="alert">{{ rowError }}</p>

    <Card v-if="loaded && !pageError" class="py-0">
      <CardContent class="px-0">
        <EmptyState
          v-if="docs.length === 0"
          title="No documents yet"
          description="Upload your return policy, shipping FAQ or product notes so the agent can answer from them."
        >
          <Button @click="uploadOpen = true">Add document</Button>
        </EmptyState>
        <Table v-else>
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead class="pl-6">Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead class="pr-6"><span class="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="doc in docs" :key="doc.id">
              <TableCell class="max-w-72 py-3 pl-6">
                <p class="truncate font-medium" :title="doc.title">{{ doc.title }}</p>
                <p v-if="doc.status === 'failed' && doc.error" class="mt-0.5 text-xs text-destructive">{{ doc.error }}</p>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ typeLabel(doc.mimeType) }}</TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">{{ formatBytes(doc.sizeBytes) }}</TableCell>
              <TableCell>
                <Badge :variant="BADGE[doc.status]" dot>{{ STATUS_LABEL[doc.status] }}</Badge>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">{{ formatDate(doc.createdAt) }}</TableCell>
              <TableCell class="pr-6">
                <div class="flex justify-end gap-1">
                  <Button v-if="doc.status === 'failed'" variant="outline" size="sm" @click="retry(doc)">Retry</Button>
                  <Button variant="ghost" size="sm" @click="download(doc)">Download</Button>
                  <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="askDelete(doc)">Delete</Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <UploadDialog v-model:open="uploadOpen" @created="onCreated" />
    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="`Delete ${toDelete?.title ?? 'document'}?`"
      description="The file and everything the agent learned from it are removed. This cannot be undone."
      confirm-label="Delete"
      destructive
      :busy="deleting"
      :error="deleteError"
      @confirm="confirmDelete"
    />
  </div>
</template>
```

- [ ] **Step 6: Run the tests, typecheck and build**

Run: `npm test -w apps/admin-dashboard && npm run typecheck -w apps/admin-dashboard && npm run build -w apps/admin-dashboard`
Expected: all PASS, and the build succeeds.

- [ ] **Step 7: Check it in the browser**

With the stack running (`make start`, or `make dev` after `docker compose up -d --wait postgres`), log in as a tenant admin. If you don't have one, create a tenant and an admin as the super-admin first. Check that:
- Login lands on `/kb`, the header shows **Knowledge base**, and `/home` redirects to `/kb`.
- Uploading a `.md` file shows a Processing row that turns Ready by itself within a few seconds.
- Picking a `.exe` shows the inline error. Pasting text creates a Text row.
- Download saves the original file, and Delete removes the row after confirmation.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat(dashboard): knowledge base page with upload, paste, status polling, download, retry and delete"
```

---

### Task 11: Document preview and re-index card

**Files:**
- Modify: `packages/ui/src/components/DialogContent.vue`, `packages/ui/test/components.test.ts`
- Create: `apps/admin-dashboard/src/lib/markdown.ts`, `apps/admin-dashboard/src/components/kb/DocumentPreviewDialog.vue`, `apps/admin-dashboard/src/components/kb/ReindexCard.vue`
- Modify: `apps/admin-dashboard/src/pages/KnowledgeBasePage.vue`, `apps/admin-dashboard/src/styles.css`
- Test: `apps/admin-dashboard/test/markdown.test.ts`, `apps/admin-dashboard/test/previewDialog.test.ts`, `apps/admin-dashboard/test/reindexCard.test.ts`

**Interfaces:**
- Consumes: `api.get/post/blob` (Task 9); `previewKind`, `typeLabel`, `formatBytes`, `downloadName`, `reindexSummary`, `reindexPercent` (Task 9); `saveBlob`, `usePolling` (Task 9); `GET /kb/documents/:id/file`, `GET /kb/documents/:id/text`, `GET|POST /kb/reindex`.
- Produces:
  - `DialogContent` gains `dialogClass?: ClassValue`, merged into the `<dialog>` classes (for example `max-w-4xl` replaces `max-w-lg`).
  - `renderMarkdown(source: string): string` (sanitised HTML)
  - `DocumentPreviewDialog.vue`: props `open: boolean`, `doc: KbDocumentView | null`; emits `update:open`
  - `ReindexCard.vue`: exposes `refresh(): Promise<void>`

- [ ] **Step 1: Install the Markdown dependencies**

Run: `npm install -w apps/admin-dashboard marked@^18.0.14 dompurify@^3.4.16`

- [ ] **Step 2: Write the failing tests**

Append to `packages/ui/test/components.test.ts`, and add `h` to its `vue` import:
```ts
describe('DialogContent dialogClass', () => {
  it('merges dialogClass into the dialog element, overriding the default width', () => {
    const Harness = defineComponent({
      setup: () => () => h(Dialog, { open: true }, () => h(DialogContent, { dialogClass: 'max-w-4xl' }, () => 'Body')),
    })
    const dialog = mount(Harness).find('dialog')
    expect(dialog.classes()).toContain('max-w-4xl')
    expect(dialog.classes()).not.toContain('max-w-lg')
  })
})
```

`apps/admin-dashboard/test/markdown.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/lib/markdown'

describe('renderMarkdown', () => {
  it('renders headings, lists and emphasis', () => {
    const html = renderMarkdown('# Returns\n\n- **30 days**\n- free')
    expect(html).toContain('<h1>Returns</h1>')
    expect(html).toContain('<li><strong>30 days</strong></li>')
  })

  it('strips scripts, event handlers and javascript: links from tenant content', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[click](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })
})
```

`apps/admin-dashboard/test/previewDialog.test.ts`:
```ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { api } from '../src/auth/session'
import DocumentPreviewDialog from '../src/components/kb/DocumentPreviewDialog.vue'

vi.mock('@/auth/session', () => ({ api: { get: vi.fn(), blob: vi.fn() } }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})
beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.blob).mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const doc = (mimeType: string): KbDocumentView => ({
  id: 'd1', title: 'Returns', mimeType, sizeBytes: 10, status: 'ready', error: null, chunkCount: 1, createdAt: '', updatedAt: '',
})

describe('DocumentPreviewDialog', () => {
  it('shows a PDF in the browser viewer through an object URL, and revokes it on unmount', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('application/pdf') } })
    await flushPromises()
    expect(api.blob).toHaveBeenCalledWith('/kb/documents/d1/file')
    expect(w.find('iframe').attributes('src')).toBe('blob:preview')
    w.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('renders Markdown inline, sanitised', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['# Hello\n\n<script>alert(1)</script>']))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('text/markdown') } })
    await flushPromises()
    expect(w.find('.kb-markdown h1').text()).toBe('Hello')
    expect(w.find('.kb-markdown').html()).not.toContain('<script')
  })

  it('shows plain text as preformatted text', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['Line 1\nLine 2']))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('text/plain') } })
    await flushPromises()
    expect(w.find('pre').text()).toBe('Line 1\nLine 2')
  })

  it('shows extracted text for DOCX without downloading the file', async () => {
    vi.mocked(api.get).mockResolvedValue({ text: 'Ships in 2 days' })
    const w = mount(DocumentPreviewDialog, {
      props: { open: true, doc: doc('application/vnd.openxmlformats-officedocument.wordprocessingml.document') },
    })
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/kb/documents/d1/text')
    expect(api.blob).not.toHaveBeenCalled()
    expect(w.find('pre').text()).toBe('Ships in 2 days')
    expect(w.text()).toContain('Extracted text')
  })
})
```

`apps/admin-dashboard/test/reindexCard.test.ts`:
```ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/auth/session'
import ReindexCard from '../src/components/kb/ReindexCard.vue'

vi.mock('@/auth/session', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
})

const button = (w: ReturnType<typeof mount>) => w.find('button')

describe('ReindexCard', () => {
  it('disables the button when everything is up to date', async () => {
    vi.mocked(api.get).mockResolvedValue({ running: false, total: 4, done: 4, model: 'fake:hash:1024' })
    const w = mount(ReindexCard)
    await flushPromises()
    expect(w.text()).toContain('Up to date')
    expect(button(w).attributes('disabled')).toBeDefined()
  })

  it('starts a re-index and shows progress', async () => {
    vi.mocked(api.get).mockResolvedValue({ running: false, total: 4, done: 1, model: 'm' })
    vi.mocked(api.post).mockResolvedValue({ running: true, total: 4, done: 1, model: 'm' })
    const w = mount(ReindexCard)
    await flushPromises()
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
    await button(w).trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/kb/reindex')
    expect(button(w).text()).toBe('Re-indexing…')
    expect(button(w).attributes('disabled')).toBeDefined()
    w.unmount()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w packages/ui && npm test -w apps/admin-dashboard -- markdown previewDialog reindexCard`
Expected: FAIL. The dialog lacks `max-w-4xl`, and the three new source files do not exist.

- [ ] **Step 4: Add `dialogClass` to `DialogContent`**

In `packages/ui/src/components/DialogContent.vue`, change the props line to:
```ts
const props = defineProps<{ class?: ClassValue; dialogClass?: ClassValue }>()
```
and the `<dialog>` class attribute to:
```vue
    :class="cn(
      'hx-dialog m-auto w-full outline-none max-w-lg rounded-xl border bg-card p-0 text-card-foreground shadow-[0_24px_48px_-12px_rgb(16_26_24/0.28)]',
      props.dialogClass,
    )"
```
(remove the old static `class="…"` attribute on the `<dialog>`).

- [ ] **Step 5: Write the Markdown renderer, preview dialog and re-index card**

`apps/admin-dashboard/src/lib/markdown.ts`:
```ts
import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** Renders tenant-supplied Markdown as sanitised HTML: scripts, event handlers and javascript: URLs are removed. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
```

`apps/admin-dashboard/src/components/kb/DocumentPreviewDialog.vue`:
```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { KbDocumentText, KbDocumentView } from '@helpix/shared/api-types'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { saveBlob } from '@/lib/download'
import { downloadName, formatBytes, previewKind, typeLabel } from '@/lib/kb'
import { renderMarkdown } from '@/lib/markdown'

const props = defineProps<{ open: boolean; doc: KbDocumentView | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const kind = computed(() => (props.doc ? previewKind(props.doc.mimeType) : null))
const loading = ref(false)
const error = ref<string | null>(null)
const pdfUrl = ref<string | null>(null)
const html = ref('')
const text = ref('')
let file: Blob | null = null
// Bumped on every load and close, so a slow response for a previous document is ignored.
let generation = 0

function reset() {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
  pdfUrl.value = null
  html.value = ''
  text.value = ''
  error.value = null
  file = null
}

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

async function load(doc: KbDocumentView) {
  const mine = ++generation
  reset()
  loading.value = true
  try {
    const k = previewKind(doc.mimeType)
    if (k === 'docx') {
      // Browsers cannot render DOCX; show the text the agent actually uses.
      const res = await api.get<KbDocumentText>(`/kb/documents/${doc.id}/text`)
      if (mine !== generation) return
      text.value = res.text
      return
    }
    const blob = await api.blob(`/kb/documents/${doc.id}/file`)
    if (mine !== generation) return
    file = blob
    if (k === 'pdf') pdfUrl.value = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
    else if (k === 'markdown') html.value = renderMarkdown(await blob.text())
    else text.value = await blob.text()
  } catch (e) {
    if (mine === generation) error.value = message(e, 'Could not load the preview')
  } finally {
    if (mine === generation) loading.value = false
  }
}

watch(
  () => [props.open, props.doc?.id] as const,
  ([open]) => {
    if (open && props.doc) void load(props.doc)
    else if (!open) {
      generation++
      reset()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
  reset()
})

async function download() {
  const doc = props.doc
  if (!doc) return
  try {
    saveBlob(file ?? (await api.blob(`/kb/documents/${doc.id}/file`)), downloadName(doc))
  } catch (e) {
    error.value = message(e, 'Could not download the file')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent dialog-class="max-w-4xl">
      <DialogHeader>
        <DialogTitle class="truncate pr-8">{{ doc?.title }}</DialogTitle>
        <DialogDescription v-if="doc">
          {{ typeLabel(doc.mimeType) }} · {{ formatBytes(doc.sizeBytes) }} · {{ doc.chunkCount }} {{ doc.chunkCount === 1 ? 'chunk' : 'chunks' }}
        </DialogDescription>
      </DialogHeader>

      <p v-if="loading" class="py-12 text-center text-sm text-muted-foreground">Loading preview…</p>
      <p v-else-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <template v-else>
        <iframe
          v-if="kind === 'pdf' && pdfUrl"
          :src="pdfUrl"
          :title="`Preview of ${doc?.title}`"
          class="h-[70vh] w-full rounded-md border"
        />
        <!-- renderMarkdown sanitises the HTML with DOMPurify before it reaches v-html. -->
        <div v-else-if="kind === 'markdown'" class="kb-markdown max-h-[70vh] overflow-auto rounded-md border p-4" v-html="html" />
        <template v-else>
          <p v-if="kind === 'docx'" class="text-xs text-muted-foreground">
            Extracted text. Download the file to see the original formatting.
          </p>
          <pre class="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-4 font-sans text-sm">{{ text }}</pre>
        </template>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="download">Download</Button>
        <Button @click="emit('update:open', false)">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

`apps/admin-dashboard/src/components/kb/ReindexCard.vue`:
```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { KbReindexStatus } from '@helpix/shared/api-types'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { reindexPercent, reindexSummary } from '@/lib/kb'
import { usePolling } from '@/lib/polling'

const status = ref<KbReindexStatus | null>(null)
const error = ref<string | null>(null)
const starting = ref(false)

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
const upToDate = computed(() => status.value !== null && status.value.done === status.value.total)

async function refresh() {
  try {
    status.value = await api.get<KbReindexStatus>('/kb/reindex')
    error.value = null
  } catch (e) {
    error.value = message(e, 'Could not load the index status')
  }
}

async function start() {
  starting.value = true
  error.value = null
  try {
    status.value = await api.post<KbReindexStatus>('/kb/reindex')
  } catch (e) {
    error.value = message(e, 'Could not start re-indexing')
  } finally {
    starting.value = false
  }
}

usePolling(refresh, 2000, computed(() => status.value?.running === true))
onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Search index</CardTitle>
      <CardDescription>
        Documents are embedded with the platform's embedding model. When the model changes, re-index so every document is
        searchable again.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3">
      <template v-if="status">
        <div
          class="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Re-index progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="reindexPercent(status)"
        >
          <div class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" :style="{ width: `${reindexPercent(status)}%` }" />
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-muted-foreground">{{ reindexSummary(status) }}</p>
          <Button variant="outline" size="sm" :disabled="status.running || starting || upToDate" @click="start">
            {{ status.running ? 'Re-indexing…' : 'Re-index' }}
          </Button>
        </div>
        <p class="font-mono text-xs text-muted-foreground">Model: {{ status.model }}</p>
      </template>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    </CardContent>
  </Card>
</template>
```

Append to `apps/admin-dashboard/src/styles.css`:
```css
/* Inline Markdown preview in the knowledge base. */
.kb-markdown { font-size: 0.875rem; line-height: 1.6; overflow-wrap: anywhere; }
.kb-markdown > * + * { margin-top: 0.75em; }
.kb-markdown h1 { font-size: 1.25rem; font-weight: 600; }
.kb-markdown h2 { font-size: 1.125rem; font-weight: 600; }
.kb-markdown h3, .kb-markdown h4 { font-weight: 600; }
.kb-markdown ul { list-style: disc; padding-left: 1.25rem; }
.kb-markdown ol { list-style: decimal; padding-left: 1.25rem; }
.kb-markdown a { color: var(--primary); text-decoration: underline; }
.kb-markdown code { font-family: var(--font-mono); font-size: 0.8125rem; background: var(--muted); padding: 0.1em 0.3em; border-radius: 0.25rem; }
.kb-markdown pre { background: var(--muted); padding: 0.75rem; border-radius: 0.375rem; overflow-x: auto; }
.kb-markdown pre code { background: none; padding: 0; }
.kb-markdown blockquote { border-left: 3px solid var(--border); padding-left: 0.75rem; color: var(--muted-foreground); }
.kb-markdown table { border-collapse: collapse; }
.kb-markdown th, .kb-markdown td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; }
```

- [ ] **Step 6: Add preview and the re-index card to the page**

In `apps/admin-dashboard/src/pages/KnowledgeBasePage.vue`:

1. Change the Vue import to `import { computed, onMounted, ref, watch } from 'vue'` and add:
```ts
import DocumentPreviewDialog from '@/components/kb/DocumentPreviewDialog.vue'
import ReindexCard from '@/components/kb/ReindexCard.vue'
```
2. Add after the delete state:
```ts
const previewDoc = ref<KbDocumentView | null>(null)
const previewOpen = ref(false)
const reindexCard = ref<InstanceType<typeof ReindexCard> | null>(null)

function openPreview(doc: KbDocumentView) {
  previewDoc.value = doc
  previewOpen.value = true
}

// Chunk totals change when documents finish processing or are deleted.
watch(
  () => docs.value.map((d) => `${d.id}:${d.status}`).join(),
  () => void reindexCard.value?.refresh(),
)
```
3. In the row actions, add before the Download button:
```vue
                  <Button v-if="doc.status === 'ready'" variant="ghost" size="sm" @click="openPreview(doc)">Preview</Button>
```
4. After the documents `</Card>`, add:
```vue
    <ReindexCard v-if="loaded && !pageError && docs.length > 0" ref="reindexCard" />
```
5. Next to the other dialogs, add:
```vue
    <DocumentPreviewDialog v-model:open="previewOpen" :doc="previewDoc" />
```

- [ ] **Step 7: Run all frontend tests, typecheck and build**

Run: `npm test -w packages/ui && npm test -w apps/admin-dashboard && npm run typecheck -w packages/ui && npm run typecheck -w apps/admin-dashboard && npm run build -w apps/admin-dashboard`
Expected: all PASS, and the build succeeds.

- [ ] **Step 8: Check it in the browser**

On `/kb` as a tenant admin, check the following. Test light and dark themes, and a 375 px-wide window, where the table may scroll horizontally but the page must not.
- **Preview** on a PDF shows the browser's PDF viewer. On Markdown it shows formatted headings and lists. On TXT it shows preformatted text. On DOCX it shows "Extracted text" plus the text.
- **Download** from the preview saves the file.
- The **Search index** card says "Up to date" and its button is disabled.
- After switching `EMBEDDING_MODEL` (for example `EMBEDDING_MODEL=hash2` with the fake provider) and restarting kb-service, the card shows 0 of N. **Re-index** then fills the bar and returns to "Up to date".

- [ ] **Step 9: Commit**

```bash
git add packages/ui apps/admin-dashboard package-lock.json
git commit -m "feat(dashboard): document preview (PDF, Markdown, text, DOCX) and re-index progress card"
```

---

### Task 12: End-to-end smoke test, README and final verification

**Files:**
- Create: `scripts/smoke-step2.mjs`
- Modify: `package.json` (root `smoke` script), `README.md`

**Interfaces:**
- Consumes: the whole stack through the gateway.
- Produces: `npm run smoke` / `make smoke` runs the step 1 and step 2 smoke tests.

- [ ] **Step 1: Write the smoke test**

`scripts/smoke-step2.mjs`:
```js
// End-to-end check of step 2 (knowledge base) through the gateway. Run with the stack up: `npm run smoke`.
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'

async function call(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const buf = Buffer.from(await res.arrayBuffer())
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  return { status: res.status, buf, json: isJson && buf.length ? JSON.parse(buf.toString()) : null }
}

function check(condition, label, detail) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? '')
    process.exit(1)
  }
  console.log(`ok   ${label}`)
}

async function waitSettled(token, id) {
  for (let i = 0; i < 60; i++) {
    const res = await call('GET', `/kb/documents/${id}`, { token })
    if (res.json?.status !== 'processing') return res.json
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`document ${id} still processing after 30 s`)
}

const suffix = Date.now().toString(36)
const root = await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })
check(root.status === 200, 'super-admin login', root.json)
const rootToken = root.json.accessToken

async function makeTenant(slug) {
  const t = await call('POST', '/admin/tenants', { token: rootToken, body: { name: `KB ${slug}`, slug: `${slug}-${suffix}` } })
  check(t.status === 201, `create tenant ${slug}`, t.json)
  const email = `${slug}-${suffix}@smoke.test`
  const admin = await call('POST', `/admin/tenants/${t.json.id}/admins`, { token: rootToken, body: { email, password: 'smoke-password-1' } })
  check(admin.status === 201, `create admin for ${slug}`, admin.json)
  const login = await call('POST', '/auth/login', { body: { email, password: 'smoke-password-1' } })
  check(login.status === 200, `tenant admin ${slug} login`, login.json)
  return login.json.accessToken
}

const a = await makeTenant('kb-a')
const b = await makeTenant('kb-b')

const md = `# Returns\n\nRefunds are accepted within 30 days of delivery. Reference ${suffix}.`
const form = new FormData()
form.append('title', 'Return policy')
form.append('file', new Blob([md], { type: 'text/markdown' }), 'returns.md')
const up = await call('POST', '/kb/documents', { token: a, form })
check(up.status === 202 && up.json.status === 'processing', 'upload Markdown returns 202 processing', up.json)
const id = up.json.id

const ready = await waitSettled(a, id)
check(ready.status === 'ready' && ready.chunkCount >= 1, 'document becomes ready with chunks', ready)

const file = await call('GET', `/kb/documents/${id}/file`, { token: a })
check(file.status === 200 && file.buf.toString() === md, 'download returns the original bytes')

const hit = await call('POST', '/kb/search', { token: a, body: { query: 'refunds within 30 days of delivery' } })
check(hit.status === 200 && hit.json.results[0]?.documentId === id, 'search finds the document', hit.json)

const leak = await call('POST', '/kb/search', { token: b, body: { query: 'refunds within 30 days of delivery' } })
check(leak.status === 200 && leak.json.results.every((r) => r.documentId !== id), "tenant B's search never returns A's chunks", leak.json)
for (const [method, path] of [['GET', ''], ['GET', '/file'], ['GET', '/text'], ['DELETE', '']]) {
  const res = await call(method, `/kb/documents/${id}${path}`, { token: b })
  check(res.status === 404, `tenant B ${method} /kb/documents/:id${path} is 404`, res.json)
}

const paste = await call('POST', '/kb/documents/text', { token: a, body: { title: 'Opening hours', text: 'Open Monday to Friday, 9 to 5.' } })
check(paste.status === 202, 'paste text returns 202', paste.json)
check((await waitSettled(a, paste.json.id)).status === 'ready', 'pasted text becomes ready')

const idx = await call('GET', '/kb/reindex', { token: a })
check(idx.status === 200 && idx.json.total >= 2 && idx.json.done === idx.json.total, 'index is up to date', idx.json)

const superList = await call('GET', '/kb/documents', { token: rootToken })
check(superList.status === 403, 'super-admin has no KB of its own (403)', superList.json)

const fake = new FormData()
fake.append('file', new Blob(['not a pdf']), 'fake.pdf')
const bad = await call('POST', '/kb/documents', { token: a, form: fake })
check(bad.status === 415 && bad.json.error.code === 'unsupported_file_type', 'a mislabelled file is refused (415)', bad.json)

const huge = new FormData()
huge.append('file', new Blob([Buffer.alloc(12 * 1024 * 1024, 'a')]), 'huge.txt')
const big = await call('POST', '/kb/documents', { token: a, form: huge })
check(big.status === 413, 'a file over the upload limit is refused (413)', big.json)

const del = await call('DELETE', `/kb/documents/${id}`, { token: a })
check(del.status === 204, 'delete returns 204')
check((await call('GET', `/kb/documents/${id}`, { token: a })).status === 404, 'deleted document is gone')

console.log('\nstep 2 smoke test passed')
```

In the root `package.json`, change the `smoke` script to run both:
```json
    "smoke": "node --env-file=.env scripts/smoke-step1.mjs && node --env-file=.env scripts/smoke-step2.mjs",
```

- [ ] **Step 2: Run the smoke test against a fresh stack**

Run:
```bash
make up
make smoke
```
Expected: every line prints `ok`, and the run ends with `step 2 smoke test passed`. If the 413 check gets 411 `length_required`, Node's `fetch` sent the multipart body chunked. That still proves the gateway refuses it, but report it rather than loosening the check silently.

- [ ] **Step 3: Update the README**

In `README.md`:

1. In **Admin dashboard**, after the intro paragraph, add:
```markdown
Tenant admins land on the **Knowledge base**: upload PDF, DOCX, Markdown or TXT files (up to 10 MB) or paste text, watch each document go from *Processing* to *Ready*, preview it (PDFs in the browser viewer, Markdown rendered, DOCX as extracted text), download or delete it, and re-index after the embedding model changes.
```
2. In **Run locally**, change the `make start` comment to `# Docker stack (postgres :5433, tenant-auth, kb-service, gateway http://localhost:4000) + dashboard http://localhost:5173` and the `make dev` comment to `# or: hot reload — postgres in Docker, services and dashboard run locally; Ctrl-C stops all`. Then add after the code block:
```markdown
Embeddings default to an offline `fake` provider, which is fine for development. For real answers use GLM: set `EMBEDDING_PROVIDER=openai-compatible` and `EMBEDDING_API_KEY` in `.env` (see `.env.example`). If your `.env` predates the knowledge base, copy the `KB_SERVICE_URL` and `EMBEDDING_*` lines from `.env.example` into it.
```
3. In **Test**, change the smoke comment to `# end-to-end through the gateway (tenants, then knowledge base); needs the full stack running (make up)`.
4. Replace the Architecture mermaid block with:
```mermaid
flowchart LR
  D[admin-dashboard<br/>Vue 3] --> G[gateway<br/>:4000]
  W[shop chat widget] --> G
  G -- identity headers --> T[tenant-auth]
  G -- identity headers --> K[kb-service]
  K -- embeddings --> L[(GLM embedding-3)]
  T --> P[(PostgreSQL + pgvector)]
  K --> P
  K --> F[(KB files volume)]
```
5. Add rows to the table under it, after `services/tenant-auth`:
```markdown
| `services/kb-service` | Knowledge base: uploads, text extraction, chunking, embeddings, pgvector search, re-indexing. Reachable only through the gateway. |
| `packages/llm` | Provider adapter: GLM / OpenAI-compatible embeddings (chat in step 3) and an offline fake. |
```

- [ ] **Step 4: Full verification**

Run:
```bash
make test
npm run typecheck
npm run build
make smoke
```
Expected: every workspace's tests pass, typecheck and build are clean, and both smoke tests pass. Then run the manual dashboard checks from Task 10 Step 7 and Task 11 Step 8 once more against the Docker stack (`make start`).

Optional, with a real key: set `EMBEDDING_PROVIDER=openai-compatible` and `EMBEDDING_API_KEY` in `.env`, then run `docker compose up -d --build kb-service` and `make smoke`. That confirms the GLM request shape and batch limits. The fake-provider threshold does not apply, since `KB_MIN_SCORE` defaults to 0.3 for real embeddings. Tune it if relevant answers are dropped.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-step2.mjs package.json README.md
git commit -m "test: step 2 knowledge-base smoke test through the gateway; README for kb-service and embeddings"
```
