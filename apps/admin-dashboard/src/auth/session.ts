import { reactive, readonly } from 'vue'
import type { MeResponse, SessionResponse } from '@helpix/shared/api-types'
import { createApiClient, type Tokens, type TokenStore } from '@/api/client'

// Demo trade-off: tokens live in localStorage. Revisit (httpOnly cookie) before production.
const STORAGE_KEY = 'helpix.session'

export const tokenStore: TokenStore = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Tokens | null
    } catch {
      return null
    }
  },
  set(tokens) {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
    else localStorage.removeItem(STORAGE_KEY)
  },
}

const state = reactive<{ me: MeResponse | null }>({ me: null })

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  tokens: tokenStore,
  onSessionExpired: () => {
    state.me = null
  },
})

export const session = {
  state: readonly(state),

  async login(email: string, password: string): Promise<MeResponse> {
    const s = await api.post<SessionResponse>('/auth/login', { email, password })
    api.invalidate()
    tokenStore.set({ accessToken: s.accessToken, refreshToken: s.refreshToken })
    return session.loadMe()
  },

  async loadMe(): Promise<MeResponse> {
    const me = await api.get<MeResponse>('/me')
    state.me = me
    return me
  },

  async logout(): Promise<void> {
    const tokens = tokenStore.get()
    api.invalidate()
    tokenStore.set(null)
    state.me = null
    if (tokens) await api.post('/auth/logout', { refreshToken: tokens.refreshToken }).catch(() => {})
  },
}
