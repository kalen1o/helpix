import { describe, expect, it } from 'vitest'
import { detectKind, ExtractionError, extractText, kindFromMime, KIND_INFO } from '../src/ingest/extract'
import { makeDocx, makePdf } from './fixtures'

describe('detectKind', () => {
  it('accepts real PDF, DOCX, Markdown and text files, case-insensitively', async () => {
    expect(detectKind('Policy.PDF', await makePdf(['Hello']))).toBe('pdf')
    expect(detectKind('faq.docx', await makeDocx(['Hello']))).toBe('docx')
    expect(detectKind('README.md', Buffer.from('# Hi'))).toBe('markdown')
    expect(detectKind('notes.markdown', Buffer.from('# Hi'))).toBe('markdown')
    expect(detectKind('notes.txt', Buffer.from('hi'))).toBe('text')
  })

  it('refuses files whose bytes do not match the extension', async () => {
    expect(detectKind('fake.pdf', Buffer.from('just text'))).toBeNull()
    expect(detectKind('fake.docx', Buffer.from('just text'))).toBeNull()
    expect(detectKind('binary.txt', Buffer.from([0x68, 0x00, 0x69]))).toBeNull()
    expect(detectKind('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBeNull()
  })

  it('refuses unsupported extensions and files without one', () => {
    expect(detectKind('setup.exe', Buffer.from('MZ'))).toBeNull()
    expect(detectKind('noext', Buffer.from('hi'))).toBeNull()
    expect(detectKind('old.doc', Buffer.from('hi'))).toBeNull()
  })
})

describe('kindFromMime', () => {
  it('maps stored MIME types back to kinds', () => {
    for (const [kind, info] of Object.entries(KIND_INFO)) expect(kindFromMime(info.mimeType)).toBe(kind)
    expect(kindFromMime('image/png')).toBeNull()
  })
})

describe('extractText', () => {
  it('extracts PDF text', async () => {
    const text = await extractText('pdf', await makePdf(['Return policy', 'Refunds within 30 days']))
    expect(text).toContain('Return policy')
    expect(text).toContain('Refunds within 30 days')
  })

  it('extracts DOCX paragraphs', async () => {
    const text = await extractText('docx', await makeDocx(['Shipping', 'Orders ship in 2 days.']))
    expect(text).toContain('Shipping')
    expect(text).toContain('Orders ship in 2 days.')
  })

  it('decodes UTF-8 text and normalises it', async () => {
    expect(await extractText('text', Buffer.from('﻿Café\r\n\r\n\r\nNext', 'utf8'))).toBe('Café\n\nNext')
  })

  it('fails a PDF with no text layer with a helpful message', async () => {
    await expect(extractText('pdf', await makePdf([]))).rejects.toThrow(/No text found in this PDF/)
  })

  it('fails a whitespace-only text file', async () => {
    await expect(extractText('text', Buffer.from('  \n\n  '))).rejects.toThrow('This file contains no text.')
  })

  it('wraps parser failures in ExtractionError', async () => {
    const err = await extractText('pdf', Buffer.from('%PDF-1.7\nnot really a pdf')).catch((e) => e)
    expect(err).toBeInstanceOf(ExtractionError)
    expect(err.message).toMatch(/Could not read this file/)
    await expect(extractText('docx', Buffer.from('PK\u0003\u0004garbage'))).rejects.toBeInstanceOf(ExtractionError)
  })
})
