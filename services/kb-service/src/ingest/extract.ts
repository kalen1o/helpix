import path from 'node:path'
import mammoth from 'mammoth'
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf'
import { normalizeText } from './chunker'

export type KbFileKind = 'pdf' | 'docx' | 'markdown' | 'text'

export const KIND_INFO: Record<KbFileKind, { mimeType: string; extension: string }> = {
  pdf: { mimeType: 'application/pdf', extension: '.pdf' },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
  markdown: { mimeType: 'text/markdown', extension: '.md' },
  text: { mimeType: 'text/plain', extension: '.txt' },
}

const BY_EXTENSION: Record<string, KbFileKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/** A failure whose message is safe and useful to show to the tenant admin. */
export class ExtractionError extends Error {
  override name = 'ExtractionError'
}

export function isTextExtension(filename: string): boolean {
  return ['.txt', '.md', '.markdown'].includes(path.extname(filename).toLowerCase())
}

export function kindFromMime(mime: string): KbFileKind | null {
  const hit = (Object.entries(KIND_INFO) as [KbFileKind, { mimeType: string }][]).find(([, info]) => info.mimeType === mime)
  return hit ? hit[0] : null
}

function decodeUtf8(data: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/** Picks the kind from the file extension, then checks the bytes agree. Returns null for anything unsupported. */
export function detectKind(filename: string, data: Buffer): KbFileKind | null {
  const kind = BY_EXTENSION[path.extname(filename).toLowerCase()]
  if (!kind) return null
  if (kind === 'pdf') return data.subarray(0, 5).toString('latin1') === '%PDF-' ? kind : null
  if (kind === 'docx') return data.subarray(0, 4).equals(ZIP_MAGIC) ? kind : null
  return decodeUtf8(data) === null ? null : kind
}

export async function extractText(kind: KbFileKind, data: Buffer): Promise<string> {
  let raw: string
  try {
    if (kind === 'pdf') {
      // Copy: pdf.js may transfer (detach) the buffer it is given.
      const pdf = await getDocumentProxy(new Uint8Array(data))
      try {
        raw = (await extractPdfText(pdf, { mergePages: true })).text
      } finally {
        // unpdf's proxy has no destroy(); the loading task owns the worker and document resources.
        await pdf.loadingTask.destroy()
      }
    } else if (kind === 'docx') {
      raw = (await mammoth.extractRawText({ buffer: data })).value
    } else {
      raw = decodeUtf8(data) ?? ''
    }
  } catch (err) {
    throw new ExtractionError('Could not read this file. It may be damaged or password-protected.', { cause: err })
  }
  const text = normalizeText(raw)
  if (!text) {
    throw new ExtractionError(
      kind === 'pdf' ? 'No text found in this PDF. Scanned PDFs are not supported.' : 'This file contains no text.',
    )
  }
  return text
}
