import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountWidget, readScriptConfig } from '../src/bootstrap'
import { loadSession, saveSession } from '../src/storage'
import { WIDGET_CONFIG, fakeApi, fakeJwt, sseResponse } from './helpers'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

describe('mountWidget shopper identity', () => {
  const target = { widgetKey: 'wk_1', apiBase: 'http://gw' }
  const shadow = () => document.getElementById('helpix-widget-host')!.shadowRoot!
  const hint = () => shadow().querySelector('[data-helpix-signin-hint]')

  async function sendFromPanel(text: string) {
    const box = shadow().querySelector('textarea')!
    box.value = text
    box.dispatchEvent(new Event('input'))
    await nextTick()
    shadow().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
  }

  it('identify and logout switch who the widget chats as', async () => {
    const { api } = fakeApi([], { ...WIDGET_CONFIG, orderLookup: true })
    const c = (await mountWidget(target, { api, css: '' }))!
    c.open()
    await flushPromises()
    expect(hint()?.textContent).toContain('Sign in on Orchard Store to ask about your orders')
    c.identify(fakeJwt({ sub: 'cust_maya' }))
    await flushPromises()
    expect(hint()).toBeNull()
    c.logout()
    await flushPromises()
    expect(hint()).not.toBeNull()
    c.destroy()
  })

  it("applies a token given before mount, so a returning shopper keeps their conversation", async () => {
    saveSession('wk_1', { conversationId: 'c1', sessionToken: 's1', customerId: 'cust_maya' })
    const c = (await mountWidget(target, { api: fakeApi([]).api, css: '', initialToken: () => fakeJwt({ sub: 'cust_maya' }) }))!
    expect(loadSession('wk_1')?.conversationId).toBe('c1')
    c.destroy()

    // Without the token the stored conversation is not the visitor's: it is ignored (never continued), but left in
    // place for the tab that owns it.
    const guest = (await mountWidget(target, { api: fakeApi([]).api, css: '' }))!
    expect(loadSession('wk_1')?.customerId).toBe('cust_maya')
    guest.destroy()
  })

  it('sends the shopper token with messages only while signed in', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, headers: { ...(init.headers as Record<string, string>) } })
        if (url.endsWith('/widget/config')) return new Response(JSON.stringify(WIDGET_CONFIG), { headers: { 'content-type': 'application/json' } })
        return sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'done', data: { messageId: 'm1' } }])
      }),
    )
    const jwt = fakeJwt({ sub: 'cust_maya' })
    const c = (await mountWidget(target, { css: '' }))!
    c.identify(jwt)
    c.open()
    await flushPromises()
    await sendFromPanel('Where is my order?')
    c.logout()
    await sendFromPanel('Hello')
    expect(calls.map((x) => x.url)).toEqual(['http://gw/widget/config', 'http://gw/chat/messages', 'http://gw/chat/messages'])
    expect(calls[0]!.headers['x-helpix-customer-token']).toBeUndefined()
    expect(calls[1]!.headers['x-helpix-customer-token']).toBe(jwt)
    expect(calls[2]!.headers['x-helpix-customer-token']).toBeUndefined()
    c.destroy()
  })
})
