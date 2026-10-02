import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.length !== 32) throw new Error('The secrets master key must be exactly 32 bytes')
}

/** AES-256-GCM with a random 12-byte IV: `v1:<iv b64>:<tag b64>:<ciphertext b64>`. */
export function encryptSecret(plain: string, masterKey: Buffer): string {
  assertMasterKey(masterKey)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Throws (with a message that never includes the secret) on a wrong key, tampering or an unknown format. */
export function decryptSecret(enc: string, masterKey: Buffer): string {
  assertMasterKey(masterKey)
  const parts = enc.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unsupported secret format')
  const iv = Buffer.from(parts[1]!, 'base64')
  const tag = Buffer.from(parts[2]!, 'base64')
  const ciphertext = Buffer.from(parts[3]!, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Malformed secret')
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey, iv, { authTagLength: TAG_BYTES })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Could not decrypt secret')
  }
}
