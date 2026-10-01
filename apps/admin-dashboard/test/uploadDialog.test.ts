import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import UploadDialog from '../src/components/kb/UploadDialog.vue'

vi.mock('@/auth/session', () => ({ api: { upload: vi.fn(), post: vi.fn() } }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})
beforeEach(() => {
  vi.mocked(api.upload).mockReset()
  vi.mocked(api.post).mockReset()
})

async function pick(w: VueWrapper, file: File) {
  const input = w.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

const submitButton = (w: VueWrapper) => w.find('button[type="submit"]')

describe('UploadDialog', () => {
  it('refuses an unsupported file before uploading', async () => {
    const w = mount(UploadDialog, { props: { open: true } })
    await pick(w, new File(['MZ'], 'setup.exe'))
    expect(w.find('[role="alert"]').text()).toBe('Choose a PDF, DOCX, Markdown or TXT file.')
    expect(submitButton(w).attributes('disabled')).toBeDefined()
  })

  it('uploads a file with the title field first, then closes', async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: 'd1' } as KbDocumentView)
    const w = mount(UploadDialog, { props: { open: true } })
    await pick(w, new File(['# Hi'], 'faq.md'))
    await w.find('#kb-title').setValue('FAQ')
    await w.find('form').trigger('submit')
    await flushPromises()
    const [path, form] = vi.mocked(api.upload).mock.calls[0]!
    expect(path).toBe('/kb/documents')
    expect([...(form as FormData).keys()]).toEqual(['title', 'file'])
    expect(w.emitted('created')![0]).toEqual([{ id: 'd1' }])
    expect(w.emitted('update:open')!.at(-1)).toEqual([false])
  })

  it('posts pasted text', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 'd2' } as KbDocumentView)
    const w = mount(UploadDialog, { props: { open: true } })
    await w.findAll('[role="tab"]')[1]!.trigger('click')
    await w.find('#kb-title').setValue('Hours')
    await w.find('#kb-text').setValue('Open Mon–Fri')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/kb/documents/text', { title: 'Hours', text: 'Open Mon–Fri' })
  })

  it('shows the server error and stays open', async () => {
    vi.mocked(api.upload).mockRejectedValue(new ApiError(409, 'document_limit_reached', 'This knowledge base already has the maximum of 200 documents.'))
    const w = mount(UploadDialog, { props: { open: true } })
    await pick(w, new File(['hi'], 'a.txt'))
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('maximum of 200 documents')
    expect(w.emitted('update:open')).toBeUndefined()
  })
})
