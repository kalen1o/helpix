import { describe, expect, it } from 'vitest'
import { createWidgetApi } from '../src/api'

describe('createWidgetApi', () => {
  it('sends the shopper token with messages only, and only while there is one', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    let token: string | null = 'tok.en.sig'
    const api = createWidgetApi({ widgetKey: 'wk_1', apiBase: 'http://gw' }, fetchImpl, () => token)

    await api.fetchConfig()
    await api.sendMessage({ message: 'hi' }, new AbortController().signal)
    token = null
    await api.sendMessage({ message: 'again' }, new AbortController().signal)

    expect(calls.map((c) => c.url)).toEqual(['http://gw/widget/config', 'http://gw/chat/messages', 'http://gw/chat/messages'])
    // An expired token must never stop the widget from loading, so config never carries it.
    expect(calls[0]!.init.headers).toEqual({ 'x-helpix-widget-key': 'wk_1' })
    expect(calls[1]!.init.headers).toEqual({
      'x-helpix-widget-key': 'wk_1',
      'content-type': 'application/json',
      'x-helpix-customer-token': 'tok.en.sig',
    })
    expect(calls[2]!.init.headers).toEqual({ 'x-helpix-widget-key': 'wk_1', 'content-type': 'application/json' })
  })

  it('works without a token getter', async () => {
    const seen: RequestInit[] = []
    const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
      seen.push(init)
      return new Response('')
    }) as typeof fetch
    await createWidgetApi({ widgetKey: 'wk_1', apiBase: 'http://gw' }, fetchImpl).sendMessage({ message: 'hi' }, new AbortController().signal)
    expect(seen[0]!.headers).toEqual({ 'x-helpix-widget-key': 'wk_1', 'content-type': 'application/json' })
  })
})
