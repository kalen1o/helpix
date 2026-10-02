import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SALT_BYTES = 16
const KEY_BYTES = 64

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, KEY_BYTES, (err, key) => (err ? reject(err) : resolve(key))))
}

/** `scrypt$<salt hex>$<hash hex>`. Demo-grade on purpose (spec 4b §5.1); real shops would use their own auth. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  return `scrypt$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== KEY_BYTES) return false
  return timingSafeEqual(await derive(password, Buffer.from(saltHex, 'hex')), expected)
}
