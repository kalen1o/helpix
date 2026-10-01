import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { api } from '../src/auth/session'
import KnowledgeBasePage from '../src/pages/KnowledgeBasePage.vue'

vi.mock('@/auth/session', () => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), upload: vi.fn(), blob: vi.fn() },
  session: { state: { me: { tenant: { name: 'Teen Fashion' } } } },
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})

const doc = (over: Partial<KbDocumentView>): KbDocumentView => ({
  id: 'd1', title: 'Returns', mimeType: 'text/markdown', sizeBytes: 2048, status: 'ready', error: null,
  chunkCount: 3, createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z', ...over,
})

beforeEach(() => {
  for (const fn of Object.values(api)) vi.mocked(fn as (...a: unknown[]) => unknown).mockReset()
})

function getReturns(documents: KbDocumentView[]) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/kb/documents') return { documents }
    if (path === '/kb/reindex') return { running: false, total: 3, done: 3, model: 'fake:hash:1024' }
    throw new Error(`unexpected GET ${path}`)
  })
}

describe('KnowledgeBasePage', () => {
  it('shows an empty state when there are no documents', async () => {
    getReturns([])
    const w = mount(KnowledgeBasePage)
    await flushPromises()
    expect(w.text()).toContain('No documents yet')
  })

  it('lists documents with status, and shows the failure reason and Retry only for failed ones', async () => {
    getReturns([doc({}), doc({ id: 'd2', title: 'Scan', status: 'failed', error: 'No text found in this PDF.' })])
    const w = mount(KnowledgeBasePage)
    await flushPromises()
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Ready')
    expect(rows[0]!.text()).not.toContain('Retry')
    expect(rows[1]!.text()).toContain('No text found in this PDF.')
    expect(rows[1]!.text()).toContain('Retry')
  })

  it('retries a failed document and shows it processing', async () => {
    getReturns([doc({ status: 'failed', error: 'x' })])
    vi.mocked(api.post).mockResolvedValue(doc({ status: 'processing' }))
    const w = mount(KnowledgeBasePage)
    await flushPromises()
    await w.findAll('tbody tr button').find((b) => b.text() === 'Retry')!.trigger('click')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/kb/documents/d1/retry')
    expect(w.find('tbody tr').text()).toContain('Processing')
  })

  it('deletes a document after confirmation', async () => {
    getReturns([doc({})])
    vi.mocked(api.del).mockResolvedValue(undefined)
    const w = mount(KnowledgeBasePage, { attachTo: document.body })
    await flushPromises()
    await w.findAll('tbody tr button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()
    const confirm = w.findAll('dialog button').find((b) => b.text() === 'Delete')!
    await confirm.trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/kb/documents/d1')
    expect(w.findAll('tbody tr')).toHaveLength(0)
    w.unmount()
  })

  it('does not let a slow in-flight refresh overwrite a local delete', async () => {
    vi.useFakeTimers()
    try {
      const first = [doc({ status: 'processing' })]
      let release!: (v: { documents: KbDocumentView[] }) => void
      let calls = 0
      vi.mocked(api.get).mockImplementation(async (path: string) => {
        if (path === '/kb/reindex') return { running: false, total: 0, done: 0, model: 'm' }
        calls++
        if (calls === 1) return { documents: first }
        return new Promise((r) => { release = r })
      })
      vi.mocked(api.del).mockResolvedValue(undefined)
      const w = mount(KnowledgeBasePage, { attachTo: document.body })
      await flushPromises()
      await vi.advanceTimersByTimeAsync(2000) // poll starts and stays pending
      expect(calls).toBe(2)
      await w.findAll('tbody tr button').find((b) => b.text() === 'Delete')!.trigger('click')
      await flushPromises()
      await w.findAll('dialog button').find((b) => b.text() === 'Delete')!.trigger('click')
      await flushPromises()
      expect(w.findAll('tbody tr')).toHaveLength(0)
      release({ documents: first })
      await flushPromises()
      expect(w.findAll('tbody tr')).toHaveLength(0)
      w.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
