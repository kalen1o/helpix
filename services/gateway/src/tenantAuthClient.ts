import { AppError, HEADERS, INTERNAL_CALLER_RESOLVER } from '@helpix/shared'
import type { ResolvedAdmin, ResolvedWidget } from '@helpix/shared/api-types'

export interface TenantAuthClient {
  resolveAdmin(accessToken: string, requestId: string): Promise<ResolvedAdmin>
  /** The tenant for a widget key used from `origin`; 401/403 from tenant-auth pass through. */
  resolveWidget(widgetKey: string, origin: string, requestId: string): Promise<ResolvedWidget>
}

export function createTenantAuthClient(baseUrl: string, internalToken: string): TenantAuthClient {
  async function post<T>(path: string, body: unknown, requestId: string): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [HEADERS.internalToken]: internalToken,
          [HEADERS.internalCaller]: INTERNAL_CALLER_RESOLVER,
          [HEADERS.requestId]: requestId,
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new AppError(502, 'upstream_unavailable', 'Auth service is unavailable')
    }
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    if (res.ok) return json as T
    if (res.status === 401 || res.status === 403) {
      throw new AppError(res.status, json?.error?.code ?? 'unauthorized', json?.error?.message ?? 'Unauthorized')
    }
    throw new AppError(502, 'upstream_error', 'Auth service returned an error')
  }

  return {
    resolveAdmin: (accessToken, requestId) => post<ResolvedAdmin>('/internal/resolve-admin', { accessToken }, requestId),
    resolveWidget: (widgetKey, origin, requestId) =>
      post<ResolvedWidget>('/internal/resolve-widget', { widgetKey, origin }, requestId),
  }
}
