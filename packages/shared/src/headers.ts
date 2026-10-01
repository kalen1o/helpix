export const HEADERS = {
  tenantId: 'x-tenant-id',
  customerId: 'x-customer-id',
  role: 'x-helpix-role',
  adminId: 'x-admin-id',
  requestId: 'x-request-id',
  internalToken: 'x-internal-token',
  /** Names the internal caller of tenant-auth `/internal/*` routes; only the gateway's resolver client sends it. */
  internalCaller: 'x-internal-caller',
  /** The public widget key a shop page sends. Only the gateway reads it; it is stripped before forwarding. */
  widgetKey: 'x-helpix-widget-key',
} as const

/** The only accepted value of `HEADERS.internalCaller` on tenant-auth `/internal/*` routes. */
export const INTERNAL_CALLER_RESOLVER = 'resolver'

/** The `HEADERS.internalCaller` value chat-service sends to tenant-auth `/internal/agent-config/*`. */
export const INTERNAL_CALLER_CHAT = 'chat'

/** Headers only the gateway may set. The gateway strips these from client requests. */
export const IDENTITY_HEADERS: readonly string[] = [
  HEADERS.tenantId,
  HEADERS.customerId,
  HEADERS.role,
  HEADERS.adminId,
  HEADERS.internalToken,
  HEADERS.internalCaller,
]
