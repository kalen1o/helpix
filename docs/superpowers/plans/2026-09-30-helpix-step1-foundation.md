# Helpix Step 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Helpix monorepo with Postgres, the shared packages, the tenant-auth service, the gateway and an admin dashboard where a super-admin can log in, create tenants, manage widget keys and allowed origins, create tenant admins, and suspend or reactivate tenants.

**Architecture:** npm-workspaces monorepo. Two Node services (Fastify 5, TypeScript run by `tsx`): `gateway` is the only public entry point and turns an admin bearer token into trusted identity headers; `tenant-auth` owns tenants, admins and tokens in its own Postgres schema and accepts requests only when they carry the internal token the gateway adds. The Vue 3 dashboard talks only to the gateway and uses small Tailwind components from a shared `packages/ui`.

**Tech Stack:** Node 22, TypeScript, Fastify 5, `pg`, `jose` (JWT), `bcryptjs`, `undici`, Vitest, Postgres 16 with pgvector (`pgvector/pgvector:pg16`), Docker Compose, Vue 3, vue-router, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), `clsx` + `tailwind-merge`, `@vue/test-utils`, jsdom. No component library.

**Spec:** `docs/superpowers/specs/2026-09-30-helpix-design.md` (build order step 1). Read sections 2, 2.3, 2.4, 2.5, 5 (super-admin part), 8 and 9 before starting.

## Global Constraints

- All services return errors as `{ error: { code, message, requestId } }` (spec §9). The shape is defined once in `packages/shared`.
- The gateway assigns the `requestId` and it is logged and returned end to end (`x-request-id`).
- The tenant comes only from the gateway-supplied header, never from a request body or query (spec §2.4).
- Downstream services accept identity headers only from the gateway: every tenant-auth route requires the `x-internal-token` header, and the gateway strips any client-supplied identity headers (spec §2.3).
- Downstream services never see raw credentials: the gateway strips `authorization` before forwarding.
- One Postgres schema per service; no service reads another service's tables (spec §2.2). This plan creates schema `tenant_auth`.
- Password hashes and tokens are never returned by an API after issue and never logged.
- A suspended tenant's admins cannot log in or refresh, and its data is kept (spec §2.5).
- Frontend: Vue 3 + Tailwind CSS; shared components live in `packages/ui` and are imported from `@helpix/ui` (spec §8). No component library.
- Out of scope for this plan: rate limiting (step 5), widget routes through the gateway (step 4), agent config, order-API config, shop JWT public keys, secret encryption (steps 3–4).
- Postgres is exposed on host port **5433** (not 5432) to avoid clashing with a local Postgres.
- Branding follows `brand/brand-sheet.html` (v1): Mint is the only accent colour, everything else is a tinted neutral. Mint 600 `#0C9A82` is for the logo, icons and the launcher only (3.5:1 on white fails AA for small text); anything with small white or mint text uses Mint 700 `#08705F`. Fonts: Bricolage Grotesque (display and wordmark, always lowercase `helpix`), Instrument Sans (interface), IBM Plex Mono (code). Use the logo exactly as supplied: no rotation, stretching, recolouring outside the palette, moved pixel, shadows, outlines or gradients.

## Review Focus

1. **Email case and whitespace.** `"  Owner@Shop.COM "` at login or admin creation must mean the same account as `owner@shop.com`. Test: Task 2 (login) and Task 3 (admin creation).
2. **Duplicates.** Creating a tenant with a taken slug, or an admin with an email already used by any admin (any tenant, any case), must return 409 with `slug_taken` / `email_taken`, not 500. Test: Task 3.
3. **Allowed-origin input.** Trailing slashes, uppercase hosts, blank lines and default ports must normalize to `scheme://host[:port]`; paths, queries and non-http schemes must return 400 `invalid_origin`. Test: Task 3 (server) and Task 9 (dashboard parsing).
4. **Suspension with live credentials.** An admin of a tenant suspended after login must be rejected on refresh and on the next token resolution. Test: Task 2 (refresh) and Task 4 (resolve-admin).
5. **Access token expiring mid-session with several requests in flight.** Exactly one refresh call, all requests retried with the new token; a failed refresh clears the session. Test: Task 8.

---

## File Structure

```
helpix/
  package.json                      workspaces + root scripts
  tsconfig.base.json                shared TS options
  .gitignore  .nvmrc  .env.example  .dockerignore
  docker-compose.yml                postgres, tenant-auth, gateway
  docker/postgres/init.sql          creates helpix_test, enables pgvector
  docker/node-service.Dockerfile    one image for any service
  scripts/smoke-step1.mjs           end-to-end smoke test through the gateway
  packages/shared/
    src/errors.ts                   AppError, errorBody
    src/headers.ts                  header name constants
    src/api-types.ts                API DTO types (no runtime deps; used by dashboard too)
    src/context.ts                  readContext, requireRole, requireAdmin
    src/fastify.ts                  registerErrorHandler, requireInternalToken
    src/db.ts                       createPool, migrate, isUniqueViolation, Db
    src/testing.ts                  TEST_DATABASE_URL
    src/index.ts                    re-exports (server-side entry)
    test/*.test.ts
  packages/ui/
    src/index.ts                    public exports
    src/lib/utils.ts                cn()
    src/styles/globals.css          Tailwind + theme tokens
    src/components/*                Button, Input, Textarea, Label, Badge, Dialog (native <dialog>), HelpixLogo, styled primitives
    test/components.test.ts
  services/tenant-auth/
    migrations/001_init.sql
    src/config.ts  src/deps.ts  src/app.ts  src/server.ts  src/seed.ts
    src/lib/passwords.ts  src/lib/tokens.ts  src/lib/origins.ts  src/lib/email.ts
    src/repos/tenants.ts  src/repos/admins.ts  src/repos/refreshTokens.ts
    src/auth/service.ts
    src/routes/auth.ts  src/routes/tenants.ts  src/routes/me.ts  src/routes/internal.ts
    test/helpers.ts  test/*.test.ts
  services/gateway/
    src/config.ts  src/cache.ts  src/forward.ts  src/tenantAuthClient.ts  src/app.ts  src/server.ts
    test/helpers.ts  test/*.test.ts
  apps/admin-dashboard/
    index.html  vite.config.ts  tsconfig.json
    src/main.ts  src/App.vue  src/styles.css  src/env.d.ts  src/router.ts
    src/api/client.ts  src/auth/session.ts  src/auth/guard.ts
    src/lib/slugify.ts  src/lib/origins.ts
    src/layouts/AppLayout.vue  src/components/ConfirmDialog.vue
    src/pages/LoginPage.vue  src/pages/TenantsPage.vue  src/pages/TenantDetailPage.vue  src/pages/TenantHomePage.vue
    test/*.test.ts
```

---

### Task 1: Monorepo skeleton, Postgres and `packages/shared`

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.env.example`, `.dockerignore`, `docker-compose.yml`, `docker/postgres/init.sql`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/{errors,headers,api-types,context,fastify,db,testing,index}.ts`
- Test: `packages/shared/test/fastify.test.ts`, `packages/shared/test/context.test.ts`, `packages/shared/test/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (import from `@helpix/shared` unless noted):
  - `class AppError extends Error { status: number; code: string }` — `new AppError(status, code, message)`
  - `errorBody(code: string, message: string, requestId: string): ErrorBody`
  - `HEADERS = { tenantId: 'x-tenant-id', customerId: 'x-customer-id', role: 'x-helpix-role', adminId: 'x-admin-id', requestId: 'x-request-id', internalToken: 'x-internal-token' }`
  - `IDENTITY_HEADERS: readonly string[]` (tenantId, customerId, role, adminId, internalToken)
  - `readContext(req: { id: string; headers: IncomingHttpHeaders }): RequestContext`
  - `requireRole(ctx: RequestContext, role: Role): void` (throws 403 `forbidden`)
  - `requireAdmin(ctx: RequestContext): { adminId: string; role: Role }` (throws 401 `unauthorized`)
  - `registerErrorHandler(app: FastifyInstance): void`
  - `requireInternalToken(expected: string): (req: FastifyRequest) => Promise<void>`
  - `type Db = pg.Pool`; `createPool(url: string): Db`; `migrate(db: Db, opts: { schema: string; dir: string }): Promise<string[]>`; `isUniqueViolation(err: unknown, constraint: string): boolean`
  - `@helpix/shared/api-types`: `Role`, `TenantStatus`, `TenantView`, `AdminView`, `SessionResponse`, `MeResponse`, `ResolvedAdmin`, `ResolvedWidget`
  - `@helpix/shared/testing`: `TEST_DATABASE_URL`

- [ ] **Step 1: Initialise the repo and root files**

Run:
```bash
cd /Users/kalen_1o/startup/helpix && git init
```

`package.json`:
```json
{
  "name": "helpix",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "services/*", "apps/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "smoke": "node --env-file=.env scripts/smoke-step1.mjs"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
.DS_Store
```

`.nvmrc`:
```
22
```

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
.env
.git
```

`.env.example`:
```
INTERNAL_TOKEN=change-me-internal-token-at-least-32-chars
ADMIN_JWT_SECRET=change-me-admin-jwt-secret-at-least-32-chars
SEED_SUPERADMIN_EMAIL=admin@helpix.local
SEED_SUPERADMIN_PASSWORD=change-me-please
DATABASE_URL=postgres://helpix:helpix@localhost:5433/helpix
TENANT_AUTH_URL=http://localhost:4001
CORS_ORIGINS=http://localhost:5173
```

Run: `cp .env.example .env`

`docker/postgres/init.sql` (runs once, on first start of an empty volume):
```sql
CREATE DATABASE helpix_test;
\c helpix
CREATE EXTENSION IF NOT EXISTS vector;
\c helpix_test
CREATE EXTENSION IF NOT EXISTS vector;
```

`docker-compose.yml` (services are added in Task 6):
```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: helpix
      POSTGRES_PASSWORD: helpix
      POSTGRES_DB: helpix
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U helpix -d helpix"]
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  pgdata: {}
```

- [ ] **Step 2: Start Postgres and verify pgvector in both databases**

Run:
```bash
npm run db:up
docker compose exec postgres psql -U helpix -d helpix_test -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
```
Expected: one row, `vector`.

- [ ] **Step 3: Create the shared package and install root tooling**

`packages/shared/package.json`:
```json
{
  "name": "@helpix/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./api-types": "./src/api-types.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { fileParallelism: false },
})
```

Run:
```bash
npm install -D typescript vitest tsx @types/node
npm install fastify pg -w packages/shared
npm install -D @types/pg -w packages/shared
```

- [ ] **Step 4: Write the failing tests**

`packages/shared/test/fastify.test.ts`:
```ts
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { AppError, HEADERS, registerErrorHandler, requireInternalToken } from '../src/index'

function buildApp() {
  const app = Fastify({ requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.get('/conflict', async () => {
    throw new AppError(409, 'slug_taken', 'Slug already in use')
  })
  app.get('/boom', async () => {
    throw new Error('database password is hunter2')
  })
  app.post('/validated', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  }, async () => ({ ok: true }))
  return app
}

describe('registerErrorHandler', () => {
  it('maps AppError to its status and the standard error shape', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/conflict', headers: { [HEADERS.requestId]: 'req-1' } })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: 'slug_taken', message: 'Slug already in use', requestId: 'req-1' } })
  })

  it('hides the message of unexpected errors', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('internal_error')
    expect(res.body).not.toContain('hunter2')
  })

  it('maps schema validation failures to 400 validation_error', async () => {
    const res = await buildApp().inject({ method: 'POST', url: '/validated', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('returns the standard shape for unknown routes', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })
})

describe('requireInternalToken', () => {
  function appWithGuard() {
    const app = Fastify()
    registerErrorHandler(app)
    app.addHook('onRequest', requireInternalToken('secret-token'))
    app.get('/x', async () => ({ ok: true }))
    return app
  }

  it('rejects a missing token', async () => {
    const res = await appWithGuard().inject({ method: 'GET', url: '/x' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('rejects a wrong token of the same length', async () => {
    const res = await appWithGuard().inject({ method: 'GET', url: '/x', headers: { [HEADERS.internalToken]: 'secret-tokeX' } })
    expect(res.statusCode).toBe(401)
  })

  it('accepts the right token', async () => {
    const res = await appWithGuard().inject({ method: 'GET', url: '/x', headers: { [HEADERS.internalToken]: 'secret-token' } })
    expect(res.statusCode).toBe(200)
  })
})
```

`packages/shared/test/context.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { AppError, HEADERS, readContext, requireAdmin, requireRole } from '../src/index'

const req = (headers: Record<string, string>) => ({ id: 'req-1', headers })

describe('readContext', () => {
  it('reads identity headers', () => {
    const ctx = readContext(req({ [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: 'a1', [HEADERS.tenantId]: 't1' }))
    expect(ctx).toEqual({ requestId: 'req-1', role: 'tenant_admin', adminId: 'a1', tenantId: 't1', customerId: undefined })
  })

  it('ignores an unknown role value', () => {
    expect(readContext(req({ [HEADERS.role]: 'god' })).role).toBeUndefined()
  })
})

describe('requireRole / requireAdmin', () => {
  it('throws 403 when the role does not match', () => {
    const ctx = readContext(req({ [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: 'a1', [HEADERS.tenantId]: 't1' }))
    expect(() => requireRole(ctx, 'super_admin')).toThrowError(AppError)
    try { requireRole(ctx, 'super_admin') } catch (e) { expect((e as AppError).status).toBe(403) }
  })

  it('throws 403 for a tenant_admin without a tenant id', () => {
    const ctx = readContext(req({ [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: 'a1' }))
    expect(() => requireRole(ctx, 'tenant_admin')).toThrowError(AppError)
  })

  it('requireAdmin throws 401 without admin headers and returns them otherwise', () => {
    try { requireAdmin(readContext(req({}))) } catch (e) { expect((e as AppError).status).toBe(401) }
    expect(requireAdmin(readContext(req({ [HEADERS.role]: 'super_admin', [HEADERS.adminId]: 'a1' })))).toEqual({ adminId: 'a1', role: 'super_admin' })
  })
})
```

`packages/shared/test/db.test.ts`:
```ts
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
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test -w packages/shared`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 6: Implement the shared package**

`packages/shared/src/errors.ts`:
```ts
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export interface ErrorBody {
  error: { code: string; message: string; requestId: string }
}

export function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } }
}
```

`packages/shared/src/headers.ts`:
```ts
export const HEADERS = {
  tenantId: 'x-tenant-id',
  customerId: 'x-customer-id',
  role: 'x-helpix-role',
  adminId: 'x-admin-id',
  requestId: 'x-request-id',
  internalToken: 'x-internal-token',
} as const

/** Headers only the gateway may set. The gateway strips these from client requests. */
export const IDENTITY_HEADERS: readonly string[] = [
  HEADERS.tenantId,
  HEADERS.customerId,
  HEADERS.role,
  HEADERS.adminId,
  HEADERS.internalToken,
]
```

`packages/shared/src/api-types.ts`:
```ts
// Pure types shared by services and the dashboard. No runtime imports allowed here.
export type Role = 'super_admin' | 'tenant_admin'
export type TenantStatus = 'active' | 'suspended'

export interface TenantView {
  id: string
  name: string
  slug: string
  status: TenantStatus
  widgetKey: string
  allowedOrigins: string[]
  createdAt: string
}

export interface AdminView {
  id: string
  tenantId: string | null
  email: string
  role: Role
  createdAt: string
}

export interface SessionResponse {
  accessToken: string
  refreshToken: string
  admin: AdminView
}

export interface MeResponse {
  admin: AdminView
  tenant: TenantView | null
}

export interface ResolvedAdmin {
  adminId: string
  role: Role
  tenantId: string | null
}

export interface ResolvedWidget {
  tenantId: string
}
```

`packages/shared/src/context.ts`:
```ts
import type { IncomingHttpHeaders } from 'node:http'
import type { Role } from './api-types'
import { AppError } from './errors'
import { HEADERS } from './headers'

export interface RequestContext {
  requestId: string
  role?: Role
  adminId?: string
  tenantId?: string
  customerId?: string
}

export function readContext(req: { id: string; headers: IncomingHttpHeaders }): RequestContext {
  const one = (name: string): string | undefined => {
    const v = req.headers[name]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const role = one(HEADERS.role)
  return {
    requestId: req.id,
    role: role === 'super_admin' || role === 'tenant_admin' ? role : undefined,
    adminId: one(HEADERS.adminId),
    tenantId: one(HEADERS.tenantId),
    customerId: one(HEADERS.customerId),
  }
}

export function requireAdmin(ctx: RequestContext): { adminId: string; role: Role } {
  if (!ctx.adminId || !ctx.role) throw new AppError(401, 'unauthorized', 'Admin authentication required')
  return { adminId: ctx.adminId, role: ctx.role }
}

export function requireRole(ctx: RequestContext, role: Role): void {
  if (ctx.role !== role || !ctx.adminId) throw new AppError(403, 'forbidden', `This action requires role ${role}`)
  if (role === 'tenant_admin' && !ctx.tenantId) throw new AppError(403, 'forbidden', 'Missing tenant context')
}
```

`packages/shared/src/fastify.ts`:
```ts
import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError, errorBody } from './errors'
import { HEADERS } from './headers'

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(errorBody(err.code, err.message, req.id))
    }
    if (err.validation) {
      return reply.code(400).send(errorBody('validation_error', err.message, req.id))
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send(errorBody('bad_request', err.message, req.id))
    }
    req.log.error(err)
    return reply.code(500).send(errorBody('internal_error', 'Internal server error', req.id))
  })
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorBody('not_found', 'Route not found', req.id))
  })
}

export function requireInternalToken(expected: string) {
  const expectedBuf = Buffer.from(expected)
  return async (req: FastifyRequest): Promise<void> => {
    const got = req.headers[HEADERS.internalToken]
    const gotBuf = Buffer.from(typeof got === 'string' ? got : '')
    if (gotBuf.length !== expectedBuf.length || !timingSafeEqual(gotBuf, expectedBuf)) {
      throw new AppError(401, 'unauthorized', 'Missing or invalid internal token')
    }
  }
}
```

`packages/shared/src/db.ts`:
```ts
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
```

`packages/shared/src/testing.ts`:
```ts
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://helpix:helpix@localhost:5433/helpix_test'
```

`packages/shared/src/index.ts`:
```ts
export * from './errors'
export * from './headers'
export * from './context'
export * from './fastify'
export * from './db'
export type * from './api-types'
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `npm test -w packages/shared && npm run typecheck -w packages/shared`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: monorepo skeleton, postgres with pgvector, shared package"
```

---

### Task 2: tenant-auth — schema, tokens, login/refresh/logout, super-admin seed

**Files:**
- Create: `services/tenant-auth/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `services/tenant-auth/migrations/001_init.sql`
- Create: `services/tenant-auth/src/{config,deps,app,server,seed}.ts`
- Create: `services/tenant-auth/src/lib/{passwords,tokens,email}.ts`
- Create: `services/tenant-auth/src/repos/{tenants,admins,refreshTokens}.ts`
- Create: `services/tenant-auth/src/auth/service.ts`, `services/tenant-auth/src/routes/auth.ts`
- Test: `services/tenant-auth/test/{helpers,tokens.test,auth.test,seed.test}.ts`

**Interfaces:**
- Consumes: everything listed under Task 1 "Produces".
- Produces:
  - `buildApp(opts: { db: Db; config: Config; logger?: boolean }): Promise<FastifyInstance>` (`src/app.ts`)
  - `interface Config { port: number; databaseUrl: string; internalToken: string; adminJwtSecret: string; accessTtl: string; refreshTtlDays: number }`, `loadConfig(env?): Config`
  - `interface RouteDeps { db: Db; config: Config; tokens: TokenService }` (`src/deps.ts`)
  - `createTokenService(secret: string, accessTtl: string): TokenService` with `signAccess(c: ResolvedAdmin): Promise<string>` and `verifyAccess(token: string): Promise<ResolvedAdmin | null>`; `newRefreshToken(): { token: string; hash: string }`; `hashToken(t: string): string`; `newWidgetKey(): string` (prefix `wk_`)
  - `normalizeEmail(e: string): string`, `assertValidEmail(e: string): void` (400 `invalid_email`)
  - Repos: `createTenant`, `listTenants`, `getTenant`, `updateTenant`, `setTenantStatus`, `rotateWidgetKey`, `findTenantByWidgetKey` (all return `TenantView` or `TenantView | null`); `findAdminByEmail`, `findAdminById` (return `AdminRow | null`), `createAdmin(db, { email, passwordHash, role, tenantId }): Promise<AdminRow>`, `listTenantAdmins(db, tenantId): Promise<AdminRow[]>`, `toAdminView(row): AdminView`
  - `assertAdminActive(db, admin: AdminRow): Promise<void>` (403 `tenant_suspended`)
  - `seedSuperAdmin(db, email, password): Promise<'created' | 'exists'>`
  - HTTP: `POST /auth/login {email,password}` → `SessionResponse`; `POST /auth/refresh {refreshToken}` → `SessionResponse`; `POST /auth/logout {refreshToken}` → 204
  - Test helpers: `TEST_CONFIG`, `setupTestDb()`, `resetDb(db)`, `buildTestApp(db)`, `internalHeaders()`, `superAdminHeaders(adminId)`, `tenantAdminHeaders(adminId, tenantId)`, `seedTenant(db, input)`, `seedAdmin(db, input)`

- [ ] **Step 1: Create the package and install dependencies**

`services/tenant-auth/package.json`:
```json
{
  "name": "@helpix/tenant-auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`services/tenant-auth/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`services/tenant-auth/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { fileParallelism: false },
})
```

Run:
```bash
npm install @helpix/shared@* fastify pg jose bcryptjs tsx -w services/tenant-auth
npm install -D @types/pg -w services/tenant-auth
```
Expected: `@helpix/shared` is linked from the workspace (check `ls -l node_modules/@helpix`).

- [ ] **Step 2: Write the migration**

`services/tenant-auth/migrations/001_init.sql`:
```sql
CREATE TABLE tenant_auth.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  widget_key text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_auth.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant_auth.tenants(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'tenant_admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'super_admin') = (tenant_id IS NULL))
);
CREATE INDEX admins_tenant_id_idx ON tenant_auth.admins (tenant_id);

