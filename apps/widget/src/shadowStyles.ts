// Tailwind 4 registers its --tw-* variables with @property, and @property is ignored inside a shadow root
// (verified in the Task 0 spike). Without the registered initial values, shadows, rings, transforms and gradients
// compute to nothing. Re-declare the initial values the way Tailwind's own no-@property fallback does, in a layer
// declared first so every utility still overrides it.
const PROPERTY_RULE = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g

// Tailwind sizes are rem, and rem resolves against the HOST page's <html> font-size even inside a shadow root
// (Shopify Dawn sets html{font-size:62.5%}, which would shrink the whole widget). Convert to px, but only inside
// innermost declaration blocks so selectors with escaped values such as `7rem` stay intact.
const INNERMOST_BLOCK = /\{([^{}]*)\}/g
const REM = /(?<![\w.])(-?\d*\.?\d+)rem(?![\w-])/g

function remToPx(css: string): string {
  return css.replace(INNERMOST_BLOCK, (_m, body: string) =>
    `{${body.replace(REM, (_r, n: string) => `${Number((parseFloat(n) * 16).toFixed(4))}px`)}}`,
  )
}

export function shadowSafeCss(css: string): string {
  const decls: string[] = []
  const rest = css.replace(PROPERTY_RULE, (_m, name: string, body: string) => {
    const initial = /initial-value\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
    decls.push(`${name}:${initial ?? 'initial'}`)
    return ''
  })
  if (decls.length === 0) return remToPx(css)
  return remToPx(`@layer properties{:host,*,::before,::after,::backdrop{${decls.join(';')}}}\n${rest}`)
}

export function applyStyles(shadow: ShadowRoot, css: string, doc: Document = document): void {
  const text = shadowSafeCss(css)
  const view = doc.defaultView as (Window & typeof globalThis) | null
  const Sheet = view?.CSSStyleSheet
  if (Sheet && 'replaceSync' in Sheet.prototype && 'adoptedStyleSheets' in shadow) {
    const sheet = new Sheet()
    sheet.replaceSync(text)
    shadow.adoptedStyleSheets = [sheet]
    return
  }
  const style = doc.createElement('style')
  style.textContent = text
  shadow.appendChild(style)
}

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap'

/** @font-face inside a shadow root is ignored, so the widget's font is loaded by the host document. */
export function ensureFonts(doc: Document = document): void {
  if (doc.head.querySelector('link[data-helpix-fonts]')) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONTS_HREF
  link.dataset.helpixFonts = ''
  doc.head.appendChild(link)
}
