import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountWidget, readScriptConfig } from '../src/bootstrap'
import { fakeApi } from './helpers'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.restoreAllMocks()
})

function script(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script')
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v)
  return s
}

describe('readScriptConfig', () => {
  it('reads the widget key and takes the API base from the script origin', () => {
    expect(readScriptConfig(script({ src: 'http://localhost:4000/widget/helpix-widget.js', 'data-widget-key': ' wk_1 ' }))).toEqual({
      widgetKey: 'wk_1',
      apiBase: 'http://localhost:4000',
    })
  })

  it('honours data-api-base and strips its trailing slash', () => {
    const s = script({ src: 'https://cdn.example/helpix-widget.js', 'data-widget-key': 'wk_1', 'data-api-base': 'https://api.example/' })
    expect(readScriptConfig(s)?.apiBase).toBe('https://api.example')
  })

  it('returns null without a script or a key', () => {
    expect(readScriptConfig(null)).toBeNull()
    expect(readScriptConfig(script({ src: 'http://localhost:4000/w.js', 'data-widget-key': '' }))).toBeNull()
  })
})

describe('mountWidget', () => {
  const target = { widgetKey: 'wk_1', apiBase: 'http://gw' }

  it('mounts into an open shadow root on document.body, once', async () => {
    const { api } = fakeApi([])
    const first = await mountWidget(target, { api, css: '.x{}' })
    expect(first).not.toBeNull()
    const host = document.getElementById('helpix-widget-host')!
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot!.querySelector('[data-helpix-root]')).not.toBeNull()
    await mountWidget(target, { api, css: '.x{}' })
    expect(document.querySelectorAll('#helpix-widget-host')).toHaveLength(1)
    first!.destroy()
    expect(document.getElementById('helpix-widget-host')).toBeNull()
  })

  it('renders nothing and warns once when the config cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = { fetchConfig: async () => { throw new Error('origin_not_allowed') }, sendMessage: async () => new Response() }
    expect(await mountWidget(target, { api, css: '' })).toBeNull()
    expect(document.getElementById('helpix-widget-host')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[helpix]')
  })

  it('returns null, leaves no host and warns once when mounting throws after the config loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => { throw new Error('head is locked') })
    const { api } = fakeApi([])
    expect(await mountWidget(target, { api, css: '.x{}' })).toBeNull()
    expect(document.getElementById('helpix-widget-host')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[helpix]')
    expect(String(warn.mock.calls[0]![1])).toContain('head is locked')
  })
})
