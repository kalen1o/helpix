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
