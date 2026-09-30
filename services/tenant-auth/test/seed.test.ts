import type { Db } from '@helpix/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAdminByEmail } from '../src/repos/admins'
import { seedSuperAdmin } from '../src/seed'
import { resetDb, setupTestDb } from './helpers'

let db: Db
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(() => resetDb(db))

describe('seedSuperAdmin', () => {
  it('creates the super-admin once, normalizing the email', async () => {
    expect(await seedSuperAdmin(db, ' Admin@Helpix.Local ', 'change-me-please')).toBe('created')
    expect(await seedSuperAdmin(db, 'admin@helpix.local', 'change-me-please')).toBe('exists')
    const row = await findAdminByEmail(db, 'admin@helpix.local')
    expect(row?.role).toBe('super_admin')
    expect(row?.tenant_id).toBeNull()
  })

  it('refuses a short password', async () => {
    await expect(seedSuperAdmin(db, 'admin@helpix.local', 'short')).rejects.toThrow(/at least 8/)
  })
})
