import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createFakeChat } from '@helpix/llm'
import { createPool, DEFAULT_AGENT_CONFIG, HEADERS, migrate, readSseEvents, type Db } from '@helpix/shared'
import type { AgentConfig, KbSearchResult, PublishedAgentConfig } from '@helpix/shared/api-types'
import type { Order, OrderLookupResult } from '@helpix/shared/orders'
import { TEST_DATABASE_URL } from '@helpix/shared/testing'
import { buildApp } from '../src/app'
import { createConversation, type ConversationRow } from '../src/repos/conversations'
import { saveTurn } from '../src/repos/messages'
import type { ChatServiceConfig } from '../src/config'
import type { ChatDeps } from '../src/deps'
import type { AgentConfigSource } from '../src/clients/agentConfig'
import { KbUnavailableError, type KbClient } from '../src/clients/kb'
import type { OrdersClient } from '../src/clients/orders'

export const TENANT_A = '00000000-0000-4000-8000-00000000000a'
export const TENANT_B = '00000000-0000-4000-8000-00000000000b'

export const TEST_CONFIG: ChatServiceConfig = {
  port: 0,
  databaseUrl: TEST_DATABASE_URL,
  internalToken: 'chat-service-test-internal-token-0123456789',
  tenantAuthUrl: 'http://tenant-auth.test',
  kbServiceUrl: 'http://kb.test',
  llm: { provider: 'fake', baseUrl: '', apiKey: '', model: 'fake', timeoutMs: 1000, thinking: 'omit' },
  modelOverrides: ['big-model'],
  maxToolRounds: 3,
  historyMaxMessages: 20,
  historyTokenBudget: 3000,
  configCacheTtlMs: 10_000,
  kbTimeoutMs: 1000,
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export async function setupTestDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL)
  await migrate(db, { schema: 'chat', dir: MIGRATIONS_DIR })
  return db
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('TRUNCATE chat.messages, chat.conversations')
}

/** A kb-service stand-in: per-tenant results, or failing with KbUnavailableError when `down`. Records every call. */
export function fakeKb(byTenant: Record<string, KbSearchResult[]> = {}, opts: { down?: boolean } = {}) {
  const calls: { tenantId: string; query: string }[] = []
  const kb: KbClient & { calls: typeof calls } = {
    calls,
    async search(tenantId, query) {
      calls.push({ tenantId, query })
      if (opts.down) throw new KbUnavailableError('kb-service did not respond')
      return byTenant[tenantId] ?? []
    },
  }
  return kb
}

export function fakeConfigs(config: Partial<AgentConfig> = {}, tenantName = 'Test Shop', orderLookup = false): AgentConfigSource {
  return {
    getPublished: async (): Promise<PublishedAgentConfig> => ({ tenantName, config: { ...DEFAULT_AGENT_CONFIG, ...config }, orderLookup }),
  }
}

/** Orders as the shop's order API returns them (after tenant-auth validated them). */
export const ORDER: Order = {
  orderId: '1001',
  status: 'shipped',
  placedAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-22T08:00:00.000Z',
  items: [{ name: 'iPhone 16', quantity: 1, variant: 'Black, 128 GB' }],
  tracking: { carrier: 'DHL', number: 'JD014600003', url: 'https://track.example/JD014600003' },
}
export const ORDER_2: Order = {
  orderId: '1002',
  status: 'processing',
  placedAt: '2026-09-28T09:30:00.000Z',
  updatedAt: '2026-09-28T09:30:00.000Z',
  items: [{ name: 'MagSafe Charger', quantity: 2 }],
}

export interface OrdersCall {
  kind: 'get' | 'list'
  tenantId: string
  customerId: string
  orderId: string | null
}

/** A tenant-auth orders stand-in: answers `reply` (or what it returns for the call) and records every call. */
export function fakeOrders(reply: OrderLookupResult | ((call: OrdersCall) => OrderLookupResult) = { status: 'not_found' }) {
  const calls: OrdersCall[] = []
  const answer = (call: OrdersCall): OrderLookupResult => {
    calls.push(call)
    return typeof reply === 'function' ? reply(call) : reply
  }
  const orders: OrdersClient & { calls: OrdersCall[] } = {
    calls,
    async get(tenantId, customerId, orderId) {
      return answer({ kind: 'get', tenantId, customerId, orderId })
    },
    async list(tenantId, customerId) {
      return answer({ kind: 'list', tenantId, customerId, orderId: null })
    },
  }
  return orders
}

export function makeDeps(db: Db, overrides: Partial<ChatDeps> = {}): ChatDeps {
  return {
    db,
    config: TEST_CONFIG,
    chat: createFakeChat('fake'),
    kb: fakeKb(),
    agentConfigs: fakeConfigs(),
    orders: fakeOrders(),
    ...overrides,
  }
}

export function buildTestApp(deps: ChatDeps) {
  return buildApp(deps, { logger: false })
}

export function internalHeaders(): Record<string, string> {
  return { [HEADERS.internalToken]: TEST_CONFIG.internalToken }
}

/** A search hit kb-service would return. */
export const HIT = {
  documentId: '00000000-0000-4000-8000-0000000000d1',
  title: 'Return policy',
  position: 0,
  text: 'Refunds within 30 days.',
  score: 0.9,
}

/** What the gateway sends for a widget request (step 4): a tenant and, for a logged-in shopper, a customer id. */
export function customerHeaders(tenantId: string, customerId?: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.tenantId]: tenantId, ...(customerId ? { [HEADERS.customerId]: customerId } : {}) }
}

export function adminHeaders(tenantId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: randomUUID(), [HEADERS.tenantId]: tenantId }
}

export function superAdminHeaders(): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.role]: 'super_admin', [HEADERS.adminId]: randomUUID() }
}

export interface StreamEvent {
  event: string
  data: any
}

/** The events of an SSE body captured by inject(). */
export async function parseEvents(payload: string): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of readSseEvents(new Response(payload).body!)) out.push({ event: e.event, data: JSON.parse(e.data) })
  return out
}

export const replyText = (events: StreamEvent[]): string =>
  events.filter((e) => e.event === 'delta').map((e) => e.data.text as string).join('')

/** A conversation with `turns` stored question/answer pairs (Q0/A0, Q1/A1, …). */
export async function seedConversation(
  db: Db,
  tenantId: string,
  opts: { playground?: boolean; customerId?: string | null; turns?: number } = {},
): Promise<ConversationRow> {
  const playground = opts.playground ?? false
  const c = await createConversation(db, {
    tenantId,
    isPlayground: playground,
    customerId: opts.customerId === undefined ? (playground ? null : 'cust-1') : opts.customerId,
    sessionTokenHash: null,
  })
  for (let n = 0; n < (opts.turns ?? 1); n++) {
    await saveTurn(db, { tenantId, conversationId: c.id, userText: `Q${n}`, assistantText: `A${n}`, tools: [], model: 'fake' })
  }
  return c
}
