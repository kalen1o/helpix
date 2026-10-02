import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth } from '../src/auth'
import { addToBag, bag, clearBag } from '../src/cart'
import BagPage from '../src/pages/BagPage.vue'

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push }),
}))

const reply = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const mountBag = () => mount(BagPage, { global: { stubs: { RouterLink: RouterLinkStub } } })
const placeButton = (w: ReturnType<typeof mountBag>) => w.findAll('button').find((b) => b.text() === 'Place demo order (no payment)')

beforeEach(() => {
  localStorage.clear()
  clearBag()
  push.mockReset()
  auth.customer = null
  addToBag('orchard-one-pro', 'Glacier', 256)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BagPage checkout', () => {
  it('signed out, links to sign in instead of checking out', () => {
    const w = mountBag()
    expect(placeButton(w)).toBeUndefined()
    const link = w.findAllComponents(RouterLinkStub).find((l) => l.text() === 'Sign in to check out')
    expect(link?.props('to')).toEqual({ path: '/signin', query: { next: '/bag' } })
  })

  it('signed in, places a demo order, clears the bag and opens the confirmation', async () => {
    auth.customer = { id: 'cust_maya', name: 'Maya Chen', email: 'maya@orchard.demo' }
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply(201, { orderId: '1009' }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mountBag()
    await placeButton(w)!.trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/checkout')
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST')
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      items: [{ productId: 'orchard-one-pro', color: 'Glacier', gb: 256, quantity: 1 }],
    })
    expect(bag.value).toEqual([])
    expect(push).toHaveBeenCalledWith('/order/1009')
  })

  it('ignores a second click while the order is being placed', async () => {
    auth.customer = { id: 'cust_maya', name: 'Maya Chen', email: 'maya@orchard.demo' }
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply(201, { orderId: '1009' }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mountBag()
    const button = placeButton(w)!
    void button.trigger('click')
    void button.trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the bag and shows the error when checkout fails', async () => {
    auth.customer = { id: 'cust_maya', name: 'Maya Chen', email: 'maya@orchard.demo' }
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: { code: 'invalid_items', message: 'Unknown product.' } })))
    const w = mountBag()
    await placeButton(w)!.trigger('click')
    await flushPromises()
    expect(bag.value).toHaveLength(1)
    expect(push).not.toHaveBeenCalled()
    expect(w.find('[role="alert"]').text()).toBe('Unknown product.')
  })
})