CREATE TABLE tenant_auth.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES tenant_auth.admins(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Write the failing token tests**

`services/tenant-auth/test/tokens.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTokenService, hashToken, newRefreshToken, newWidgetKey } from '../src/lib/tokens'

const SECRET = 'test-secret-test-secret-test-secret-1234'
const claims = { adminId: 'a1', role: 'tenant_admin' as const, tenantId: 't1' }

afterEach(() => vi.useRealTimers())

describe('access tokens', () => {
  it('round-trips claims', async () => {
    const svc = createTokenService(SECRET, '15m')
    expect(await svc.verifyAccess(await svc.signAccess(claims))).toEqual(claims)
  })

  it('keeps a null tenant for super-admins', async () => {
    const svc = createTokenService(SECRET, '15m')
    const c = { adminId: 'a0', role: 'super_admin' as const, tenantId: null }
    expect(await svc.verifyAccess(await svc.signAccess(c))).toEqual(c)
  })

  it('rejects a tampered token', async () => {
    const svc = createTokenService(SECRET, '15m')
    const token = await svc.signAccess(claims)
    const [h, , s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'a1', role: 'super_admin', tid: null })).toString('base64url')
    expect(await svc.verifyAccess(`${h}.${forged}.${s}`)).toBeNull()
  })

  it('rejects a token signed with another secret', async () => {
    const other = createTokenService('another-secret-another-secret-12345678', '15m')
    expect(await createTokenService(SECRET, '15m').verifyAccess(await other.signAccess(claims))).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const svc = createTokenService(SECRET, '1m')
    const token = await svc.signAccess(claims)
    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'))
    expect(await svc.verifyAccess(token)).toBeNull()
  })

  it('returns null for garbage', async () => {
    expect(await createTokenService(SECRET, '15m').verifyAccess('not-a-jwt')).toBeNull()
  })
})

describe('random credentials', () => {
  it('refresh tokens are unique and hash deterministically', () => {
    const a = newRefreshToken()
    const b = newRefreshToken()
    expect(a.token).not.toBe(b.token)
    expect(hashToken(a.token)).toBe(a.hash)
    expect(a.hash).not.toContain(a.token)
  })

  it('widget keys have the wk_ prefix and are unique', () => {
    const k = newWidgetKey()
    expect(k).toMatch(/^wk_[A-Za-z0-9_-]{32}$/)
    expect(newWidgetKey()).not.toBe(k)
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test -w services/tenant-auth -- tokens`
Expected: FAIL — cannot resolve `../src/lib/tokens`.

- [ ] **Step 5: Implement the libs**

`services/tenant-auth/src/lib/tokens.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import type { ResolvedAdmin } from '@helpix/shared/api-types'

const ISSUER = 'helpix'
const AUDIENCE = 'helpix-admin'

export function createTokenService(secret: string, accessTtl: string) {
  const key = new TextEncoder().encode(secret)
  return {
    signAccess(c: ResolvedAdmin): Promise<string> {
      return new SignJWT({ role: c.role, tid: c.tenantId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(c.adminId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(accessTtl)
        .sign(key)
    },
    async verifyAccess(token: string): Promise<ResolvedAdmin | null> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] })
        const role = payload.role
        if (typeof payload.sub !== 'string' || (role !== 'super_admin' && role !== 'tenant_admin')) return null
        return { adminId: payload.sub, role, tenantId: typeof payload.tid === 'string' ? payload.tid : null }
      } catch {
        return null
      }
    },
  }
}

export type TokenService = ReturnType<typeof createTokenService>

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function newWidgetKey(): string {
  return `wk_${randomBytes(24).toString('base64url')}`
}
```

`services/tenant-auth/src/lib/passwords.ts`:
```ts
import bcrypt from 'bcryptjs'

export const MIN_PASSWORD_LENGTH = 8

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Compared against when the email is unknown, so both paths cost one bcrypt check. */
export const DUMMY_HASH = bcrypt.hashSync('helpix-dummy-password', 10)
```

`services/tenant-auth/src/lib/email.ts`:
```ts
import { AppError } from '@helpix/shared'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function assertValidEmail(email: string): void {
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AppError(400, 'invalid_email', 'Enter a valid email address')
}
```

Run: `npm test -w services/tenant-auth -- tokens`
Expected: PASS.

- [ ] **Step 6: Implement config, deps and repos**

`services/tenant-auth/src/config.ts`:
```ts
export interface Config {
  port: number
  databaseUrl: string
  internalToken: string
  adminJwtSecret: string
  accessTtl: string
  refreshTtlDays: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (key: string): string => {
    const v = env[key]
    if (!v) throw new Error(`Missing required env var ${key}`)
    return v
  }
  const adminJwtSecret = required('ADMIN_JWT_SECRET')
  if (adminJwtSecret.length < 32) throw new Error('ADMIN_JWT_SECRET must be at least 32 characters')
  return {
    port: Number(env.PORT ?? 4001),
    databaseUrl: required('DATABASE_URL'),
    internalToken: required('INTERNAL_TOKEN'),
    adminJwtSecret,
    accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  }
}
```

`services/tenant-auth/src/deps.ts`:
```ts
import type { Db } from '@helpix/shared'
import type { Config } from './config'
import type { TokenService } from './lib/tokens'

export interface RouteDeps {
  db: Db
  config: Config
  tokens: TokenService
}
```

`services/tenant-auth/src/repos/tenants.ts`:
```ts
import { AppError, isUniqueViolation, type Db } from '@helpix/shared'
import type { TenantStatus, TenantView } from '@helpix/shared/api-types'
import { newWidgetKey } from '../lib/tokens'

interface TenantRow {
  id: string
  name: string
  slug: string
  status: TenantStatus
  widget_key: string
  allowed_origins: string[]
  created_at: Date
}

const COLUMNS = 'id, name, slug, status, widget_key, allowed_origins, created_at'

function toView(r: TenantRow): TenantView {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    widgetKey: r.widget_key,
    allowedOrigins: r.allowed_origins,
    createdAt: r.created_at.toISOString(),
  }
}

function one(rows: TenantRow[]): TenantView | null {
  return rows[0] ? toView(rows[0]) : null
}

export async function createTenant(db: Db, input: { name: string; slug: string }): Promise<TenantView> {
  try {
    const { rows } = await db.query<TenantRow>(
      `INSERT INTO tenant_auth.tenants (name, slug, widget_key) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [input.name, input.slug, newWidgetKey()],
    )
    return toView(rows[0]!)
  } catch (e) {
    if (isUniqueViolation(e, 'tenants_slug_key')) throw new AppError(409, 'slug_taken', `Slug "${input.slug}" is already in use`)
    throw e
  }
}

export async function listTenants(db: Db): Promise<TenantView[]> {
  const { rows } = await db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenant_auth.tenants ORDER BY created_at DESC, id`)
  return rows.map(toView)
}

export async function getTenant(db: Db, id: string): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenant_auth.tenants WHERE id = $1`, [id])
  return one(rows)
}

export async function updateTenant(
  db: Db,
  id: string,
  patch: { name?: string; allowedOrigins?: string[] },
): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenant_auth.tenants
       SET name = COALESCE($2, name), allowed_origins = COALESCE($3, allowed_origins), updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, patch.name ?? null, patch.allowedOrigins ?? null],
  )
  return one(rows)
}

export async function setTenantStatus(db: Db, id: string, status: TenantStatus): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenant_auth.tenants SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status],
  )
  return one(rows)
}

export async function rotateWidgetKey(db: Db, id: string): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(
    `UPDATE tenant_auth.tenants SET widget_key = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, newWidgetKey()],
  )
  return one(rows)
}

export async function findTenantByWidgetKey(db: Db, widgetKey: string): Promise<TenantView | null> {
  const { rows } = await db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenant_auth.tenants WHERE widget_key = $1`, [widgetKey])
  return one(rows)
}
```

`services/tenant-auth/src/repos/admins.ts`:
```ts
import { AppError, isUniqueViolation, type Db } from '@helpix/shared'
import type { AdminView, Role } from '@helpix/shared/api-types'

export interface AdminRow {
  id: string
  tenant_id: string | null
  email: string
  password_hash: string
  role: Role
  created_at: Date
}

const COLUMNS = 'id, tenant_id, email, password_hash, role, created_at'

export function toAdminView(r: AdminRow): AdminView {
  return { id: r.id, tenantId: r.tenant_id, email: r.email, role: r.role, createdAt: r.created_at.toISOString() }
}

/** `email` must already be normalized. */
export async function findAdminByEmail(db: Db, email: string): Promise<AdminRow | null> {
  const { rows } = await db.query<AdminRow>(`SELECT ${COLUMNS} FROM tenant_auth.admins WHERE email = $1`, [email])
  return rows[0] ?? null
}

export async function findAdminById(db: Db, id: string): Promise<AdminRow | null> {
  const { rows } = await db.query<AdminRow>(`SELECT ${COLUMNS} FROM tenant_auth.admins WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function createAdmin(
  db: Db,
  input: { email: string; passwordHash: string; role: Role; tenantId: string | null },
): Promise<AdminRow> {
  try {
    const { rows } = await db.query<AdminRow>(
      `INSERT INTO tenant_auth.admins (email, password_hash, role, tenant_id) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [input.email, input.passwordHash, input.role, input.tenantId],
    )
    return rows[0]!
  } catch (e) {
    if (isUniqueViolation(e, 'admins_email_key')) throw new AppError(409, 'email_taken', 'An admin with this email already exists')
    throw e
  }
}

export async function listTenantAdmins(db: Db, tenantId: string): Promise<AdminRow[]> {
  const { rows } = await db.query<AdminRow>(
    `SELECT ${COLUMNS} FROM tenant_auth.admins WHERE tenant_id = $1 ORDER BY created_at, id`,
    [tenantId],
  )
  return rows
}
```

`services/tenant-auth/src/repos/refreshTokens.ts`:
```ts
import type { Db } from '@helpix/shared'

export async function insertRefreshToken(db: Db, adminId: string, hash: string, expiresAt: Date): Promise<void> {
  await db.query(
    'INSERT INTO tenant_auth.refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [adminId, hash, expiresAt],
  )
}

/** Atomically marks a live token as used. Returns its admin id, or null if it was unknown, used, revoked or expired. */
export async function consumeRefreshToken(db: Db, hash: string): Promise<string | null> {
  const { rows } = await db.query<{ admin_id: string }>(
    `UPDATE tenant_auth.refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     RETURNING admin_id`,
    [hash],
  )
  return rows[0]?.admin_id ?? null
}

export async function revokeRefreshToken(db: Db, hash: string): Promise<void> {
  await db.query('UPDATE tenant_auth.refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hash])
}
```

- [ ] **Step 7: Write the test helpers and failing auth + seed tests**

`services/tenant-auth/test/helpers.ts`:
```ts
import { fileURLToPath } from 'node:url'
import { createPool, HEADERS, migrate, type Db } from '@helpix/shared'
import type { AdminView, Role, TenantStatus, TenantView } from '@helpix/shared/api-types'
import { TEST_DATABASE_URL } from '@helpix/shared/testing'
import { buildApp } from '../src/app'
import type { Config } from '../src/config'
import { hashPassword } from '../src/lib/passwords'
import { createAdmin, toAdminView } from '../src/repos/admins'
import { createTenant, setTenantStatus, updateTenant } from '../src/repos/tenants'

export const TEST_CONFIG: Config = {
  port: 0,
  databaseUrl: TEST_DATABASE_URL,
  internalToken: 'test-internal-token',
  adminJwtSecret: 'test-secret-test-secret-test-secret-1234',
  accessTtl: '15m',
  refreshTtlDays: 30,
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export async function setupTestDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL)
  await migrate(db, { schema: 'tenant_auth', dir: MIGRATIONS_DIR })
  return db
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('TRUNCATE tenant_auth.refresh_tokens, tenant_auth.admins, tenant_auth.tenants CASCADE')
}

export function buildTestApp(db: Db) {
  return buildApp({ db, config: TEST_CONFIG, logger: false })
}

export function internalHeaders(): Record<string, string> {
  return { [HEADERS.internalToken]: TEST_CONFIG.internalToken }
}

export function superAdminHeaders(adminId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.role]: 'super_admin', [HEADERS.adminId]: adminId }
}

export function tenantAdminHeaders(adminId: string, tenantId: string): Record<string, string> {
  return { ...internalHeaders(), [HEADERS.role]: 'tenant_admin', [HEADERS.adminId]: adminId, [HEADERS.tenantId]: tenantId }
}

export async function seedTenant(
  db: Db,
  input: { name?: string; slug: string; status?: TenantStatus; allowedOrigins?: string[] },
): Promise<TenantView> {
  let t = await createTenant(db, { name: input.name ?? input.slug, slug: input.slug })
  if (input.allowedOrigins) t = (await updateTenant(db, t.id, { allowedOrigins: input.allowedOrigins }))!
  if (input.status) t = (await setTenantStatus(db, t.id, input.status))!
  return t
}

export async function seedAdmin(
  db: Db,
  input: { email: string; password: string; role: Role; tenantId: string | null },
): Promise<AdminView> {
  const row = await createAdmin(db, {
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    tenantId: input.tenantId,
  })
  return toAdminView(row)
}
```

`services/tenant-auth/test/auth.test.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb } from './helpers'

