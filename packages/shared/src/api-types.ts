// Pure types shared by services and the dashboard. No runtime imports allowed here.
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
