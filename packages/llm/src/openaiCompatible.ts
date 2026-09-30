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