let db: Db
let app: FastifyInstance

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/auth/login', headers: internalHeaders(), payload: { email, password } })

describe('POST /auth/login', () => {
  it('rejects requests without the internal token', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@b.co', password: 'x' } })
    expect(res.statusCode).toBe(401)
  })

  it('logs in a super-admin and returns tokens and profile without the hash', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const res = await login('root@helpix.test', 'password-1')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.accessToken).toEqual(expect.any(String))
    expect(body.refreshToken).toEqual(expect.any(String))
    expect(body.admin).toMatchObject({ email: 'root@helpix.test', role: 'super_admin', tenantId: null })
    expect(JSON.stringify(body)).not.toMatch(/password/i)
  })

  it('treats email case and surrounding whitespace as the same account', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    expect((await login('  Root@Helpix.TEST ', 'password-1')).statusCode).toBe(200)
  })

  it('returns the same error for a wrong password and an unknown email', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const wrong = await login('root@helpix.test', 'nope-nope')
    const unknown = await login('ghost@helpix.test', 'nope-nope')
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('invalid_credentials')
    expect(unknown.json().error.code).toBe('invalid_credentials')
  })

  it('blocks login for admins of a suspended tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop', status: 'suspended' })
    await seedAdmin(db, { email: 'owner@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const res = await login('owner@shop.test', 'password-1')
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })
})

describe('POST /auth/refresh and /auth/logout', () => {
  async function sessionFor(email: string) {
    return (await login(email, 'password-1')).json() as { refreshToken: string; accessToken: string }
  }
  const refresh = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', headers: internalHeaders(), payload: { refreshToken } })

  it('issues a new session and makes the old refresh token single-use', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const s = await sessionFor('root@helpix.test')
    const first = await refresh(s.refreshToken)
    expect(first.statusCode).toBe(200)
    expect(first.json().refreshToken).not.toBe(s.refreshToken)
    const reuse = await refresh(s.refreshToken)
    expect(reuse.statusCode).toBe(401)
    expect(reuse.json().error.code).toBe('invalid_refresh_token')
  })

  it('rejects refresh once the tenant has been suspended', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    await seedAdmin(db, { email: 'owner@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const s = await sessionFor('owner@shop.test')
    await setTenantStatus(db, t.id, 'suspended')
    const res = await refresh(s.refreshToken)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })

  it('logout revokes the refresh token', async () => {
    await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const s = await sessionFor('root@helpix.test')
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: internalHeaders(), payload: { refreshToken: s.refreshToken } })
    expect(out.statusCode).toBe(204)
    expect((await refresh(s.refreshToken)).statusCode).toBe(401)
  })
})
```

`services/tenant-auth/test/seed.test.ts`:
```ts
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
```

Run: `npm test -w services/tenant-auth`
Expected: FAIL — cannot resolve `../src/app` and `../src/seed`.

- [ ] **Step 8: Implement the auth service, routes, app, seed and server**

`services/tenant-auth/src/auth/service.ts`:
```ts
import { AppError, type Db } from '@helpix/shared'
import type { SessionResponse } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { normalizeEmail } from '../lib/email'
import { DUMMY_HASH, verifyPassword } from '../lib/passwords'
import { hashToken, newRefreshToken } from '../lib/tokens'
import { findAdminByEmail, findAdminById, toAdminView, type AdminRow } from '../repos/admins'
import { consumeRefreshToken, insertRefreshToken, revokeRefreshToken } from '../repos/refreshTokens'
import { getTenant } from '../repos/tenants'

export async function assertAdminActive(db: Db, admin: AdminRow): Promise<void> {
  if (!admin.tenant_id) return
  const tenant = await getTenant(db, admin.tenant_id)
  if (!tenant || tenant.status !== 'active') {
    throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
  }
}

async function issueSession(deps: RouteDeps, admin: AdminRow): Promise<SessionResponse> {
  const accessToken = await deps.tokens.signAccess({ adminId: admin.id, role: admin.role, tenantId: admin.tenant_id })
  const refresh = newRefreshToken()
  const expiresAt = new Date(Date.now() + deps.config.refreshTtlDays * 24 * 60 * 60 * 1000)
  await insertRefreshToken(deps.db, admin.id, refresh.hash, expiresAt)
  return { accessToken, refreshToken: refresh.token, admin: toAdminView(admin) }
}

export async function login(deps: RouteDeps, email: string, password: string): Promise<SessionResponse> {
  const admin = await findAdminByEmail(deps.db, normalizeEmail(email))
  const ok = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH)
  if (!admin || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password')
  await assertAdminActive(deps.db, admin)
  return issueSession(deps, admin)
}

export async function refreshSession(deps: RouteDeps, refreshToken: string): Promise<SessionResponse> {
  const adminId = await consumeRefreshToken(deps.db, hashToken(refreshToken))
  const admin = adminId ? await findAdminById(deps.db, adminId) : null
  if (!admin) throw new AppError(401, 'invalid_refresh_token', 'Session expired, please log in again')
  await assertAdminActive(deps.db, admin)
  return issueSession(deps, admin)
}

export async function logout(deps: RouteDeps, refreshToken: string): Promise<void> {
  await revokeRefreshToken(deps.db, hashToken(refreshToken))
}
```

`services/tenant-auth/src/routes/auth.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify'
import { login, logout, refreshSession } from '../auth/service'
import type { RouteDeps } from '../deps'

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 300 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const

const refreshBody = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: { refreshToken: { type: 'string', minLength: 1, maxLength: 200 } },
} as const

export const authRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  app.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    { schema: { body: loginBody } },
    async (req) => login(deps, req.body.email, req.body.password),
  )

  app.post<{ Body: { refreshToken: string } }>(
    '/auth/refresh',
    { schema: { body: refreshBody } },
    async (req) => refreshSession(deps, req.body.refreshToken),
  )

  app.post<{ Body: { refreshToken: string } }>(
    '/auth/logout',
    { schema: { body: refreshBody } },
    async (req, reply) => {
      await logout(deps, req.body.refreshToken)
      return reply.code(204).send()
    },
  )
}
```

`services/tenant-auth/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler, requireInternalToken, type Db } from '@helpix/shared'
import type { Config } from './config'
import type { RouteDeps } from './deps'
import { createTokenService } from './lib/tokens'
import { authRoutes } from './routes/auth'

export interface AppOptions {
  db: Db
  config: Config
  logger?: boolean
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, requestIdHeader: HEADERS.requestId })
  registerErrorHandler(app)
  app.addHook('onRequest', requireInternalToken(opts.config.internalToken))

  const deps: RouteDeps = {
    db: opts.db,
    config: opts.config,
    tokens: createTokenService(opts.config.adminJwtSecret, opts.config.accessTtl),
  }
  await app.register(authRoutes, deps)
  return app
}
```

`services/tenant-auth/src/seed.ts`:
```ts
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
```

`services/tenant-auth/src/server.ts`:
```ts
import { fileURLToPath } from 'node:url'
import { createPool, migrate } from '@helpix/shared'
import { buildApp } from './app'
import { loadConfig } from './config'
import { seedSuperAdmin } from './seed'

const config = loadConfig()
const db = createPool(config.databaseUrl)
const applied = await migrate(db, { schema: 'tenant_auth', dir: fileURLToPath(new URL('../migrations', import.meta.url)) })
if (applied.length) console.log(`tenant-auth: applied migrations ${applied.join(', ')}`)

const { SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD } = process.env
if (SEED_SUPERADMIN_EMAIL && SEED_SUPERADMIN_PASSWORD) {
  const result = await seedSuperAdmin(db, SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD)
  console.log(`tenant-auth: super-admin ${result}`)
}

const app = await buildApp({ db, config, logger: true })
await app.listen({ port: config.port, host: '0.0.0.0' })
```

- [ ] **Step 9: Run tests, typecheck and boot the service**

Run: `npm test -w services/tenant-auth && npm run typecheck -w services/tenant-auth`
Expected: all PASS.

Run: `PORT=4001 npm run dev -w services/tenant-auth` (stop it with Ctrl-C after the check)
Expected log lines: `applied migrations 001_init.sql`, `super-admin created`, then Fastify listening on `0.0.0.0:4001`. A second start logs `super-admin exists` and no migrations.

- [ ] **Step 10: Commit**

```bash
git add services/tenant-auth package-lock.json package.json
git commit -m "feat(tenant-auth): schema, admin login with refresh rotation, super-admin seed"
```

---

### Task 3: tenant-auth — tenant management and `/me`

**Files:**
- Create: `services/tenant-auth/src/lib/origins.ts`, `services/tenant-auth/src/routes/tenants.ts`, `services/tenant-auth/src/routes/me.ts`
- Modify: `services/tenant-auth/src/app.ts` (register the two new route plugins)
- Test: `services/tenant-auth/test/origins.test.ts`, `services/tenant-auth/test/tenants.test.ts`, `services/tenant-auth/test/me.test.ts`

**Interfaces:**
- Consumes: Task 2 repos, `RouteDeps`, test helpers; `readContext`, `requireRole`, `requireAdmin` from shared.
- Produces:
  - `normalizeOrigin(input: string): string | null` (throws 400 `invalid_origin`; null for blank), `normalizeOrigins(list: string[]): string[]`, `tryNormalizeOrigin(input: string | null | undefined): string | null`
  - HTTP (all require role `super_admin`):
    - `GET /admin/tenants` → `{ tenants: TenantView[] }`
    - `POST /admin/tenants {name, slug}` → 201 `TenantView`
    - `GET /admin/tenants/:id` → `TenantView`
    - `PATCH /admin/tenants/:id {name?, allowedOrigins?}` → `TenantView`
    - `POST /admin/tenants/:id/suspend` and `/reactivate` → `TenantView`
    - `POST /admin/tenants/:id/widget-key/rotate` → `TenantView`
    - `GET /admin/tenants/:id/admins` → `{ admins: AdminView[] }`
    - `POST /admin/tenants/:id/admins {email, password}` → 201 `AdminView`
  - `GET /me` (any admin) → `MeResponse`

- [ ] **Step 1: Write the failing origin tests**

`services/tenant-auth/test/origins.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { AppError } from '@helpix/shared'
import { normalizeOrigin, normalizeOrigins, tryNormalizeOrigin } from '../src/lib/origins'

describe('normalizeOrigin', () => {
  it.each([
    ['https://Shop.Example/', 'https://shop.example'],
    ['  http://localhost:5174  ', 'http://localhost:5174'],
    ['https://shop.example:443', 'https://shop.example'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected)
  })

  it('returns null for blank input', () => {
    expect(normalizeOrigin('   ')).toBeNull()
  })

  it.each(['https://shop.example/about', 'https://shop.example?x=1', 'ftp://shop.example', 'shop.example', 'https://user:pw@shop.example'])(
    'rejects %s with invalid_origin',
    (input) => {
      try {
        normalizeOrigin(input)
        expect.fail('should throw')
      } catch (e) {
        expect((e as AppError).code).toBe('invalid_origin')
        expect((e as AppError).status).toBe(400)
      }
    },
  )
})

describe('normalizeOrigins / tryNormalizeOrigin', () => {
  it('drops blanks and duplicates, keeping first-seen order', () => {
    expect(normalizeOrigins(['https://Shop.Example/', '', ' http://localhost:5174 ', 'https://shop.example'])).toEqual([
      'https://shop.example',
      'http://localhost:5174',
    ])
  })

  it('tryNormalizeOrigin never throws', () => {
    expect(tryNormalizeOrigin('https://Shop.Example')).toBe('https://shop.example')
    expect(tryNormalizeOrigin('garbage')).toBeNull()
    expect(tryNormalizeOrigin(undefined)).toBeNull()
  })
})
```

Run: `npm test -w services/tenant-auth -- origins`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement origins**

`services/tenant-auth/src/lib/origins.ts`:
```ts
import { AppError } from '@helpix/shared'

function invalid(input: string): AppError {
  return new AppError(400, 'invalid_origin', `"${input}" is not an origin. Use the form https://shop.example or http://localhost:5174`)
}

/** Returns `scheme://host[:port]`, or null for blank input. Throws 400 invalid_origin for anything else. */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw invalid(trimmed)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid(trimmed)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw invalid(trimmed)
  return url.origin
}

export function normalizeOrigins(list: string[]): string[] {
  const out: string[] = []
  for (const item of list) {
    const origin = normalizeOrigin(item)
    if (origin && !out.includes(origin)) out.push(origin)
  }
  return out
}

export function tryNormalizeOrigin(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    return normalizeOrigin(input)
  } catch {
    return null
  }
}
```

Run: `npm test -w services/tenant-auth -- origins`
Expected: PASS.

- [ ] **Step 3: Write the failing tenant-management and `/me` tests**

`services/tenant-auth/test/tenants.test.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import type { AdminView } from '@helpix/shared/api-types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findTenantByWidgetKey } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb, superAdminHeaders, tenantAdminHeaders } from './helpers'

let db: Db
let app: FastifyInstance
let root: AdminView

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
  root = await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
})
afterEach(async () => { await app.close() })

const asRoot = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, headers: superAdminHeaders(root.id), ...(payload ? { payload } : {}) })

describe('access control', () => {
  it('rejects tenant admins with 403', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await app.inject({ method: 'GET', url: '/admin/tenants', headers: tenantAdminHeaders('00000000-0000-0000-0000-000000000001', t.id) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
  })

  it('rejects requests with no role with 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/tenants', headers: internalHeaders() })
    expect(res.statusCode).toBe(403)
  })
})

describe('tenants', () => {
  it('creates a tenant with a widget key and no origins', async () => {
    const res = await asRoot('POST', '/admin/tenants', { name: 'iPhone Store', slug: 'iphone-store' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'iPhone Store', slug: 'iphone-store', status: 'active', allowedOrigins: [] })
    expect(res.json().widgetKey).toMatch(/^wk_/)
  })

  it('returns 409 slug_taken for a duplicate slug', async () => {
    await asRoot('POST', '/admin/tenants', { name: 'A', slug: 'shop' })
    const res = await asRoot('POST', '/admin/tenants', { name: 'B', slug: 'shop' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('slug_taken')
  })

  it('rejects an invalid slug with 400', async () => {
    const res = await asRoot('POST', '/admin/tenants', { name: 'Bad', slug: 'Bad Slug' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('lists tenants', async () => {
    await seedTenant(db, { slug: 'one' })
    await seedTenant(db, { slug: 'two' })
    const res = await asRoot('GET', '/admin/tenants')
    expect(res.json().tenants.map((t: { slug: string }) => t.slug).sort()).toEqual(['one', 'two'])
  })

  it('returns 404 for an unknown id and 400 for a malformed id', async () => {
    expect((await asRoot('GET', '/admin/tenants/00000000-0000-0000-0000-000000000000')).json().error.code).toBe('tenant_not_found')
    expect((await asRoot('GET', '/admin/tenants/not-a-uuid')).statusCode).toBe(400)
  })

  it('normalizes allowed origins on PATCH', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await asRoot('PATCH', `/admin/tenants/${t.id}`, {
      allowedOrigins: ['https://Shop.Example/', ' http://localhost:5174 ', '', 'https://shop.example'],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().allowedOrigins).toEqual(['https://shop.example', 'http://localhost:5174'])
  })

  it('rejects an origin with a path and leaves the tenant unchanged', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'] })
    const res = await asRoot('PATCH', `/admin/tenants/${t.id}`, { allowedOrigins: ['https://shop.example/about'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_origin')
    expect((await asRoot('GET', `/admin/tenants/${t.id}`)).json().allowedOrigins).toEqual(['https://shop.example'])
  })

  it('renames a tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect((await asRoot('PATCH', `/admin/tenants/${t.id}`, { name: 'New Name' })).json().name).toBe('New Name')
  })

  it('suspends and reactivates', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect((await asRoot('POST', `/admin/tenants/${t.id}/suspend`)).json().status).toBe('suspended')
    expect((await asRoot('POST', `/admin/tenants/${t.id}/reactivate`)).json().status).toBe('active')
  })

  it('rotates the widget key so the old key no longer resolves', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await asRoot('POST', `/admin/tenants/${t.id}/widget-key/rotate`)
    expect(res.json().widgetKey).not.toBe(t.widgetKey)
    expect(await findTenantByWidgetKey(db, t.widgetKey)).toBeNull()
  })
})

describe('tenant admins', () => {
  it('creates a tenant admin with a normalized email and no hash in the response', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const res = await asRoot('POST', `/admin/tenants/${t.id}/admins`, { email: '  Owner@Shop.COM ', password: 'password-1' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ email: 'owner@shop.com', role: 'tenant_admin', tenantId: t.id })
    expect(res.body).not.toMatch(/password/i)
  })

  it('returns 409 email_taken for an email used by any admin, in any case', async () => {
    const a = await seedTenant(db, { slug: 'a' })
    const b = await seedTenant(db, { slug: 'b' })
    await asRoot('POST', `/admin/tenants/${a.id}/admins`, { email: 'owner@shop.com', password: 'password-1' })
    const res = await asRoot('POST', `/admin/tenants/${b.id}/admins`, { email: 'OWNER@shop.com', password: 'password-1' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('email_taken')
  })

  it('rejects a short password and an invalid email', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    expect((await asRoot('POST', `/admin/tenants/${t.id}/admins`, { email: 'o@shop.com', password: 'short' })).statusCode).toBe(400)
    const bad = await asRoot('POST', `/admin/tenants/${t.id}/admins`, { email: 'not an email', password: 'password-1' })
    expect(bad.json().error.code).toBe('invalid_email')
  })

  it('returns 404 for an unknown tenant', async () => {
    const res = await asRoot('POST', '/admin/tenants/00000000-0000-0000-0000-000000000000/admins', { email: 'o@shop.com', password: 'password-1' })
    expect(res.statusCode).toBe(404)
  })

  it('lists only that tenant\'s admins', async () => {
    const a = await seedTenant(db, { slug: 'a' })
    const b = await seedTenant(db, { slug: 'b' })
    await seedAdmin(db, { email: 'a@a.test', password: 'password-1', role: 'tenant_admin', tenantId: a.id })
    await seedAdmin(db, { email: 'b@b.test', password: 'password-1', role: 'tenant_admin', tenantId: b.id })
    const res = await asRoot('GET', `/admin/tenants/${a.id}/admins`)
    expect(res.json().admins.map((x: { email: string }) => x.email)).toEqual(['a@a.test'])
  })
})
```

`services/tenant-auth/test/me.test.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb, superAdminHeaders, tenantAdminHeaders } from './helpers'

let db: Db
let app: FastifyInstance
beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

describe('GET /me', () => {
  it('returns the super-admin with no tenant', async () => {
    const root = await seedAdmin(db, { email: 'root@helpix.test', password: 'password-1', role: 'super_admin', tenantId: null })
    const res = await app.inject({ method: 'GET', url: '/me', headers: superAdminHeaders(root.id) })
    expect(res.json()).toMatchObject({ admin: { email: 'root@helpix.test' }, tenant: null })
  })

  it('returns the tenant admin with their tenant', async () => {
    const t = await seedTenant(db, { name: 'Teen Fashion', slug: 'teen-fashion' })
    const owner = await seedAdmin(db, { email: 'o@teen.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const res = await app.inject({ method: 'GET', url: '/me', headers: tenantAdminHeaders(owner.id, t.id) })
    expect(res.json()).toMatchObject({ admin: { email: 'o@teen.test' }, tenant: { id: t.id, name: 'Teen Fashion' } })
  })

  it('returns 401 without admin identity', async () => {
    expect((await app.inject({ method: 'GET', url: '/me', headers: internalHeaders() })).statusCode).toBe(401)
  })
})
```

Run: `npm test -w services/tenant-auth`
Expected: FAIL — `/admin/tenants` and `/me` return 404.

- [ ] **Step 4: Implement the routes and register them**

`services/tenant-auth/src/routes/tenants.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify'
import { AppError, readContext, requireRole } from '@helpix/shared'
import type { TenantView } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { assertValidEmail, normalizeEmail } from '../lib/email'
import { normalizeOrigins } from '../lib/origins'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../lib/passwords'
import { createAdmin, listTenantAdmins, toAdminView } from '../repos/admins'
import {
  createTenant,
  getTenant,
  listTenants,
  rotateWidgetKey,
  setTenantStatus,
  updateTenant,
} from '../repos/tenants'

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const createTenantBody = {
  type: 'object',
  required: ['name', 'slug'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    slug: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
  },
} as const

const patchTenantBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    allowedOrigins: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } },
  },
} as const

const createAdminBody = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 300 },
    password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 },
  },
} as const

