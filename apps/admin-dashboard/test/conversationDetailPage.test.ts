import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationDetail } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import ConversationDetailPage from '../src/pages/ConversationDetailPage.vue'

vi.mock('@/auth/session', () => ({ api: { get: vi.fn() } }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { id: 'c1' } }),
}))

const hit = { documentId: 'd1', title: 'Return policy', position: 0, text: 'Refunds are accepted within 30 days of delivery.', score: 0.82 }
const DETAIL: ConversationDetail = {
  conversation: {
    id: 'c1',
    isPlayground: false,
    customerId: 'cust_1001',
    messageCount: 2,
    preview: 'Refunds?',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:05Z',
  },
  messages: [
    { id: 'm1', role: 'user', content: 'Refunds?', tools: [], model: null, createdAt: '2026-10-01T08:00:00Z' },
    {
      id: 'm2',
      role: 'assistant',
      content: 'Within 30 days of delivery.',
      tools: [{ name: 'search_kb', arguments: { query: 'refund policy' }, status: 'ok', results: [hit], error: null }],
      model: 'glm-4.5-air',
      createdAt: '2026-10-01T08:00:05Z',
    },
  ],
}
const mountPage = () => mount(ConversationDetailPage, { global: { stubs: { RouterLink: RouterLinkStub } } })

beforeEach(() => {
  vi.mocked(api.get).mockReset()
})

describe('ConversationDetailPage', () => {
  it('shows the transcript with sources and what the agent looked up', async () => {
    vi.mocked(api.get).mockResolvedValue(DETAIL)
    const w = mountPage()
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/chat/conversations/c1')
    expect(w.find('h1').text()).toBe('cust_1001')
    expect(w.find('[data-role="user"]').text()).toContain('Refunds?')
    const agent = w.find('[data-role="assistant"]')
    expect(agent.text()).toContain('Within 30 days of delivery.')
    expect(agent.text()).toContain('Return policy')
    expect(agent.text()).toContain('glm-4.5-air')
    expect(agent.find('details').text()).toContain('“refund policy”')
    expect(agent.find('details').text()).toContain('(0.82)')
  })

  it('says when the conversation does not exist', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, 'conversation_not_found', 'Conversation not found'))
    const w = mountPage()
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toBe('This conversation does not exist.')
  })

  it('shows order lookups: the order asked about, the status and the orders returned', async () => {
    const order = {
      orderId: '1047',
      status: 'shipped' as const,
      placedAt: '2026-09-28T10:00:00Z',
      updatedAt: '2026-09-30T10:00:00Z',
      items: [{ name: 'iPhone 15', quantity: 1, variant: 'Blue, 128 GB' }, { name: 'USB-C cable', quantity: 2 }],
    }
    vi.mocked(api.get).mockResolvedValue({
      ...DETAIL,
      messages: [
        DETAIL.messages[0]!,
        {
          ...DETAIL.messages[1]!,
          content: 'Order #1047 has shipped.',
          tools: [
            { name: 'lookup_order', arguments: { orderId: '1047' }, status: 'ok', results: [], error: null, orders: [order] },
            { name: 'lookup_order', arguments: { orderId: '9999' }, status: 'empty', results: [], error: null },
            { name: 'lookup_order', arguments: {}, status: 'error', results: [], error: 'unavailable' },
          ],
        },
      ],
    } satisfies ConversationDetail)
    const w = mountPage()
    await flushPromises()
    const agent = w.find('[data-role="assistant"]')
    expect(agent.text()).toContain('Order #1047 · shipped')
    expect(agent.text()).toContain('Order not found')
    expect(agent.text()).toContain("Couldn't check your order")
    const details = agent.find('details').text()
    expect(details).toContain('order #1047 · 1 order')
    expect(details).toContain('#1047 · shipped · 1 × iPhone 15 (Blue, 128 GB), 2 × USB-C cable')
    expect(details).toContain('order #9999 · not found')
    expect(details).toContain('recent orders · unavailable')
    // Order lookups are not knowledge-base searches.
    expect(w.get('[aria-label="Conversation summary"]').text()).toContain('answered without searching')
  })
})
