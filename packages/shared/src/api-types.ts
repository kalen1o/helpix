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