type IdParams = { Params: { id: string } }

function found(t: TenantView | null): TenantView {
  if (!t) throw new AppError(404, 'tenant_not_found', 'Tenant not found')
  return t
}

export const tenantRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', async (req) => requireRole(readContext(req), 'super_admin'))

  app.get('/admin/tenants', async () => ({ tenants: await listTenants(db) }))

  app.post<{ Body: { name: string; slug: string } }>(
    '/admin/tenants',
    { schema: { body: createTenantBody } },
    async (req, reply) => reply.code(201).send(await createTenant(db, { name: req.body.name.trim(), slug: req.body.slug })),
  )

  app.get<IdParams>('/admin/tenants/:id', { schema: { params: idParams } }, async (req) => found(await getTenant(db, req.params.id)))

  app.patch<IdParams & { Body: { name?: string; allowedOrigins?: string[] } }>(
    '/admin/tenants/:id',
    { schema: { params: idParams, body: patchTenantBody } },
    async (req) =>
      found(
        await updateTenant(db, req.params.id, {
          name: req.body.name?.trim(),
          allowedOrigins: req.body.allowedOrigins ? normalizeOrigins(req.body.allowedOrigins) : undefined,
        }),
      ),
  )

  app.post<IdParams>('/admin/tenants/:id/suspend', { schema: { params: idParams } }, async (req) =>
    found(await setTenantStatus(db, req.params.id, 'suspended')),
  )

  app.post<IdParams>('/admin/tenants/:id/reactivate', { schema: { params: idParams } }, async (req) =>
    found(await setTenantStatus(db, req.params.id, 'active')),
  )

  app.post<IdParams>('/admin/tenants/:id/widget-key/rotate', { schema: { params: idParams } }, async (req) =>
    found(await rotateWidgetKey(db, req.params.id)),
  )

  app.get<IdParams>('/admin/tenants/:id/admins', { schema: { params: idParams } }, async (req) => {
    found(await getTenant(db, req.params.id))
    return { admins: (await listTenantAdmins(db, req.params.id)).map(toAdminView) }
  })

  app.post<IdParams & { Body: { email: string; password: string } }>(
    '/admin/tenants/:id/admins',
    { schema: { params: idParams, body: createAdminBody } },
    async (req, reply) => {
      found(await getTenant(db, req.params.id))
      const email = normalizeEmail(req.body.email)
      assertValidEmail(email)
      const row = await createAdmin(db, {
        email,
        passwordHash: await hashPassword(req.body.password),
        role: 'tenant_admin',
        tenantId: req.params.id,
      })
      return reply.code(201).send(toAdminView(row))
    },
  )
}
```

`services/tenant-auth/src/routes/me.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify'
import { AppError, readContext, requireAdmin } from '@helpix/shared'
import type { MeResponse } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { findAdminById, toAdminView } from '../repos/admins'
import { getTenant } from '../repos/tenants'

export const meRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.get('/me', async (req): Promise<MeResponse> => {
    const { adminId } = requireAdmin(readContext(req))
    const admin = await findAdminById(db, adminId)
    if (!admin) throw new AppError(401, 'unauthorized', 'Admin no longer exists')
    return { admin: toAdminView(admin), tenant: admin.tenant_id ? await getTenant(db, admin.tenant_id) : null }
  })
}
```

Modify `services/tenant-auth/src/app.ts` — add the imports and registrations below the existing `authRoutes` registration:
```ts
import { meRoutes } from './routes/me'
import { tenantRoutes } from './routes/tenants'
// ...inside buildApp, after `await app.register(authRoutes, deps)`:
  await app.register(meRoutes, deps)
  await app.register(tenantRoutes, deps)
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w services/tenant-auth && npm run typecheck -w services/tenant-auth`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add services/tenant-auth
git commit -m "feat(tenant-auth): super-admin tenant management, tenant admins, /me"
```

---

### Task 4: tenant-auth — internal credential resolution

**Files:**
- Create: `services/tenant-auth/src/routes/internal.ts`
- Modify: `services/tenant-auth/src/app.ts` (register `internalRoutes`)
- Test: `services/tenant-auth/test/internal.test.ts`

**Interfaces:**
- Consumes: `RouteDeps`, `assertAdminActive`, `findAdminById`, `findTenantByWidgetKey`, `tryNormalizeOrigin`.
- Produces (called only by the gateway; the gateway never exposes `/internal/*`):
  - `POST /internal/resolve-admin { accessToken }` → 200 `ResolvedAdmin` | 401 `invalid_token` | 403 `tenant_suspended`
  - `POST /internal/resolve-widget { widgetKey, origin: string | null }` → 200 `ResolvedWidget` | 401 `invalid_widget_key` | 403 `tenant_suspended` | 403 `origin_not_allowed` (used by the gateway in step 4)

- [ ] **Step 1: Write the failing tests**

`services/tenant-auth/test/internal.test.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import type { Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTokenService } from '../src/lib/tokens'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedAdmin, seedTenant, setupTestDb, TEST_CONFIG } from './helpers'

let db: Db
let app: FastifyInstance
const tokens = createTokenService(TEST_CONFIG.adminJwtSecret, TEST_CONFIG.accessTtl)

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const resolveAdmin = (accessToken: string) =>
  app.inject({ method: 'POST', url: '/internal/resolve-admin', headers: internalHeaders(), payload: { accessToken } })
const resolveWidget = (widgetKey: string, origin: string | null) =>
  app.inject({ method: 'POST', url: '/internal/resolve-widget', headers: internalHeaders(), payload: { widgetKey, origin } })

describe('POST /internal/resolve-admin', () => {
  it('requires the internal token', async () => {
    const res = await app.inject({ method: 'POST', url: '/internal/resolve-admin', payload: { accessToken: 'x' } })
    expect(res.statusCode).toBe(401)
  })

  it('resolves a valid token to the identity stored in the database', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const owner = await seedAdmin(db, { email: 'o@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const token = await tokens.signAccess({ adminId: owner.id, role: 'tenant_admin', tenantId: t.id })
    const res = await resolveAdmin(token)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ adminId: owner.id, role: 'tenant_admin', tenantId: t.id })
  })

  it('returns 401 invalid_token for garbage', async () => {
    const res = await resolveAdmin('garbage')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_token')
  })

  it('returns 401 for a valid token whose admin was deleted', async () => {
    const token = await tokens.signAccess({ adminId: '00000000-0000-0000-0000-000000000009', role: 'super_admin', tenantId: null })
    expect((await resolveAdmin(token)).statusCode).toBe(401)
  })

  it('returns 403 tenant_suspended for a live token after suspension', async () => {
    const t = await seedTenant(db, { slug: 'shop' })
    const owner = await seedAdmin(db, { email: 'o@shop.test', password: 'password-1', role: 'tenant_admin', tenantId: t.id })
    const token = await tokens.signAccess({ adminId: owner.id, role: 'tenant_admin', tenantId: t.id })
    await setTenantStatus(db, t.id, 'suspended')
    const res = await resolveAdmin(token)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })
})

describe('POST /internal/resolve-widget', () => {
  it('resolves a key from an allowed origin, normalizing the request origin', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'] })
    const res = await resolveWidget(t.widgetKey, 'https://Shop.Example')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ tenantId: t.id })
  })

  it('returns 401 invalid_widget_key for an unknown key', async () => {
    expect((await resolveWidget('wk_nope', 'https://shop.example')).json().error.code).toBe('invalid_widget_key')
  })

  it('returns 403 origin_not_allowed for another origin or a missing origin', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'] })
    expect((await resolveWidget(t.widgetKey, 'https://evil.example')).json().error.code).toBe('origin_not_allowed')
    expect((await resolveWidget(t.widgetKey, null)).json().error.code).toBe('origin_not_allowed')
  })

  it('returns 403 tenant_suspended for a suspended tenant', async () => {
    const t = await seedTenant(db, { slug: 'shop', allowedOrigins: ['https://shop.example'], status: 'suspended' })
    expect((await resolveWidget(t.widgetKey, 'https://shop.example')).json().error.code).toBe('tenant_suspended')
  })
})
```

Run: `npm test -w services/tenant-auth -- internal`
Expected: FAIL — 404 on both routes.

- [ ] **Step 2: Implement and register**

`services/tenant-auth/src/routes/internal.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify'
import { AppError } from '@helpix/shared'
import type { ResolvedAdmin, ResolvedWidget } from '@helpix/shared/api-types'
import { assertAdminActive } from '../auth/service'
import type { RouteDeps } from '../deps'
import { tryNormalizeOrigin } from '../lib/origins'
import { findAdminById } from '../repos/admins'
import { findTenantByWidgetKey } from '../repos/tenants'

const resolveAdminBody = {
  type: 'object',
  required: ['accessToken'],
  properties: { accessToken: { type: 'string', minLength: 1, maxLength: 4000 } },
} as const

const resolveWidgetBody = {
  type: 'object',
  required: ['widgetKey', 'origin'],
  properties: {
    widgetKey: { type: 'string', minLength: 1, maxLength: 200 },
    origin: { type: ['string', 'null'], maxLength: 300 },
  },
} as const

export const internalRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db, tokens }) => {
  app.post<{ Body: { accessToken: string } }>(
    '/internal/resolve-admin',
    { schema: { body: resolveAdminBody } },
    async (req): Promise<ResolvedAdmin> => {
      const claims = await tokens.verifyAccess(req.body.accessToken)
      const admin = claims ? await findAdminById(db, claims.adminId) : null
      if (!admin) throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      await assertAdminActive(db, admin)
      return { adminId: admin.id, role: admin.role, tenantId: admin.tenant_id }
    },
  )

  app.post<{ Body: { widgetKey: string; origin: string | null } }>(
    '/internal/resolve-widget',
    { schema: { body: resolveWidgetBody } },
    async (req): Promise<ResolvedWidget> => {
      const tenant = await findTenantByWidgetKey(db, req.body.widgetKey)
      if (!tenant) throw new AppError(401, 'invalid_widget_key', 'Unknown widget key')
      if (tenant.status !== 'active') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      const origin = tryNormalizeOrigin(req.body.origin)
      if (!origin || !tenant.allowedOrigins.includes(origin)) {
        throw new AppError(403, 'origin_not_allowed', 'This site is not allowed to use this widget key')
      }
      return { tenantId: tenant.id }
    },
  )
}
```

Modify `services/tenant-auth/src/app.ts` — add:
```ts
import { internalRoutes } from './routes/internal'
// ...after the other registrations:
  await app.register(internalRoutes, deps)
```

- [ ] **Step 3: Run the tests**

Run: `npm test -w services/tenant-auth && npm run typecheck -w services/tenant-auth`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add services/tenant-auth
git commit -m "feat(tenant-auth): internal admin-token and widget-key resolution"
```

---

### Task 5: gateway — forwarding, header stripping, request IDs, body limit

**Files:**
- Create: `services/gateway/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `services/gateway/src/{config,forward,app}.ts`
- Test: `services/gateway/test/helpers.ts`, `services/gateway/test/forward.test.ts`

**Interfaces:**
- Consumes: `HEADERS`, `IDENTITY_HEADERS`, `AppError`, `registerErrorHandler` from shared.
- Produces:
  - `interface GatewayConfig { port: number; internalToken: string; tenantAuthUrl: string; corsOrigins: string[]; bodyLimitBytes: number; resolveCacheTtlMs: number }`, `loadConfig(env?): GatewayConfig`
  - `forward(req: FastifyRequest, reply: FastifyReply, opts: { target: string; internalToken: string; identity?: Record<string, string> }): Promise<FastifyReply>`
  - `enforceBodyLimit(limit: number): (req: FastifyRequest) => Promise<void>`
  - `buildGateway(deps: GatewayDeps): Promise<FastifyInstance>` with `GatewayDeps = { config: GatewayConfig; logger?: boolean }` (Task 6 adds `tenantAuth?`)
  - Routes: `GET /health` → `{ ok: true }`; `GET|POST|PUT|PATCH|DELETE /auth/*` → tenant-auth, no credential
  - Test helpers: `startEcho(): Promise<{ url: string; calls: EchoCall[]; close(): Promise<void> }>`, `testConfig(tenantAuthUrl: string): GatewayConfig`

- [ ] **Step 1: Create the package**

`services/gateway/package.json`:
```json
{
  "name": "@helpix/gateway",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`services/gateway/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`services/gateway/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {} })
```

Run:
```bash
npm install @helpix/shared@* fastify @fastify/cors undici tsx -w services/gateway
```

- [ ] **Step 2: Write the test helpers and failing tests**

`services/gateway/test/helpers.ts`:
```ts
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import type { GatewayConfig } from '../src/config'

export interface EchoCall {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string | null
}

/** A fake upstream that records every request and replies `{ ok: true }` with an `x-upstream` header. */
export async function startEcho() {
  const calls: EchoCall[] = []
  const app = Fastify()
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/*',
    handler: async (req, reply) => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: (req.body as string | undefined) ?? null })
      reply.header('x-upstream', 'yes')
      return { ok: true }
    },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, calls, close: () => app.close() }
}

export function testConfig(tenantAuthUrl: string): GatewayConfig {
  return {
    port: 0,
    internalToken: 'internal-secret',
    tenantAuthUrl,
    corsOrigins: ['http://localhost:5173'],
    bodyLimitBytes: 1024,
    resolveCacheTtlMs: 30_000,
  }
}
```

`services/gateway/test/forward.test.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildGateway } from '../src/app'
import { startEcho, testConfig } from './helpers'

let echo: Awaited<ReturnType<typeof startEcho>>
let gw: FastifyInstance

beforeEach(async () => {
  echo = await startEcho()
  gw = await buildGateway({ config: testConfig(echo.url) })
})
afterEach(async () => {
  await gw.close()
  await echo.close()
})

describe('gateway forwarding', () => {
  it('answers /health with a request id', async () => {
    const res = await gw.inject({ method: 'GET', url: '/health' })
    expect(res.json()).toEqual({ ok: true })
    expect(res.headers['x-request-id']).toEqual(expect.any(String))
  })

  it('forwards /auth/* with body, query, internal token and the same request id', async () => {
    const res = await gw.inject({
      method: 'POST',
      url: '/auth/login?x=1',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.co', password: 'pw' }),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-upstream']).toBe('yes')
    const call = echo.calls[0]!
    expect(call.url).toBe('/auth/login?x=1')
    expect(JSON.parse(call.body!)).toEqual({ email: 'a@b.co', password: 'pw' })
    expect(call.headers['x-internal-token']).toBe('internal-secret')
    expect(call.headers['x-request-id']).toBe(res.headers['x-request-id'])
  })

  it('strips client-supplied identity headers, authorization and request id', async () => {
    await gw.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'spoofed',
        'x-customer-id': 'spoofed',
        'x-helpix-role': 'super_admin',
        'x-admin-id': 'spoofed',
        'x-internal-token': 'spoofed',
        'x-request-id': 'spoofed',
        authorization: 'Bearer spoofed',
      },
      payload: '{}',
    })
    const h = echo.calls[0]!.headers
    expect(h['x-tenant-id']).toBeUndefined()
    expect(h['x-customer-id']).toBeUndefined()
    expect(h['x-helpix-role']).toBeUndefined()
    expect(h['x-admin-id']).toBeUndefined()
    expect(h.authorization).toBeUndefined()
    expect(h['x-internal-token']).toBe('internal-secret')
    expect(h['x-request-id']).not.toBe('spoofed')
  })

  it('rejects bodies over the limit with 413 without calling upstream', async () => {
    const res = await gw.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ big: 'x'.repeat(2000) }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('payload_too_large')
    expect(echo.calls).toHaveLength(0)
  })

  it('does not expose internal routes', async () => {
    const res = await gw.inject({ method: 'POST', url: '/internal/resolve-admin', payload: {} })
    expect(res.statusCode).toBe(404)
    expect(echo.calls).toHaveLength(0)
  })

  it('returns 502 when the upstream is down', async () => {
    const down = await buildGateway({ config: testConfig('http://127.0.0.1:1') })
    const res = await down.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: '{}' })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe('upstream_unavailable')
    await down.close()
  })
})
```

