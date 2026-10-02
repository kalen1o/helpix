import { createApp, reactive } from 'vue'
import css from './widget.css?inline'
import App from './App.vue'
import { createWidgetApi, type WidgetApi, type WidgetTarget } from './api'
import { createIdentity, setToken } from './identity'
import { applyStyles, ensureFonts } from './shadowStyles'

const HOST_ID = 'helpix-widget-host'

export function readScriptConfig(script: HTMLScriptElement | null, base: string = location.href): WidgetTarget | null {
  if (!script) return null
  const widgetKey = script.dataset.widgetKey?.trim()
  if (!widgetKey) return null
  const explicit = script.dataset.apiBase?.trim()
  let apiBase: string
  try {
    apiBase = explicit ? new URL(explicit, base).href : new URL(script.src, base).origin
  } catch {
    return null
  }
  return { widgetKey, apiBase: apiBase.replace(/\/$/, '') }
}

export interface WidgetController {
  open(): void
  close(): void
  destroy(): void
  /** Chat as the shopper in this shop-signed token. A different shopper starts a new conversation. */
  identify(jwt: string): void
  /** Chat as a guest again, in a new conversation. */
  logout(): void
}

export async function mountWidget(
  target: WidgetTarget,
  opts: {
    api?: WidgetApi
    doc?: Document
    css?: string
    /** A token identify()'d before mount. Read once the config has loaded, before the chat reads its stored session. */
    initialToken?: () => string | null
  } = {},
): Promise<WidgetController | null> {
  const doc = opts.doc ?? document
  if (doc.getElementById(HOST_ID)) return null
  const identity = createIdentity()
  const api = opts.api ?? createWidgetApi(target, undefined, () => identity.token)

  let config
  try {
    config = await api.fetchConfig()
  } catch (err) {
    console.warn('[helpix] chat widget disabled:', err instanceof Error ? err.message : err)
    return null
  }
  if (doc.getElementById(HOST_ID)) return null

  const host = doc.createElement('div')
  try {
    host.id = HOST_ID
    // Inline beats shop selectors such as `body > div { transform: ... }`.
    host.style.cssText = 'all:initial'
    const shadow = host.attachShadow({ mode: 'open' })
    applyStyles(shadow, opts.css ?? css, doc)
    ensureFonts(doc)
    const root = doc.createElement('div')
    root.dataset.helpixRoot = ''
    shadow.appendChild(root)
    doc.body.appendChild(host)

    const initial = opts.initialToken?.() ?? null
    if (initial !== null) setToken(identity, initial)
    const state = reactive({ open: false })
    const app = createApp(App, { config, api, widgetKey: target.widgetKey, state, identity })
    app.mount(root)
    return {
      open: () => { state.open = true },
      close: () => { state.open = false },
      destroy: () => {
        app.unmount()
        host.remove()
      },
      identify: (jwt) => setToken(identity, jwt),
      logout: () => setToken(identity, null),
    }
  } catch (err) {
    host.remove()
    console.warn('[helpix] chat widget disabled:', err instanceof Error ? err.message : err)
    return null
  }
}
