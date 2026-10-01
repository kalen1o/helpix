import { fileURLToPath } from 'node:url'
import { createChatProvider } from '@helpix/llm'
import { createPool, migrate } from '@helpix/shared'
import { buildApp } from './app'
import { createAgentConfigClient } from './clients/agentConfig'
import { createKbClient } from './clients/kb'
import { loadConfig } from './config'

const config = loadConfig()
const db = createPool(config.databaseUrl)
const applied = await migrate(db, { schema: 'chat', dir: fileURLToPath(new URL('../migrations', import.meta.url)) })
if (applied.length) console.log(`chat-service: applied migrations ${applied.join(', ')}`)

const chat = createChatProvider(config.llm)
const overrides = config.modelOverrides.length ? `; tenant overrides: ${config.modelOverrides.join(', ')}` : ''
console.log(`chat-service: chat model ${chat.defaultModel} via ${config.llm.provider}${overrides}`)

const app = await buildApp(
  {
    db,
    config,
    chat,
    kb: createKbClient({ baseUrl: config.kbServiceUrl, internalToken: config.internalToken, timeoutMs: config.kbTimeoutMs }),
    agentConfigs: createAgentConfigClient({
      baseUrl: config.tenantAuthUrl,
      internalToken: config.internalToken,
      cacheTtlMs: config.configCacheTtlMs,
    }),
  },
  { logger: true },
)
await app.listen({ port: config.port, host: '0.0.0.0' })