Run: `npm test -w services/gateway`
Expected: FAIL — cannot resolve `../src/app`.

- [ ] **Step 3: Implement config, forward and app**

`services/gateway/src/config.ts`:
```ts
export interface GatewayConfig {
  port: number
  internalToken: string
  tenantAuthUrl: string
  corsOrigins: string[]
  bodyLimitBytes: number
  resolveCacheTtlMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const required = (key: string): string => {
    const v = env[key]
    if (!v) throw new Error(`Missing required env var ${key}`)
    return v
  }
  return {
    port: Number(env.PORT ?? 4000),
    internalToken: required('INTERNAL_TOKEN'),
    tenantAuthUrl: required('TENANT_AUTH_URL'),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimitBytes: Number(env.BODY_LIMIT_BYTES ?? 1_048_576),
    resolveCacheTtlMs: Number(env.RESOLVE_CACHE_TTL_MS ?? 30_000),
  }
}
```

`services/gateway/src/forward.ts`:
```ts
import type { Readable } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { request, type Dispatcher } from 'undici'
import { AppError, HEADERS, IDENTITY_HEADERS } from '@helpix/shared'

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
])
const STRIP_FROM_CLIENT = new Set([...IDENTITY_HEADERS, 'authorization', HEADERS.requestId])

export interface ForwardOptions {
  target: string
  internalToken: string
  identity?: Record<string, string>
}

export function enforceBodyLimit(limit: number) {
  return async (req: FastifyRequest): Promise<void> => {
    const len = req.headers['content-length']
    if (len !== undefined && Number(len) > limit) {
      throw new AppError(413, 'payload_too_large', `Request body exceeds ${limit} bytes`)
    }
    if (len === undefined && req.headers['transfer-encoding']) {
      throw new AppError(411, 'length_required', 'Content-Length is required')
    }
  }
}

export async function forward(req: FastifyRequest, reply: FastifyReply, opts: ForwardOptions): Promise<FastifyReply> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || STRIP_FROM_CLIENT.has(name)) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  Object.assign(headers, opts.identity)
  headers[HEADERS.internalToken] = opts.internalToken
  headers[HEADERS.requestId] = req.id

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body != null
  let upstream: Dispatcher.ResponseData
  try {
    upstream = await request(opts.target + req.url, {
      method: req.method as Dispatcher.HttpMethod,
      headers,
      body: hasBody ? (req.body as Readable) : undefined,
    })
  } catch (err) {
    req.log.error({ err, target: opts.target }, 'upstream request failed')
    throw new AppError(502, 'upstream_unavailable', 'A backend service is unavailable')
  }

  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) reply.header(name, value)
  }
  reply.code(upstream.statusCode)
  if (upstream.statusCode === 204 || upstream.statusCode === 304) {
    await upstream.body.dump()
    return reply.send()
  }
  return reply.send(upstream.body)
}
```

`services/gateway/src/app.ts`:
```ts
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { HEADERS, registerErrorHandler } from '@helpix/shared'
import type { GatewayConfig } from './config'
import { enforceBodyLimit, forward } from './forward'

export interface GatewayDeps {
  config: GatewayConfig
  logger?: boolean
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export async function buildGateway(deps: GatewayDeps): Promise<FastifyInstance> {
  const { config } = deps
  const app = Fastify({ logger: deps.logger ?? false, genReqId: () => randomUUID() })

  // Bodies are streamed through untouched; size is enforced from Content-Length.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  registerErrorHandler(app)
  app.addHook('onRequest', enforceBodyLimit(config.bodyLimitBytes))
  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.requestId, req.id)
  })

  app.get('/health', async () => ({ ok: true }))

  app.route({
    method: [...METHODS],
    url: '/auth/*',
    handler: (req, reply) => forward(req, reply, { target: config.tenantAuthUrl, internalToken: config.internalToken }),
  })

  return app
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w services/gateway && npm run typecheck -w services/gateway`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add services/gateway package-lock.json
git commit -m "feat(gateway): streaming forwarder with identity-header stripping and body limit"
```

---

### Task 6: gateway — admin resolution, cache, CORS, server and Docker Compose

**Files:**
- Create: `services/gateway/src/{cache,tenantAuthClient,server}.ts`
- Modify: `services/gateway/src/app.ts` (full replacement below)
- Create: `docker/node-service.Dockerfile`
- Modify: `docker-compose.yml` (add `tenant-auth` and `gateway`)
- Test: `services/gateway/test/cache.test.ts`, `services/gateway/test/admin.test.ts`

**Interfaces:**
- Consumes: Task 5 `forward`, `enforceBodyLimit`, `GatewayConfig`; `ResolvedAdmin` type; tenant-auth `POST /internal/resolve-admin` (Task 4).
- Produces:
  - `class TtlCache<V> { constructor(ttlMs: number, maxEntries?: number, now?: () => number); get(key: string): V | undefined; set(key: string, value: V): void }`
  - `interface TenantAuthClient { resolveAdmin(accessToken: string, requestId: string): Promise<ResolvedAdmin> }`, `createTenantAuthClient(baseUrl: string, internalToken: string): TenantAuthClient`
  - `GatewayDeps` gains `tenantAuth?: TenantAuthClient`
  - Routes: `GET /me` and `GET|POST|PUT|PATCH|DELETE /admin/*` require `Authorization: Bearer <accessToken>` and forward with `x-admin-id`, `x-helpix-role` and (tenant admins only) `x-tenant-id`

- [ ] **Step 1: Write the failing tests**

`services/gateway/test/cache.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { TtlCache } from '../src/cache'

describe('TtlCache', () => {
  it('returns values until they expire', () => {
    let now = 1000
    const cache = new TtlCache<string>(100, 10, () => now)
    cache.set('a', 'x')
    expect(cache.get('a')).toBe('x')
    now = 1099
    expect(cache.get('a')).toBe('x')
    now = 1100
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts the oldest entry when full', () => {
    const cache = new TtlCache<number>(10_000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })
})
```

`services/gateway/test/admin.test.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import type { ResolvedAdmin } from '@helpix/shared/api-types'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { startEcho, testConfig } from './helpers'

let echo: Awaited<ReturnType<typeof startEcho>>
let gw: FastifyInstance
let tenantAuth: TenantAuthClient & { resolveAdmin: ReturnType<typeof vi.fn> }

const IDENTITIES: Record<string, ResolvedAdmin> = {
  'super-token': { adminId: 'admin-super', role: 'super_admin', tenantId: null },
  'tenant-token': { adminId: 'admin-a', role: 'tenant_admin', tenantId: 'tenant-a' },
}

beforeEach(async () => {
  echo = await startEcho()
  tenantAuth = {
    resolveAdmin: vi.fn(async (token: string) => {
      if (token === 'suspended-token') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      const id = IDENTITIES[token]
      if (!id) throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      return id
    }),
  }
  gw = await buildGateway({ config: testConfig(echo.url), tenantAuth })
})
afterEach(async () => {
  await gw.close()
  await echo.close()
})

const get = (url: string, headers: Record<string, string> = {}) => gw.inject({ method: 'GET', url, headers })

describe('admin routes', () => {
  it('rejects a missing bearer token with 401 without calling upstream', async () => {
    const res = await get('/admin/tenants')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
    expect(echo.calls).toHaveLength(0)
  })

  it('propagates invalid_token and tenant_suspended', async () => {
    expect((await get('/me', { authorization: 'Bearer nope' })).json().error.code).toBe('invalid_token')
    const suspended = await get('/me', { authorization: 'Bearer suspended-token' })
    expect(suspended.statusCode).toBe(403)
    expect(suspended.json().error.code).toBe('tenant_suspended')
  })

  it('forwards a tenant admin with resolved identity headers and no authorization', async () => {
    const res = await get('/me', { authorization: 'Bearer tenant-token' })
    expect(res.statusCode).toBe(200)
    const h = echo.calls[0]!.headers
    expect(h['x-admin-id']).toBe('admin-a')
    expect(h['x-helpix-role']).toBe('tenant_admin')
    expect(h['x-tenant-id']).toBe('tenant-a')
    expect(h.authorization).toBeUndefined()
  })

  it('overrides spoofed identity headers with the resolved ones', async () => {
    await get('/me', { authorization: 'Bearer tenant-token', 'x-tenant-id': 'tenant-b', 'x-helpix-role': 'super_admin' })
    const h = echo.calls[0]!.headers
    expect(h['x-tenant-id']).toBe('tenant-a')
    expect(h['x-helpix-role']).toBe('tenant_admin')
  })

  it('sends no tenant header for a super-admin even if the client sends one', async () => {
    await get('/admin/tenants', { authorization: 'Bearer super-token', 'x-tenant-id': 'tenant-b' })
    const h = echo.calls[0]!.headers
    expect(h['x-helpix-role']).toBe('super_admin')
    expect(h['x-tenant-id']).toBeUndefined()
  })

  it('caches successful resolutions', async () => {
    await get('/me', { authorization: 'Bearer tenant-token' })
    await get('/me', { authorization: 'Bearer tenant-token' })
    expect(tenantAuth.resolveAdmin).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures', async () => {
    await get('/me', { authorization: 'Bearer nope' })
    await get('/me', { authorization: 'Bearer nope' })
    expect(tenantAuth.resolveAdmin).toHaveBeenCalledTimes(2)
  })
})

describe('CORS', () => {
  it('answers a preflight from an allowed origin', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/admin/tenants',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(echo.calls).toHaveLength(0)
  })

  it('does not allow other origins', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/admin/tenants',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
```

Run: `npm test -w services/gateway`
Expected: FAIL — `../src/cache` and `../src/tenantAuthClient` not found.

- [ ] **Step 2: Implement cache and client**

`services/gateway/src/cache.ts`:
```ts
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V): void {
    this.entries.delete(key)
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }
}
```

`services/gateway/src/tenantAuthClient.ts`:
```ts
import { AppError, HEADERS } from '@helpix/shared'
import type { ResolvedAdmin } from '@helpix/shared/api-types'

export interface TenantAuthClient {
  resolveAdmin(accessToken: string, requestId: string): Promise<ResolvedAdmin>
}

export function createTenantAuthClient(baseUrl: string, internalToken: string): TenantAuthClient {
  async function post<T>(path: string, body: unknown, requestId: string): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [HEADERS.internalToken]: internalToken, [HEADERS.requestId]: requestId },
        body: JSON.stringify(body),
      })
    } catch {
      throw new AppError(502, 'upstream_unavailable', 'Auth service is unavailable')
    }
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    if (res.ok) return json as T
    if (res.status === 401 || res.status === 403) {
      throw new AppError(res.status, json?.error?.code ?? 'unauthorized', json?.error?.message ?? 'Unauthorized')
    }
    throw new AppError(502, 'upstream_error', 'Auth service returned an error')
  }

  return {
    resolveAdmin: (accessToken, requestId) => post<ResolvedAdmin>('/internal/resolve-admin', { accessToken }, requestId),
  }
}
```

- [ ] **Step 3: Replace `app.ts` with the full version**

`services/gateway/src/app.ts`:
```ts
import { randomUUID } from 'node:crypto'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { AppError, HEADERS, registerErrorHandler } from '@helpix/shared'
import type { ResolvedAdmin } from '@helpix/shared/api-types'
import { TtlCache } from './cache'
import type { GatewayConfig } from './config'
import { enforceBodyLimit, forward } from './forward'
import { createTenantAuthClient, type TenantAuthClient } from './tenantAuthClient'

export interface GatewayDeps {
  config: GatewayConfig
  logger?: boolean
  tenantAuth?: TenantAuthClient
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export async function buildGateway(deps: GatewayDeps): Promise<FastifyInstance> {
  const { config } = deps
  const tenantAuth = deps.tenantAuth ?? createTenantAuthClient(config.tenantAuthUrl, config.internalToken)
  const adminCache = new TtlCache<ResolvedAdmin>(config.resolveCacheTtlMs)

  const app = Fastify({ logger: deps.logger ?? false, genReqId: () => randomUUID() })

  // Bodies are streamed through untouched; size is enforced from Content-Length.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

  registerErrorHandler(app)
  app.addHook('onRequest', enforceBodyLimit(config.bodyLimitBytes))
  app.addHook('onSend', async (req, reply) => {
    reply.header(HEADERS.requestId, req.id)
  })
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: [...METHODS],
    allowedHeaders: ['content-type', 'authorization'],
    exposedHeaders: [HEADERS.requestId],
  })

  async function adminIdentity(req: FastifyRequest): Promise<Record<string, string>> {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    if (!match) throw new AppError(401, 'unauthorized', 'Missing bearer token')
    const token = match[1]!
    let identity = adminCache.get(token)
    if (!identity) {
      identity = await tenantAuth.resolveAdmin(token, req.id)
      adminCache.set(token, identity)
    }
    return {
      [HEADERS.adminId]: identity.adminId,
      [HEADERS.role]: identity.role,
      ...(identity.tenantId ? { [HEADERS.tenantId]: identity.tenantId } : {}),
    }
  }

  app.get('/health', async () => ({ ok: true }))

  app.route({
    method: [...METHODS],
    url: '/auth/*',
    handler: (req, reply) => forward(req, reply, { target: config.tenantAuthUrl, internalToken: config.internalToken }),
  })

  for (const url of ['/me', '/admin/*']) {
    app.route({
      method: [...METHODS],
      url,
      handler: async (req, reply) =>
        forward(req, reply, {
          target: config.tenantAuthUrl,
          internalToken: config.internalToken,
          identity: await adminIdentity(req),
        }),
    })
  }

  return app
}
```

`services/gateway/src/server.ts`:
```ts
import { buildGateway } from './app'
import { loadConfig } from './config'

const config = loadConfig()
const app = await buildGateway({ config, logger: true })
await app.listen({ port: config.port, host: '0.0.0.0' })
```

- [ ] **Step 4: Run the gateway tests**

Run: `npm test -w services/gateway && npm run typecheck -w services/gateway`
Expected: all PASS (including the Task 5 tests, which still build the gateway without `tenantAuth`).

- [ ] **Step 5: Add the Dockerfile and Compose services**

`docker/node-service.Dockerfile`:
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci
ENV NODE_ENV=production
CMD ["sh", "-c", "npm run start -w services/${SERVICE}"]
```

Add to `docker-compose.yml` under `services:` (keep `postgres` and `volumes` as they are):
```yaml
  tenant-auth:
    build:
      context: .
      dockerfile: docker/node-service.Dockerfile
    env_file: .env
    environment:
      SERVICE: tenant-auth
      PORT: "4001"
      DATABASE_URL: postgres://helpix:helpix@postgres:5432/helpix
    depends_on:
      postgres:
        condition: service_healthy

  gateway:
    build:
      context: .
      dockerfile: docker/node-service.Dockerfile
    env_file: .env
    environment:
      SERVICE: gateway
      PORT: "4000"
      TENANT_AUTH_URL: http://tenant-auth:4001
    ports:
      - "4000:4000"
    depends_on:
      - tenant-auth
```
`tenant-auth` publishes no host port: only the gateway can reach it.

- [ ] **Step 6: Verify the stack end to end**

Run:
```bash
docker compose up -d --build
docker compose logs tenant-auth | grep -E "migrations|super-admin"
curl -s http://localhost:4000/health
curl -s -X POST http://localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@helpix.local","password":"change-me-please"}' | head -c 200; echo
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/admin/tenants
```
Expected: logs show the migration and `super-admin created`; `{"ok":true}`; a JSON body starting with `{"accessToken":`; `401`.

- [ ] **Step 7: Commit**

```bash
git add services/gateway docker docker-compose.yml package-lock.json
git commit -m "feat(gateway): admin token resolution with cache, CORS, docker compose wiring"
```

---

### Task 7: `packages/ui` — shared Tailwind components

A small in-house component set styled with Tailwind v4 and CSS-variable theme tokens. No component library: dialogs use the native `<dialog>` element (focus handling, Escape and backdrop come from the browser, and it works inside the widget's Shadow DOM in step 4). Consumers import everything from the package root.

**Files:**
- Create: `packages/ui/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/ui/src/index.ts`, `packages/ui/src/lib/utils.ts`, `packages/ui/src/styles/globals.css`
- Create: `packages/ui/src/components/{Button,Input,Textarea,Label,Badge,Dialog,DialogContent,HelpixLogo}.vue`
- Create: `packages/ui/src/components/primitives.ts`, `packages/ui/src/components/dialogContext.ts`
- Test: `packages/ui/test/components.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all from `@helpix/ui`; styles from `@helpix/ui/styles.css`):
  - `cn(...inputs: ClassValue[]): string`
  - `Button` — props `variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost'`, `size?: 'default' | 'sm' | 'lg'`, `type?: 'button' | 'submit' | 'reset'` (default `'button'`); other attributes (`disabled`, `form`, listeners) fall through
  - `Input`, `Textarea` — `v-model` (string); attributes fall through
  - `Label` — attributes (`for`) fall through
  - `Badge` — prop `variant?: 'default' | 'secondary' | 'outline' | 'destructive'`
  - `Dialog` — `v-model:open` (boolean); `DialogContent` renders a native modal `<dialog>` while open and sets `open` to false on Escape or backdrop click
  - Slot-only styled elements: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`
  - `HelpixLogo` — the brand lockup (mark + lowercase `helpix` wordmark), or the square mark with `markOnly`; size it with a text-size class (lockup) or `size-*` (mark)
  - Brand tokens as Tailwind colours: `brand` (Mint 600), `brand-bright`; fonts `font-sans`, `font-display`, `font-mono`
  - All components accept a `class` prop merged with `cn`

- [ ] **Step 1: Create the package files and install dependencies**

`packages/ui/package.json`:
```json
{
  "name": "@helpix/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles/globals.css"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve"
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "test/**/*.ts"]
}
```

`packages/ui/vitest.config.ts`:
```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom' },
})
```

Run:
```bash
npm install vue clsx tailwind-merge tailwindcss -w packages/ui
npm install -D @vitejs/plugin-vue vue-tsc @vue/test-utils jsdom -w packages/ui
```

- [ ] **Step 2: Write the failing tests**

`packages/ui/test/components.test.ts`:
```ts
import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { Badge, Button, Card, cn, Dialog, DialogContent, HelpixLogo, Input } from '../src/index'

