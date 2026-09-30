import { describe, expect, it, vi } from 'vitest'
import { applyTheme, parsePreference, resolveTheme } from '../src/lib/theme'

describe('theme', () => {
  it('parses stored preferences, defaulting to system', () => {
    expect(parsePreference('dark')).toBe('dark')
    expect(parsePreference('light')).toBe('light')
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference('purple')).toBe('system')
  })

  it('resolves system preference from the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('toggles the dark class and suppresses transitions until the next frames', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    const root = document.createElement('html')

    applyTheme('dark', root)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('hx-theme-switching')).toBe(true)
    frames.shift()!(0)
    frames.shift()!(0)
    expect(root.classList.contains('hx-theme-switching')).toBe(false)

    applyTheme('light', root)
    expect(root.classList.contains('dark')).toBe(false)
    vi.unstubAllGlobals()
  })
})
