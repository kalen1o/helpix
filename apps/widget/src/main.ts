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
  // Before mount only the latest call counts: identify() keeps its token, logout() forgets it.
  let pendingToken: string | null = null
  // What the widget mounted with, to pass on a call that lands between that read and the mount finishing.
  let mountedWith: string | null = null

  window.Helpix = {
    open: () => (controller ? controller.open() : (openRequested = true)),
    close: () => {
      openRequested = false
      controller?.close()
    },
    identify: (jwt: string) => {
      if (controller) controller.identify(jwt)
      else pendingToken = jwt
    },
    logout: () => {
      if (controller) controller.logout()
      else pendingToken = null
    },
  }

  function start() {
    if (!target) {
      console.warn('[helpix] add data-widget-key to the helpix-widget.js script tag')
      return
    }
    mountWidget(target, { initialToken: () => (mountedWith = pendingToken) })
      .then((c) => {
        controller = c
        if (c && pendingToken !== mountedWith) {
          if (pendingToken) c.identify(pendingToken)
          else c.logout()
        }
        pendingToken = null
        if (c && openRequested) c.open()
      })
      .catch((err) => console.warn('[helpix] chat widget disabled:', err instanceof Error ? err.message : err))
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

boot()