// jsdom does not implement modal dialogs; emulate the parts we rely on.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

describe('cn', () => {
  it('merges conflicting Tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})

describe('Button', () => {
  it('defaults to type=button so it never submits a form by accident', () => {
    expect(mount(Button, { slots: { default: 'Go' } }).attributes('type')).toBe('button')
  })

  it('applies variant and size classes and lets a class prop override', () => {
    const w = mount(Button, { props: { variant: 'destructive', size: 'sm', class: 'px-8' }, slots: { default: 'Delete' } })
    expect(w.text()).toBe('Delete')
    expect(w.classes()).toContain('bg-destructive')
    expect(w.classes()).toContain('px-8')
    expect(w.classes()).not.toContain('px-3')
  })

  it('passes through disabled and form attributes', () => {
    const w = mount(Button, { attrs: { disabled: true, form: 'f1' }, props: { type: 'submit' } })
    expect(w.attributes('disabled')).toBeDefined()
    expect(w.attributes('form')).toBe('f1')
    expect(w.attributes('type')).toBe('submit')
  })
})

describe('Input', () => {
  it('supports v-model', async () => {
    const w = mount(Input, { props: { modelValue: 'a', 'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }) } })
    await w.find('input').setValue('hello')
    expect(w.props('modelValue')).toBe('hello')
  })
})

describe('Badge and slot primitives', () => {
  it('Badge applies its variant', () => {
    expect(mount(Badge, { props: { variant: 'secondary' } }).classes()).toContain('bg-secondary')
  })

  it('Card renders its slot and merges class and attributes', () => {
    const w = mount(Card, { props: { class: 'p-8' }, attrs: { 'data-x': '1' }, slots: { default: 'Body' } })
    expect(w.text()).toBe('Body')
    expect(w.classes()).toContain('p-8')
    expect(w.attributes('data-x')).toBe('1')
  })
})

describe('HelpixLogo', () => {
  it('renders the lockup with a lowercase wordmark and an accessible name', () => {
    const w = mount(HelpixLogo)
    expect(w.attributes('aria-label')).toBe('helpix')
    expect(w.text()).toBe('helpix')
    expect(w.find('svg rect').exists()).toBe(true)
  })

  it('renders only the square mark with markOnly', () => {
    const w = mount(HelpixLogo, { props: { markOnly: true } })
    expect(w.element.tagName.toLowerCase()).toBe('svg')
    expect(w.attributes('viewBox')).toBe('0 0 100 100')
    expect(w.text()).toBe('')
  })
})

describe('Dialog', () => {
  const Harness = defineComponent({
    components: { Dialog, DialogContent },
    setup() {
      return { open: ref(false) }
    },
    template: `<Dialog v-model:open="open"><DialogContent><p class="inside">Hi</p></DialogContent></Dialog>`,
  })

  it('renders content only while open and opens as a modal', async () => {
    const w = mount(Harness, { attachTo: document.body })
    expect(w.find('.inside').exists()).toBe(false)
    ;(w.vm as unknown as { open: boolean }).open = true
    await nextTick()
    await nextTick()
    expect(w.find('dialog').attributes('open')).toBeDefined()
    expect(w.find('.inside').exists()).toBe(true)
    w.unmount()
  })

  it('sets open to false when the dialog closes (Escape) or the backdrop is clicked', async () => {
    const w = mount(Harness, { attachTo: document.body })
    const vm = w.vm as unknown as { open: boolean }
    vm.open = true
    await nextTick()
    w.find('dialog').element.dispatchEvent(new Event('close'))
    await nextTick()
    expect(vm.open).toBe(false)

    vm.open = true
    await nextTick()
    await w.find('dialog').trigger('click')
    expect(vm.open).toBe(false)
    w.unmount()
  })

  it('does not close when clicking inside the content', async () => {
    const w = mount(Harness, { attachTo: document.body })
    const vm = w.vm as unknown as { open: boolean }
    vm.open = true
    await nextTick()
    await nextTick()
    await w.find('.inside').trigger('click')
    expect(vm.open).toBe(true)
    w.unmount()
  })
})
```

The `Harness` uses a runtime template, so add the full Vue build alias for tests. Update `packages/ui/vitest.config.ts`:
```ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { vue: 'vue/dist/vue.esm-bundler.js' } },
  test: { environment: 'jsdom' },
})
```

Run: `npm test -w packages/ui`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 3: Implement the styles and helpers**

`packages/ui/src/lib/utils.ts`:
```ts
import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

`packages/ui/src/styles/globals.css` (Helpix brand tokens from `brand/brand-sheet.html`; tenants and demo shops override the variables). `--primary` is Mint 700, not Mint 600, because primary buttons carry small white labels and Mint 600 fails AA for them; `--brand` is Mint 600 for the logo and the launcher:
```css
@import "tailwindcss";

/* Consumers import this file, so the UI package's own templates are scanned for classes. */
@source "..";

@custom-variant dark (&:is(.dark *));

:root {
  --background: #F4F7F6;
  --foreground: #101A18;
  --card: #FFFFFF;
  --card-foreground: #101A18;
  --primary: #08705F;
  --primary-foreground: #FFFFFF;
  --brand: #0C9A82;
  --brand-bright: #3FD1B5;
  --secondary: #E3F4EF;
  --secondary-foreground: #101A18;
  --muted: #EAF0EE;
  --muted-foreground: #56645F;
  --accent: #E3F4EF;
  --accent-foreground: #101A18;
  --destructive: #C2413A;
  --border: #DCE3E0;
  --input: #DCE3E0;
  --ring: #0C9A82;
  --radius: 0.75rem;
}

.dark {
  --background: #0B100F;
  --foreground: #E9F0EE;
  --card: #131A19;
  --card-foreground: #E9F0EE;
  --primary: #2FC3A7;
  --primary-foreground: #0F1716;
  --brand: #3FD1B5;
  --brand-bright: #3FD1B5;
  --secondary: #11302A;
  --secondary-foreground: #E9F0EE;
  --muted: #1A2322;
  --muted-foreground: #97A6A1;
  --accent: #11302A;
  --accent-foreground: #E9F0EE;
  --destructive: #F0776F;
  --border: #25302D;
  --input: #25302D;
  --ring: #2FC3A7;
}

@theme inline {
  --font-sans: "Instrument Sans", "Helvetica Neue", system-ui, sans-serif;
  --font-display: "Bricolage Grotesque", "Avenir Next", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-brand: var(--brand);
  --color-brand-bright: var(--brand-bright);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background font-sans text-foreground;
  }
  h1, h2 {
    @apply font-display tracking-tight;
  }
}
```

The fonts themselves are loaded by each app (the dashboard's `index.html` in Task 8), not by this package.

`packages/ui/src/components/HelpixLogo.vue` (paths copied verbatim from `brand/logo/refined/h-pixel-mint.svg`; the lockup crops the mark's viewBox to its ink so it can sit on the wordmark's baseline at 74% of the font size, per the brand sheet):
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

// markOnly: square mark, e.g. where the name already appears nearby.
const props = defineProps<{ markOnly?: boolean; class?: ClassValue }>()
</script>

<template>
  <svg
    v-if="props.markOnly"
    viewBox="0 0 100 100"
    role="img"
    aria-label="helpix"
    :class="cn('size-8 text-brand', props.class)"
  >
    <g transform="translate(1.5 0)">
      <g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round">
        <path d="M31 21 V79" />
        <path d="M31 70 V58 C31 46.5 39 39.5 48.5 39.5 C58 39.5 66 46.5 66 58 V79" />
      </g>
      <rect x="59.75" y="14" width="12.5" height="12.5" rx="3.4" fill="currentColor" />
    </g>
  </svg>
  <span
    v-else
    role="img"
    aria-label="helpix"
    :class="cn('inline-flex items-baseline gap-[0.1em] text-2xl text-brand', props.class)"
  >
    <svg viewBox="26.5 14 47.25 71" aria-hidden="true" class="h-[0.74em] w-auto flex-none">
      <g transform="translate(1.5 0)">
        <g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round">
          <path d="M31 21 V79" />
          <path d="M31 70 V58 C31 46.5 39 39.5 48.5 39.5 C58 39.5 66 46.5 66 58 V79" />
        </g>
        <rect x="59.75" y="14" width="12.5" height="12.5" rx="3.4" fill="currentColor" />
      </g>
    </svg>
    <span aria-hidden="true" class="font-display font-bold leading-none tracking-[-0.04em] text-foreground">helpix</span>
  </span>
</template>
```

`packages/ui/src/components/primitives.ts`:
```ts
import type { ClassValue } from 'clsx'
import { defineComponent, h, type PropType } from 'vue'
import { cn } from '../lib/utils'

/** A slot-only element with base Tailwind classes; a `class` prop is merged in with `cn`. */
function styled(name: string, tag: string, base: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { class: { type: [String, Array, Object] as PropType<ClassValue>, default: undefined } },
    setup(props, { slots, attrs }) {
      return () => h(tag, { ...attrs, class: cn(base, props.class) }, slots.default?.())
    },
  })
}

export const Card = styled('Card', 'div', 'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm')
export const CardHeader = styled('CardHeader', 'div', 'grid gap-1.5 px-6')
export const CardTitle = styled('CardTitle', 'h3', 'font-semibold leading-none')
export const CardDescription = styled('CardDescription', 'p', 'text-sm text-muted-foreground')
export const CardContent = styled('CardContent', 'div', 'px-6')
export const CardFooter = styled('CardFooter', 'div', 'flex items-center px-6')

export const Table = styled('Table', 'table', 'w-full caption-bottom text-sm')
export const TableHeader = styled('TableHeader', 'thead', '[&_tr]:border-b')
export const TableBody = styled('TableBody', 'tbody', '[&_tr:last-child]:border-0')
export const TableRow = styled('TableRow', 'tr', 'border-b transition-colors hover:bg-muted/50')
export const TableHead = styled('TableHead', 'th', 'h-10 px-2 text-left align-middle font-medium text-muted-foreground')
export const TableCell = styled('TableCell', 'td', 'p-2 align-middle')

export const DialogHeader = styled('DialogHeader', 'div', 'grid gap-2')
export const DialogTitle = styled('DialogTitle', 'h2', 'text-lg font-semibold leading-none')
export const DialogDescription = styled('DialogDescription', 'p', 'text-sm text-muted-foreground')
export const DialogFooter = styled('DialogFooter', 'div', 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end')
```

`packages/ui/src/components/dialogContext.ts`:
```ts
import type { InjectionKey, Ref } from 'vue'

export const DIALOG_OPEN: InjectionKey<Ref<boolean>> = Symbol('HelpixDialogOpen')
```

- [ ] **Step 4: Implement the SFC components**

`packages/ui/src/components/Button.vue`:
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { computed } from 'vue'
import { cn } from '../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost'
type Size = 'default' | 'sm' | 'lg'

const props = withDefaults(
  defineProps<{ variant?: Variant; size?: Size; type?: 'button' | 'submit' | 'reset'; class?: ClassValue }>(),
  { variant: 'default', size: 'default', type: 'button' },
)

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
}
const SIZES: Record<Size, string> = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-6',
}

const classes = computed(() =>
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[props.variant],
    SIZES[props.size],
    props.class,
  ),
)
</script>

<template>
  <button :type="type" :class="classes"><slot /></button>
</template>
```

`packages/ui/src/components/Input.vue`:
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

const props = defineProps<{ class?: ClassValue }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    v-model="model"
    :class="cn(
      'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  />
</template>
```

`packages/ui/src/components/Textarea.vue`:
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

const props = defineProps<{ class?: ClassValue }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <textarea
    v-model="model"
    :class="cn(
      'flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  />
</template>
```

`packages/ui/src/components/Label.vue`:
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

const props = defineProps<{ class?: ClassValue }>()
</script>

<template>
  <label :class="cn('text-sm font-medium leading-none', props.class)"><slot /></label>
</template>
```

`packages/ui/src/components/Badge.vue`:
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { cn } from '../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive'
const props = withDefaults(defineProps<{ variant?: Variant; class?: ClassValue }>(), { variant: 'default' })

const VARIANTS: Record<Variant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-destructive text-white',
}
</script>

<template>
  <span :class="cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', VARIANTS[props.variant], props.class)">
    <slot />
  </span>
</template>
```

`packages/ui/src/components/Dialog.vue`:
```vue
<script setup lang="ts">
import { provide } from 'vue'
import { DIALOG_OPEN } from './dialogContext'

const open = defineModel<boolean>('open', { default: false })
provide(DIALOG_OPEN, open)
</script>

<template>
  <slot />
</template>
```

`packages/ui/src/components/DialogContent.vue`:
```vue
<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { inject, onMounted, ref, watch } from 'vue'
import { cn } from '../lib/utils'
import { DIALOG_OPEN } from './dialogContext'

const props = defineProps<{ class?: ClassValue }>()
const open = inject(DIALOG_OPEN)
if (!open) throw new Error('DialogContent must be used inside Dialog')

const el = ref<HTMLDialogElement | null>(null)

function sync(value: boolean) {
  const dialog = el.value
  if (!dialog) return
  if (value && !dialog.open) dialog.showModal()
  else if (!value && dialog.open) dialog.close()
}

onMounted(() => sync(open.value))
watch(open, sync, { flush: 'post' })

// Fires on Escape and on programmatic close.
function onClose() {
  open!.value = false
}

// The content wrapper fills the dialog box, so a click whose target is the <dialog> itself hit the backdrop.
function onClick(event: MouseEvent) {
  if (event.target === el.value) open!.value = false
}
</script>

<template>
  <dialog
    ref="el"
    class="m-auto w-full max-w-lg rounded-lg border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
    @close="onClose"
    @click="onClick"
  >
    <div v-if="open" :class="cn('grid gap-4 p-6', props.class)">
      <slot />
    </div>
  </dialog>
</template>
```

`packages/ui/src/index.ts`:
```ts
export { cn } from './lib/utils'
export { default as Button } from './components/Button.vue'
export { default as Input } from './components/Input.vue'
export { default as Textarea } from './components/Textarea.vue'
export { default as Label } from './components/Label.vue'
export { default as Badge } from './components/Badge.vue'
export { default as Dialog } from './components/Dialog.vue'
export { default as DialogContent } from './components/DialogContent.vue'
export { default as HelpixLogo } from './components/HelpixLogo.vue'
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/primitives'
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -w packages/ui && npm run typecheck -w packages/ui`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui package-lock.json
git commit -m "feat(ui): shared Tailwind component package with native-dialog modals"
```

---

### Task 8: admin dashboard — scaffold, API client, session, guard, login

The dashboard must build with components and styles imported from `@helpix/ui`; Step 5 checks that Tailwind picks up the package's classes.

**Files:**
- Create: `apps/admin-dashboard/{package.json,index.html,vite.config.ts,tsconfig.json}`
- Create (copied from `brand/logo/png/`): `apps/admin-dashboard/public/{favicon-32.png,favicon-16.png,apple-touch-icon.png}`
- Create: `apps/admin-dashboard/src/{main.ts,App.vue,styles.css,env.d.ts,router.ts}`
- Create: `apps/admin-dashboard/src/api/client.ts`, `src/auth/session.ts`, `src/auth/guard.ts`
- Create: `apps/admin-dashboard/src/layouts/AppLayout.vue`, `src/pages/LoginPage.vue`, `src/pages/TenantsPage.vue`, `src/pages/TenantHomePage.vue`
- Test: `apps/admin-dashboard/test/client.test.ts`, `apps/admin-dashboard/test/guard.test.ts`

**Interfaces:**
- Consumes: gateway routes `/auth/login`, `/auth/refresh`, `/auth/logout`, `/me`, `/admin/tenants` (Tasks 2, 3, 6); `@helpix/shared/api-types`; `@helpix/ui` components (Task 7).
- Produces:
  - `class ApiError extends Error { status: number; code: string; requestId?: string }`
  - `interface Tokens { accessToken: string; refreshToken: string }`, `interface TokenStore { get(): Tokens | null; set(t: Tokens | null): void }`
  - `createApiClient(opts: { baseUrl: string; tokens: TokenStore; fetch?: typeof fetch; onSessionExpired?: () => void })` → `{ request<T>(method, path, body?), get<T>(path), post<T>(path, body?), patch<T>(path, body) }`
  - `src/auth/session.ts`: `api`, `tokenStore`, `session` with `state.me: MeResponse | null`, `login(email, password): Promise<MeResponse>`, `loadMe(): Promise<MeResponse>`, `logout(): Promise<void>`
  - `src/auth/guard.ts`: `homeFor(me: MeResponse): string`, `guard(meta: { public?: boolean; role?: Role }, me: MeResponse | null, hasTokens: boolean): true | string`

- [ ] **Step 1: Create the app files and install dependencies**

`apps/admin-dashboard/package.json`:
```json
{
  "name": "@helpix/admin-dashboard",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  }
}
```

Run:
```bash
npm install vue vue-router @helpix/ui@* @helpix/shared@* -w apps/admin-dashboard
npm install -D vite @vitejs/plugin-vue @tailwindcss/vite tailwindcss vue-tsc @vue/test-utils jsdom -w apps/admin-dashboard
```

`apps/admin-dashboard/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>helpix admin</title>
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`apps/admin-dashboard/vite.config.ts`:
```ts
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  test: { environment: 'jsdom' },
})
```

`apps/admin-dashboard/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "test/**/*.ts"]
}
```

Copy the brand icons (use the supplied files as they are):
```bash
mkdir -p apps/admin-dashboard/public
cp brand/logo/png/h-pixel-app-icon-32.png apps/admin-dashboard/public/favicon-32.png
cp brand/logo/png/h-pixel-app-icon-16.png apps/admin-dashboard/public/favicon-16.png
cp brand/logo/png/h-pixel-app-icon-180.png apps/admin-dashboard/public/apple-touch-icon.png
```

`apps/admin-dashboard/src/env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}
```

`apps/admin-dashboard/src/styles.css`:
```css
@import "@helpix/ui/styles.css";
```

- [ ] **Step 2: Write the failing client and guard tests**

`apps/admin-dashboard/test/client.test.ts`:
```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, type Tokens, type TokenStore } from '../src/api/client'

function memoryStore(initial: Tokens | null): TokenStore & { value: Tokens | null } {
  const store = {
    value: initial,
    get: () => store.value,
    set: (t: Tokens | null) => { store.value = t },
  }
  return store
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Protected routes accept only 'new-access'; refresh accepts only 'r1'. */
function fakeBackend(opts: { refreshOk?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.endsWith('/auth/refresh')) {
      await new Promise((r) => setTimeout(r, 5))
      return opts.refreshOk === false
        ? json(401, { error: { code: 'invalid_refresh_token', message: 'Session expired', requestId: 'r' } })
        : json(200, { accessToken: 'new-access', refreshToken: 'r2', admin: {} })
    }
    const auth = new Headers(init.headers).get('authorization')
    if (auth !== 'Bearer new-access') return json(401, { error: { code: 'invalid_token', message: 'Expired', requestId: 'r' } })
    if (u.endsWith('/empty')) return new Response(null, { status: 204 })
    if (u.endsWith('/conflict')) return json(409, { error: { code: 'slug_taken', message: 'Slug taken', requestId: 'req-9' } })
    return json(200, { path: u })
  })
  return { fetch, calls }
}

describe('createApiClient', () => {
  it('sends the bearer token, JSON body and content-type only when there is a body', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    await api.get('/me')
    await api.post('/admin/tenants', { name: 'x' })
    await api.post('/admin/tenants/1/suspend')
    const [get, post, bare] = calls.map((c) => new Headers(c.init.headers))
    expect(get!.get('authorization')).toBe('Bearer new-access')
    expect(get!.get('content-type')).toBeNull()
    expect(post!.get('content-type')).toBe('application/json')
    expect(calls[1]!.init.body).toBe(JSON.stringify({ name: 'x' }))
    expect(bare!.get('content-type')).toBeNull()
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    const { fetch, calls } = fakeBackend()
    const tokens = memoryStore({ accessToken: 'old-access', refreshToken: 'r1' })
    const api = createApiClient({ baseUrl: 'http://gw', tokens, fetch })
    expect(await api.get('/me')).toEqual({ path: 'http://gw/me' })
    expect(tokens.value).toEqual({ accessToken: 'new-access', refreshToken: 'r2' })
    expect(calls.map((c) => c.url)).toEqual(['http://gw/me', 'http://gw/auth/refresh', 'http://gw/me'])
  })

  it('shares one refresh between concurrent 401s', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'old-access', refreshToken: 'r1' }), fetch })
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    expect(results).toHaveLength(3)
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1)
  })

  it('clears the session and reports expiry when refresh fails', async () => {
    const { fetch } = fakeBackend({ refreshOk: false })
    const tokens = memoryStore({ accessToken: 'old-access', refreshToken: 'r1' })
    const onSessionExpired = vi.fn()
    const api = createApiClient({ baseUrl: 'http://gw', tokens, fetch, onSessionExpired })
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(tokens.value).toBeNull()
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('does not try to refresh when there is no session (e.g. a failed login)', async () => {
    const { fetch, calls } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore(null), fetch })
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError)
    expect(calls).toHaveLength(1)
  })

  it('maps error bodies to ApiError and 204 to undefined', async () => {
    const { fetch } = fakeBackend()
    const api = createApiClient({ baseUrl: 'http://gw', tokens: memoryStore({ accessToken: 'new-access', refreshToken: 'r1' }), fetch })
    await expect(api.get('/conflict')).rejects.toMatchObject({ status: 409, code: 'slug_taken', message: 'Slug taken', requestId: 'req-9' })
    expect(await api.get('/empty')).toBeUndefined()
  })
})
```

`apps/admin-dashboard/test/guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { MeResponse } from '@helpix/shared/api-types'
import { guard, homeFor } from '../src/auth/guard'

const superMe: MeResponse = {
  admin: { id: 'a0', tenantId: null, email: 'root@helpix.test', role: 'super_admin', createdAt: '' },
  tenant: null,
}
const tenantMe: MeResponse = {
  admin: { id: 'a1', tenantId: 't1', email: 'o@shop.test', role: 'tenant_admin', createdAt: '' },
  tenant: null,
}

describe('guard', () => {
  it('sends logged-out users to /login', () => {
    expect(guard({ role: 'super_admin' }, null, false)).toBe('/login')
    expect(guard({}, null, false)).toBe('/login')
  })

  it('lets logged-out users see public pages', () => {
    expect(guard({ public: true }, null, false)).toBe(true)
  })

  it('sends logged-in users away from public pages to their home', () => {
    expect(guard({ public: true }, superMe, true)).toBe('/tenants')
    expect(guard({ public: true }, tenantMe, true)).toBe('/home')
  })

  it('redirects a role mismatch to the user\'s home', () => {
    expect(guard({ role: 'super_admin' }, tenantMe, true)).toBe('/home')
    expect(guard({ role: 'tenant_admin' }, superMe, true)).toBe('/tenants')
  })

  it('allows a matching role', () => {
    expect(guard({ role: 'super_admin' }, superMe, true)).toBe(true)
  })

  it('treats tokens without a loaded profile as logged out', () => {
    expect(guard({ role: 'super_admin' }, null, true)).toBe('/login')
  })

  it('homeFor maps roles', () => {
    expect(homeFor(superMe)).toBe('/tenants')
    expect(homeFor(tenantMe)).toBe('/home')
  })
})
```

Run: `npm test -w apps/admin-dashboard`
Expected: FAIL — `../src/api/client` and `../src/auth/guard` not found.

- [ ] **Step 3: Implement the client and guard**

`apps/admin-dashboard/src/api/client.ts`:
```ts
export interface Tokens {
  accessToken: string
  refreshToken: string
}

export interface TokenStore {
  get(): Tokens | null
  set(tokens: Tokens | null): void
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  tokens: TokenStore
  fetch?: typeof fetch
  onSessionExpired?: () => void
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  let refreshing: Promise<boolean> | null = null

  function send(method: Method, path: string, body: unknown, accessToken?: string): Promise<Response> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    return doFetch(`${opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  function refreshOnce(): Promise<boolean> {
    refreshing ??= (async () => {
      const current = opts.tokens.get()
      if (!current) return false
      const res = await send('POST', '/auth/refresh', { refreshToken: current.refreshToken })
      if (!res.ok) {
        opts.tokens.set(null)
        opts.onSessionExpired?.()
        return false
      }
      const s = (await res.json()) as Tokens
      opts.tokens.set({ accessToken: s.accessToken, refreshToken: s.refreshToken })
      return true
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    let res = await send(method, path, body, opts.tokens.get()?.accessToken)
    if (res.status === 401 && opts.tokens.get()) {
      if (await refreshOnce()) res = await send(method, path, body, opts.tokens.get()?.accessToken)
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; requestId?: string } } | null
      throw new ApiError(res.status, err?.error?.code ?? 'http_error', err?.error?.message ?? res.statusText, err?.error?.requestId)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  return {
    request,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
```

`apps/admin-dashboard/src/auth/guard.ts`:
```ts
import type { MeResponse, Role } from '@helpix/shared/api-types'

export function homeFor(me: MeResponse): string {
  return me.admin.role === 'super_admin' ? '/tenants' : '/home'
}

/** Returns true to allow navigation, or a path to redirect to. */
export function guard(meta: { public?: boolean; role?: Role }, me: MeResponse | null, hasTokens: boolean): true | string {
  const loggedIn = hasTokens && me !== null
  if (meta.public) return loggedIn ? homeFor(me!) : true
  if (!loggedIn) return '/login'
  if (meta.role && meta.role !== me!.admin.role) return homeFor(me!)
  return true
}
```

Run: `npm test -w apps/admin-dashboard`
Expected: PASS.

- [ ] **Step 4: Implement the session, router, layout and pages**

`apps/admin-dashboard/src/auth/session.ts`:
```ts
import { reactive, readonly } from 'vue'
import type { MeResponse, SessionResponse } from '@helpix/shared/api-types'
import { createApiClient, type Tokens, type TokenStore } from '@/api/client'

// Demo trade-off: tokens live in localStorage. Revisit (httpOnly cookie) before production.
const STORAGE_KEY = 'helpix.session'

export const tokenStore: TokenStore = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Tokens | null
    } catch {
      return null
    }
  },
  set(tokens) {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
    else localStorage.removeItem(STORAGE_KEY)
  },
}

const state = reactive<{ me: MeResponse | null }>({ me: null })

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  tokens: tokenStore,
  onSessionExpired: () => {
    state.me = null
  },
})

export const session = {
  state: readonly(state),

  async login(email: string, password: string): Promise<MeResponse> {
    const s = await api.post<SessionResponse>('/auth/login', { email, password })
    tokenStore.set({ accessToken: s.accessToken, refreshToken: s.refreshToken })
    return session.loadMe()
  },

  async loadMe(): Promise<MeResponse> {
    const me = await api.get<MeResponse>('/me')
    state.me = me
    return me
  },

  async logout(): Promise<void> {
    const tokens = tokenStore.get()
    tokenStore.set(null)
    state.me = null
    if (tokens) await api.post('/auth/logout', { refreshToken: tokens.refreshToken }).catch(() => {})
  },
}
```

`apps/admin-dashboard/src/router.ts`:
```ts
import { createRouter, createWebHistory } from 'vue-router'
import type { MeResponse, Role } from '@helpix/shared/api-types'
import { guard } from '@/auth/guard'
import { session, tokenStore } from '@/auth/session'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    role?: Role
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/pages/LoginPage.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        { path: '', redirect: '/login' },
        { path: 'tenants', component: () => import('@/pages/TenantsPage.vue'), meta: { role: 'super_admin' } },
        { path: 'home', component: () => import('@/pages/TenantHomePage.vue'), meta: { role: 'tenant_admin' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/login' },
  ],
})

