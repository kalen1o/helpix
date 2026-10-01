import { describe, expect, it } from 'vitest'
import { cleanTitle, contentDisposition, titleFromFilename } from '../src/lib/names'

describe('names', () => {
  it('cleans titles: control characters, whitespace runs, length', () => {
    expect(cleanTitle('  Return\u0000\tPolicy \n v2  ')).toBe('Return Policy v2')
    expect(Array.from(cleanTitle('é'.repeat(300)))).toHaveLength(200)
  })

  it('derives a title from a file name without its path or extension', () => {
    expect(titleFromFilename('../../etc/Return Policy.md')).toBe('Return Policy')
    expect(titleFromFilename('C:\\Users\\me\\faq.final.pdf')).toBe('faq.final')
    expect(titleFromFilename('.txt')).toBe('Untitled')
  })

  it('writes an RFC 6266 content-disposition with an ASCII fallback', () => {
    expect(contentDisposition('báo giá "mới".txt')).toBe(
      `attachment; filename="bao gia _moi_.txt"; filename*=UTF-8''b%C3%A1o%20gi%C3%A1%20%22m%E1%BB%9Bi%22.txt`,
    )
    expect(contentDisposition('退货.pdf')).toBe(`attachment; filename=".pdf"; filename*=UTF-8''%E9%80%80%E8%B4%A7.pdf`)
    expect(contentDisposition("it's (v2)*.md")).toContain(`filename*=UTF-8''it%27s%20%28v2%29%2A.md`)
  })
})
