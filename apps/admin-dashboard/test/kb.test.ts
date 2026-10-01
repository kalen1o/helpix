import { describe, expect, it } from 'vitest'
import type { KbDocumentView } from '@helpix/shared/api-types'
import {
  downloadName,
  formatBytes,
  hasPending,
  previewKind,
  reindexPercent,
  reindexSummary,
  typeLabel,
  validateUpload,
} from '../src/lib/kb'

const doc = (over: Partial<KbDocumentView>): KbDocumentView => ({
  id: '1', title: 'Returns', mimeType: 'text/markdown', sizeBytes: 10, status: 'ready', error: null,
  chunkCount: 1, createdAt: '', updatedAt: '', ...over,
})

describe('kb helpers', () => {
  it('maps MIME types to preview kinds, labels and download names', () => {
    expect(previewKind('application/pdf')).toBe('pdf')
    expect(previewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
    expect(previewKind('text/markdown')).toBe('markdown')
    expect(previewKind('text/plain')).toBe('text')
    expect(previewKind('image/png')).toBeNull()
    expect(typeLabel('application/pdf')).toBe('PDF')
    expect(typeLabel('image/png')).toBe('File')
    expect(downloadName(doc({ title: 'Return policy', mimeType: 'application/pdf' }))).toBe('Return policy.pdf')
  })

  it('validates uploads before sending them', () => {
    expect(validateUpload({ name: 'faq.PDF', size: 100 })).toBeNull()
    expect(validateUpload({ name: 'notes.markdown', size: 100 })).toBeNull()
    expect(validateUpload({ name: 'setup.exe', size: 100 })).toBe('Choose a PDF, DOCX, Markdown or TXT file.')
    expect(validateUpload({ name: 'noext', size: 100 })).toBe('Choose a PDF, DOCX, Markdown or TXT file.')
    expect(validateUpload({ name: 'a.txt', size: 0 })).toBe('This file is empty.')
    expect(validateUpload({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 })).toBe('Files must be 10 MB or smaller.')
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024)).toBe('20 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB')
  })

  it('knows when documents are still processing', () => {
    expect(hasPending([doc({}), doc({ status: 'failed' })])).toBe(false)
    expect(hasPending([doc({}), doc({ status: 'processing' })])).toBe(true)
  })

  it('summarises re-index status', () => {
    const s = { running: false, total: 12, done: 12, model: 'm' }
    expect(reindexSummary({ ...s, total: 0, done: 0 })).toBe('Nothing indexed yet.')
    expect(reindexSummary(s)).toBe('Up to date: all 12 chunks use the current embedding model.')
    expect(reindexSummary({ ...s, total: 1, done: 1 })).toBe('Up to date: all 1 chunk uses the current embedding model.')
    expect(reindexSummary({ ...s, done: 3 })).toBe('3 of 12 chunks use the current embedding model. Re-index so search includes the rest.')
    expect(reindexSummary({ ...s, done: 3, running: true })).toBe('Re-indexing… 3 of 12 chunks done.')
    expect(reindexPercent({ ...s, done: 3 })).toBe(25)
    expect(reindexPercent({ ...s, total: 0, done: 0 })).toBe(100)
  })
})
