// Pure types shared by services and the dashboard. No runtime imports allowed here.
import type { Order, OrderLookupStatus, OrderStatus } from './orders'

export type Role = 'super_admin' | 'tenant_admin'
export type TenantStatus = 'active' | 'suspended'

export interface TenantView {
  id: string
  name: string
  slug: string
  status: TenantStatus
  widgetKey: string
  allowedOrigins: string[]
  createdAt: string
}

export interface AdminView {
  id: string
  tenantId: string | null
  email: string
  role: Role
  createdAt: string
}

export interface SessionResponse {
  accessToken: string
  refreshToken: string
  admin: AdminView
}

export interface MeResponse {
  admin: AdminView
  tenant: TenantView | null
}

export interface ResolvedAdmin {
  adminId: string
  role: Role
  tenantId: string | null
}

export interface ResolvedWidget {
  tenantId: string
  /** The shop's customer ID; present only when a customer token was sent and verified. */
  customerId?: string
}

/** tenant-auth → widget (`GET /widget/config`): what the widget needs before the first message. */
export interface WidgetConfig {
  shopName: string
  greeting: string
  accentColor: string
  /** True when the tenant has an order API configured, so signed-in shoppers can ask about their orders. */
  orderLookup: boolean
}

export type DocumentStatus = 'processing' | 'ready' | 'failed'

export interface KbDocumentView {
  id: string
  title: string
  mimeType: string
  sizeBytes: number
  status: DocumentStatus
  /** Why processing failed; null unless status is 'failed'. */
  error: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface KbDocumentText {
  text: string
}

export interface KbSearchResult {
  documentId: string
  title: string
  position: number
  text: string
  /** Cosine similarity, higher is closer. */
  score: number
}

export interface KbSearchResponse {
  results: KbSearchResult[]
}

export interface KbReindexStatus {
  running: boolean
  /** All of the tenant's chunks. */
  total: number
  /** Chunks already embedded with the current model. */
  done: number
  /** The current embedding model id. */
  model: string
}

export type TonePreset = 'friendly' | 'professional' | 'playful' | 'concise'

/** What a tenant admin edits on the Agent page (spec §3.3, §5). Saved as a draft; publishing makes it live. */
export interface AgentConfig {
  /** The shop's own instructions. May be empty. */
  prompt: string
  tone: TonePreset
  toneNotes: string
  /** The widget's first message (used by the widget in step 4). */
  greeting: string
  /** Widget accent colour, `#RRGGBB` (used by the widget in step 4). */
  accentColor: string
  /** A chat model from the platform's allowed list, or null for the platform default. */
  modelOverride: string | null
}

export interface AgentConfigState {
  draft: AgentConfig
  /** null until the first publish; the live agent then uses the defaults. */
  published: AgentConfig | null
  draftUpdatedAt: string | null
  publishedAt: string | null
}

/** tenant-auth → chat-service: what the live agent runs on. */
export interface PublishedAgentConfig {
  tenantName: string
  config: AgentConfig
  /** True when the tenant has an order API configured (base URL and key). */
  orderLookup: boolean
}

export interface ChatModelsResponse {
  defaultModel: string
  /** Models a tenant may pick as an override; empty means overrides are off. */
  overrides: string[]
}

export type ToolStatus = 'ok' | 'empty' | 'error'

/** One tool call made while answering, stored with the assistant message (spec §3.1). */
export interface ToolActivity {
  name: string
  /** The model's arguments, or null when they were not a JSON object. */
  arguments: Record<string, unknown> | null
  status: ToolStatus
  /** search_kb hits, including the text the model saw. */
  results: KbSearchResult[]
  error: string | null
  /** lookup_order: the order(s) the shop returned (status 'ok' only). The only place Helpix stores order data. */
  orders?: Order[]
}

export interface ChatSource {
  documentId: string
  title: string
}

/** The `tool` stream event: enough to draw source chips. */
export interface ChatToolEvent {
  name: string
  status: ToolStatus
  sources: ChatSource[]
  /** lookup_order: enough to draw order chips. */
  orders?: { orderId: string; status: OrderStatus }[]
}

/** Events on a chat SSE stream, in order: meta, then any of delta/tool, then done or error. */
export type ChatStreamEvent =
  | { event: 'meta'; data: { conversationId: string; sessionToken?: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool'; data: ChatToolEvent }
  | { event: 'done'; data: { messageId: string } }
  | { event: 'error'; data: { code: string; message: string } }

export type ChatRole = 'user' | 'assistant'

export interface ChatMessageView {
  id: string
  role: ChatRole
  content: string
  tools: ToolActivity[]
  /** The chat model that wrote an assistant message; null for user messages. */
  model: string | null
  createdAt: string
}

export interface ConversationSummary {
  id: string
  isPlayground: boolean
  /** A logged-in shopper, or the test customer ID in the playground; null for anonymous visitors. */
  customerId: string | null
  messageCount: number
  /** The first user message. */
  preview: string
  createdAt: string
  updatedAt: string
}

export interface ConversationListResponse {
  conversations: ConversationSummary[]
  /** Pass as `before` to get the next page; null on the last page. */
  nextBefore: string | null
}

export interface ConversationDetail {
  conversation: ConversationSummary
  messages: ChatMessageView[]
}

/** `GET /integrations` (tenant admin). The order API key is never returned, only whether one is stored. */
export interface IntegrationsView {
  orderApi: { baseUrl: string; hasApiKey: boolean; updatedAt: string } | null
  shopKey: { fingerprint: string; updatedAt: string } | null
}

/** `POST /integrations/order-api/test`: the outcome in plain words. */
export interface OrderApiTestResult {
  ok: boolean
  status: OrderLookupStatus
  message: string
}
