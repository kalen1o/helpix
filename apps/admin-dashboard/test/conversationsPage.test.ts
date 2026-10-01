import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationListResponse, ConversationSummary } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import ConversationsPage from '../src/pages/ConversationsPage.vue'

vi.mock('@/auth/session', () => ({ api: { get: vi.fn() }, session: { state: { me: { tenant: { name: 'Teen Fashion' } } } } }))

const conv = (over: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'c1',
  isPlayground: false,
  customerId: null,
  messageCount: 2,
  preview: 'Do you ship to Hanoi?',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-01T08:05:00Z',
  ...over,
})
const page = (conversations: ConversationSummary[], nextBefore: string | null = null): ConversationListResponse => ({ conversations, nextBefore })
const mountPage = () => mount(ConversationsPage, { global: { stubs: { RouterLink: RouterLinkStub } } })

beforeEach(() => {
  vi.mocked(api.get).mockReset()
})

describe('ConversationsPage', () => {
  it('lists customer conversations with who, the first message and a link to the transcript', async () => {
    vi.mocked(api.get).mockResolvedValue(page([conv({}), conv({ id: 'c2', customerId: 'cust_1001', messageCount: 6 })]))
    const w = mountPage()
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/chat/conversations?kind=real')
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Anonymous visitor')
    expect(rows[0]!.text()).toContain('Do you ship to Hanoi?')
    expect(rows[1]!.text()).toContain('cust_1001')
    expect(w.findAllComponents(RouterLinkStub).map((l) => l.props('to'))).toEqual(['/conversations/c1', '/conversations/c2'])
  })

  it('switches to playground chats', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([conv({ isPlayground: true })]))
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain('No conversations yet')
    await w.findAll('button').find((b) => b.text() === 'Playground')!.trigger('click')
    await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/chat/conversations?kind=playground')
    expect(w.find('tbody tr').text()).toContain('Admin test')
  })

  it('loads more with the cursor', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(page([conv({})], '2026-10-01T08:05:00.123456Z'))
      .mockResolvedValueOnce(page([conv({ id: 'c0', preview: 'Older' })]))
    const w = mountPage()
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Load more')!.trigger('click')
    await flushPromises()
    expect(api.get).toHaveBeenLastCalledWith('/chat/conversations?kind=real&before=2026-10-01T08%3A05%3A00.123456Z')
    expect(w.findAll('tbody tr')).toHaveLength(2)
    expect(w.findAll('button').some((b) => b.text() === 'Load more')).toBe(false)
  })

  it('keeps the loaded rows and shows an error when load more fails', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(page([conv({})], '2026-10-01T08:05:00.123456Z'))
      .mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Chat service is down'))
    const w = mountPage()
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Load more')!.trigger('click')
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(1)
    expect(w.find('[role="alert"]').text()).toContain('Chat service is down')
    expect(w.findAll('button').some((b) => b.text() === 'Load more')).toBe(true)
  })
})
