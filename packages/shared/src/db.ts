import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

export type Db = pg.Pool

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString })
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string }
  return e?.code === '23505' && e.constraint === constraint
}

const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/

/** Applies `dir/*.sql` files not yet recorded in `<schema>.schema_migrations`, in name order, each in its own transaction. */
export async function migrate(db: Db, opts: { schema: string; dir: string }): Promise<string[]> {
  const { schema, dir } = opts
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name: ${schema}`)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const client = await db.connect()
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [schema])
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    )
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM ${schema}.schema_migrations`)
    const done = new Set(rows.map((r) => r.name))
    const applied: string[] = []
    for (const file of files) {
      if (done.has(file)) continue
      const sql = await readFile(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO ${schema}.schema_migrations (name) VALUES ($1)`, [file])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`)
      }
      applied.push(file)
    }
    return applied
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [schema]).catch(() => {})
    client.release()
  }
}
