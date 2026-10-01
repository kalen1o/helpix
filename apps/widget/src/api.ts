import type { WidgetConfig } from '@helpix/shared/api-types'

export interface WidgetTarget {
  widgetKey: string
  /** Gateway origin, no trailing slash. */
  apiBase: string
}

export interface SendBody {
  message: string
  conversationId?: string
  sessionToken?: string
}

export interface WidgetApi {
  fetchConfig(): Promise<WidgetConfig>
  /** The raw response: an SSE stream on success, a JSON error otherwise. */
  sendMessage(body: SendBody, signal: AbortSignal): Promise<Response>
}

export class WidgetApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function readApiError(res: Response): Promise<WidgetApiError> {
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  return new WidgetApiError(res.status, json?.error?.code ?? 'http_error', json?.error?.message ?? `Request failed (${res.status})`)
}

export function createWidgetApi(target: WidgetTarget, fetchImpl: typeof fetch = (...a) => fetch(...a)): WidgetApi {
  const headers = { 'x-helpix-widget-key': target.widgetKey }
  return {
    async fetchConfig() {
      const res = await fetchImpl(`${target.apiBase}/widget/config`, { headers })
      if (!res.ok) throw await readApiError(res)
      return (await res.json()) as WidgetConfig
    },
    sendMessage(body, signal) {
      return fetchImpl(`${target.apiBase}/chat/messages`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    },
  }
}
