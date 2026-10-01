import { readSseEvents } from '@helpix/shared/sse'
import {
  ChatError,
  type ChatEvent,
  type ChatMessage,
  type ChatProvider,
  type ChatProviderConfig,
  type ChatRequest,
  type ToolDefinition,
} from './types'

const RETRY_DELAYS_MS = [500, 2000]

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface WireChunk {
  error?: { code?: unknown }
  choices?: {
    delta?: {
      content?: string | null
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
    }
    finish_reason?: string | null
  }[]
}

function toWire(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    }
  }
  return { role: m.role, content: m.content }
}

const toolWire = (t: ToolDefinition) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters },
})

/** " (code 1211)" from a provider error body, or "". Only a short code is kept: never the provider's free text. */
function codeSuffix(code: unknown): string {
  return (typeof code === 'string' || typeof code === 'number') && String(code).length <= 20 ? ` (code ${code})` : ''
}

/**
 * Streaming `POST {baseUrl}/chat/completions` in the OpenAI shape, which GLM serves (see the plan's verified GLM facts).
 * Failures before the stream starts are retried; once text has been yielded, a failure is thrown to the caller.
 */
export function createOpenAICompatibleChat(
  config: ChatProviderConfig,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
  sleep: (ms: number) => Promise<void> = defaultSleep,
): ChatProvider {
  async function open(req: ChatRequest): Promise<Response> {
    const body = JSON.stringify({
      model: req.model ?? config.model,
      messages: req.messages.map(toWire),
      stream: true,
      ...(req.tools?.length ? { tools: req.tools.map(toolWire), tool_choice: 'auto' } : {}),
      ...(config.thinking === 'omit' ? {} : { thinking: { type: config.thinking } }),
    })
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(config.timeoutMs)
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
      let res: Response
      try {
        res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body,
          signal,
        })
      } catch {
        if (req.signal?.aborted) throw req.signal.reason
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!)
          continue
        }
        throw new ChatError('The chat model did not respond', true)
      }
      if (res.ok && res.body) return res
      const json = (await res.json().catch(() => null)) as WireChunk | null
      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!)
        continue
      }
      throw new ChatError(`The chat model returned HTTP ${res.status}${codeSuffix(json?.error?.code)}`, retryable)
    }
  }

  return {
    defaultModel: config.model,
    async *chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
      const res = await open(req)
      const calls = new Map<number, { id: string; name: string; arguments: string }>()
      let finishReason: string | null = null
      let sawDone = false
      try {
        for await (const { data } of readSseEvents(res.body!)) {
          if (data === '[DONE]') {
            sawDone = true
            break
          }
          let chunk: WireChunk
          try {
            chunk = JSON.parse(data) as WireChunk
          } catch {
            throw new ChatError('The chat model sent an unreadable stream', false)
          }
          if (chunk.error) throw new ChatError(`The chat model reported an error${codeSuffix(chunk.error.code)}`, false)
          const choice = chunk.choices?.[0]
          if (!choice) continue
          const content = choice.delta?.content
          if (typeof content === 'string' && content) yield { type: 'text', text: content }
          for (const tc of choice.delta?.tool_calls ?? []) {
            const index = tc.index ?? 0
            const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
            if (tc.id) call.id = tc.id
            if (tc.function?.name) call.name = tc.function.name
            if (tc.function?.arguments) call.arguments += tc.function.arguments
            calls.set(index, call)
          }
          if (choice.finish_reason) finishReason = choice.finish_reason
        }
      } catch (e) {
        if (req.signal?.aborted) throw req.signal.reason
        if (e instanceof ChatError) throw e
        throw new ChatError('The chat model stream was interrupted', true)
      }
      if (!sawDone && finishReason === null) throw new ChatError('The chat model stream ended early', true)
      for (const [index, call] of [...calls].sort((a, b) => a[0] - b[0])) {
        if (!call.name) throw new ChatError('The chat model sent a tool call without a name', false)
        yield { type: 'tool_call', call: { id: call.id || `call_${index}`, name: call.name, arguments: call.arguments || '{}' } }
      }
      yield { type: 'done', finishReason }
    },
  }
}
