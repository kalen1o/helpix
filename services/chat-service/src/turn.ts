import { ChatError, type ChatProvider } from '@helpix/llm'
import { toChatToolEvent } from '@helpix/shared'
import type { AgentConfig } from '@helpix/shared/api-types'
import type { FastifyBaseLogger } from 'fastify'
import { runAgent } from './agent/loop'
import { buildPrompt, orderContext } from './agent/prompt'
import { createLookupOrderTool } from './agent/lookupOrder'
import { createSearchKbTool, SEARCH_KB_TOOL, type AgentTool } from './agent/searchKb'
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
  /** The verified shopper (gateway `x-customer-id`) or the playground's test customer; null when anonymous. */
  customerId: string | null
  /** The tenant has an order API configured (`PublishedAgentConfig.orderLookup`). */
  orderLookup: boolean
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
    const tools: AgentTool[] = [createSearchKbTool(deps.kb, input.tenantId, input.requestId)]
    // The prompt states this turn's sign-in state; lookup_order is offered exactly when it says signed_in.
    const orders = orderContext(input.customerId, input.orderLookup)
    // Spec 4b §4: only for a known customer on a shop with an order API. The customer is bound here, never by the model.
    if (orders === 'signed_in' && input.customerId) {
      tools.push(createLookupOrderTool(deps.orders, input.tenantId, input.customerId, input.requestId))
    }
    const result = await runAgent({
      chat: deps.chat,
      model,
      messages: buildPrompt({
        shopName: input.shopName,
        config: input.config,
        history,
        userMessage: input.userMessage,
        historyTokenBudget: deps.config.historyTokenBudget,
        orders,
      }),
      tools,
      maxToolRounds: deps.config.maxToolRounds,
      // Always search before the first round: models (GLM included) skip search_kb when the shop instructions seem to
      // cover a question, then invent the answer, and GLM cannot be forced to call a tool (it ignores tool_choice).
      prefetch: { id: 'prefetch_search', name: SEARCH_KB_TOOL.name, arguments: JSON.stringify({ query: input.userMessage }) },
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
