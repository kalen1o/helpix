import { describe, expect, it } from 'vitest'
import { TtlCache } from '../src/cache'

describe('TtlCache', () => {
  it('returns values until they expire', () => {
    let now = 1000
    const cache = new TtlCache<string>(100, 10, () => now)
    cache.set('a', 'x')
    expect(cache.get('a')).toBe('x')
    now = 1099
    expect(cache.get('a')).toBe('x')
    now = 1100
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts the oldest entry when full', () => {
    const cache = new TtlCache<number>(10_000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('takes an optional per-entry TTL', () => {
    let now = 0
    const cache = new TtlCache<string>(1000, 10, () => now)
    cache.set('short', 'a', 50)
    cache.set('default', 'b')
    now = 49
    expect(cache.get('short')).toBe('a')
    now = 50
    expect(cache.get('short')).toBeUndefined()
    expect(cache.get('default')).toBe('b')
    now = 1000
    expect(cache.get('default')).toBeUndefined()
  })

  it('never returns an entry stored with a non-positive TTL', () => {
    const cache = new TtlCache<string>(1000, 10, () => 5)
    cache.set('gone', 'x', 0)
    cache.set('negative', 'y', -10)
    expect(cache.get('gone')).toBeUndefined()
    expect(cache.get('negative')).toBeUndefined()
  })
})