router.beforeEach(async (to) => {
  if (tokenStore.get() && !session.state.me) {
    try {
      await session.loadMe()
    } catch {
      tokenStore.set(null)
    }
  }
  return guard({ public: to.meta.public, role: to.meta.role }, session.state.me as MeResponse | null, tokenStore.get() !== null)
})
```

`apps/admin-dashboard/src/main.ts`:
```ts
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles.css'

createApp(App).use(router).mount('#app')
```

`apps/admin-dashboard/src/App.vue`:
```vue
<template>
  <RouterView />
</template>
```

`apps/admin-dashboard/src/layouts/AppLayout.vue`:
```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button, HelpixLogo } from '@helpix/ui'
import { session } from '@/auth/session'

const router = useRouter()

async function logout() {
  await session.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-muted/40">
    <header class="border-b bg-background">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <RouterLink to="/" aria-label="helpix home"><HelpixLogo class="text-xl" /></RouterLink>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-muted-foreground">{{ session.state.me?.admin.email }}</span>
          <Button variant="outline" size="sm" @click="logout">Log out</Button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-8">
      <RouterView />
    </main>
  </div>
</template>
```

`apps/admin-dashboard/src/pages/LoginPage.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, HelpixLogo, Input, Label } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { homeFor } from '@/auth/guard'
import { session } from '@/auth/session'

const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  error.value = null
  busy.value = true
  try {
    const me = await session.login(email.value, password.value)
    await router.push(homeFor(me))
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Could not reach the server'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-muted/40 px-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <HelpixLogo class="mb-2 text-3xl" />
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Manage your shop's support agent.</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit.prevent="submit">
          <div class="grid gap-2">
            <Label for="email">Email</Label>
            <Input id="email" v-model="email" type="email" autocomplete="username" required />
          </div>
          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
          </div>
          <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
          <Button type="submit" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
```

`apps/admin-dashboard/src/pages/TenantsPage.vue` (read-only list; Task 9 adds creation):
```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { TenantView } from '@helpix/shared/api-types'
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'

const tenants = ref<TenantView[]>([])
const loadError = ref<string | null>(null)

onMounted(async () => {
  try {
    tenants.value = (await api.get<{ tenants: TenantView[] }>('/admin/tenants')).tenants
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : 'Could not load tenants'
  }
})
</script>

<template>
  <div class="grid gap-6">
    <h1 class="text-2xl font-semibold">Tenants</h1>
    <p v-if="loadError" class="text-sm text-destructive">{{ loadError }}</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Slug</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="t in tenants" :key="t.id">
          <TableCell class="font-medium">{{ t.name }}</TableCell>
          <TableCell class="text-muted-foreground">{{ t.slug }}</TableCell>
          <TableCell>
            <Badge :variant="t.status === 'active' ? 'secondary' : 'destructive'">{{ t.status }}</Badge>
          </TableCell>
          <TableCell>{{ new Date(t.createdAt).toLocaleDateString() }}</TableCell>
        </TableRow>
        <TableRow v-if="tenants.length === 0 && !loadError">
          <TableCell colspan="4" class="text-center text-muted-foreground">No tenants yet.</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
```

`apps/admin-dashboard/src/pages/TenantHomePage.vue`:
```vue
<script setup lang="ts">
import { Card, CardDescription, CardHeader, CardTitle } from '@helpix/ui'
import { session } from '@/auth/session'
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Welcome, {{ session.state.me?.tenant?.name }}</CardTitle>
      <CardDescription>Knowledge base, agent settings and conversations will appear here in the next milestones.</CardDescription>
    </CardHeader>
  </Card>
</template>
```

- [ ] **Step 5: Test, typecheck and build**

Run:
```bash
npm test -w apps/admin-dashboard
npm run typecheck -w apps/admin-dashboard
npm run build -w apps/admin-dashboard
grep -l "bg-primary" apps/admin-dashboard/dist/assets/*.css
```
Expected: tests PASS; no type errors; build succeeds; the `grep` prints a CSS file. `bg-primary` is used only inside the shared `Button`, so its presence proves Tailwind scanned `packages/ui` through `@source`.

If the `grep` finds nothing, add this line to `apps/admin-dashboard/src/styles.css` below the import, rebuild and re-check:
```css
@source "../../../packages/ui/src";
```

If the build fails to resolve `@helpix/ui/styles.css` itself, replace the import with the relative path and note it in the commit message:
```css
@import "../../../packages/ui/src/styles/globals.css";
```

- [ ] **Step 6: Manual check**

With `docker compose up -d` running, run `npm run dev -w apps/admin-dashboard`, open http://localhost:5173, and log in as `admin@helpix.local` / `change-me-please`.
Expected: the login card shows the helpix lockup (mint mark, lowercase wordmark in Bricolage Grotesque) and the tab shows the app-icon favicon; login redirects to `/tenants` showing the empty table with the lockup in the header; a wrong password shows "Invalid email or password"; **Log out** returns to `/login`; visiting `/tenants` while logged out redirects to `/login`.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-dashboard package-lock.json
git commit -m "feat(dashboard): scaffold with shared UI, API client with token refresh, login and route guard"
```

---

### Task 9: admin dashboard — tenant creation and tenant detail

**Files:**
- Create: `apps/admin-dashboard/src/lib/slugify.ts`, `apps/admin-dashboard/src/lib/origins.ts`, `apps/admin-dashboard/src/components/ConfirmDialog.vue`, `apps/admin-dashboard/src/pages/TenantDetailPage.vue`
- Modify: `apps/admin-dashboard/src/pages/TenantsPage.vue` (full replacement below), `apps/admin-dashboard/src/router.ts` (add the detail route)
- Test: `apps/admin-dashboard/test/lib.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 8); tenant routes from Task 3 via the gateway; `@helpix/ui` components.
- Produces: `slugify(input: string): string`, `parseOriginsInput(text: string): string[]`; route `/tenants/:id` (role `super_admin`).

- [ ] **Step 1: Write the failing tests**

`apps/admin-dashboard/test/lib.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseOriginsInput } from '../src/lib/origins'
import { slugify } from '../src/lib/slugify'

describe('slugify', () => {
  it.each([
    ['Teen Fashion!', 'teen-fashion'],
    ['  --iPhone  Store-- ', 'iphone-store'],
    ['Cửa hàng Táo Đỏ', 'cua-hang-tao-do'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps length at 50 without a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(49)} b`)
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('parseOriginsInput', () => {
  it('splits on newlines and commas, trims, and drops blanks', () => {
    expect(parseOriginsInput('https://a.example\n\n  http://localhost:5174 ,https://b.example\n')).toEqual([
      'https://a.example',
      'http://localhost:5174',
      'https://b.example',
    ])
  })

  it('returns an empty list for blank input', () => {
    expect(parseOriginsInput('  \n ')).toEqual([])
  })
})
```

Run: `npm test -w apps/admin-dashboard -- lib`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement the helpers**

`apps/admin-dashboard/src/lib/slugify.ts`:
```ts
/** Lowercase ASCII slug matching the server pattern ^[a-z0-9]+(-[a-z0-9]+)*$, max 50 chars. Strips diacritics (incl. Vietnamese đ). */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
}
```

`apps/admin-dashboard/src/lib/origins.ts`:
```ts
/** Splits the allowed-origins textarea. The server does the real validation and normalization. */
export function parseOriginsInput(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
```

Run: `npm test -w apps/admin-dashboard -- lib`
Expected: PASS.

- [ ] **Step 3: Build the confirm dialog, the detail page and the create flow**

`apps/admin-dashboard/src/components/ConfirmDialog.vue`:
```vue
<script setup lang="ts">
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@helpix/ui'

defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [] }>()
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
        <Button :variant="destructive ? 'destructive' : 'default'" :disabled="busy" @click="emit('confirm')">
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

