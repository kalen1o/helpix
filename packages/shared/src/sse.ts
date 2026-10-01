// Pure TypeScript with no Node imports: the dashboard and the widget use it in the browser.
export interface SseEvent {
  /** The `event:` field, or `message` when there is none. */
  event: string
  /** The `data:` lines joined with `\n`. */
  data: string
}

/**
 * Parses a text/event-stream body (WHATWG SSE format, `\n` or `\r\n` line endings). A last event without its closing
 * blank line is still delivered. Stopping early (`break`) cancels the underlying stream.
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []
  let done = false

  function* line(raw: string): Generator<SseEvent> {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (text === '') {
      if (data.length > 0) yield { event: event || 'message', data: data.join('\n') }
      event = ''
      data = []
      return
    }
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  try {
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      buffer += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        yield* line(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    }
    if (buffer) yield* line(buffer)
    yield* line('')
  } finally {
    if (!done) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** One SSE event with JSON data. JSON.stringify never emits a raw newline, so the data stays on one line. */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
