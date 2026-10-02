import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationsView } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import IntegrationsPage from '../src/pages/IntegrationsPage.vue'

vi.mock('@/auth/session', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() },
  session: { state: { me: { tenant: { name: 'Orchard Store' } } } },
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})

const EMPTY: IntegrationsView = { orderApi: null, shopKey: null }
const ORDER_API = { baseUrl: 'https://shop.example/api', hasApiKey: true, updatedAt: '2026-10-01T12:00:00Z' }
const SHOP_KEY = { fingerprint: 'ab:cd:ef:01', updatedAt: '2026-10-01T12:00:00Z' }
const SAVED: IntegrationsView = { orderApi: ORDER_API, shopKey: SHOP_KEY }
const PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----'

function backend(view: IntegrationsView) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/integrations') return view
    throw new Error(`unexpected GET ${path}`)
  })
}

type CardName = 'order-api' | 'shop-key'
const card = (w: VueWrapper, name: CardName) => w.get(`[data-card="${name}"]`)
const button = (w: VueWrapper, name: CardName, label: string) => card(w, name).findAll('button').find((b) => b.text() === label)
const value = (w: VueWrapper, selector: string) => (w.get(selector).element as HTMLInputElement | HTMLTextAreaElement).value

async function mountPage(view: IntegrationsView) {
  backend(view)
  const w = mount(IntegrationsPage, { attachTo: document.body })
  await flushPromises()
  return w
}

beforeEach(() => {
  for (const fn of Object.values(api)) vi.mocked(fn as (...a: unknown[]) => unknown).mockReset()
})

