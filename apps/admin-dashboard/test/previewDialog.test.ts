import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { api } from '../src/auth/session'
import DocumentPreviewDialog from '../src/components/kb/DocumentPreviewDialog.vue'

vi.mock('@/auth/session', () => ({ api: { get: vi.fn(), blob: vi.fn() } }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})
beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.blob).mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const doc = (mimeType: string): KbDocumentView => ({
  id: 'd1', title: 'Returns', mimeType, sizeBytes: 10, status: 'ready', error: null, chunkCount: 1, createdAt: '', updatedAt: '',
})

describe('DocumentPreviewDialog', () => {
  it('shows a PDF in the browser viewer through an object URL, and revokes it on unmount', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('application/pdf') } })
    await flushPromises()
    expect(api.blob).toHaveBeenCalledWith('/kb/documents/d1/file')
    expect(w.find('iframe').attributes('src')).toBe('blob:preview')
    w.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('renders Markdown inline, sanitised', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['# Hello\n\n<script>alert(1)</script>']))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('text/markdown') } })
    await flushPromises()
    expect(w.find('.kb-markdown h1').text()).toBe('Hello')
    expect(w.find('.kb-markdown').html()).not.toContain('<script')
  })

  it('shows plain text as preformatted text', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['Line 1\nLine 2']))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('text/plain') } })
    await flushPromises()
    expect(w.find('pre').text()).toBe('Line 1\nLine 2')
  })

  it('shows extracted text for DOCX without downloading the file', async () => {
    vi.mocked(api.get).mockResolvedValue({ text: 'Ships in 2 days' })
    const w = mount(DocumentPreviewDialog, {
      props: { open: true, doc: doc('application/vnd.openxmlformats-officedocument.wordprocessingml.document') },
    })
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/kb/documents/d1/text')
    expect(api.blob).not.toHaveBeenCalled()
    expect(w.find('pre').text()).toBe('Ships in 2 days')
    expect(w.text()).toContain('Extracted text')
  })

  it('ignores a slow response for a previous document after switching', async () => {
    let resolveFirst!: (b: Blob) => void
    vi.mocked(api.blob)
      .mockReturnValueOnce(new Promise<Blob>((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(new Blob(['second']))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('text/plain') } })
    await w.setProps({ doc: { ...doc('text/plain'), id: 'd2' } })
    await flushPromises()
    resolveFirst(new Blob(['first']))
    await flushPromises()
    expect(w.find('pre').text()).toBe('second')
  })

  it('revokes the object URL when switching documents and when closed', async () => {
    vi.mocked(api.blob).mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }))
    const w = mount(DocumentPreviewDialog, { props: { open: true, doc: doc('application/pdf') } })
    await flushPromises()
    await w.setProps({ doc: { ...doc('application/pdf'), id: 'd2' } })
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    await flushPromises()
    await w.setProps({ open: false })
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    w.unmount()
  })
})
