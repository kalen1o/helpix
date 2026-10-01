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