describe('IntegrationsPage: order API', () => {
  it('shows an empty, unconnected state', async () => {
    const w = await mountPage(EMPTY)
    expect(api.get).toHaveBeenCalledWith('/integrations')
    expect(card(w, 'order-api').text()).toContain('Not connected')
    expect(value(w, '#integrations-base-url')).toBe('')
    expect(w.find('#integrations-api-key').exists()).toBe(true)
    expect(card(w, 'order-api').text()).not.toContain('Key saved')
    expect(w.find('#integrations-test-customer').exists()).toBe(false)
    expect(button(w, 'order-api', 'Remove')).toBeUndefined()
    expect(button(w, 'order-api', 'Save')!.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('shows saved settings, and never the API key', async () => {
    const w = await mountPage(SAVED)
    expect(card(w, 'order-api').text()).toContain('Connected')
    expect(value(w, '#integrations-base-url')).toBe('https://shop.example/api')
    expect(w.find('#integrations-api-key').exists()).toBe(false)
    expect(card(w, 'order-api').text()).toContain('Key saved')
    expect(button(w, 'order-api', 'Replace')).toBeDefined()
    expect(w.find('#integrations-test-customer').exists()).toBe(true)
    // Nothing changed yet, so there is nothing to save.
    expect(button(w, 'order-api', 'Save')!.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('saving without a new key keeps the stored one (no apiKey in the body)', async () => {
    vi.mocked(api.put).mockResolvedValue({ ...SAVED, orderApi: { ...ORDER_API, baseUrl: 'https://shop.example/v2' } })
    const w = await mountPage(SAVED)
    await w.get('#integrations-base-url').setValue('https://shop.example/v2')
    await w.get('#order-api-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/integrations/order-api', { baseUrl: 'https://shop.example/v2' })
    expect(vi.mocked(api.put).mock.calls[0]![1]).not.toHaveProperty('apiKey')
    expect(card(w, 'order-api').text()).toContain('Key saved')
    expect(w.text()).toContain('Saved.')
    w.unmount()
  })

  it('asks for the key again when the base URL moves to another host', async () => {
    vi.mocked(api.put).mockResolvedValue({ ...SAVED, orderApi: { ...ORDER_API, baseUrl: 'https://new-shop.example/api' } })
    const w = await mountPage(SAVED)
    const save = () => button(w, 'order-api', 'Save')!
    await w.get('#integrations-base-url').setValue('https://new-shop.example/api')
    expect(w.find('#integrations-api-key').exists()).toBe(true)
    expect(card(w, 'order-api').text()).toContain('Enter the API key again when changing the order API host.')
    expect(save().attributes('disabled')).toBeDefined()
    // Back on the saved host, the stored key is kept again.
    await w.get('#integrations-base-url').setValue('https://shop.example/v2')
    expect(w.find('#integrations-api-key').exists()).toBe(false)
    expect(save().attributes('disabled')).toBeUndefined()
    await w.get('#integrations-base-url').setValue('https://new-shop.example/api')
    await w.get('#integrations-api-key').setValue('sk_live_new_123')
    expect(save().attributes('disabled')).toBeUndefined()
    await w.get('#order-api-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/integrations/order-api', { baseUrl: 'https://new-shop.example/api', apiKey: 'sk_live_new_123' })
    expect(card(w, 'order-api').text()).toContain('Key saved')
    w.unmount()
  })

  it('replaces the key: the field starts empty and the new key is sent once', async () => {
    vi.mocked(api.put).mockResolvedValue(SAVED)
    const w = await mountPage(SAVED)
    await button(w, 'order-api', 'Replace')!.trigger('click')
    expect(value(w, '#integrations-api-key')).toBe('')
    await w.get('#integrations-api-key').setValue('sk_live_new_123')
    await w.get('#order-api-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/integrations/order-api', { baseUrl: 'https://shop.example/api', apiKey: 'sk_live_new_123' })
    expect(w.find('#integrations-api-key').exists()).toBe(false)
    expect(card(w, 'order-api').text()).toContain('Key saved')
    w.unmount()
  })

  it('keeps the current key when a replace is cancelled', async () => {
    const w = await mountPage(SAVED)
    await button(w, 'order-api', 'Replace')!.trigger('click')
    await w.get('#integrations-api-key').setValue('half-typed')
    await button(w, 'order-api', 'Keep current key')!.trigger('click')
    expect(w.find('#integrations-api-key').exists()).toBe(false)
    expect(button(w, 'order-api', 'Save')!.attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('needs a valid URL and a key before the first save', async () => {
    vi.mocked(api.put).mockResolvedValue(SAVED)
    const w = await mountPage(EMPTY)
    const save = () => button(w, 'order-api', 'Save')!
    await w.get('#integrations-base-url').setValue('ftp://shop.example')
    expect(card(w, 'order-api').text()).toContain('Use an https:// (or http://) URL.')
    expect(save().attributes('disabled')).toBeDefined()
    await w.get('#integrations-base-url').setValue('https://shop.example/api')
    expect(card(w, 'order-api').text()).toContain('Enter the API key your shop gave Helpix.')
    await w.get('#integrations-api-key').setValue('short')
    expect(card(w, 'order-api').text()).toContain('The API key must be at least 8 characters.')
    await w.get('#integrations-api-key').setValue('sk_test_12345678')
    expect(save().attributes('disabled')).toBeUndefined()
    await w.get('#order-api-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/integrations/order-api', { baseUrl: 'https://shop.example/api', apiKey: 'sk_test_12345678' })
    w.unmount()
  })

  it('shows why the server refused the URL', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, 'invalid_base_url', 'The order API must be a public https URL'))
    const w = await mountPage(EMPTY)
    await w.get('#integrations-base-url').setValue('http://localhost:4001')
    await w.get('#integrations-api-key').setValue('sk_test_12345678')
    await w.get('#order-api-form').trigger('submit')
    await flushPromises()
    expect(card(w, 'order-api').get('[role="alert"]').text()).toBe('The order API must be a public https URL')
    w.unmount()
  })

  it('tests the connection and reports success', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 'ok', message: 'Found 2 orders for cust_maya.' })
    const w = await mountPage(SAVED)
    expect(button(w, 'order-api', 'Test connection')!.attributes('disabled')).toBeDefined()
    await w.get('#integrations-test-customer').setValue(' cust_maya ')
    await w.get('#order-test-form').trigger('submit')
    await flushPromises()
    expect(api.post).toHaveBeenCalledWith('/integrations/order-api/test', { customerId: 'cust_maya' })
    const result = w.get('[data-test-result]')
    expect(result.text()).toContain('Connection works')
    expect(result.text()).toContain('Found 2 orders for cust_maya.')
    expect(result.get('[data-headline]').classes()).toContain('text-primary')
    w.unmount()
  })

  it.each([
    ['misconfigured', 'The shop rejected the API key (401)', 'The shop refused the request'],
    ['unavailable', 'Timed out after 5 s', "Couldn't reach the order API"],
    ['unavailable', "The response didn't match the order format", "Couldn't reach the order API"],
  ] as const)('reports a failed test (%s) in plain words', async (status, message, headline) => {
    vi.mocked(api.post).mockResolvedValue({ ok: false, status, message })
    const w = await mountPage(SAVED)
    await w.get('#integrations-test-customer').setValue('cust_maya')
    await w.get('#order-test-form').trigger('submit')
    await flushPromises()
    const result = w.get('[data-test-result]')
    expect(result.text()).toContain(headline)
    expect(result.text()).toContain(message)
    expect(result.get('[data-headline]').classes()).toContain('text-destructive')
    w.unmount()
  })

  it('removes the order API after confirmation', async () => {
    vi.mocked(api.del).mockResolvedValue(undefined)
    const w = await mountPage(SAVED)
    await button(w, 'order-api', 'Remove')!.trigger('click')
    await flushPromises()
    await w.findAll('dialog button').find((b) => b.text() === 'Remove order API')!.trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/integrations/order-api')
    expect(card(w, 'order-api').text()).toContain('Not connected')
    expect(value(w, '#integrations-base-url')).toBe('')
    expect(w.find('#integrations-api-key').exists()).toBe(true)
    expect(w.find('#integrations-test-customer').exists()).toBe(false)
    w.unmount()
  })
})

describe('IntegrationsPage: shop sign-in key', () => {
  it('shows the fingerprint and date of a saved key', async () => {
    const w = await mountPage(SAVED)
    expect(card(w, 'shop-key').text()).toContain('ab:cd:ef:01')
    expect(card(w, 'shop-key').text()).toContain('Added 1 Oct 2026')
    expect(w.find('#integrations-pem').exists()).toBe(false)
    expect(card(w, 'shop-key').text()).toContain('aud')
    w.unmount()
  })

  it('saves a pasted key and shows its fingerprint', async () => {
    vi.mocked(api.put).mockResolvedValue({ ...EMPTY, shopKey: SHOP_KEY })
    const w = await mountPage(EMPTY)
    expect(button(w, 'shop-key', 'Save key')!.attributes('disabled')).toBeDefined()
    await w.get('#integrations-pem').setValue(`  ${PEM}\n`)
    await w.get('#shop-key-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/integrations/shop-key', { publicKeyPem: PEM })
    expect(card(w, 'shop-key').text()).toContain('ab:cd:ef:01')
    expect(w.find('#integrations-pem').exists()).toBe(false)
    w.unmount()
  })

  it('refuses a private key before sending it', async () => {
    const w = await mountPage(EMPTY)
    await w.get('#integrations-pem').setValue('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
    expect(card(w, 'shop-key').text()).toContain('This is a private key.')
    expect(button(w, 'shop-key', 'Save key')!.attributes('disabled')).toBeDefined()
    await w.get('#shop-key-form').trigger('submit')
    await flushPromises()
    expect(api.put).not.toHaveBeenCalled()
    w.unmount()
  })

  it('reads an uploaded .pem file into the key field', async () => {
    const w = await mountPage(EMPTY)
    const input = w.get('#integrations-pem-file')
    Object.defineProperty(input.element, 'files', { value: [new File([PEM], 'shop-key.pub.pem', { type: 'application/x-pem-file' })] })
    await input.trigger('change')
    await flushPromises()
    expect(value(w, '#integrations-pem')).toBe(PEM)
    w.unmount()
  })

  it('shows the server error for a key it rejects', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, 'invalid_public_key', 'Use an RSA public key of at least 2048 bits'))
    const w = await mountPage(EMPTY)
    await w.get('#integrations-pem').setValue(PEM)
    await w.get('#shop-key-form').trigger('submit')
    await flushPromises()
    expect(card(w, 'shop-key').get('[role="alert"]').text()).toBe('Use an RSA public key of at least 2048 bits')
    w.unmount()
  })

  it('replaces a saved key', async () => {
    vi.mocked(api.put).mockResolvedValue({ ...SAVED, shopKey: { fingerprint: '99:88', updatedAt: '2026-10-02T12:00:00Z' } })
    const w = await mountPage(SAVED)
    await button(w, 'shop-key', 'Replace')!.trigger('click')
    expect(value(w, '#integrations-pem')).toBe('')
    await w.get('#integrations-pem').setValue(PEM)
    await w.get('#shop-key-form').trigger('submit')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/integrations/shop-key', { publicKeyPem: PEM })
    expect(card(w, 'shop-key').text()).toContain('99:88')
    w.unmount()
  })

  it('removes the key after confirmation', async () => {
    vi.mocked(api.del).mockResolvedValue(undefined)
    const w = await mountPage(SAVED)
    await button(w, 'shop-key', 'Remove')!.trigger('click')
    await flushPromises()
    await w.findAll('dialog button').find((b) => b.text() === 'Remove key')!.trigger('click')
    await flushPromises()
    expect(api.del).toHaveBeenCalledWith('/integrations/shop-key')
    expect(w.find('#integrations-pem').exists()).toBe(true)
    expect(card(w, 'shop-key').text()).not.toContain('ab:cd:ef:01')
    w.unmount()
  })

  it('shows a removal failure inside the dialog', async () => {
    vi.mocked(api.del).mockRejectedValue(new ApiError(503, 'upstream_unavailable', 'A backend service is unavailable'))
    const w = await mountPage(SAVED)
    await button(w, 'shop-key', 'Remove')!.trigger('click')
    await flushPromises()
    await w.findAll('dialog button').find((b) => b.text() === 'Remove key')!.trigger('click')
    await flushPromises()
    expect(w.get('dialog [role="alert"]').text()).toBe('A backend service is unavailable')
    expect(card(w, 'shop-key').text()).toContain('ab:cd:ef:01')
    w.unmount()
  })
})

it('shows a load failure', async () => {
  vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'forbidden', 'Tenant admins only'))
  const w = mount(IntegrationsPage)
  await flushPromises()
  expect(w.get('[role="alert"]').text()).toBe('Tenant admins only')
})
