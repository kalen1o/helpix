/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HELPIX_GATEWAY?: string
  readonly VITE_HELPIX_WIDGET_KEY?: string
}

/** Set by the Helpix widget script (`helpix-widget.js`), which may load after this app or not at all. */
interface Window {
  Helpix?: { open(): void; close(): void; identify(jwt: string): void; logout(): void }
}
