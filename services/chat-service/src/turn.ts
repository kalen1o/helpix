import { ChatError, type ChatProvider } from '@helpix/llm'
import { toChatToolEvent } from '@helpix/shared'
import type { AgentConfig } from '@helpix/shared/api-types'
import type { FastifyBaseLogger } from 'fastify'
import { runAgent } from './agent/loop'
import { buildPrompt } from './agent/prompt'
import { createSearchKbTool } from './agent/searchKb'
import type { ChatServiceConfig } from './config'
import type { ChatDeps } from './deps'
import type { ConversationRow } from './repos/conversations'
import { recentMessages, saveTurn } from './repos/messages'
import type { EventStream } from './sse'

export interface TurnInput {
  tenantId: string
  requestId: string
  conversation: ConversationRow
  /** Set only for a new anonymous conversation; sent once in the `meta` event. */
  sessionToken: string | null
  shopName: string
  config: AgentConfig
  userMessage: string
}

/** The tenant's model override when the platform allows it (spec §3.6), otherwise the platform model. */
export function effectiveModel(config: ChatServiceConfig, chat: ChatProvider, override: string | null): string {
  return override && config.modelOverrides.includes(override) ? override : chat.defaultModel
}

/**
 * One turn over an open event stream: meta, then deltas and tool events while the agent runs, then done. The turn is
 * stored only when it completes; a model failure becomes an `error` event and a disconnect stores nothing.
 */
export async function runTurn(deps: ChatDeps, input: TurnInput, stream: EventStream, log: FastifyBaseLogger): Promise<void> {
  stream.send({
    event: 'meta',
    data: { conversationId: input.conversation.id, ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}) },
  })
  try {
    const model = effectiveModel(deps.config, deps.chat, input.config.modelOverride)
    const history = await recentMessages(deps.db, input.tenantId, input.conversation.id, deps.config.historyMaxMessages)
    const result = await runAgent({
      chat: deps.chat,
      model,
      messages: buildPrompt({
        shopName: input.shopName,
        config: input.config,
        history,
        userMessage: input.userMessage,
        historyTokenBudget: deps.config.historyTokenBudget,
      }),
      tools: [createSearchKbTool(deps.kb, input.tenantId, input.requestId)],
      maxToolRounds: deps.config.maxToolRounds,
      signal: stream.signal,
      onText: (text) => stream.send({ event: 'delta', data: { text } }),
      onTool: (activity) => stream.send({ event: 'tool', data: toChatToolEvent(activity) }),
    })
    // A provider may ignore the signal (the fake one does): a client that left mid-turn gets nothing stored.
    if (stream.signal.aborted) return
    const messageId = await saveTurn(deps.db, {
      tenantId: input.tenantId,
      conversationId: input.conversation.id,
      userText: input.userMessage,
      assistantText: result.text,
      tools: result.tools,
      model,
    })
    stream.send({ event: 'done', data: { messageId } })
  } catch (e) {
    if (stream.signal.aborted) return
    if (e instanceof ChatError) {
      log.warn({ err: e }, 'chat model failed')
      stream.send({ event: 'error', data: { code: 'llm_unavailable', message: 'The assistant is unavailable right now. Please try again.' } })
    } else {
      log.error({ err: e }, 'chat turn failed')
      stream.send({ event: 'error', data: { code: 'internal_error', message: 'Something went wrong. Please try again.' } })
    }
  } finally {
    stream.end()
  }
}
