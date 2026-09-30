import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPool, migrate } from '../src/index'
import { TEST_DATABASE_URL } from '../src/testing'

const db = createPool(TEST_DATABASE_URL)
afterAll(() => db.end())
beforeEach(() => db.query('DROP SCHEMA IF EXISTS migrate_test CASCADE'))

async function dirWith(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'))
  for (const [name, sql] of Object.entries(files)) await writeFile(path.join(dir, name), sql)
  return dir
}

describe('migrate', () => {
  it('applies pending files in name order, once', async () => {
    const dir = await dirWith({
      '002_seed.sql': 'INSERT INTO migrate_test.items (name) VALUES (\'a\');',
      '001_init.sql': 'CREATE TABLE migrate_test.items (name text);',
    })
    expect(await migrate(db, { schema: 'migrate_test', dir })).toEqual(['001_init.sql', '002_seed.sql'])
    expect(await migrate(db, { schema: 'migrate_test', dir })).toEqual([])
    const { rows } = await db.query('SELECT count(*)::int AS n FROM migrate_test.items')
    expect(rows[0].n).toBe(1)
  })

  it('rolls back a failing file and does not record it', async () => {
    const dir = await dirWith({ '001_bad.sql': 'CREATE TABLE migrate_test.x (a int); SELECT nope FROM nowhere;' })
    await expect(migrate(db, { schema: 'migrate_test', dir })).rejects.toThrow(/001_bad\.sql/)
    const { rows } = await db.query("SELECT to_regclass('migrate_test.x') AS t")
    expect(rows[0].t).toBeNull()
  })

  it('rejects unsafe schema names', async () => {
    await expect(migrate(db, { schema: 'x; DROP TABLE y', dir: '/tmp' })).rejects.toThrow(/Invalid schema/)
  })
})
