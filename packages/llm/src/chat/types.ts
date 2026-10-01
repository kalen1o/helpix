export interface ToolCall {
  id: string
  name: string
  /** The model's raw JSON text; it may not parse. */
  arguments: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

/** One round streams any text first, then its tool calls, then `done`. */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; finishReason: string | null }

export interface ChatRequest {
  /** Defaults to the provider's `defaultModel`. */
  model?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  signal?: AbortSignal
}

export interface ChatProvider {
  readonly defaultModel: string
  chat(req: ChatRequest): AsyncIterable<ChatEvent>
}

export class ChatError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ChatError'
  }
}

export interface ChatProviderConfig {
  provider: 'openai-compatible' | 'fake'
  baseUrl: string
  apiKey: string
  model: string
  /** Covers the whole request, streaming included. */
  timeoutMs: number
  /** GLM's `thinking` switch: sent as `{ type }` unless 'omit' (for providers that reject the field). */
  thinking: 'disabled' | 'enabled' | 'omit'
}
