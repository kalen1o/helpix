import { afterEach, describe, expect, it } from 'vitest'
import { applyStyles, ensureFonts, shadowSafeCss } from '../src/shadowStyles'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

const CSS = `@layer theme, base, components, utilities;
.shadow-lg{box-shadow:var(--tw-shadow)}
@property --tw-shadow { syntax: "*"; inherits: false; initial-value: 0 0 #0000; }
@property --tw-ring-color { syntax: "*"; inherits: false }`

describe('shadowSafeCss', () => {
  it('replaces @property rules with initial values in a lowest-priority layer at the top', () => {
    const out = shadowSafeCss(CSS)
    expect(out).not.toContain('@property')
    expect(out.startsWith('@layer properties{:host,*,::before,::after,::backdrop{--tw-shadow:0 0 #0000;--tw-ring-color:initial}}')).toBe(true)
    expect(out).toContain('.shadow-lg{box-shadow:var(--tw-shadow)}')
  })

  it('leaves CSS without @property unchanged', () => {
    expect(shadowSafeCss('.a{color:red}')).toBe('.a{color:red}')
  })
})

describe('shadowSafeCss rem to px', () => {
  it('converts rem in declarations, including custom properties', () => {
    const out = shadowSafeCss(':host{--spacing:.25rem}.p-2{padding:calc(var(--spacing)*2)}.t{font-size:.875rem;margin:-0.5rem 1rem 1.5000rem 0}')
    expect(out).toContain('--spacing:4px')
    expect(out).toContain('font-size:14px')
    expect(out).toContain('margin:-8px 16px 24px 0')
    expect(out).not.toContain('rem')
  })

  it('converts rem inside calc()', () => {
    expect(shadowSafeCss('.a{height:calc(100dvh - 7rem)}')).toBe('.a{height:calc(100dvh - 112px)}')
    expect(shadowSafeCss('.a{height:calc(100dvh-7rem)}')).toBe('.a{height:calc(100dvh-112px)}')
  })

  it('leaves selectors with escaped rem values intact while converting their declaration', () => {
    const sel = '.h-\\[min\\(640px\\,calc\\(100dvh-7rem\\)\\)\\]'
    const out = shadowSafeCss(`${sel}{height:min(640px,calc(100dvh - 7rem))}`)
    expect(out).toBe(`${sel}{height:min(640px,calc(100dvh - 112px))}`)
  })

  it('converts inside @media and nested @layer blocks, but not em, vh or px', () => {
    const out = shadowSafeCss('@layer utilities{@media (min-width:40rem){.a{padding:1rem 2em 3vh 4px}}}')
    expect(out).toBe('@layer utilities{@media (min-width:40rem){.a{padding:16px 2em 3vh 4px}}}')
  })

  it('converts rem in the prepended @layer properties block', () => {
    const out = shadowSafeCss('@property --x { syntax: "*"; inherits: false; initial-value: 2rem; }')
    expect(out).toContain('--x:32px')
  })
})

describe('applyStyles', () => {
  it('falls back to a <style> element when constructable stylesheets are unavailable (jsdom)', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    applyStyles(shadow, CSS)
    const style = shadow.querySelector('style')!
    expect(style.textContent).toContain('.shadow-lg')
    expect(style.textContent).not.toContain('@property')
  })
})

describe('ensureFonts', () => {
  it('adds the Instrument Sans stylesheet to the host page once', () => {
    ensureFonts()
    ensureFonts()
    const links = document.head.querySelectorAll('link[data-helpix-fonts]')
    expect(links).toHaveLength(1)
    expect((links[0] as HTMLLinkElement).href).toContain('Instrument+Sans')
  })
})
