import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ShopError } from './errors'

export interface DemoSecrets {
  privateKeyPem: string
  orderApiKey: string
  sessionSecret: string
  widgetKey: string
}

const FILES: Record<keyof DemoSecrets, string> = {
  privateKeyPem: 'shop-key.pem',
  orderApiKey: 'order-api-key',
  sessionSecret: 'session-secret',
  widgetKey: 'widget-key',
}

/**
 * Reads the secrets `make seed-demos` writes into `.data/`. Read on every use (they are tiny), so seeding while the
 * server runs, or re-seeding after `make reset-db`, takes effect without a restart. A missing file means the shop has
 * not been seeded: 503 before anything else in the request happens.
 */
export async function loadSecrets(dataDir: string): Promise<DemoSecrets> {
  const out = {} as DemoSecrets
  for (const key of Object.keys(FILES) as (keyof DemoSecrets)[]) {
    let value = ''
    try {
      value = (await readFile(join(dataDir, FILES[key]), 'utf8')).trim()
    } catch {
      value = ''
    }
    if (!value) throw new ShopError(503, 'not_seeded', 'Run make seed-demos first')
    out[key] = value
  }
  return out
}
