import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, ChatStreamEvent } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import PlaygroundPanel from '../src/components/agent/PlaygroundPanel.vue'

vi.mock('@/auth/session', () => ({ api: { stream: vi.fn() } }))

const CONFIG: AgentConfig = {
  prompt: 'Unsaved instructions',
  tone: 'playful',
  toneNotes: '',
  greeting: 'Hi!',
  accentColor: '#0C9A82',
  modelOverride: null,
}

const sse = (events: ChatStreamEvent[]) =>
  new Response(events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })

const reply = (conversationId = 'c1'): ChatStreamEvent[] => [
  { event: 'meta', data: { conversationId } },
  { event: 'tool', data: { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Return policy' }] } },
  { event: 'delta', data: { text: 'Within ' } },
  { event: 'delta', data: { text: '30 days.' } },
  { event: 'done', data: { messageId: 'm1' } },
]

async function ask(w: VueWrapper, text: string) {
  await w.find('#playground-message').setValue(text)
  await w.find('form').trigger('submit')
  await flushPromises()
}
const bodyOf = (call: number) => vi.mocked(api.stream).mock.calls[call]![1]
const button = (w: VueWrapper, label: string) => w.findAll('button').find((b) => b.text() === label)

beforeEach(() => {
  vi.mocked(api.stream).mockReset()
})

describe('PlaygroundPanel', () => {
  it('sends the message with the current settings and shows the streamed reply with its sources', async () => {
    vi.mocked(api.stream).mockResolvedValue(sse(reply()))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    expect(api.stream).toHaveBeenCalledWith('/chat/playground', { message: 'Refunds?', config: CONFIG, customerId: null }, expect.any(AbortSignal))
    expect(w.find('[data-role="user"]').text()).toBe('Refunds?')
    expect(w.find('[data-role="assistant"]').text()).toContain('Within 30 days.')
    expect(w.text()).toContain('Return policy')
    expect((w.find('#playground-message').element as HTMLTextAreaElement).value).toBe('')
  })

  it('continues the same test chat and sends the test customer id', async () => {
    vi.mocked(api.stream).mockImplementation(async () => sse(reply('c1')))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    await w.find('#playground-customer').setValue(' cust_1001 ')
    await ask(w, 'And shipping?')
    expect(bodyOf(1)).toEqual({ message: 'And shipping?', config: CONFIG, customerId: 'cust_1001', conversationId: 'c1' })
  })

  it('"New chat" starts over', async () => {
    vi.mocked(api.stream).mockImplementation(async () => sse(reply('c1')))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    await button(w, 'New chat')!.trigger('click')
    expect(w.findAll('[data-role="user"]')).toHaveLength(0)
    await ask(w, 'Hello')
    expect(bodyOf(1)).not.toHaveProperty('conversationId')
  })

  it('shows an error event and retries the same message without duplicating it', async () => {
    vi.mocked(api.stream)
      .mockResolvedValueOnce(
        sse([
          { event: 'meta', data: { conversationId: 'c1' } },
          { event: 'delta', data: { text: 'Hal' } },
          { event: 'error', data: { code: 'llm_unavailable', message: 'The assistant is unavailable right now. Please try again.' } },
        ]),
      )
      .mockResolvedValueOnce(sse(reply('c1')))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    expect(w.text()).toContain('The assistant is unavailable right now.')
    await button(w, 'Try again')!.trigger('click')
    await flushPromises()
    expect(bodyOf(1)).toMatchObject({ message: 'Refunds?', conversationId: 'c1' })
    expect(w.findAll('[data-role="user"]')).toHaveLength(1)
    expect(w.text()).toContain('Within 30 days.')
    expect(w.text()).not.toContain('unavailable')
  })

  it('shows a failed request with a retry', async () => {
    vi.mocked(api.stream).mockRejectedValue(new ApiError(503, 'config_unavailable', 'The assistant is unavailable right now'))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    expect(w.find('[role="alert"]').text()).toBe('The assistant is unavailable right now')
    expect(button(w, 'Try again')).toBeDefined()
  })

  it('says the reply was cut off when the stream ends without done', async () => {
    vi.mocked(api.stream).mockResolvedValue(sse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'delta', data: { text: 'Wi' } }]))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    expect(w.find('[role="alert"]').text()).toContain('cut off')
  })

  it('cannot send while the settings are invalid', async () => {
    const w = mount(PlaygroundPanel, { props: { config: CONFIG, disabled: true } })
    expect(button(w, 'Send')!.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Fix the settings')
    await ask(w, 'Refunds?')
    expect(api.stream).not.toHaveBeenCalled()
  })

  it('sends on Enter but not on Shift+Enter', async () => {
    vi.mocked(api.stream).mockResolvedValue(sse(reply()))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    const box = w.find('#playground-message')
    await box.setValue('Line one')
    await box.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(api.stream).not.toHaveBeenCalled()
    await box.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.stream).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed exchange and offers no retry while the settings are invalid', async () => {
    vi.mocked(api.stream).mockRejectedValue(new ApiError(503, 'config_unavailable', 'Unavailable'))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    await w.setProps({ disabled: true })
    expect(button(w, 'Try again')).toBeUndefined()
    expect(w.findAll('[data-role="user"]')).toHaveLength(1)
    expect(w.find('[role="alert"]').text()).toBe('Unavailable')
    expect(api.stream).toHaveBeenCalledTimes(1)
  })

  it('"New chat" aborts a reply that is still streaming', async () => {
    vi.mocked(api.stream).mockResolvedValue(new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } }))
    const w = mount(PlaygroundPanel, { props: { config: CONFIG } })
    await ask(w, 'Refunds?')
    const signal = vi.mocked(api.stream).mock.calls[0]![2] as AbortSignal
    expect(signal.aborted).toBe(false)
    await button(w, 'New chat')!.trigger('click')
    expect(signal.aborted).toBe(true)
    expect(w.findAll('[data-role="user"]')).toHaveLength(0)
  })
})
