import { createHash, createPublicKey } from 'node:crypto'
import { importSPKI } from 'jose'
import { AppError } from '@helpix/shared'

export const SHOP_KEY_PEM_MAX = 10240
const MIN_MODULUS_BITS = 2048
/** Exactly one SPKI block: rejects private keys, PKCS#1 ("RSA PUBLIC KEY") and pasted extras. */
const SPKI_PEM = /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/

const invalid = (message: string) => new AppError(400, 'invalid_public_key', message)

/** Validates a shop's RS256 public key; returns it re-exported as SPKI PEM with its SHA-256 fingerprint (`aa:bb:…`). */
export async function parseShopPublicKey(pem: string): Promise<{ pem: string; fingerprint: string }> {
  const text = pem.trim()
  if (!text || text.length > SHOP_KEY_PEM_MAX) throw invalid(`The public key must be a PEM of at most ${SHOP_KEY_PEM_MAX} characters`)
  if (!SPKI_PEM.test(text)) throw invalid('Paste an RSA public key in PEM format, starting with -----BEGIN PUBLIC KEY-----')
  try {
    await importSPKI(text, 'RS256')
  } catch {
    throw invalid('This is not a usable RSA public key')
  }
  const key = createPublicKey(text)
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_MODULUS_BITS) {
    throw invalid(`The key must be an RSA key of at least ${MIN_MODULUS_BITS} bits`)
  }
  const der = key.export({ type: 'spki', format: 'der' })
  const fingerprint = createHash('sha256').update(der).digest('hex').match(/../g)!.join(':')
  return { pem: String(key.export({ type: 'spki', format: 'pem' })), fingerprint }
}
