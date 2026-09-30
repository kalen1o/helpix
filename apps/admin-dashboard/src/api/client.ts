export interface Tokens {
  accessToken: string
  refreshToken: string
}

export interface TokenStore {
  get(): Tokens | null
  set(tokens: Tokens | null): void
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  tokens: TokenStore
  fetch?: typeof fetch
  onSessionExpired?: () => void
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  let refreshing: Promise<boolean> | null = null

  function send(method: Method, path: string, body: unknown, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    return doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  function refreshOnce(): Promise<boolean> {
    refreshing ??= (async () => {
      const current = opts.tokens.get()
      if (!current) return false
      const res = await send('POST', '/auth/refresh', { refreshToken: current.refreshToken })
      if (!res.ok) {
        opts.tokens.set(null)
        opts.onSessionExpired?.()
        return false
      }
      const s = (await res.json()) as Tokens
      opts.tokens.set({ accessToken: s.accessToken, refreshToken: s.refreshToken })
      return true
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    let res = await send(method, path, body, opts.tokens.get()?.accessToken)
    if (res.status === 401 && opts.tokens.get()) {
      if (await refreshOnce()) res = await send(method, path, body, opts.tokens.get()?.accessToken)
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; requestId?: string } } | null
      throw new ApiError(res.status, err?.error?.code ?? 'http_error', err?.error?.message ?? res.statusText, err?.error?.requestId)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  return {
    request,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
