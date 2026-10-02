import type { ChatProvider } from '@helpix/llm'
import type { Db } from '@helpix/shared'
import type { AgentConfigSource } from './clients/agentConfig'
import type { KbClient } from './clients/kb'
import type { OrdersClient } from './clients/orders'
import type { ChatServiceConfig } from './config'

export interface ChatDeps {
  db: Db
  config: ChatServiceConfig
  chat: ChatProvider
  kb: KbClient
  agentConfigs: AgentConfigSource
  orders: OrdersClient
}
