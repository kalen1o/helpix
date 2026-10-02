import { computed, ref } from 'vue'
import { productById } from './products'

export interface BagLine {
  key: string
  productId: string
  color: string
  gb: number
  quantity: number
}

const STORAGE_KEY = 'orchard:bag'

function load(): BagLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bag.value))
  } catch {
    // The bag still works for this page view.
  }
}

export const bag = ref<BagLine[]>(load())
export const bagCount = computed(() => bag.value.reduce((n, l) => n + l.quantity, 0))
export const bagTotal = computed(() =>
  bag.value.reduce((sum, l) => {
    const price = productById(l.productId)?.storage.find((s) => s.gb === l.gb)?.priceCents ?? 0
    return sum + price * l.quantity
  }, 0),
)

export function addToBag(productId: string, color: string, gb: number): void {
  const key = `${productId}:${color}:${gb}`
  const line = bag.value.find((l) => l.key === key)
  if (line) line.quantity += 1
  else bag.value.push({ key, productId, color, gb, quantity: 1 })
  save()
}

export function removeFromBag(key: string): void {
  bag.value = bag.value.filter((l) => l.key !== key)
  save()
}

export function clearBag(): void {
  bag.value = []
  save()
}
