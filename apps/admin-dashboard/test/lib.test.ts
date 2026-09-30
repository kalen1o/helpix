import { describe, expect, it } from 'vitest'
import { formatDate } from '../src/lib/format'
import { parseOriginsInput } from '../src/lib/origins'
import { slugify } from '../src/lib/slugify'

describe('slugify', () => {
  it.each([
    ['Teen Fashion!', 'teen-fashion'],
    ['  --iPhone  Store-- ', 'iphone-store'],
    ['Cửa hàng Táo Đỏ', 'cua-hang-tao-do'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps length at 50 without a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(49)} b`)
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('parseOriginsInput', () => {
  it('splits on newlines and commas, trims, and drops blanks', () => {
    expect(parseOriginsInput('https://a.example\n\n  http://localhost:5174 ,https://b.example\n')).toEqual([
      'https://a.example',
      'http://localhost:5174',
      'https://b.example',
    ])
  })

  it('returns an empty list for blank input', () => {
    expect(parseOriginsInput('  \n ')).toEqual([])
  })
})

describe('formatDate', () => {
  it('uses an unambiguous day-month-year with a month name', () => {
    expect(formatDate('2026-09-30T12:00:00.000Z')).toBe('30 Sep 2026')
  })
})
