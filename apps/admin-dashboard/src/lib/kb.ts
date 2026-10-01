import type { DocumentStatus, KbDocumentView, KbReindexStatus } from '@helpix/shared/api-types'

// Mirrors kb-service's KB_MAX_FILE_BYTES default; the server checks again.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.md', '.markdown', '.txt'] as const
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',')

export type PreviewKind = 'pdf' | 'docx' | 'markdown' | 'text'

const KIND_BY_MIME: Record<string, PreviewKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/markdown': 'markdown',
  'text/plain': 'text',
}
const LABEL: Record<PreviewKind, string> = { pdf: 'PDF', docx: 'Word', markdown: 'Markdown', text: 'Text' }
const EXTENSION: Record<PreviewKind, string> = { pdf: '.pdf', docx: '.docx', markdown: '.md', text: '.txt' }

export const STATUS_LABEL: Record<DocumentStatus, string> = { processing: 'Processing', ready: 'Ready', failed: 'Failed' }

export function previewKind(mimeType: string): PreviewKind | null {
  return KIND_BY_MIME[mimeType] ?? null
}

export function typeLabel(mimeType: string): string {
  const kind = previewKind(mimeType)
  return kind ? LABEL[kind] : 'File'
}

export function downloadName(doc: Pick<KbDocumentView, 'title' | 'mimeType'>): string {
  const kind = previewKind(doc.mimeType)
  return doc.title + (kind ? EXTENSION[kind] : '')
}

/** Returns an error message, or null when the file may be uploaded. */
export function validateUpload(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.')
  const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase()
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) return 'Choose a PDF, DOCX, Markdown or TXT file.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 10 MB or smaller.'
  return null
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function hasPending(docs: KbDocumentView[]): boolean {
  return docs.some((d) => d.status === 'processing')
}

const chunks = (n: number) => `${n} chunk${n === 1 ? '' : 's'}`

export function reindexSummary(s: KbReindexStatus): string {
  if (s.total === 0) return 'Nothing indexed yet.'
  if (s.running) return `Re-indexing… ${s.done} of ${chunks(s.total)} done.`
  if (s.done === s.total) return `Up to date: all ${chunks(s.total)} ${s.total === 1 ? 'uses' : 'use'} the current embedding model.`
  return `${s.done} of ${chunks(s.total)} use the current embedding model. Re-index so search includes the rest.`
}

export function reindexPercent(s: KbReindexStatus): number {
  return s.total === 0 ? 100 : Math.floor((s.done / s.total) * 100)
}
