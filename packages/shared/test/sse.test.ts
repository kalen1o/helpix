import { describe, expect, it } from 'vitest'
import { formatSseEvent, readSseEvents, type SseEvent } from '../src/sse'

/** A pull-based stream over byte pieces; reports whether the reader cancelled it. */
function streamOf(pieces: Uint8Array[]) {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      const p = pieces.shift()
      if (p === undefined) c.close()
      else c.enqueue(p)
    },
    cancel() {
      cancelled = true
    },
  })
  return { body, wasCancelled: () => cancelled }
}

const enc = new TextEncoder()
const text = (...pieces: string[]) => streamOf(pieces.map((p) => enc.encode(p))).body

/** Splits the UTF-8 bytes of `s` into `size`-byte pieces, cutting through multi-byte characters. */
function bytes(s: string, size: number): ReadableStream<Uint8Array> {
  const all = enc.encode(s)
  const pieces: Uint8Array[] = []
  for (let i = 0; i < all.length; i += size) pieces.push(all.slice(i, i + size))
  return streamOf(pieces).body
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const e of readSseEvents(body)) out.push(e)
  return out
}

describe('readSseEvents', () => {
  it('reads named events and defaults the name to "message"', async () => {
    expect(await collect(text('event: delta\ndata: {"text":"Hi"}\n\ndata: plain\n\n'))).toEqual([
      { event: 'delta', data: '{"text":"Hi"}' },
      { event: 'message', data: 'plain' },
    ])
  })

  it('reassembles events and multi-byte characters split across chunks', async () => {
    const source = 'event: delta\ndata: {"text":"Xin chào bạn"}\n\nevent: done\ndata: {}\n\n'
    expect(await collect(bytes(source, 3))).toEqual([
      { event: 'delta', data: '{"text":"Xin chào bạn"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('joins data lines, ignores comments and other fields, and accepts CRLF', async () => {
    expect(await collect(text(': ping\r\nid: 7\r\nretry: 10\r\ndata: a\r\ndata: b\r\n\r\n'))).toEqual([{ event: 'message', data: 'a\nb' }])
  })

  it('delivers a last event that has no closing blank line', async () => {
    expect(await collect(text('data: [DONE]'))).toEqual([{ event: 'message', data: '[DONE]' }])
  })

  it('skips blank lines that carry no data', async () => {
    expect(await collect(text('\n\n\nevent: x\n\ndata: y\n\n'))).toEqual([{ event: 'message', data: 'y' }])
  })

  it('cancels the stream when the consumer stops early', async () => {
    const s = streamOf(['data: 1\n\n', 'data: 2\n\n', 'data: 3\n\n'].map((p) => enc.encode(p)))
    for await (const e of readSseEvents(s.body)) {
      expect(e.data).toBe('1')
      break
    }
    expect(s.wasCancelled()).toBe(true)
  })
})

describe('formatSseEvent', () => {
  it('writes JSON data on one line so it round-trips, newlines included', async () => {
    const wire = formatSseEvent('delta', { text: 'line one\nline two' })
    expect(wire).toBe('event: delta\ndata: {"text":"line one\\nline two"}\n\n')
    const [e] = await collect(text(wire))
    expect(JSON.parse(e!.data)).toEqual({ text: 'line one\nline two' })
  })
})
