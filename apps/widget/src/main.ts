import { mountWidget, readScriptConfig, type WidgetController } from './bootstrap'

declare global {
  interface Window {
    Helpix?: { open(): void; close(): void; identify(jwt: string): void; logout(): void }
  }
}

function boot() {
  // A second load of the script (or a host left by an earlier one) must not replace the live widget.
  if (window.Helpix || document.getElementById('helpix-widget-host')) return

  // currentScript is only set while this classic script first runs, so read it before anything async.
  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>('script[data-widget-key]')
  const target = readScriptConfig(script)

  let controller: WidgetController | null = null
  let openRequested = false

  window.Helpix = {
    open: () => (controller ? controller.open() : (openRequested = true)),
    close: () => {
      openRequested = false
      controller?.close()
    },
    // Shop sign-in arrives in step 4b; until then the widget always chats as an anonymous visitor.
    identify: () => {},
    logout: () => {},
  }

  function start() {
    if (!target) {
      console.warn('[helpix] add data-widget-key to the helpix-widget.js script tag')
      return
    }
    mountWidget(target)
      .then((c) => {
        controller = c
        if (c && openRequested) c.open()
      })
      .catch((err) => console.warn('[helpix] chat widget disabled:', err instanceof Error ? err.message : err))
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

boot()
