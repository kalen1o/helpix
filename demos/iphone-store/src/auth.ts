import { reactive } from 'vue'
import type { BagLine } from './cart'

export interface ShopCustomer {
  id: string
  name: string
  email: string
}

interface MeResponse {
  customer: ShopCustomer | null
  helpixToken?: string
}

/** A failed call to the shop backend, with its message and (for form errors) the field it is about. */
export class ShopApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'ShopApiError'
  }
}

export const auth = reactive<{ customer: ShopCustomer | null; loaded: boolean }>({ customer: null, loaded: false })

/** The Helpix token lasts an hour; refreshing twice as often keeps it from expiring mid-chat. */
export const REFRESH_MS = 30 * 60 * 1000
/** Which shopper this browser last identified to the widget, so a sign-out elsewhere still logs the widget out. */
const IDENTIFIED_KEY = 'orchard:helpix-customer'
const HELPIX_POLL_MS = 100
const HELPIX_WAIT_MS = 15_000

let helpixToken: string | null = null
/** This page identified a shopper (survives blocked storage and storage cleared by another tab). */
let identifiedHere = false
/** An explicit sign-out whose widget logout() has not been delivered yet (widget script not loaded). */
let logoutPending = false
let pollTimer: ReturnType<typeof setInterval> | null = null

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const json: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; field?: string } } | null)?.error
    throw new ShopApiError(e?.message ?? 'Something went wrong. Please try again.', e?.code ?? 'request_failed', e?.field)
  }
  return json as T
}

function readIdentified(): string | null {
  try {
    return localStorage.getItem(IDENTIFIED_KEY)
  } catch {
    return null
  }
}

function writeIdentified(customerId: string | null): void {
  try {
    if (customerId) localStorage.setItem(IDENTIFIED_KEY, customerId)
    else localStorage.removeItem(IDENTIFIED_KEY)
  } catch {
    // Storage blocked: the widget still gets identify(); only a cross-tab sign-out is missed.
  }
}

/**
 * Tells the widget who is shopping: identify() with a fresh token when signed in. logout() only when this page or this browser
 * identified someone before (or the shopper just signed out), so an anonymous visitor's conversation is not wiped on every page load.
 * Returns false while the widget script has not run.
 */
function applyToWidget(): boolean {
  const helpix = window.Helpix
  if (!helpix) return false
  if (auth.customer && helpixToken) {
    helpix.identify(helpixToken)
    identifiedHere = true
    writeIdentified(auth.customer.id)
  } else if (logoutPending || identifiedHere || readIdentified()) {
    helpix.logout()
    identifiedHere = false
    logoutPending = false
    writeIdentified(null)
  }
  return true
}

/** The widget is a separate deferred script that can run after this app: poll briefly until it appears. */
function syncWidget(): void {
  if (applyToWidget() || pollTimer) return
  const started = Date.now()
  pollTimer = setInterval(() => {
    if (applyToWidget() || Date.now() - started > HELPIX_WAIT_MS) {
      clearInterval(pollTimer!)
      pollTimer = null
    }
  }, HELPIX_POLL_MS)
}

function setSession(me: MeResponse): void {
  auth.customer = me.customer
  helpixToken = me.customer ? (me.helpixToken ?? null) : null
  auth.loaded = true
  syncWidget()
}

export async function refresh(): Promise<void> {
  try {
    setSession(await request<MeResponse>('GET', '/api/me'))
  } catch {
    // Backend down or not seeded yet: keep what we have; the next refresh tries again.
    auth.loaded = true
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  await request('POST', '/api/login', { email, password })
  await refresh()
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  await request('POST', '/api/signup', { name, email, password })
  await refresh()
}

export async function signOut(): Promise<void> {
  await request('POST', '/api/logout').catch(() => undefined)
  logoutPending = true
  setSession({ customer: null })
}

export async function checkout(lines: BagLine[]): Promise<{ orderId: string }> {
  try {
    return await request<{ orderId: string }>('POST', '/api/checkout', {
      items: lines.map(({ productId, color, gb, quantity }) => ({ productId, color, gb, quantity })),
    })
  } catch (e) {
    if (e instanceof ShopApiError && e.code === 'not_signed_in') void refresh()
    throw e
  }
}

/** Loads the session now, every 30 minutes and whenever the tab regains focus. Returns a stop function. */
export function startAuth(): () => void {
  void refresh()
  const timer = setInterval(() => void refresh(), REFRESH_MS)
  const onFocus = () => void refresh()
  window.addEventListener('focus', onFocus)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', onFocus)
  }
}

/** A `?next=` value that stays on this site: one leading slash, not `//host` or `/\host`. */
export function nextPath(next: unknown): string {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/'
}
