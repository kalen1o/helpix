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
