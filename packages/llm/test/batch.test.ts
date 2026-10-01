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
