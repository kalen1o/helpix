import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import type { WidgetConfig } from '@helpix/shared/api-types'
import App from '../src/App.vue'
import { createIdentity, setToken, type Identity } from '../src/identity'
import { WIDGET_CONFIG, errorResponse, fakeApi, fakeJwt, sseResponse } from './helpers'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

function mountApp(
  replies: Array<Response | (() => Promise<Response>)>,
  opts: { config?: Partial<WidgetConfig>; identity?: Identity } = {},
) {
  const { api, bodies } = fakeApi(replies)
  const state = reactive({ open: false })
  const identity = opts.identity ?? createIdentity()
  const config = { ...WIDGET_CONFIG, accentColor: '#123456', ...opts.config }
  const wrapper = mount(App, { props: { config, api, widgetKey: 'wk_1', state, identity }, attachTo: document.body })
  return { wrapper, bodies, state, identity }
}

const answer = (text: string) =>
  sseResponse([
    { event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } },
    { event: 'tool', data: { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Shipping' }] } },
    { event: 'delta', data: { text } },
    { event: 'done', data: { messageId: 'm1' } },
  ])

describe('widget UI', () => {
  it('shows the launcher in the accent colour and opens a panel headed with the shop name and greeting', async () => {
    const { wrapper } = mountApp([])
    const launcher = wrapper.get('[data-helpix-launcher]')
    expect(launcher.attributes('style')).toContain('background-color: rgb(18, 52, 86)')
    expect(launcher.attributes('aria-label')).toBe('Open chat')
    expect(wrapper.find('[data-helpix-panel]').exists()).toBe(false)
    await launcher.trigger('click')
    const panel = wrapper.get('[data-helpix-panel]')
    expect(panel.text()).toContain('Orchard Store')
    expect(panel.text()).toContain('Hi from Orchard')
    expect(panel.text()).toContain('Powered by')
    expect(launcher.attributes('aria-label')).toBe('Close chat')
  })

  it('sends with Enter, keeps Shift+Enter for new lines, and shows sources', async () => {
    const { wrapper, bodies, state } = mountApp([answer('We ship in 2 days.')])
    state.open = true
    await flushPromises()
    const box = wrapper.get('textarea')
    await box.setValue('How fast')
    await box.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(bodies).toHaveLength(0)
    await box.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(bodies[0]).toEqual({ message: 'How fast' })
    expect(wrapper.findAll('[data-role="assistant"]').at(-1)!.text()).toContain('We ship in 2 days.')
    expect(wrapper.text()).toContain('Shipping')
    expect((box.element as HTMLTextAreaElement).value).toBe('')
  })

  it('renders reply text as plain text', async () => {
    const { wrapper, state } = mountApp([answer('<img src=x onerror="window.pwned=1"> **bold**')])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const panel = wrapper.get('[data-helpix-panel]')
    expect(panel.find('img').exists()).toBe(false)
    expect(panel.text()).toContain('<img src=x onerror="window.pwned=1"> **bold**')
  })

  it('offers Try again after an error', async () => {
    const { wrapper, bodies, state } = mountApp([errorResponse(503, 'upstream_unavailable', 'A backend service is unavailable'), answer('Back now')])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('A backend service is unavailable')
    await wrapper.get('[data-helpix-retry]').trigger('click')
    await flushPromises()
    expect(bodies).toHaveLength(2)
    expect(wrapper.text()).toContain('Back now')
    expect(wrapper.find('[data-helpix-retry]').exists()).toBe(false)
  })

  it('New chat clears the transcript', async () => {
    const { wrapper, state } = mountApp([answer('First')])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-helpix-new-chat]').trigger('click')
    expect(wrapper.findAll('[data-role="user"]')).toHaveLength(0)
    expect(localStorage.getItem('helpix:wk_1')).toBeNull()
  })

  it('hides the launcher on narrow screens while the panel is open, and links it to the panel', async () => {
    const { wrapper, state } = mountApp([])
    const launcher = wrapper.get('[data-helpix-launcher]')
    expect(launcher.classes()).not.toContain('max-[480px]:hidden')
    state.open = true
    await flushPromises()
    expect(launcher.classes()).toContain('max-[480px]:hidden')
    expect(launcher.attributes('aria-controls')).toBe(wrapper.get('[data-helpix-panel]').attributes('id'))
    expect(wrapper.get('[data-helpix-panel]').attributes('aria-modal')).toBeUndefined()
  })

  it('focuses the composer on open, closes on Escape and returns focus to the launcher', async () => {
    const { wrapper, state } = mountApp([])
    state.open = true
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    await wrapper.get('[data-helpix-panel]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(state.open).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-helpix-launcher]').element)
  })

  it('keeps streaming when the panel is closed and shows the finished reply on reopen', async () => {
    let release!: (r: Response) => void
    const deferred = new Promise<Response>((resolve) => (release = resolve))
    const { wrapper, bodies, state } = mountApp([() => deferred])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(bodies).toHaveLength(1)
    state.open = false
    await flushPromises()
    release(answer('Done while closed'))
    await flushPromises()
    state.open = true
    await flushPromises()
    expect(wrapper.findAll('[data-role="assistant"]').at(-1)!.text()).toContain('Done while closed')
    expect(wrapper.find('[data-helpix-retry]').exists()).toBe(false)
  })

  it('shows the sign-in hint only when order lookup is on and nobody is signed in', async () => {
    const { wrapper, state, identity } = mountApp([], { config: { orderLookup: true } })
    state.open = true
    await flushPromises()
    expect(wrapper.get('[data-helpix-signin-hint]').text()).toBe('Sign in on Orchard Store to ask about your orders')
    setToken(identity, fakeJwt({ sub: 'cust_maya' }))
    await flushPromises()
    expect(wrapper.find('[data-helpix-signin-hint]').exists()).toBe(false)
    setToken(identity, null)
    await flushPromises()
    expect(wrapper.find('[data-helpix-signin-hint]').exists()).toBe(true)

    const off = mountApp([])
    off.state.open = true
    await flushPromises()
    expect(off.wrapper.find('[data-helpix-signin-hint]').exists()).toBe(false)
  })

  it('shows order chips, but not empty knowledge-base searches', async () => {
    const { wrapper, state } = mountApp([
      sseResponse([
        { event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } },
        { event: 'tool', data: { name: 'search_kb', status: 'empty', sources: [] } },
        { event: 'tool', data: { name: 'lookup_order', status: 'ok', sources: [], orders: [{ orderId: '1047', status: 'processing' }, { orderId: '1003', status: 'shipped' }] } },
        { event: 'delta', data: { text: 'Order 1047 is being prepared.' } },
        { event: 'done', data: { messageId: 'm1' } },
      ]),
    ])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('Where are my orders?')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const reply = wrapper.findAll('[data-role="assistant"]').at(-1)!
    expect(reply.get('[aria-label="Orders"]').findAll('li').map((li) => li.text())).toEqual(['Order #1047 · processing', 'Order #1003 · shipped'])
    expect(reply.text()).not.toContain('No matching documents')
  })

  it('says when an order was not found or could not be checked, but hides knowledge-base errors', async () => {
    const turn = (tools: object[]) =>
      sseResponse([
        { event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } },
        ...tools.map((data) => ({ event: 'tool' as const, data: data as never })),
        { event: 'delta', data: { text: 'Answer' } },
        { event: 'done', data: { messageId: 'm1' } },
      ])
    const { wrapper, state } = mountApp([
      turn([{ name: 'lookup_order', status: 'empty', sources: [] }]),
      turn([{ name: 'search_kb', status: 'error', sources: [] }, { name: 'lookup_order', status: 'error', sources: [] }]),
    ])
    state.open = true
    await flushPromises()
    for (const text of ['Order 9999?', 'And now?']) {
      await wrapper.get('textarea').setValue(text)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
    }
    const replies = wrapper.findAll('[data-role="assistant"]')
    expect(replies.at(-2)!.get('[aria-label="Orders"]').text()).toBe('Order not found')
    expect(replies.at(-1)!.get('[aria-label="Orders"]').text()).toBe("Couldn't check your order")
    expect(replies.at(-1)!.text()).not.toContain("Couldn't check the knowledge base")
  })
})
