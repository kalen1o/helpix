import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearOrderApi,
  clearShopKey,
  getIntegrations,
  setOrderApi,
  setShopKey,
  toIntegrationsView,
} from '../src/repos/integrations'
import { resetDb, seedTenant, setupTestDb } from './helpers'

let db: Db

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => { await resetDb(db) })

const PEM = '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'
const FP = 'aa:bb'

describe('integrations repo', () => {
  it('has nothing for a new tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect(await getIntegrations(db, t.id)).toBeNull()
    expect(toIntegrationsView(null)).toEqual({ orderApi: null, shopKey: null })
  })

  it('stores the shop key and the order API independently', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const withKey = await setShopKey(db, t.id, PEM, FP)
    expect(withKey).toMatchObject({ shop_key_pem: PEM, shop_key_fingerprint: FP, order_api_base_url: null, order_api_key_enc: null })
    expect(withKey.shop_key_updated_at).toBeInstanceOf(Date)

    const both = await setOrderApi(db, t.id, 'https://shop.example/api', 'v1:a:b:c')
    expect(both).toMatchObject({ shop_key_pem: PEM, order_api_base_url: 'https://shop.example/api', order_api_key_enc: 'v1:a:b:c' })

    const view = toIntegrationsView(await getIntegrations(db, t.id))
    expect(view).toEqual({
      orderApi: { baseUrl: 'https://shop.example/api', hasApiKey: true, updatedAt: expect.any(String) },
      shopKey: { fingerprint: FP, updatedAt: expect.any(String) },
    })
    expect(new Date(view.orderApi!.updatedAt).toISOString()).toBe(view.orderApi!.updatedAt)
  })

  it('keeps the stored key when keyEnc is null, and saves nothing when there is no key yet', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect(await setOrderApi(db, t.id, 'https://shop.example', null)).toBeNull()
    expect(await getIntegrations(db, t.id)).toBeNull()

    await setOrderApi(db, t.id, 'https://shop.example', 'v1:old:key:x')
    const updated = await setOrderApi(db, t.id, 'https://new.example', null)
    expect(updated).toMatchObject({ order_api_base_url: 'https://new.example', order_api_key_enc: 'v1:old:key:x' })

    const replaced = await setOrderApi(db, t.id, 'https://new.example', 'v1:new:key:y')
    expect(replaced?.order_api_key_enc).toBe('v1:new:key:y')
  })

  it('clears each part without touching the other', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    await setShopKey(db, t.id, PEM, FP)
    await setOrderApi(db, t.id, 'https://shop.example', 'v1:a:b:c')
    await clearOrderApi(db, t.id)
    expect(toIntegrationsView(await getIntegrations(db, t.id))).toEqual({ orderApi: null, shopKey: { fingerprint: FP, updatedAt: expect.any(String) } })
    await setOrderApi(db, t.id, 'https://shop.example', 'v1:a:b:c')
    await clearShopKey(db, t.id)
    expect(toIntegrationsView(await getIntegrations(db, t.id))).toEqual({
      orderApi: { baseUrl: 'https://shop.example', hasApiKey: true, updatedAt: expect.any(String) },
      shopKey: null,
    })
  })

  it("never reads or changes another tenant's row", async () => {
    const a = await seedTenant(db, { slug: 'shop-a' })
    const b = await seedTenant(db, { slug: 'shop-b' })
    await setShopKey(db, a.id, PEM, FP)
    await setOrderApi(db, a.id, 'https://a.example', 'v1:a:a:a')
    expect(await getIntegrations(db, b.id)).toBeNull()
    expect(await setOrderApi(db, b.id, 'https://b.example', null)).toBeNull()
    await clearOrderApi(db, b.id)
    await clearShopKey(db, b.id)
    expect(await getIntegrations(db, a.id)).toMatchObject({ order_api_base_url: 'https://a.example', shop_key_fingerprint: FP })
  })

  it('is deleted with its tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    await setShopKey(db, t.id, PEM, FP)
    await db.query('DELETE FROM tenant_auth.tenants WHERE id = $1', [t.id])
    expect(await getIntegrations(db, t.id)).toBeNull()
  })
})
