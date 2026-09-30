import { describe, expect, it } from 'vitest'
import { AppError } from '@helpix/shared'
import { normalizeOrigin, normalizeOrigins, tryNormalizeOrigin } from '../src/lib/origins'

describe('normalizeOrigin', () => {
  it.each([
    ['https://Shop.Example/', 'https://shop.example'],
    ['  http://localhost:5174  ', 'http://localhost:5174'],
    ['https://shop.example:443', 'https://shop.example'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected)
  })

  it('returns null for blank input', () => {
    expect(normalizeOrigin('   ')).toBeNull()
  })

  it.each(['https://shop.example/about', 'https://shop.example?x=1', 'ftp://shop.example', 'shop.example', 'https://user:pw@shop.example'])(
    'rejects %s with invalid_origin',
    (input) => {
      try {
        normalizeOrigin(input)
        expect.fail('should throw')
      } catch (e) {
        expect((e as AppError).code).toBe('invalid_origin')
        expect((e as AppError).status).toBe(400)
      }
    },
  )
})

describe('normalizeOrigins / tryNormalizeOrigin', () => {
  it('drops blanks and duplicates, keeping first-seen order', () => {
    expect(normalizeOrigins(['https://Shop.Example/', '', ' http://localhost:5174 ', 'https://shop.example'])).toEqual([
      'https://shop.example',
      'http://localhost:5174',
    ])
  })

  it('tryNormalizeOrigin never throws', () => {
    expect(tryNormalizeOrigin('https://Shop.Example')).toBe('https://shop.example')
    expect(tryNormalizeOrigin('garbage')).toBeNull()
    expect(tryNormalizeOrigin(undefined)).toBeNull()
  })
})
