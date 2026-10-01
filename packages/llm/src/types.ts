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
