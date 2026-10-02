import { beforeEach, describe, expect, it } from 'vitest'
import { addToBag, bag, bagCount, bagTotal, clearBag, removeFromBag } from '../src/cart'
import { PRODUCTS } from '../src/products'

beforeEach(() => {
  localStorage.clear()
  clearBag()
})

describe('bag', () => {
  it('adds, merges identical lines and totals in cents', () => {
    const p = PRODUCTS[0]!
    addToBag(p.id, p.colors[0]!.name, p.storage[0]!.gb)
    addToBag(p.id, p.colors[0]!.name, p.storage[0]!.gb)
    expect(bag.value).toHaveLength(1)
    expect(bagCount.value).toBe(2)
    expect(bagTotal.value).toBe(2 * p.storage[0]!.priceCents)
  })

  it('removes a line and persists to localStorage', () => {
    const p = PRODUCTS[1]!
    addToBag(p.id, p.colors[0]!.name, p.storage[0]!.gb)
    expect(JSON.parse(localStorage.getItem('orchard:bag')!)).toHaveLength(1)
    removeFromBag(bag.value[0]!.key)
    expect(bag.value).toEqual([])
  })
})
