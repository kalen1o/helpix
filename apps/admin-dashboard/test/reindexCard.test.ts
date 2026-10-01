import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/auth/session'
import ReindexCard from '../src/components/kb/ReindexCard.vue'

vi.mock('@/auth/session', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
})

const button = (w: ReturnType<typeof mount>) => w.find('button')

describe('ReindexCard', () => {
  it('disables the button when everything is up to date', async () => {
    vi.mocked(api.get).mockResolvedValue({ running: false, total: 4, done: 4, model: 'fake:hash:1024' })
    const w = mount(ReindexCard)
    await flushPromises()
    expect(w.text()).toContain('Up to date')
    expect(button(w).attributes('disabled')).toBeDefined()
  })

  it('starts a re-index and shows progress', async () => {
    vi.mocked(api.get).mockResolvedValue({ running: false, total: 4, done: 1, model: 'm' })
    vi.mocked(api.post).mockResolvedValue({ running: true, total: 4, done: 1, model: 'm' })
    const w = mount(ReindexCard)
    await flushPromises()
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
    await button(w).trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/kb/reindex')
    expect(button(w).text()).toBe('Re-indexing…')
    expect(button(w).attributes('disabled')).toBeDefined()
    w.unmount()
  })
})
