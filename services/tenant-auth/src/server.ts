import { fileURLToPath } from 'node:url'
import { createPool, migrate } from '@helpix/shared'
import { buildApp } from './app'
import { loadConfig } from './config'
import { createShopClient } from './lib/shopClient'
import { seedSuperAdmin } from './seed'

const config = loadConfig()
const db = createPool(config.databaseUrl)
const applied = await migrate(db, { schema: 'tenant_auth', dir: fileURLToPath(new URL('../migrations', import.meta.url)) })
if (applied.length) console.log(`tenant-auth: applied migrations ${applied.join(', ')}`)

const { SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD } = process.env
if (SEED_SUPERADMIN_EMAIL && SEED_SUPERADMIN_PASSWORD) {
  const result = await seedSuperAdmin(db, SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD)
  console.log(`tenant-auth: super-admin ${result}`)
}

if (config.orderApiAllowPrivateHosts) {
  console.warn('tenant-auth: ORDER_API_ALLOW_PRIVATE_HOSTS=true, so order APIs may use http:// and private addresses (development only)')
}
const shop = createShopClient({ allowPrivateHosts: config.orderApiAllowPrivateHosts })
const app = await buildApp({ db, config, shop, logger: true })
await app.listen({ port: config.port, host: '0.0.0.0' })
