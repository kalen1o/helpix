import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createLocalStorage, storageKey } from '../src/storage'
import { TENANT_A, tempDir } from './helpers'

const DOC = '11111111-1111-4111-8111-111111111111'

describe('local file storage', () => {
  it('round-trips bytes and deletes them', async () => {
    const storage = createLocalStorage(await tempDir())
    const key = storageKey(TENANT_A, DOC)
    await storage.put(key, Buffer.from('hello'))
    expect((await storage.get(key))!.toString()).toBe('hello')
    await storage.delete(key)
    expect(await storage.get(key)).toBeNull()
  })

  it('treats deleting a missing file as success', async () => {
    const storage = createLocalStorage(await tempDir())
    await expect(storage.delete(storageKey(TENANT_A, DOC))).resolves.toBeUndefined()
  })

  it('leaves no temp files behind', async () => {
    const root = await tempDir()
    await createLocalStorage(root).put(storageKey(TENANT_A, DOC), Buffer.from('x'))
    expect(await readdir(`${root}/${TENANT_A}`)).toEqual([DOC])
  })

  it('refuses keys that could escape the root', async () => {
    const storage = createLocalStorage(await tempDir())
    for (const key of ['../x', `${TENANT_A}/../../etc/passwd`, '/etc/passwd', `${TENANT_A}/${DOC}/x`]) {
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key')
    }
  })
})
