import { createApp, reactive } from 'vue'
import css from './widget.css?inline'
import App from './App.vue'
import { createWidgetApi, type WidgetApi, type WidgetTarget } from './api'
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
}

export async function mountWidget(
  target: WidgetTarget,
  opts: { api?: WidgetApi; doc?: Document; css?: string } = {},
): Promise<WidgetController | null> {
  const doc = opts.doc ?? document
  if (doc.getElementById(HOST_ID)) return null
  const api = opts.api ?? createWidgetApi(target)

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

    const state = reactive({ open: false })
    const app = createApp(App, { config, api, widgetKey: target.widgetKey, state })
    app.mount(root)
    return {
      open: () => { state.open = true },
      close: () => { state.open = false },
      destroy: () => {
        app.unmount()
        host.remove()
      },
    }
  } catch (err) {
    host.remove()
    console.warn('[helpix] chat widget disabled:', err instanceof Error ? err.message : err)
    return null
  }
}
