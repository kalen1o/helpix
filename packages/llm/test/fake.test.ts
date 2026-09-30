import { describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../src/fake'

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0)
const fake = createFakeEmbeddings({ model: 'hash', dimensions: 1024 })

describe('fake embeddings', () => {
  it('names its vector space', () => {
    expect(fake.modelId).toBe('fake:hash:1024')
  })

  it('is deterministic and unit length', async () => {
    const [a, b] = await fake.embed(['Refunds within 30 days', 'Refunds within 30 days'])
    expect(a).toEqual(b)
    expect(a).toHaveLength(1024)
    expect(Math.abs(cosine(a!, a!) - 1)).toBeLessThan(1e-9)
  })

  it('scores texts that share words above unrelated texts', async () => {
    const [q, related, unrelated] = await fake.embed([
      'refund window',
      'Our refund window is 30 days from delivery.',
      'We ship phones in recyclable boxes.',
    ])
    expect(cosine(q!, related!)).toBeGreaterThan(cosine(q!, unrelated!))
    expect(cosine(q!, related!)).toBeGreaterThan(0.2)
  })

  it('never returns a zero vector, even for empty text', async () => {
    const [v] = await fake.embed([''])
    expect(v!.some((x) => x !== 0)).toBe(true)
  })

  it('tokenises CJK per character', async () => {
    const [q, doc] = await fake.embed(['退货', '我们的退货政策是三十天'])
    expect(cosine(q!, doc!)).toBeGreaterThan(0)
  })
})
