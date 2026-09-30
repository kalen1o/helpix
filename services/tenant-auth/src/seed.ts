import type { Db } from '@helpix/shared'
import { normalizeEmail } from './lib/email'
import { hashPassword, MIN_PASSWORD_LENGTH } from './lib/passwords'
import { createAdmin, findAdminByEmail } from './repos/admins'

export async function seedSuperAdmin(db: Db, email: string, password: string): Promise<'created' | 'exists'> {
  const normalized = normalizeEmail(email)
  if (await findAdminByEmail(db, normalized)) return 'exists'
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  await createAdmin(db, { email: normalized, passwordHash: await hashPassword(password), role: 'super_admin', tenantId: null })
  return 'created'
}