`apps/admin-dashboard/src/pages/TenantsPage.vue` (replace the whole file):
```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { slugify } from '@/lib/slugify'

const router = useRouter()
const tenants = ref<TenantView[]>([])
const loadError = ref<string | null>(null)

const createOpen = ref(false)
const name = ref('')
const slug = ref('')
const slugEdited = ref(false)
const createError = ref<string | null>(null)
const creating = ref(false)

watch(name, (value) => {
  if (!slugEdited.value) slug.value = slugify(value)
})

function openCreate() {
  name.value = ''
  slug.value = ''
  slugEdited.value = false
  createError.value = null
  createOpen.value = true
}

async function create() {
  creating.value = true
  createError.value = null
  try {
    const tenant = await api.post<TenantView>('/admin/tenants', { name: name.value.trim(), slug: slug.value })
    createOpen.value = false
    await router.push(`/tenants/${tenant.id}`)
  } catch (e) {
    createError.value = e instanceof ApiError ? e.message : 'Could not create the tenant'
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  try {
    tenants.value = (await api.get<{ tenants: TenantView[] }>('/admin/tenants')).tenants
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : 'Could not load tenants'
  }
})
</script>

<template>
  <div class="grid gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Tenants</h1>
      <Button @click="openCreate">New tenant</Button>
    </div>
    <p v-if="loadError" class="text-sm text-destructive">{{ loadError }}</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Slug</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="t in tenants" :key="t.id" class="cursor-pointer" @click="router.push(`/tenants/${t.id}`)">
          <TableCell class="font-medium">{{ t.name }}</TableCell>
          <TableCell class="text-muted-foreground">{{ t.slug }}</TableCell>
          <TableCell>
            <Badge :variant="t.status === 'active' ? 'secondary' : 'destructive'">{{ t.status }}</Badge>
          </TableCell>
          <TableCell>{{ new Date(t.createdAt).toLocaleDateString() }}</TableCell>
        </TableRow>
        <TableRow v-if="tenants.length === 0 && !loadError">
          <TableCell colspan="4" class="text-center text-muted-foreground">No tenants yet.</TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="createOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>A tenant is one shop. You can add its admins and allowed sites next.</DialogDescription>
        </DialogHeader>
        <form id="create-tenant" class="grid gap-4" @submit.prevent="create">
          <div class="grid gap-2">
            <Label for="tenant-name">Name</Label>
            <Input id="tenant-name" v-model="name" required maxlength="100" />
          </div>
          <div class="grid gap-2">
            <Label for="tenant-slug">Slug</Label>
            <Input id="tenant-slug" v-model="slug" required maxlength="50" @input="slugEdited = true" />
            <p class="text-xs text-muted-foreground">Lowercase letters, numbers and dashes.</p>
          </div>
          <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>
        </form>
        <DialogFooter>
          <Button variant="outline" @click="createOpen = false">Cancel</Button>
          <Button type="submit" form="create-tenant" :disabled="creating || !slug">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
```

`apps/admin-dashboard/src/pages/TenantDetailPage.vue`:
```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { AdminView, TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { parseOriginsInput } from '@/lib/origins'

const route = useRoute()
const id = computed(() => String(route.params.id))
const base = computed(() => `/admin/tenants/${id.value}`)

const tenant = ref<TenantView | null>(null)
const admins = ref<AdminView[]>([])
const pageError = ref<string | null>(null)

const statusDialogOpen = ref(false)
const rotateDialogOpen = ref(false)
const busy = ref(false)
const actionError = ref<string | null>(null)
const copied = ref(false)

const originsText = ref('')
const originsError = ref<string | null>(null)
const originsSaved = ref(false)

const newAdminEmail = ref('')
const newAdminPassword = ref('')
const adminError = ref<string | null>(null)

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback
}

function setTenant(t: TenantView) {
  tenant.value = t
  originsText.value = t.allowedOrigins.join('\n')
}

async function load() {
  try {
    const [t, a] = await Promise.all([
      api.get<TenantView>(base.value),
      api.get<{ admins: AdminView[] }>(`${base.value}/admins`),
    ])
    setTenant(t)
    admins.value = a.admins
  } catch (e) {
    pageError.value = message(e, 'Could not load the tenant')
  }
}

async function runAction(path: string, close: () => void) {
  busy.value = true
  actionError.value = null
  try {
    setTenant(await api.post<TenantView>(`${base.value}${path}`))
    close()
  } catch (e) {
    actionError.value = message(e, 'The action failed')
  } finally {
    busy.value = false
  }
}

const toggleStatus = () =>
  runAction(tenant.value?.status === 'active' ? '/suspend' : '/reactivate', () => (statusDialogOpen.value = false))
const rotateKey = () => runAction('/widget-key/rotate', () => (rotateDialogOpen.value = false))

async function copyKey() {
  if (!tenant.value) return
  await navigator.clipboard.writeText(tenant.value.widgetKey)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function saveOrigins() {
  originsError.value = null
  originsSaved.value = false
  try {
    setTenant(await api.patch<TenantView>(base.value, { allowedOrigins: parseOriginsInput(originsText.value) }))
    originsSaved.value = true
  } catch (e) {
    originsError.value = message(e, 'Could not save allowed sites')
  }
}

async function createAdmin() {
  adminError.value = null
  try {
    const admin = await api.post<AdminView>(`${base.value}/admins`, {
      email: newAdminEmail.value,
      password: newAdminPassword.value,
    })
    admins.value.push(admin)
    newAdminEmail.value = ''
    newAdminPassword.value = ''
  } catch (e) {
    adminError.value = message(e, 'Could not create the admin')
  }
}

onMounted(load)
</script>

<template>
  <p v-if="pageError" class="text-sm text-destructive">{{ pageError }}</p>
  <div v-else-if="tenant" class="grid gap-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <RouterLink to="/tenants" class="text-sm text-muted-foreground hover:underline">← Tenants</RouterLink>
        <h1 class="flex items-center gap-3 text-2xl font-semibold">
          {{ tenant.name }}
          <Badge :variant="tenant.status === 'active' ? 'secondary' : 'destructive'">{{ tenant.status }}</Badge>
        </h1>
        <p class="text-sm text-muted-foreground">{{ tenant.slug }}</p>
      </div>
      <Button :variant="tenant.status === 'active' ? 'destructive' : 'default'" @click="statusDialogOpen = true">
        {{ tenant.status === 'active' ? 'Suspend' : 'Reactivate' }}
      </Button>
    </div>
    <p v-if="actionError" class="text-sm text-destructive" role="alert">{{ actionError }}</p>

    <Card>
      <CardHeader>
        <CardTitle>Widget key</CardTitle>
        <CardDescription>The shop puts this key in its widget script tag. It is public.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap items-center gap-3">
        <code class="rounded bg-muted px-2 py-1 text-sm">{{ tenant.widgetKey }}</code>
        <Button variant="outline" size="sm" @click="copyKey">{{ copied ? 'Copied' : 'Copy' }}</Button>
        <Button variant="outline" size="sm" @click="rotateDialogOpen = true">Rotate</Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Allowed sites</CardTitle>
        <CardDescription>Origins where the widget may run, one per line, e.g. https://shop.example</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-3">
        <Textarea v-model="originsText" rows="4" @input="originsSaved = false" />
        <div class="flex items-center gap-3">
          <Button size="sm" @click="saveOrigins">Save</Button>
          <span v-if="originsSaved" class="text-sm text-muted-foreground">Saved</span>
          <span v-if="originsError" class="text-sm text-destructive" role="alert">{{ originsError }}</span>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Admins</CardTitle>
        <CardDescription>People who manage this shop's knowledge base and agent.</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="a in admins" :key="a.id">
              <TableCell>{{ a.email }}</TableCell>
              <TableCell>{{ new Date(a.createdAt).toLocaleDateString() }}</TableCell>
            </TableRow>
            <TableRow v-if="admins.length === 0">
              <TableCell colspan="2" class="text-center text-muted-foreground">No admins yet.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <form class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" @submit.prevent="createAdmin">
          <div class="grid gap-2">
            <Label for="admin-email">Email</Label>
            <Input id="admin-email" v-model="newAdminEmail" type="email" required />
          </div>
          <div class="grid gap-2">
            <Label for="admin-password">Temporary password</Label>
            <Input id="admin-password" v-model="newAdminPassword" type="password" minlength="8" required />
          </div>
          <Button type="submit">Add admin</Button>
        </form>
        <p v-if="adminError" class="text-sm text-destructive" role="alert">{{ adminError }}</p>
      </CardContent>
    </Card>

    <ConfirmDialog
      v-model:open="statusDialogOpen"
      :title="tenant.status === 'active' ? `Suspend ${tenant.name}?` : `Reactivate ${tenant.name}?`"
      :description="tenant.status === 'active'
        ? 'The widget stops working on their site and their admins cannot log in. No data is deleted.'
        : 'The widget and admin logins start working again.'"
      :confirm-label="tenant.status === 'active' ? 'Suspend' : 'Reactivate'"
      :destructive="tenant.status === 'active'"
      :busy="busy"
      @confirm="toggleStatus"
    />
    <ConfirmDialog
      v-model:open="rotateDialogOpen"
      title="Rotate the widget key?"
      description="The current key stops working immediately. The shop must update its script tag with the new key."
      confirm-label="Rotate key"
      destructive
      :busy="busy"
      @confirm="rotateKey"
    />
  </div>
</template>
```

Modify `apps/admin-dashboard/src/router.ts` — add this child route after the `tenants` route:
```ts
        { path: 'tenants/:id', component: () => import('@/pages/TenantDetailPage.vue'), meta: { role: 'super_admin' } },
```

- [ ] **Step 4: Test, typecheck and build**

Run: `npm test -w apps/admin-dashboard && npm run typecheck -w apps/admin-dashboard && npm run build -w apps/admin-dashboard`
Expected: all PASS, build succeeds.

- [ ] **Step 5: Manual check**

With the stack and `npm run dev -w apps/admin-dashboard` running, as the super-admin:
1. **New tenant** → type "Cửa hàng Táo" → slug field shows `cua-hang-tao` → Create → lands on the detail page.
2. Creating another tenant with the same slug shows "Slug "cua-hang-tao" is already in use" in the dialog.
3. Allowed sites: enter `https://Shop.Example/` and a blank line → Save → textarea shows `https://shop.example`. Enter `https://shop.example/about` → Save → inline error, value not saved (reload to confirm).
4. **Rotate** → confirm → key changes. **Copy** shows "Copied".
5. Add admin `Owner@Shop.test` / `password-1` → table shows `owner@shop.test`. Adding it again shows "An admin with this email already exists".
6. Log out, log in as `owner@shop.test` → lands on `/home` with "Welcome, Cửa hàng Táo". Visiting `/tenants` redirects to `/home`.
7. Log back in as super-admin, **Suspend** the tenant → badge shows `suspended`. Logging in as the owner now shows "This shop's account is suspended".

- [ ] **Step 6: Commit**

```bash
git add apps/admin-dashboard
git commit -m "feat(dashboard): create tenants, manage widget key, allowed sites, admins and suspension"
```

---

### Task 10: End-to-end smoke test and README

**Files:**
- Create: `scripts/smoke-step1.mjs`, `README.md`

**Interfaces:**
- Consumes: the running stack from Task 6 (gateway on `http://localhost:4000`) and the seeded super-admin from `.env`.
- Produces: `npm run smoke` (defined in root `package.json` in Task 1).

- [ ] **Step 1: Write the smoke script**

`scripts/smoke-step1.mjs`:
```js
// End-to-end check of step 1 through the gateway. Run with the stack up: `npm run smoke`.
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null, requestId: res.headers.get('x-request-id') }
}

function check(condition, label, detail) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? '')
    process.exit(1)
  }
  console.log(`ok   ${label}`)
}

const suffix = Date.now().toString(36)

const health = await call('GET', '/health')
check(health.status === 200 && health.requestId, 'gateway health with request id', health)

const root = await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })
check(root.status === 200, 'super-admin login', root.json)
const rootToken = root.json.accessToken

const tenant = await call('POST', '/admin/tenants', { token: rootToken, body: { name: `Smoke ${suffix}`, slug: `smoke-${suffix}` } })
check(tenant.status === 201 && tenant.json.widgetKey.startsWith('wk_'), 'create tenant', tenant.json)
const tenantId = tenant.json.id

const ownerEmail = `owner-${suffix}@smoke.test`
const admin = await call('POST', `/admin/tenants/${tenantId}/admins`, { token: rootToken, body: { email: ` ${ownerEmail.toUpperCase()} `, password: 'password-1' } })
check(admin.status === 201 && admin.json.email === ownerEmail, 'create tenant admin with normalized email', admin.json)

const owner = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'password-1' } })
check(owner.status === 200, 'tenant admin login', owner.json)

const me = await call('GET', '/me', { token: owner.json.accessToken, headers: { 'x-admin-id': root.json.admin.id, 'x-tenant-id': 'spoofed' } })
check(me.status === 200 && me.json.admin.email === ownerEmail && me.json.tenant.id === tenantId, 'spoofed identity headers are ignored', me.json)

const forbidden = await call('GET', '/admin/tenants', { token: owner.json.accessToken })
check(forbidden.status === 403 && forbidden.json.error.requestId === forbidden.requestId, 'tenant admin cannot use super-admin routes; error carries request id', forbidden.json)

const internal = await call('POST', '/internal/resolve-admin', { body: { accessToken: rootToken } })
check(internal.status === 404, 'internal routes are not exposed', internal.json)

const suspended = await call('POST', `/admin/tenants/${tenantId}/suspend`, { token: rootToken })
check(suspended.status === 200 && suspended.json.status === 'suspended', 'suspend tenant', suspended.json)

const blockedLogin = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'password-1' } })
check(blockedLogin.status === 403 && blockedLogin.json.error.code === 'tenant_suspended', 'suspended tenant admin cannot log in', blockedLogin.json)

const blockedRefresh = await call('POST', '/auth/refresh', { body: { refreshToken: owner.json.refreshToken } })
check(blockedRefresh.status === 403, 'suspended tenant admin cannot refresh', blockedRefresh.json)

const reactivated = await call('POST', `/admin/tenants/${tenantId}/reactivate`, { token: rootToken })
check(reactivated.json.status === 'active', 'reactivate tenant', reactivated.json)
const again = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'password-1' } })
check(again.status === 200, 'tenant admin can log in after reactivation', again.json)

console.log('\nStep 1 smoke test passed.')
```

- [ ] **Step 2: Run it against the rebuilt stack**

Run:
```bash
docker compose up -d --build
npm run smoke
```
Expected: every line prints `ok`, ending with `Step 1 smoke test passed.`

- [ ] **Step 3: Write the README**

`README.md`:
````markdown
# Helpix

Multitenant AI customer-support platform. Design: `docs/superpowers/specs/2026-09-30-helpix-design.md`.

## Run locally

Requirements: Node 22, Docker.

```bash
cp .env.example .env          # then change the secrets
npm install
docker compose up -d --build  # postgres (host port 5433), tenant-auth, gateway (http://localhost:4000)
npm run dev -w apps/admin-dashboard   # http://localhost:5173
```

Log in with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` from `.env`.

## Test

```bash
npm run db:up      # tests use the helpix_test database on port 5433
npm test
npm run typecheck
npm run smoke      # end-to-end through the gateway; needs the full stack running
```

## Layout

- `services/gateway` — the only public entry point; resolves credentials into identity headers.
- `services/tenant-auth` — tenants, admins, widget keys, sessions. Reachable only through the gateway.
- `packages/shared` — error format, header names, DB helpers, API types.
- `packages/ui` — shared Tailwind components (`@helpix/ui`) and theme tokens.
- `apps/admin-dashboard` — super-admin and tenant-admin UI.
````

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: every workspace PASSES.

- [ ] **Step 5: Commit**

```bash
git add scripts README.md
git commit -m "test: step 1 end-to-end smoke test and README"
```
