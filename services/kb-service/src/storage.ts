import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Where original KB files live. The local implementation can be swapped for S3 without touching callers. */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>
  /** Returns null when nothing is stored under `key`. */
  get(key: string): Promise<Buffer | null>
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY_RE = new RegExp(`^${UUID}/${UUID}$`)

export function storageKey(tenantId: string, documentId: string): string {
  return `${tenantId}/${documentId}`
}

export function createLocalStorage(root: string): FileStorage {
  const resolve = (key: string): string => {
    if (!KEY_RE.test(key)) throw new Error(`Invalid storage key: ${key}`)
    return path.join(root, key)
  }
  return {
    async put(key, data) {
      const file = resolve(key)
      await mkdir(path.dirname(file), { recursive: true })
      // Write then rename, so a crash never leaves a half-written file under the real key.
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, data)
      await rename(tmp, file)
    },
    async get(key) {
      try {
        return await readFile(resolve(key))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true })
    },
  }
}
