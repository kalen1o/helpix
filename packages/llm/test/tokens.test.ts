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
