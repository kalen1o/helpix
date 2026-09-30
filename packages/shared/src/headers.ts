export const HEADERS = {
  tenantId: 'x-tenant-id',
  customerId: 'x-customer-id',
  role: 'x-helpix-role',
  adminId: 'x-admin-id',
  requestId: 'x-request-id',
  internalToken: 'x-internal-token',
} as const

/** Headers only the gateway may set. The gateway strips these from client requests. */
export const IDENTITY_HEADERS: readonly string[] = [
  HEADERS.tenantId,
  HEADERS.customerId,
  HEADERS.role,
  HEADERS.adminId,
  HEADERS.internalToken,
]
