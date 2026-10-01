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
