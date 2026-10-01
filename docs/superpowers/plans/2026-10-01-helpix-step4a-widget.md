# Helpix Step 4a (Widget and First Demo Shop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Running `make seed-demos` and then `make dev` gives a working "Orchard Store" demo at `http://localhost:5174`. Its embedded Helpix widget streams answers from that shop's KB, in that shop's tone, to an anonymous visitor. The widget is styled inside a Shadow DOM and refused on origins the tenant has not allowed.

**Architecture:** The gateway gets a second credential, the public widget key, sent in `x-helpix-widget-key`. The gateway resolves it, together with the request's `Origin`, through tenant-auth's existing `/internal/resolve-widget`, caches the result per (key, origin), and forwards to exactly two routes: `POST /chat/messages` (chat-service, unchanged) and `GET /widget/config` (a new tenant-auth route). The gateway also serves the built widget bundle at `/widget/helpix-widget.js`. `apps/widget` is a Vue 3 app built by Vite into one IIFE file. It mounts into an open shadow root and loads the compiled `@helpix/ui` Tailwind CSS through a constructable stylesheet, with a fix for the `@property` rules that shadow roots ignore. It keeps the conversation ID and session token in `localStorage`. `demos/iphone-store` is a front-end-only Vite storefront that embeds the widget with a plain `<script>` tag. `scripts/seed-demos.mjs` provisions its tenant through the gateway.

**Tech Stack:** Node 22, TypeScript ~5.9, Fastify 5, `@fastify/cors` (per-request `delegator`), Vitest 4, Vue 3.5, Vite 8 (library mode, `iife`), Tailwind 4 via `@tailwindcss/vite`, jsdom, vue-router 5.

**Spec:** `docs/superpowers/specs/2026-10-01-helpix-step4a-widget-design.md`. It refines `docs/superpowers/specs/2026-09-30-helpix-design.md` §2.3, §2.5, §6 and §7. Read the 4a spec in full before starting. The step 3 plan (`docs/superpowers/plans/2026-10-01-helpix-step3-agent.md`) shows the conventions this plan follows.

## Global Constraints

- Errors are `{ error: { code, message, requestId } }` via `AppError` + `registerErrorHandler` from `@helpix/shared`. Once an SSE stream has started, failures arrive as an `error` event.
- The tenant comes only from the gateway's `x-tenant-id`. The widget key is resolved **only** by the gateway. Backend services never see the widget key: the gateway strips `x-helpix-widget-key` before forwarding.
- Widget-reachable routes are exactly `POST /chat/messages` and `GET /widget/config`. A widget key on any other path returns **403 `forbidden`**. A widget key together with `Authorization` returns **400 `ambiguous_credentials`**. A widget route with only a bearer token returns **403 `forbidden`**. A widget route with neither credential returns **401 `invalid_widget_key`**. A widget request without an `Origin` returns **403 `origin_not_allowed`** without calling the resolver.
- Resolver results are cached per `${widgetKey}\n${origin}` for `RESOLVE_CACHE_TTL_MS`. Errors are never cached.
- CORS: widget routes reflect any origin and allow `content-type` and `x-helpix-widget-key`. All other routes keep the `CORS_ORIGINS` allowlist with `content-type` and `authorization`. Preflights never call the resolver.
- `services/gateway/src/path.ts` checks (`canonicalPath`) still run on every forwarded request. This is security-sensitive code, so every rejection rule above needs its own test.
- `GET /widget/config` returns `WidgetConfig { shopName, greeting, accentColor, orderLookup }` from the **published** config with defaults applied. `orderLookup` is always `false` in 4a.
- The widget bundle is served at `GET /widget/helpix-widget.js` with `content-type: application/javascript; charset=utf-8` and `cache-control: public, max-age=300`. The path comes from `WIDGET_BUNDLE_PATH`, defaulting to `<repo>/apps/widget/dist/helpix-widget.js`. A missing file returns 404 `not_found`.
- The widget imports only browser-safe subpaths of `@helpix/shared` (`/api-types`, `/chat`, `/sse`), never `@helpix/shared` itself, which pulls in `pg` and `fastify`.
- Widget message text is rendered as plain text (`whitespace-pre-wrap`), never as HTML. Agent bubbles use the Mint wash (`bg-secondary text-secondary-foreground`). Customer bubbles use Ink (`bg-foreground text-background`).
- Widget branding (DESIGN.md "Chat surfaces"):
  - Launcher: 56 px circle (`size-14 rounded-full`), 16 px from the bottom and right edges (`bottom-4 right-4`), with a white 28 px mark (`size-7`). Its background is the tenant's `accentColor`, which defaults to Mint 600 `#0C9A82`.
  - Header: shows the shop name.
  - Footer: "Powered by" at 12 px plus the lockup at **72 px wide** (`w-[72px]`). DESIGN.md says "lockup at 12 px", but a 12 px-tall lockup is about 41 px wide, which breaks DESIGN.md's own 72 px minimum width. The minimum wins.
- Widget storage: `localStorage['helpix:<widgetKey>'] = { conversationId, sessionToken }` and `sessionStorage['helpix:<widgetKey>'] = finished messages`. Every storage access is wrapped in try/catch, so the widget works without storage.
- The demo is a fictional brand, **"Orchard Store"**. It must not use Apple's name, logo or product photos. Product art is CSS only.
- The demo runs on port **5174** (`strictPort`). The seed sets the tenant's `allowedOrigins` to exactly `["http://localhost:5174"]`.
- Postgres is on host port **5433**, and tests use `helpix_test`. Each workspace's vitest suite must pass. CI runs `npm run typecheck` and `npm run build`, so the new workspaces must pass both.
- The user asked for the existing local tenants to be wiped and the demo seeded fresh. Task 11 runs `make reset-db FORCE=1`. That deletes **all** local Helpix data (tenants, admins, KB files, test DB), which is intended.
- Out of scope: shop JWTs, `identify`/`logout` behaviour (stubs only), customer identity, orders, `lookup_order`, the Integrations page, the teen store, demo backends, loading server-side history in the widget, rate limits and Playwright.

## Review Focus

1. **A widget key for shop A used from shop B's site, or from `curl` with a forged `Origin`.** A browser on another site must get 403. A forged `Origin` from `curl` still only reaches shop A's tenant, because the key and the origin must match the same tenant's row. Neither path gives access to another tenant's data. Tests: Task 4 (`rejects an origin the tenant has not allowed`, `caches per key and origin`).
2. **The cache hides a suspension or an origin removal for up to 30 s.** This is accepted, as it is for admin tokens. Errors must never be cached, so a fixed misconfiguration takes effect on the next request. Test: Task 4 (`does not cache resolver errors`).
3. **A stale `conversationId` in `localStorage`** (the DB was reset by `make reset-db`, or the visitor copied storage between browsers). The first message after a reset must not fail. The widget clears storage and silently starts a new conversation, retrying only once. Test: Task 7 (`starts a new conversation when the stored one is gone`).
4. **Host-page CSS leaking into the widget, or the widget leaking into the host** (the demo's dark theme with a large base font, and Tailwind on the host page). The panel must look the same on any page, and the host page must not change. Tests: Task 6 (`:host { all: initial }` present, tokens on `:host`, `@property` fallback layered), Task 11 manual check on the dark demo.
5. **A model reply containing HTML or markdown** (`<img onerror>`, `**bold**`). It must render as literal text, with no injected element. Test: Task 8 (`renders reply text as plain text`).

---

## File Structure

```
helpix/
  package.json                                 + "demos/*" workspace, smoke includes step 4a (modified)
  Makefile                                     + seed-demos, demo; dev/start run widget watch + demo (modified)
  .gitignore                                   + *.local (modified)
  .env.example                                 + WIDGET_BUNDLE_PATH comment (modified)
  docker/node-service.Dockerfile               builds apps/widget (modified)
  README.md                                    widget + demo section (modified)
  scripts/seed-demos.mjs                       NEW: provisions every demos/*/seed through the gateway
  scripts/smoke-step3.mjs                      admin on /chat/messages → still 403 (verify only)
  scripts/smoke-step4a.mjs                     NEW: widget surface end to end
  packages/shared/src/api-types.ts             + WidgetConfig (modified)
  packages/shared/src/headers.ts               + HEADERS.widgetKey (modified)
  packages/shared/src/chat.ts                  + chatEvents, chipsFor, Chip (moved from dashboard) (modified)
  packages/shared/test/chat.test.ts            NEW (moved tests)
  packages/ui/src/styles/globals.css           tokens on `:root, :host` (modified)
  apps/admin-dashboard/src/lib/chat.ts         re-exports chatEvents/chipsFor from shared (modified)
  services/tenant-auth/src/routes/widget.ts    NEW: GET /widget/config
  services/tenant-auth/src/app.ts              registers widgetRoutes (modified)
  services/tenant-auth/test/widget.test.ts     NEW
  services/gateway/src/config.ts               + widgetBundlePath (modified)
  services/gateway/src/tenantAuthClient.ts     + resolveWidget (modified)
  services/gateway/src/forward.ts              strips x-helpix-widget-key (modified)
  services/gateway/src/widget.ts               NEW: isWidgetRoute, createWidgetIdentity, serveWidgetBundle
  services/gateway/src/app.ts                  CORS delegator, widget routes, credential rules (modified)
  services/gateway/test/helpers.ts             + widgetBundlePath (modified)
  services/gateway/test/widget.test.ts         NEW
  apps/widget/                                 NEW
    package.json tsconfig.json vite.config.ts
    src/main.ts                                entry: reads document.currentScript, mounts, defines window.Helpix
    src/bootstrap.ts                           readScriptConfig, mountWidget
    src/shadowStyles.ts                        shadowSafeCss, applyStyles, ensureFonts
    src/api.ts                                 createWidgetApi, WidgetApiError
    src/storage.ts                             loadSession/saveSession/clearSession, loadHistory/saveHistory
    src/useChat.ts                             conversation state machine
    src/widget.css                             Tailwind entry: @helpix/ui styles + :host reset
    src/App.vue  src/components/Launcher.vue  ChatPanel.vue  MessageBubble.vue  Composer.vue
    test/shadowStyles.test.ts bootstrap.test.ts storage.test.ts useChat.test.ts chatPanel.test.ts helpers.ts
  demos/iphone-store/                          NEW
    package.json tsconfig.json vite.config.ts index.html .env.development
    src/main.ts src/App.vue src/router.ts src/styles.css src/products.ts src/cart.ts
    src/components/PhoneArt.vue src/pages/HomePage.vue ProductPage.vue BagPage.vue
    seed/shop.json seed/agent.json seed/kb/*.md
```

---

### Task 0: Spike: Tailwind 4 inside a Shadow DOM (throwaway)

**Purpose:** settle the open item in spec §12. Nothing from this task is committed.

**Files (temporary, deleted at the end of this task):**
- Create: `apps/admin-dashboard/spike.html`
- Create: `apps/admin-dashboard/src/spike.ts`

- [ ] **Step 1: Write the spike page**

`apps/admin-dashboard/spike.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>shadow spike</title></head>
<body style="font-size:20px;color:red;background:#111">
  <div id="light"></div><div id="raw"></div><div id="fixed"></div>
  <script type="module" src="/src/spike.ts"></script>
</body></html>
```

`apps/admin-dashboard/src/spike.ts`:

```ts
import css from '@helpix/ui/styles.css?inline'

const BODY = `
  <div class="m-4 flex items-center gap-4 font-sans text-sm text-foreground">
    <div data-k="shadow" class="size-16 rounded-xl bg-card shadow-lg"></div>
    <div data-k="ring" class="size-16 rounded-xl bg-card ring-4 ring-ring"></div>
    <div data-k="transform" class="size-16 translate-x-2 scale-110 rounded-xl bg-primary"></div>
    <div data-k="gradient" class="size-16 rounded-xl bg-linear-to-r from-brand to-primary"></div>
    <button data-k="open" class="rounded-md bg-primary px-3 py-2 text-primary-foreground">dialog</button>
    <dialog class="rounded-xl bg-card p-6 shadow-lg backdrop:bg-black/50">in the top layer</dialog>
  </div>`

const PROPERTY_RULE = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g
function shadowSafeCss(input: string): string {
  const decls: string[] = []
  const rest = input.replace(PROPERTY_RULE, (_m, name: string, body: string) => {
    const initial = /initial-value\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
    decls.push(`${name}:${initial ?? 'initial'}`)
    return ''
  })
  return decls.length ? `@layer properties{:host,*,::before,::after,::backdrop{${decls.join(';')}}}\n${rest}` : rest
}

function mount(id: string, sheetCss: string | null) {
  const el = document.getElementById(id)!
  if (sheetCss === null) {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s)
    el.innerHTML = BODY
    return el
  }
  const root = el.attachShadow({ mode: 'open' })
  const sheet = new CSSStyleSheet(); sheet.replaceSync(`:host{all:initial}\n${sheetCss}`)
  root.adoptedStyleSheets = [sheet]
  root.innerHTML = BODY
  return root
}

const report: Record<string, Record<string, string>> = {}
for (const [id, sheet] of [['light', null], ['raw', css], ['fixed', shadowSafeCss(css)]] as const) {
  const root = mount(id, sheet)
  const q = (k: string) => getComputedStyle(root.querySelector(`[data-k="${k}"]`)!)
  root.querySelector('[data-k="open"]')!.addEventListener('click', () => root.querySelector('dialog')!.showModal())
  requestAnimationFrame(() => {
    report[id] = {
      shadow: q('shadow').boxShadow,
      ring: q('ring').boxShadow,
      transform: q('transform').transform + ' | ' + q('transform').translate + ' | ' + q('transform').scale,
      gradient: q('gradient').backgroundImage,
    }
    console.log('[spike]', id, JSON.stringify(report[id]))
  })
}
```

- [ ] **Step 2: Run it in Chrome and record the computed styles**

Run: `npm run dev -w apps/admin-dashboard` and open `http://localhost:5173/spike.html` in Chrome (use the claude-in-chrome tools: read console messages with pattern `\[spike\]`, take a screenshot, and click each "dialog" button).

Expected:
- `light` has real values everywhere.
- `raw` shows `none` (or empty) for `shadow`/`ring`, and the gradient is missing. This confirms that `@property` is ignored inside the shadow root.
- `fixed` matches `light`.
- In the `fixed` row the dialog opens styled, with a dimmed backdrop.
- The red 20 px body font does not reach the `raw`/`fixed` rows.

- [ ] **Step 3: Decide and record**

If `fixed` matches `light`: use **option (b)**, the `shadowSafeCss` above, in Task 6 as written.

If it does not: switch Task 6 to **option (a)** instead:
- extract the `@property` blocks
- inject them once into `document.head` in a `<style id="helpix-widget-properties">`
- pass the rest of the CSS to the shadow root

Update Task 6's `shadowSafeCss` tests to match. Either way, write the outcome, with the computed values, into the "Shadow DOM styling" note in Task 10's README section.

- [ ] **Step 4: Delete the spike**

```bash
rm apps/admin-dashboard/spike.html apps/admin-dashboard/src/spike.ts
git status --short   # expected: clean apart from earlier uncommitted work
```

---

### Task 1: Shared pieces: `WidgetConfig`, widget-key header, chat client helpers, `:host` tokens

**Files:**
- Modify: `packages/shared/src/api-types.ts` (add after `ResolvedWidget`)
- Modify: `packages/shared/src/headers.ts`
- Modify: `packages/shared/src/chat.ts`
- Create: `packages/shared/test/chat.test.ts`
- Modify: `apps/admin-dashboard/src/lib/chat.ts`
- Modify: `apps/admin-dashboard/test/chat.test.ts` (keep only `customerLabel` tests)
- Modify: `packages/ui/src/styles/globals.css:11` and `:35`

**Interfaces:**
- Produces:
  - `WidgetConfig`
  - `HEADERS.widgetKey === 'x-helpix-widget-key'`
  - `chatEvents(res: Response): AsyncGenerator<ChatStreamEvent>`
  - `chipsFor(tools: ChatToolEvent[]): Chip[]`
  - `Chip { key; label; tone: 'source' | 'empty' | 'error' }`

  All of these are exported from `@helpix/shared/chat`, and `@helpix/shared` re-exports them.

- [ ] **Step 1: Move the tests first**

Create `packages/shared/test/chat.test.ts` containing the existing `chatEvents` and `chipsFor` `describe` blocks cut from `apps/admin-dashboard/test/chat.test.ts`. Change the import line to:

```ts
import { describe, expect, it } from 'vitest'
import type { ChatStreamEvent } from '../src/api-types'
import { chatEvents, chipsFor } from '../src/chat'
```

In `apps/admin-dashboard/test/chat.test.ts`, keep the `customerLabel` block and change its import to `import { customerLabel } from '../src/lib/chat'`. Also add one re-export assertion:

```ts
import { chatEvents, chipsFor } from '../src/lib/chat'
it('re-exports the shared chat helpers', () => {
  expect(typeof chatEvents).toBe('function')
  expect(typeof chipsFor).toBe('function')
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -w packages/shared -- test/chat.test.ts`
Expected: FAIL. `chatEvents` / `chipsFor` are not exported from `../src/chat`.

- [ ] **Step 3: Move the implementation**

Append to `packages/shared/src/chat.ts`. Update its import line to `import type { ChatSource, ChatStreamEvent, ChatToolEvent, ToolActivity } from './api-types'`, then add `import { readSseEvents } from './sse'`:

```ts
const EVENTS = new Set<string>(['meta', 'delta', 'tool', 'done', 'error'])

/** Typed events from a chat SSE response. Unknown event names and unreadable data are skipped. */
export async function* chatEvents(res: Response): AsyncGenerator<ChatStreamEvent> {
  if (!res.body) return
  for await (const { event, data } of readSseEvents(res.body)) {
    if (!EVENTS.has(event)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    yield { event, data: parsed } as ChatStreamEvent
  }
}

export interface Chip {
  key: string
  label: string
  tone: 'source' | 'empty' | 'error'
}

/** The chips under a reply: each cited document once, or why there are none. */
export function chipsFor(tools: ChatToolEvent[]): Chip[] {
  const chips: Chip[] = []
  const seen = new Set<string>()
  const add = (chip: Chip) => {
    if (seen.has(chip.key)) return
    seen.add(chip.key)
    chips.push(chip)
  }
  for (const t of tools) {
    const what = t.name === 'search_kb' ? 'the knowledge base' : t.name
    if (t.status === 'error') add({ key: `error:${t.name}`, label: `Couldn't check ${what}`, tone: 'error' })
    else if (t.sources.length === 0) add({ key: `empty:${t.name}`, label: 'No matching documents', tone: 'empty' })
    else for (const s of t.sources) add({ key: `source:${s.documentId}`, label: s.title, tone: 'source' })
  }
  return chips
}
```

Replace `apps/admin-dashboard/src/lib/chat.ts`'s `EVENTS`, `chatEvents`, `Chip` and `chipsFor` definitions, and its `readSseEvents` import, with:

```ts
export { CHAT_MESSAGE_MAX, chatEvents, chipsFor, toChatToolEvent, type Chip } from '@helpix/shared/chat'
```

Keep `customerLabel` where it is.

In `packages/shared/src/headers.ts` add to `HEADERS`:

```ts
  /** The public widget key a shop page sends. Only the gateway reads it; it is stripped before forwarding. */
  widgetKey: 'x-helpix-widget-key',
```

Do **not** add it to `IDENTITY_HEADERS`: it is a client credential, not an identity the gateway asserts.

In `packages/shared/src/api-types.ts`, after `ResolvedWidget`:

```ts
/** tenant-auth → widget (`GET /widget/config`): what the widget needs before the first message. */
export interface WidgetConfig {
  shopName: string
  greeting: string
  accentColor: string
  /** Whether order lookup is available. Always false until step 4b. */
  orderLookup: boolean
}
```

In `packages/ui/src/styles/globals.css`, change the first `:root {` (line 11, the light tokens) to `:root, :host {`, and change the later `:root { color-scheme: light; }` to `:root, :host { color-scheme: light; }`. Above the first one, add the comment `/* :host too: inside the widget's shadow root :root matches nothing. */`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w packages/shared -- test/chat.test.ts && npm test -w apps/admin-dashboard && npm run typecheck -w packages/shared -w apps/admin-dashboard`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared packages/ui/src/styles/globals.css apps/admin-dashboard/src/lib/chat.ts apps/admin-dashboard/test/chat.test.ts
git commit -m "feat(shared): widget config type, widget-key header, shared chat stream helpers"
```

---

### Task 2: tenant-auth `GET /widget/config`

**Files:**
- Create: `services/tenant-auth/src/routes/widget.ts`
- Modify: `services/tenant-auth/src/app.ts` (register after `internalChatRoutes`)
- Test: `services/tenant-auth/test/widget.test.ts`

**Interfaces:**
- Consumes: `getPublishedConfig(db, tenantId)` from `src/repos/agentConfigs.ts` (returns `{ tenantName, status, config } | null`), plus `readContext` and `WidgetConfig`.
- Produces: `GET /widget/config`. It needs `x-internal-token` and `x-tenant-id` with no `x-helpix-role` or `x-admin-id`, and returns `WidgetConfig`.

- [ ] **Step 1: Write the failing test**

`services/tenant-auth/test/widget.test.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { DEFAULT_AGENT_CONFIG, HEADERS, type Db } from '@helpix/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveDraft, publishDraft } from '../src/repos/agentConfigs'
import { setTenantStatus } from '../src/repos/tenants'
import { buildTestApp, internalHeaders, resetDb, seedTenant, setupTestDb, tenantAdminHeaders } from './helpers'

let db: Db
let app: FastifyInstance

beforeAll(async () => { db = await setupTestDb() })
afterAll(async () => { await db.end() })
beforeEach(async () => {
  await resetDb(db)
  app = await buildTestApp(db)
})
afterEach(async () => { await app.close() })

const widgetHeaders = (tenantId: string) => ({ ...internalHeaders(), [HEADERS.tenantId]: tenantId })
const getConfig = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/widget/config', headers })

describe('GET /widget/config', () => {
  it('returns defaults and the shop name before anything is published', async () => {
    const t = await seedTenant(db, { slug: 'orchard', name: 'Orchard Store' })
    const res = await getConfig(widgetHeaders(t.id))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      shopName: 'Orchard Store',
      greeting: DEFAULT_AGENT_CONFIG.greeting,
      accentColor: DEFAULT_AGENT_CONFIG.accentColor,
      orderLookup: false,
    })
  })

  it('returns the published config, not the draft', async () => {
    const t = await seedTenant(db, { slug: 'orchard' })
    await saveDraft(db, t.id, { ...DEFAULT_AGENT_CONFIG, greeting: 'Published hi', accentColor: '#111111' })
    await publishDraft(db, t.id)
    await saveDraft(db, t.id, { ...DEFAULT_AGENT_CONFIG, greeting: 'Draft hi', accentColor: '#222222' })
    expect(res(await getConfig(widgetHeaders(t.id)))).toMatchObject({ greeting: 'Published hi', accentColor: '#111111' })
  })

  it("never returns another tenant's config", async () => {
    const a = await seedTenant(db, { slug: 'shop-a', name: 'Shop A' })
    const b = await seedTenant(db, { slug: 'shop-b', name: 'Shop B' })
    await saveDraft(db, b.id, { ...DEFAULT_AGENT_CONFIG, greeting: 'B only' })
    await publishDraft(db, b.id)
    expect(res(await getConfig(widgetHeaders(a.id)))).toMatchObject({ shopName: 'Shop A', greeting: DEFAULT_AGENT_CONFIG.greeting })
  })

  it('rejects admin callers, a missing or malformed tenant, and suspended tenants', async () => {
    const t = await seedTenant(db, { slug: 'orchard' })
    expect((await getConfig(tenantAdminHeaders('00000000-0000-4000-8000-0000000000a1', t.id))).statusCode).toBe(403)
    expect((await getConfig(internalHeaders())).statusCode).toBe(403)
    expect((await getConfig(widgetHeaders('not-a-uuid'))).statusCode).toBe(403)
    expect((await getConfig(widgetHeaders('00000000-0000-4000-8000-000000000099'))).statusCode).toBe(404)
    await setTenantStatus(db, t.id, 'suspended')
    const suspended = await getConfig(widgetHeaders(t.id))
    expect(suspended.statusCode).toBe(403)
    expect(suspended.json().error.code).toBe('tenant_suspended')
  })

  it('requires the internal token', async () => {
    const t = await seedTenant(db, { slug: 'orchard' })
    expect((await getConfig({ [HEADERS.tenantId]: t.id })).statusCode).toBe(401)
  })
})

function res(r: { statusCode: number; json: () => unknown }) {
  expect(r.statusCode).toBe(200)
  return r.json()
}
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -w services/tenant-auth -- test/widget.test.ts`
Expected: FAIL, with 404 `not_found` responses (the route doesn't exist).

- [ ] **Step 3: Implement**

`services/tenant-auth/src/routes/widget.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify'
import { AppError, readContext } from '@helpix/shared'
import type { WidgetConfig } from '@helpix/shared/api-types'
import type { RouteDeps } from '../deps'
import { getPublishedConfig } from '../repos/agentConfigs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Called by the gateway for the chat widget: the tenant comes from a resolved widget key, never from an admin. */
export const widgetRoutes: FastifyPluginAsync<RouteDeps> = async (app, { db }) => {
  app.get('/widget/config', async (req): Promise<WidgetConfig> => {
    const ctx = readContext(req)
    if (ctx.role || ctx.adminId) throw new AppError(403, 'forbidden', 'This route is for the chat widget')
    if (!ctx.tenantId || !UUID.test(ctx.tenantId)) throw new AppError(403, 'forbidden', 'Missing tenant context')
    const found = await getPublishedConfig(db, ctx.tenantId)
    if (!found) throw new AppError(404, 'tenant_not_found', 'Tenant not found')
    if (found.status !== 'active') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
    return {
      shopName: found.tenantName,
      greeting: found.config.greeting,
      accentColor: found.config.accentColor,
      orderLookup: false,
    }
  })
}
```

In `services/tenant-auth/src/app.ts`, add `import { widgetRoutes } from './routes/widget'` and `await app.register(widgetRoutes, deps)` after the `internalChatRoutes` registration.

- [ ] **Step 4: Run tests**

Run: `npm test -w services/tenant-auth && npm run typecheck -w services/tenant-auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/tenant-auth
git commit -m "feat(tenant-auth): GET /widget/config from the published agent config"
```

---

### Task 3: Gateway plumbing: `resolveWidget`, `widgetBundlePath`, strip the widget key

**Files:**
- Modify: `services/gateway/src/tenantAuthClient.ts`
- Modify: `services/gateway/src/config.ts`
- Modify: `services/gateway/src/forward.ts:11`
- Modify: `services/gateway/test/helpers.ts` (`testConfig`)
- Modify: every `TenantAuthClient` fake in `services/gateway/test/*.test.ts` (find them with `grep -rn "TenantAuthClient = {" services/gateway/test`; there are 2 today)
- Test: `services/gateway/test/tenantAuthClient.test.ts`, `services/gateway/test/config.test.ts`

**Interfaces:**
- Produces:
  - `TenantAuthClient.resolveWidget(widgetKey: string, origin: string, requestId: string): Promise<ResolvedWidget>`
  - `GatewayConfig.widgetBundlePath: string`
  - `forward()` drops `x-helpix-widget-key`

- [ ] **Step 1: Write the failing tests**

Add to `services/gateway/test/tenantAuthClient.test.ts`. That file's `echo` stub always answers 200 `{ ok: true }`, so the error case uses a small inline stub. Add `import Fastify from 'fastify'` and `import type { AddressInfo } from 'node:net'` at the top:

```ts
  it('calls /internal/resolve-widget with the key, the origin and the resolver caller header', async () => {
    await createTenantAuthClient(echo.url, TEST_INTERNAL_TOKEN).resolveWidget('wk_1', 'https://shop.example', 'req-1')
    const call = echo.calls[0]!
    expect(call.url).toBe('/internal/resolve-widget')
    expect(call.headers['x-internal-caller']).toBe('resolver')
    expect(call.headers['x-request-id']).toBe('req-1')
    expect(JSON.parse(call.body!)).toEqual({ widgetKey: 'wk_1', origin: 'https://shop.example' })
  })

  it('passes a 403 from resolve-widget through with its code', async () => {
    const stub = Fastify()
    stub.post('/internal/resolve-widget', async (_req, reply) =>
      reply.code(403).send({ error: { code: 'origin_not_allowed', message: 'Not allowed', requestId: 'r' } }),
    )
    await stub.listen({ port: 0, host: '127.0.0.1' })
    const { port } = stub.server.address() as AddressInfo
    try {
      await expect(
        createTenantAuthClient(`http://127.0.0.1:${port}`, TEST_INTERNAL_TOKEN).resolveWidget('wk_1', 'https://evil.example', 'req-2'),
      ).rejects.toMatchObject({ status: 403, code: 'origin_not_allowed' })
    } finally {
      await stub.close()
    }
  })
```

Put both inside the existing `describe('tenant-auth client', …)` block.

Add to `services/gateway/test/config.test.ts`:

```ts
it('defaults the widget bundle path to apps/widget/dist and honours WIDGET_BUNDLE_PATH', () => {
  const base = { INTERNAL_TOKEN: 'x'.repeat(32), TENANT_AUTH_URL: 'http://a', KB_SERVICE_URL: 'http://b', CHAT_SERVICE_URL: 'http://c' }
  expect(loadConfig(base).widgetBundlePath).toMatch(/apps[\\/]widget[\\/]dist[\\/]helpix-widget\.js$/)
  expect(loadConfig({ ...base, WIDGET_BUNDLE_PATH: '/tmp/w.js' }).widgetBundlePath).toBe('/tmp/w.js')
})
```

(Stripping `x-helpix-widget-key` upstream is tested in Task 4, `forwards POST /chat/messages to chat-service with only the tenant identity`. After Task 4, a widget key on `/auth/*` is rejected before `forward()` runs, so a `forward.test.ts` case for it would not survive.)

- [ ] **Step 2: Run to see them fail**

Run: `npm test -w services/gateway`
Expected: the new tests FAIL (`resolveWidget` is not a function, `widgetBundlePath` is undefined).

- [ ] **Step 3: Implement**

`services/gateway/src/tenantAuthClient.ts`: change the type import to `import type { ResolvedAdmin, ResolvedWidget } from '@helpix/shared/api-types'`, then extend the interface and the returned object:

```ts
export interface TenantAuthClient {
  resolveAdmin(accessToken: string, requestId: string): Promise<ResolvedAdmin>
  /** The tenant for a widget key used from `origin`; 401/403 from tenant-auth pass through. */
  resolveWidget(widgetKey: string, origin: string, requestId: string): Promise<ResolvedWidget>
}
```

```ts
    resolveWidget: (widgetKey, origin, requestId) =>
      post<ResolvedWidget>('/internal/resolve-widget', { widgetKey, origin }, requestId),
```

`services/gateway/src/config.ts`: add `import { fileURLToPath } from 'node:url'` at the top, add to the interface:

```ts
  /** The built widget bundle served at GET /widget/helpix-widget.js. */
  widgetBundlePath: string
```

and to the returned object:

```ts
    widgetBundlePath: env.WIDGET_BUNDLE_PATH || fileURLToPath(new URL('../../../apps/widget/dist/helpix-widget.js', import.meta.url)),
```

`services/gateway/src/forward.ts` line 11:

```ts
const STRIP_FROM_CLIENT = new Set([...IDENTITY_HEADERS, 'authorization', HEADERS.widgetKey, HEADERS.requestId])
```

`services/gateway/test/helpers.ts` `testConfig`: add `widgetBundlePath: '/nonexistent/helpix-widget.js',`.

In each existing `TenantAuthClient` fake, add:

```ts
  resolveWidget: vi.fn(async () => { throw new AppError(401, 'invalid_widget_key', 'Unknown widget key') }),
```

(and import `AppError` if the file doesn't already).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w services/gateway && npm run typecheck -w services/gateway`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/gateway
git commit -m "feat(gateway): widget resolver client, bundle path config, strip widget key upstream"
```

---

### Task 4: Gateway widget routes, credential rules, CORS and the bundle

**Files:**
- Create: `services/gateway/src/widget.ts`
- Modify: `services/gateway/src/app.ts`
- Test: `services/gateway/test/widget.test.ts`

**Interfaces:**
- Consumes: `TenantAuthClient.resolveWidget`, `GatewayConfig.widgetBundlePath`, `HEADERS.widgetKey`, `TtlCache<T>` (`get(key)`, `set(key, value)`), `forward`, `canonicalPath`.
- Produces:
  - `POST /chat/messages` → chat-service, with `x-tenant-id` and no role
  - `GET /widget/config` → tenant-auth
  - `GET /widget/helpix-widget.js`
  - the rejection rules in Global Constraints

- [ ] **Step 1: Write the failing tests**

`services/gateway/test/widget.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@helpix/shared'
import { buildGateway } from '../src/app'
import type { TenantAuthClient } from '../src/tenantAuthClient'
import { startEcho, testConfig } from './helpers'

const SHOP = 'https://shop.example'
const KEY = 'wk_live_a'

function fakeTenantAuth(): TenantAuthClient & { resolveWidget: ReturnType<typeof vi.fn> } {
  return {
    resolveAdmin: vi.fn(async (token: string) => {
      if (token !== 'tenant-token') throw new AppError(401, 'invalid_token', 'Invalid or expired access token')
      return { adminId: 'admin-a', role: 'tenant_admin' as const, tenantId: 'tenant-a' }
    }),
    resolveWidget: vi.fn(async (key: string, origin: string) => {
      if (key === 'wk_suspended') throw new AppError(403, 'tenant_suspended', "This shop's account is suspended")
      if (key !== KEY) throw new AppError(401, 'invalid_widget_key', 'Unknown widget key')
      if (origin !== SHOP && origin !== 'https://other.shop.example') throw new AppError(403, 'origin_not_allowed', 'Not allowed')
      return { tenantId: 'tenant-a' }
    }),
  }
}

const widget = (extra: Record<string, string> = {}) => ({ 'x-helpix-widget-key': KEY, origin: SHOP, ...extra })
const json = { 'content-type': 'application/json' }

describe('gateway widget surface', () => {
  let auth: Awaited<ReturnType<typeof startEcho>>
  let chat: Awaited<ReturnType<typeof startEcho>>
  let kb: Awaited<ReturnType<typeof startEcho>>
  let tenantAuth: ReturnType<typeof fakeTenantAuth>
  let gw: FastifyInstance

  async function build(widgetBundlePath = '/nonexistent/helpix-widget.js') {
    gw = await buildGateway({ config: { ...testConfig(auth.url, kb.url, chat.url), widgetBundlePath }, tenantAuth })
  }

  beforeEach(async () => {
    auth = await startEcho()
    chat = await startEcho()
    kb = await startEcho()
    tenantAuth = fakeTenantAuth()
    await build()
  })
  afterEach(async () => {
    await gw.close()
    await Promise.all([auth.close(), chat.close(), kb.close()])
  })

  it('forwards POST /chat/messages to chat-service with only the tenant identity', async () => {
    const res = await gw.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { ...widget(), ...json, 'x-tenant-id': 'spoofed', 'x-customer-id': 'spoofed', 'x-helpix-role': 'tenant_admin' },
      payload: '{"message":"hi"}',
    })
    expect(res.statusCode).toBe(200)
    const call = chat.calls[0]!
    expect(call.url).toBe('/chat/messages')
    expect(call.headers['x-tenant-id']).toBe('tenant-a')
    expect(call.headers['x-customer-id']).toBeUndefined()
    expect(call.headers['x-helpix-role']).toBeUndefined()
    expect(call.headers['x-admin-id']).toBeUndefined()
    expect(call.headers['x-helpix-widget-key']).toBeUndefined()
    expect(call.body).toBe('{"message":"hi"}')
  })

  it('forwards GET /widget/config to tenant-auth', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    expect(res.statusCode).toBe(200)
    expect(auth.calls.map((c) => c.url)).toEqual(['/widget/config'])
    expect(auth.calls[0]!.headers['x-tenant-id']).toBe('tenant-a')
  })

  it('rejects an unknown widget key (401)', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-helpix-widget-key': 'wk_nope' }) })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('invalid_widget_key')
  })

  it('rejects a request without an Origin before calling the resolver (403)', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: { 'x-helpix-widget-key': KEY } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('origin_not_allowed')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })

  it('rejects an origin the tenant has not allowed (403)', async () => {
    const res = await gw.inject({ method: 'POST', url: '/chat/messages', headers: { ...widget({ origin: 'https://evil.example' }), ...json }, payload: '{}' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('origin_not_allowed')
    expect(chat.calls).toHaveLength(0)
  })

  it('rejects a suspended tenant (403)', async () => {
    const res = await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ 'x-helpix-widget-key': 'wk_suspended' }) })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('tenant_suspended')
  })

  it('rejects a widget key on any other route (403)', async () => {
    for (const [method, url] of [['GET', '/kb/documents'], ['POST', '/auth/login'], ['GET', '/agent/config'], ['GET', '/chat/conversations'], ['GET', '/me']] as const) {
      const res = await gw.inject({ method, url, headers: widget() })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
    expect(auth.calls.length + kb.calls.length + chat.calls.length).toBe(0)
  })

  it('rejects a widget key together with a bearer token (400)', async () => {
    for (const url of ['/widget/config', '/kb/documents']) {
      const res = await gw.inject({ method: 'GET', url, headers: { ...widget(), authorization: 'Bearer tenant-token' } })
      expect(res.statusCode, url).toBe(400)
      expect(res.json().error.code).toBe('ambiguous_credentials')
    }
  })

  it('rejects a bearer token alone on widget routes (403) and no credential (401)', async () => {
    const admin = await gw.inject({ method: 'POST', url: '/chat/messages', headers: { authorization: 'Bearer tenant-token', origin: SHOP, ...json }, payload: '{}' })
    expect(admin.statusCode).toBe(403)
    const none = await gw.inject({ method: 'GET', url: '/widget/config', headers: { origin: SHOP } })
    expect(none.statusCode).toBe(401)
    expect(chat.calls.length + auth.calls.length).toBe(0)
  })

  it('still routes the admin /chat/* routes with a bearer token', async () => {
    const res = await gw.inject({ method: 'GET', url: '/chat/conversations', headers: { authorization: 'Bearer tenant-token' } })
    expect(res.statusCode).toBe(200)
    expect(chat.calls[0]!.headers['x-helpix-role']).toBe('tenant_admin')
  })

  it('caches per key and origin', async () => {
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget() })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(1)
    await gw.inject({ method: 'GET', url: '/widget/config', headers: widget({ origin: 'https://other.shop.example' }) })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(2)
  })

  it('does not cache resolver errors', async () => {
    const bad = widget({ origin: 'https://evil.example' })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: bad })
    await gw.inject({ method: 'GET', url: '/widget/config', headers: bad })
    expect(tenantAuth.resolveWidget).toHaveBeenCalledTimes(2)
  })

  it('answers widget preflights from any origin without calling the resolver', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/chat/messages',
      headers: { origin: 'https://any-shop.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-helpix-widget-key' },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://any-shop.example')
    expect(String(res.headers['access-control-allow-headers'])).toContain('x-helpix-widget-key')
    expect(tenantAuth.resolveWidget).not.toHaveBeenCalled()
  })

  it('keeps the admin CORS allowlist on other routes', async () => {
    const res = await gw.inject({
      method: 'OPTIONS',
      url: '/kb/documents',
      headers: { origin: 'https://any-shop.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('serves the widget bundle, and 404s when it has not been built', async () => {
    expect((await gw.inject({ method: 'GET', url: '/widget/helpix-widget.js' })).statusCode).toBe(404)
    const dir = await mkdtemp(join(tmpdir(), 'helpix-widget-'))
    const file = join(dir, 'helpix-widget.js')
    await writeFile(file, 'console.log("helpix")')
    await gw.close()
    await build(file)
    const res = await gw.inject({ method: 'GET', url: '/widget/helpix-widget.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(res.body).toBe('console.log("helpix")')
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -w services/gateway -- test/widget.test.ts`
Expected: most tests FAIL. `/widget/*` returns 404, and `/chat/messages` asks for a bearer token.

- [ ] **Step 3: Implement `services/gateway/src/widget.ts`**

```ts
import { readFile } from 'node:fs/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError, HEADERS, TtlCache } from '@helpix/shared'
import type { ResolvedWidget } from '@helpix/shared/api-types'
import type { TenantAuthClient } from './tenantAuthClient'

/** The only routes a widget key opens (spec 4a §2). Everything else is admin-only. */
const WIDGET_ROUTES = new Set(['/chat/messages', '/widget/config'])

export function pathnameOf(url: string): string {
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

export function isWidgetRoute(req: FastifyRequest): boolean {
  return WIDGET_ROUTES.has(pathnameOf(req.url))
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * onRequest: a widget key never mixes with a bearer token, and never opens a non-widget route. Runs before routing,
 * so `/auth/*` (which does not resolve a bearer) is covered too. Preflights carry no credentials and pass.
 */
export async function enforceCredentialRules(req: FastifyRequest): Promise<void> {
  if (header(req, HEADERS.widgetKey) === undefined) return
  if (req.headers.authorization !== undefined) {
    throw new AppError(400, 'ambiguous_credentials', 'Send either a widget key or a bearer token, not both')
  }
  if (!isWidgetRoute(req)) throw new AppError(403, 'forbidden', 'A widget key only works on the chat widget routes')
}

/** Resolves the widget key + Origin into identity headers. Successes are cached per (key, origin); errors are not. */
export function createWidgetIdentity(tenantAuth: TenantAuthClient, ttlMs: number) {
  const cache = new TtlCache<ResolvedWidget>(ttlMs)
  return async (req: FastifyRequest): Promise<Record<string, string>> => {
    const key = header(req, HEADERS.widgetKey)
    if (!key) {
      if (req.headers.authorization !== undefined) throw new AppError(403, 'forbidden', 'This route is for the chat widget')
      throw new AppError(401, 'invalid_widget_key', 'Missing widget key')
    }
    const origin = header(req, 'origin')
    if (!origin) throw new AppError(403, 'origin_not_allowed', 'This site is not allowed to use this widget key')
    const cacheKey = `${key}\n${origin}`
    let resolved = cache.get(cacheKey)
    if (!resolved) {
      resolved = await tenantAuth.resolveWidget(key, origin, req.id)
      cache.set(cacheKey, resolved)
    }
    return { [HEADERS.tenantId]: resolved.tenantId }
  }
}

/** GET /widget/helpix-widget.js. Read per request so `vite build --watch` output is picked up in dev. */
export function serveWidgetBundle(path: string) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    let file: Buffer
    try {
      file = await readFile(path)
    } catch {
      throw new AppError(404, 'not_found', 'The widget bundle has not been built')
    }
    return reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .header('cross-origin-resource-policy', 'cross-origin')
      .send(file)
  }
}
```

- [ ] **Step 4: Wire it into `services/gateway/src/app.ts`**

Add `import { createWidgetIdentity, enforceCredentialRules, isWidgetRoute, serveWidgetBundle } from './widget'`.

Replace the `cors` registration with the block below, and add the credential hook **after** it. Hooks run in registration order, so CORS headers are already set when the hook rejects a request, and the widget can read the error body:

```ts
  // Widget routes are called from shop pages on any origin; the tenant's allowed origins are enforced by the
  // widget-key resolver, not here. Admin routes keep the dashboard allowlist.
  await app.register(cors, {
    delegator: (req, cb) => {
      const widget = isWidgetRoute(req)
      cb(null, {
        origin: widget ? true : config.corsOrigins,
        methods: [...METHODS],
        allowedHeaders: widget ? ['content-type', HEADERS.widgetKey] : ['content-type', 'authorization'],
        exposedHeaders: [HEADERS.requestId],
      })
    },
  })
  app.addHook('onRequest', enforceCredentialRules)
```

Under `adminCache`, add `const widgetIdentity = createWidgetIdentity(tenantAuth, config.resolveCacheTtlMs)`.

Before the admin `for` loop, add the widget routes. A static route wins over the `/chat/*` wildcard in find-my-way:

```ts
  app.post('/chat/messages', async (req, reply) => {
    const path = canonicalPath(req.url, '/chat')
    return forward(req, reply, {
      target: config.chatServiceUrl,
      internalToken: config.internalToken,
      routePrefix: '/chat',
      path,
      identity: await widgetIdentity(req),
    })
  })

  app.get('/widget/config', async (req, reply) => {
    const path = canonicalPath(req.url, '/widget')
    return forward(req, reply, {
      target: config.tenantAuthUrl,
      internalToken: config.internalToken,
      routePrefix: '/widget',
      path,
      identity: await widgetIdentity(req),
    })
  })

  app.get('/widget/helpix-widget.js', serveWidgetBundle(config.widgetBundlePath))
```

- [ ] **Step 5: Run the whole gateway suite and typecheck**

Run: `npm test -w services/gateway && npm run typecheck -w services/gateway`
Expected: all PASS. This includes the existing `chat.test.ts` and `admin.test.ts`, which shows the admin routes are unchanged.

- [ ] **Step 6: Commit**

```bash
git add services/gateway
git commit -m "feat(gateway): widget-key auth for /chat/messages and /widget/config, widget CORS, bundle route"
```

---

### Task 5: Widget workspace scaffold, API client and storage

**Files:**
- Create: `apps/widget/package.json`, `apps/widget/tsconfig.json`, `apps/widget/vite.config.ts`, `apps/widget/src/env.d.ts`
- Create: `apps/widget/src/api.ts`, `apps/widget/src/storage.ts`
- Test: `apps/widget/test/storage.test.ts`, `apps/widget/test/helpers.ts`

**Interfaces:**
- Produces:

  ```ts
  // api.ts
  export interface WidgetTarget { widgetKey: string; apiBase: string }
  export interface SendBody { message: string; conversationId?: string; sessionToken?: string }
  export interface WidgetApi {
    fetchConfig(): Promise<WidgetConfig>
    sendMessage(body: SendBody, signal: AbortSignal): Promise<Response>
  }
  export class WidgetApiError extends Error { status: number; code: string }
  export function readApiError(res: Response): Promise<WidgetApiError>
  export function createWidgetApi(target: WidgetTarget, fetchImpl?: typeof fetch): WidgetApi
  // storage.ts
  export interface StoredSession { conversationId: string; sessionToken: string | null }
  export interface StoredMessage { role: 'user' | 'assistant'; content: string; tools: ChatToolEvent[] }
  export function loadSession(widgetKey: string): StoredSession | null
  export function saveSession(widgetKey: string, s: StoredSession): void
  export function clearSession(widgetKey: string): void
  export function loadHistory(widgetKey: string): StoredMessage[]
  export function saveHistory(widgetKey: string, messages: StoredMessage[]): void
  ```

- [ ] **Step 1: Scaffold the workspace**

`apps/widget/package.json`:

```json
{
  "name": "@helpix/widget",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@helpix/shared": "*",
    "@helpix/ui": "*",
    "vue": "^3.5.43"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@vitejs/plugin-vue": "^6.0.9",
    "@vue/test-utils": "^2.5.1",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.3.3",
    "vite": "^8.3.1",
    "vue-tsc": "^3.3.11"
  }
}
```

`apps/widget/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "test/**/*.ts"]
}
```

`apps/widget/src/env.d.ts`:

```ts
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
```

(Copy the dashboard's `src/env.d.ts` instead if it differs.)

`apps/widget/vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// One self-contained IIFE: shops add a single <script> tag. Vue is bundled; CSS is inlined as a string (?inline)
// and applied inside the shadow root, so no separate stylesheet is emitted.
export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
  build: {
    lib: { entry: 'src/main.ts', name: 'HelpixWidget', formats: ['iife'], fileName: () => 'helpix-widget.js' },
    cssCodeSplit: false,
    emptyOutDir: true,
  },
  test: { environment: 'jsdom' },
}))
```

Run: `npm install` (from the repo root, so the new workspace is linked).

- [ ] **Step 2: Write the failing storage test**

`apps/widget/test/storage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSession, loadHistory, loadSession, saveHistory, saveSession } from '../src/storage'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('widget storage', () => {
  it('round-trips the session per widget key', () => {
    saveSession('wk_a', { conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession('wk_a')).toEqual({ conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession('wk_b')).toBeNull()
    expect(localStorage.getItem('helpix:wk_a')).toBe('{"conversationId":"c1","sessionToken":"s1"}')
    clearSession('wk_a')
    expect(loadSession('wk_a')).toBeNull()
  })

  it('ignores corrupt or wrongly shaped values', () => {
    localStorage.setItem('helpix:wk_a', 'not json')
    expect(loadSession('wk_a')).toBeNull()
    localStorage.setItem('helpix:wk_a', '{"conversationId":42}')
    expect(loadSession('wk_a')).toBeNull()
    sessionStorage.setItem('helpix:wk_a', '{"nope":true}')
    expect(loadHistory('wk_a')).toEqual([])
  })

  it('keeps finished messages in sessionStorage', () => {
    const msgs = [{ role: 'user' as const, content: 'hi', tools: [] }, { role: 'assistant' as const, content: 'hello', tools: [] }]
    saveHistory('wk_a', msgs)
    expect(loadHistory('wk_a')).toEqual(msgs)
  })

  it('works when storage throws (blocked cookies, private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(() => saveSession('wk_a', { conversationId: 'c1', sessionToken: null })).not.toThrow()
    expect(loadSession('wk_a')).toBeNull()
    expect(() => clearSession('wk_a')).not.toThrow()
    expect(loadHistory('wk_a')).toEqual([])
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `npm test -w apps/widget -- test/storage.test.ts`
Expected: FAIL, because `../src/storage` is not found.

- [ ] **Step 4: Implement storage and the API client**

`apps/widget/src/storage.ts`:

```ts
import type { ChatToolEvent } from '@helpix/shared/api-types'

export interface StoredSession {
  conversationId: string
  sessionToken: string | null
}

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  tools: ChatToolEvent[]
}

const keyFor = (widgetKey: string) => `helpix:${widgetKey}`

// Storage can be missing or throw (blocked site data, private windows, sandboxed iframes): never let that break chat.
function read(store: () => Storage, key: string): unknown {
  try {
    const raw = store().getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function write(store: () => Storage, key: string, value: unknown): void {
  try {
    store().setItem(key, JSON.stringify(value))
  } catch {
    // Not persisted; the conversation still works for this page view.
  }
}

function remove(store: () => Storage, key: string): void {
  try {
    store().removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

export function loadSession(widgetKey: string): StoredSession | null {
  const v = read(local, keyFor(widgetKey)) as Partial<StoredSession> | null
  if (!v || typeof v.conversationId !== 'string') return null
  return { conversationId: v.conversationId, sessionToken: typeof v.sessionToken === 'string' ? v.sessionToken : null }
}

export function saveSession(widgetKey: string, s: StoredSession): void {
  write(local, keyFor(widgetKey), s)
}

export function clearSession(widgetKey: string): void {
  remove(local, keyFor(widgetKey))
  remove(session, keyFor(widgetKey))
}

export function loadHistory(widgetKey: string): StoredMessage[] {
  const v = read(session, keyFor(widgetKey))
  if (!Array.isArray(v)) return []
  return v.filter(
    (m): m is StoredMessage =>
      !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && Array.isArray(m.tools),
  )
}

export function saveHistory(widgetKey: string, messages: StoredMessage[]): void {
  write(session, keyFor(widgetKey), messages)
}
```

`apps/widget/src/api.ts`:

```ts
import type { WidgetConfig } from '@helpix/shared/api-types'

export interface WidgetTarget {
  widgetKey: string
  /** Gateway origin, no trailing slash. */
  apiBase: string
}

export interface SendBody {
  message: string
  conversationId?: string
  sessionToken?: string
}

export interface WidgetApi {
  fetchConfig(): Promise<WidgetConfig>
  /** The raw response: an SSE stream on success, a JSON error otherwise. */
  sendMessage(body: SendBody, signal: AbortSignal): Promise<Response>
}

export class WidgetApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function readApiError(res: Response): Promise<WidgetApiError> {
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  return new WidgetApiError(res.status, json?.error?.code ?? 'http_error', json?.error?.message ?? `Request failed (${res.status})`)
}

export function createWidgetApi(target: WidgetTarget, fetchImpl: typeof fetch = (...a) => fetch(...a)): WidgetApi {
  const headers = { 'x-helpix-widget-key': target.widgetKey }
  return {
    async fetchConfig() {
      const res = await fetchImpl(`${target.apiBase}/widget/config`, { headers })
      if (!res.ok) throw await readApiError(res)
      return (await res.json()) as WidgetConfig
    },
    sendMessage(body, signal) {
      return fetchImpl(`${target.apiBase}/chat/messages`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    },
  }
}
```

`apps/widget/test/helpers.ts` (used by later tasks):

```ts
import { formatSseEvent } from '@helpix/shared/sse'
import type { ChatStreamEvent, WidgetConfig } from '@helpix/shared/api-types'
import type { SendBody, WidgetApi } from '../src/api'

export const WIDGET_CONFIG: WidgetConfig = { shopName: 'Orchard Store', greeting: 'Hi from Orchard', accentColor: '#0C9A82', orderLookup: false }

export function sseResponse(events: ChatStreamEvent[]): Response {
  return new Response(events.map((e) => formatSseEvent(e.event, e.data)).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

export function errorResponse(status: number, code: string, message = 'nope'): Response {
  return new Response(JSON.stringify({ error: { code, message, requestId: 'r' } }), { status, headers: { 'content-type': 'application/json' } })
}

/** A WidgetApi whose sendMessage answers from a queue and records every body. */
export function fakeApi(replies: Array<Response | (() => Promise<Response>)>, config: WidgetConfig = WIDGET_CONFIG) {
  const bodies: SendBody[] = []
  const api: WidgetApi = {
    fetchConfig: async () => config,
    sendMessage: async (body) => {
      bodies.push(body)
      const next = replies.shift()
      if (!next) throw new Error('no scripted reply left')
      return typeof next === 'function' ? next() : next
    },
  }
  return { api, bodies }
}
```

Make sure `formatSseEvent` is exported from `@helpix/shared/sse` (it is, in `packages/shared/src/sse.ts`).

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w apps/widget -- test/storage.test.ts && npm run typecheck -w apps/widget`
Expected: PASS. (`typecheck` may complain that `src/main.ts` is missing only if `vite.config.ts` is included, which it isn't.)

- [ ] **Step 6: Commit**

```bash
git add apps/widget package-lock.json
git commit -m "feat(widget): workspace scaffold, gateway API client, resilient storage"
```

---

### Task 6: Shadow-root styling and bootstrap

**Files:**
- Create: `apps/widget/src/shadowStyles.ts`, `apps/widget/src/widget.css`, `apps/widget/src/bootstrap.ts`, `apps/widget/src/main.ts`
- Create (temporary stub, replaced in Task 8): `apps/widget/src/App.vue`
- Test: `apps/widget/test/shadowStyles.test.ts`, `apps/widget/test/bootstrap.test.ts`

**Interfaces:**
- Consumes: `createWidgetApi`, `WidgetApi`, `WidgetTarget` (Task 5).
- Produces:

  ```ts
  export function shadowSafeCss(css: string): string
  export function applyStyles(shadow: ShadowRoot, css: string, doc?: Document): void
  export function ensureFonts(doc?: Document): void
  export function readScriptConfig(script: HTMLScriptElement | null, base?: string): WidgetTarget | null
  export interface WidgetController { open(): void; close(): void; destroy(): void }
  export function mountWidget(target: WidgetTarget, opts?: { api?: WidgetApi; doc?: Document; css?: string }): Promise<WidgetController | null>
  ```

  `App.vue` props: `{ config: WidgetConfig; api: WidgetApi; widgetKey: string; state: { open: boolean } }`. `state` is a `reactive` object shared with the controller.

- [ ] **Step 1: Write the failing tests**

`apps/widget/test/shadowStyles.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { applyStyles, ensureFonts, shadowSafeCss } from '../src/shadowStyles'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

const CSS = `@layer theme, base, components, utilities;
.shadow-lg{box-shadow:var(--tw-shadow)}
@property --tw-shadow { syntax: "*"; inherits: false; initial-value: 0 0 #0000; }
@property --tw-ring-color { syntax: "*"; inherits: false }`

describe('shadowSafeCss', () => {
  it('replaces @property rules with initial values in a lowest-priority layer at the top', () => {
    const out = shadowSafeCss(CSS)
    expect(out).not.toContain('@property')
    expect(out.startsWith('@layer properties{:host,*,::before,::after,::backdrop{--tw-shadow:0 0 #0000;--tw-ring-color:initial}}')).toBe(true)
    expect(out).toContain('.shadow-lg{box-shadow:var(--tw-shadow)}')
  })

  it('leaves CSS without @property unchanged', () => {
    expect(shadowSafeCss('.a{color:red}')).toBe('.a{color:red}')
  })
})

describe('applyStyles', () => {
  it('falls back to a <style> element when constructable stylesheets are unavailable (jsdom)', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    applyStyles(shadow, CSS)
    const style = shadow.querySelector('style')!
    expect(style.textContent).toContain('.shadow-lg')
    expect(style.textContent).not.toContain('@property')
  })
})

describe('ensureFonts', () => {
  it('adds the Instrument Sans stylesheet to the host page once', () => {
    ensureFonts()
    ensureFonts()
    const links = document.head.querySelectorAll('link[data-helpix-fonts]')
    expect(links).toHaveLength(1)
    expect((links[0] as HTMLLinkElement).href).toContain('Instrument+Sans')
  })
})
```

`apps/widget/test/bootstrap.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountWidget, readScriptConfig } from '../src/bootstrap'
import { fakeApi } from './helpers'

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.restoreAllMocks()
})

function script(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script')
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v)
  return s
}

describe('readScriptConfig', () => {
  it('reads the widget key and takes the API base from the script origin', () => {
    expect(readScriptConfig(script({ src: 'http://localhost:4000/widget/helpix-widget.js', 'data-widget-key': ' wk_1 ' }))).toEqual({
      widgetKey: 'wk_1',
      apiBase: 'http://localhost:4000',
    })
  })

  it('honours data-api-base and strips its trailing slash', () => {
    const s = script({ src: 'https://cdn.example/helpix-widget.js', 'data-widget-key': 'wk_1', 'data-api-base': 'https://api.example/' })
    expect(readScriptConfig(s)?.apiBase).toBe('https://api.example')
  })

  it('returns null without a script or a key', () => {
    expect(readScriptConfig(null)).toBeNull()
    expect(readScriptConfig(script({ src: 'http://localhost:4000/w.js', 'data-widget-key': '' }))).toBeNull()
  })
})

describe('mountWidget', () => {
  const target = { widgetKey: 'wk_1', apiBase: 'http://gw' }

  it('mounts into an open shadow root on document.body, once', async () => {
    const { api } = fakeApi([])
    const first = await mountWidget(target, { api, css: '.x{}' })
    expect(first).not.toBeNull()
    const host = document.getElementById('helpix-widget-host')!
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot!.querySelector('[data-helpix-root]')).not.toBeNull()
    await mountWidget(target, { api, css: '.x{}' })
    expect(document.querySelectorAll('#helpix-widget-host')).toHaveLength(1)
    first!.destroy()
    expect(document.getElementById('helpix-widget-host')).toBeNull()
  })

  it('renders nothing and warns once when the config cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = { fetchConfig: async () => { throw new Error('origin_not_allowed') }, sendMessage: async () => new Response() }
    expect(await mountWidget(target, { api, css: '' })).toBeNull()
    expect(document.getElementById('helpix-widget-host')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[helpix]')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npm test -w apps/widget`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement**

`apps/widget/src/shadowStyles.ts`. If Task 0 chose option (a), implement that instead and adjust the tests:

```ts
// Tailwind 4 registers its --tw-* variables with @property, and @property is ignored inside a shadow root
// (verified in the Task 0 spike). Without the registered initial values, shadows, rings, transforms and gradients
// compute to nothing. Re-declare the initial values the way Tailwind's own no-@property fallback does, in a layer
// declared first so every utility still overrides it.
const PROPERTY_RULE = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g

export function shadowSafeCss(css: string): string {
  const decls: string[] = []
  const rest = css.replace(PROPERTY_RULE, (_m, name: string, body: string) => {
    const initial = /initial-value\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
    decls.push(`${name}:${initial ?? 'initial'}`)
    return ''
  })
  if (decls.length === 0) return css
  return `@layer properties{:host,*,::before,::after,::backdrop{${decls.join(';')}}}\n${rest}`
}

export function applyStyles(shadow: ShadowRoot, css: string, doc: Document = document): void {
  const text = shadowSafeCss(css)
  const view = doc.defaultView as (Window & typeof globalThis) | null
  const Sheet = view?.CSSStyleSheet
  if (Sheet && 'replaceSync' in Sheet.prototype && 'adoptedStyleSheets' in shadow) {
    const sheet = new Sheet()
    sheet.replaceSync(text)
    shadow.adoptedStyleSheets = [sheet]
    return
  }
  const style = doc.createElement('style')
  style.textContent = text
  shadow.appendChild(style)
}

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap'

/** @font-face inside a shadow root is ignored, so the widget's font is loaded by the host document. */
export function ensureFonts(doc: Document = document): void {
  if (doc.head.querySelector('link[data-helpix-fonts]')) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONTS_HREF
  link.dataset.helpixFonts = ''
  doc.head.appendChild(link)
}
```

`apps/widget/src/widget.css`:

```css
@import "@helpix/ui/styles.css";
@source "./";

/* The shadow root still inherits font, colour and size from the shop's page; start from nothing. Custom properties
   (the theme tokens on :host) are not affected by `all`. */
:host {
  all: initial;
}
```

`apps/widget/src/App.vue` (stub; Task 8 replaces it):

```vue
<script setup lang="ts">
import type { WidgetConfig } from '@helpix/shared/api-types'
import type { WidgetApi } from './api'

defineProps<{ config: WidgetConfig; api: WidgetApi; widgetKey: string; state: { open: boolean } }>()
</script>

<template>
  <div class="font-sans text-foreground">{{ config.shopName }}</div>
</template>
```

`apps/widget/src/bootstrap.ts`:

```ts
import { createApp, reactive } from 'vue'
import css from './widget.css?inline'
import App from './App.vue'
import { createWidgetApi, type WidgetApi, type WidgetTarget } from './api'
import { applyStyles, ensureFonts } from './shadowStyles'

const HOST_ID = 'helpix-widget-host'

export function readScriptConfig(script: HTMLScriptElement | null, base: string = location.href): WidgetTarget | null {
  if (!script) return null
  const widgetKey = script.dataset.widgetKey?.trim()
  if (!widgetKey) return null
  const explicit = script.dataset.apiBase?.trim()
  let apiBase: string
  try {
    apiBase = explicit ? new URL(explicit, base).href : new URL(script.src, base).origin
  } catch {
    return null
  }
  return { widgetKey, apiBase: apiBase.replace(/\/$/, '') }
}

export interface WidgetController {
  open(): void
  close(): void
  destroy(): void
}

export async function mountWidget(
  target: WidgetTarget,
  opts: { api?: WidgetApi; doc?: Document; css?: string } = {},
): Promise<WidgetController | null> {
  const doc = opts.doc ?? document
  if (doc.getElementById(HOST_ID)) return null
  const api = opts.api ?? createWidgetApi(target)

  let config
  try {
    config = await api.fetchConfig()
  } catch (err) {
    console.warn('[helpix] chat widget disabled:', err instanceof Error ? err.message : err)
    return null
  }
  if (doc.getElementById(HOST_ID)) return null

  const host = doc.createElement('div')
  host.id = HOST_ID
  const shadow = host.attachShadow({ mode: 'open' })
  applyStyles(shadow, opts.css ?? css, doc)
  ensureFonts(doc)
  const root = doc.createElement('div')
  root.dataset.helpixRoot = ''
  shadow.appendChild(root)
  doc.body.appendChild(host)

  const state = reactive({ open: false })
  const app = createApp(App, { config, api, widgetKey: target.widgetKey, state })
  app.mount(root)
  return {
    open: () => { state.open = true },
    close: () => { state.open = false },
    destroy: () => {
      app.unmount()
      host.remove()
    },
  }
}
```

`apps/widget/src/main.ts`:

```ts
import { mountWidget, readScriptConfig, type WidgetController } from './bootstrap'

// currentScript is only set while this classic script first runs, so read it before anything async.
const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>('script[data-widget-key]')
const target = readScriptConfig(script)

let controller: WidgetController | null = null
let openRequested = false

declare global {
  interface Window {
    Helpix?: { open(): void; close(): void; identify(jwt: string): void; logout(): void }
  }
}

window.Helpix = {
  open: () => (controller ? controller.open() : (openRequested = true)),
  close: () => {
    openRequested = false
    controller?.close()
  },
  // Shop sign-in arrives in step 4b; until then the widget always chats as an anonymous visitor.
  identify: () => {},
  logout: () => {},
}

function start() {
  if (!target) {
    console.warn('[helpix] add data-widget-key to the helpix-widget.js script tag')
    return
  }
  void mountWidget(target).then((c) => {
    controller = c
    if (c && openRequested) c.open()
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
```

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test -w apps/widget && npm run typecheck -w apps/widget && npm run build -w apps/widget && ls -l apps/widget/dist`
Expected:
- tests PASS
- `dist/helpix-widget.js` exists
- no `.css` file in `dist`
- `grep -c "@property" apps/widget/dist/helpix-widget.js` prints ≥ 1, because the raw CSS string is transformed at runtime

If Vitest cannot resolve `?inline` CSS imports, add `css: true` under `test` in `vite.config.ts`. If Tailwind is too slow under Vitest, pass `css: '.x{}'` everywhere, as the tests already do.

- [ ] **Step 5: Commit**

```bash
git add apps/widget
git commit -m "feat(widget): shadow-root mount, @property fallback, script-tag bootstrap"
```

---

### Task 7: Conversation state (`useChat`)

**Files:**
- Create: `apps/widget/src/useChat.ts`
- Test: `apps/widget/test/useChat.test.ts`

**Interfaces:**
- Consumes: `WidgetApi`, `readApiError` (Task 5), `chatEvents` (`@helpix/shared/chat`), and the storage functions (Task 5).
- Produces:

  ```ts
  export interface WidgetMessage {
    id: number
    role: 'user' | 'assistant'
    content: string
    tools: ChatToolEvent[]
    status: 'done' | 'streaming' | 'error'
    error?: string
  }
  export function useChat(opts: { api: WidgetApi; widgetKey: string }): {
    messages: Ref<WidgetMessage[]>
    busy: Ref<boolean>
    send(text: string): Promise<void>
    retry(): Promise<void>
    newChat(): void
  }
  ```

- [ ] **Step 1: Write the failing tests**

`apps/widget/test/useChat.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { loadHistory, loadSession, saveSession } from '../src/storage'
import { useChat } from '../src/useChat'
import { errorResponse, fakeApi, sseResponse } from './helpers'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

const KEY = 'wk_1'
const reply = (text: string, extra: object = {}) =>
  sseResponse([
    { event: 'meta', data: { conversationId: 'c1', sessionToken: 's1', ...extra } },
    { event: 'tool', data: { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Returns' }] } },
    { event: 'delta', data: { text: text.slice(0, 3) } },
    { event: 'delta', data: { text: text.slice(3) } },
    { event: 'done', data: { messageId: 'm1' } },
  ])

describe('useChat', () => {
  it('streams a reply and remembers the conversation', async () => {
    const { api, bodies } = fakeApi([reply('Hello there')])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('  Hi  ')
    expect(bodies[0]).toEqual({ message: 'Hi' })
    expect(chat.messages.value.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'Hi', 'done'],
      ['assistant', 'Hello there', 'done'],
    ])
    expect(chat.messages.value[1]!.tools[0]!.sources[0]!.title).toBe('Returns')
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1' })
    expect(loadHistory(KEY)).toHaveLength(2)
    expect(chat.busy.value).toBe(false)
  })

  it('sends the stored conversation and session token, keeping the token when meta omits it', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1' })
    const { api, bodies } = fakeApi([sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'done', data: { messageId: 'm2' } }])])
    await useChat({ api, widgetKey: KEY }).send('Again')
    expect(bodies[0]).toEqual({ message: 'Again', conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession(KEY)).toEqual({ conversationId: 'c1', sessionToken: 's1' })
  })

  it('starts a new conversation when the stored one is gone', async () => {
    saveSession(KEY, { conversationId: 'stale', sessionToken: 'old' })
    const { api, bodies } = fakeApi([errorResponse(404, 'conversation_not_found'), reply('Fresh start')])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    expect(bodies).toEqual([{ message: 'Hi', conversationId: 'stale', sessionToken: 'old' }, { message: 'Hi' }])
    expect(chat.messages.value.at(-1)!.content).toBe('Fresh start')
    expect(loadSession(KEY)?.conversationId).toBe('c1')
  })

  it('retries a stale conversation only once', async () => {
    saveSession(KEY, { conversationId: 'stale', sessionToken: 'old' })
    const { api, bodies } = fakeApi([errorResponse(404, 'conversation_not_found'), errorResponse(404, 'conversation_not_found')])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    expect(bodies).toHaveLength(2)
    expect(chat.messages.value.at(-1)!.status).toBe('error')
  })

  it('shows a stream error and "Try again" resends the same message', async () => {
    const { api, bodies } = fakeApi([
      sseResponse([{ event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } }, { event: 'error', data: { code: 'model_unavailable', message: 'The assistant is busy. Try again.' } }]),
      reply('Second time lucky'),
    ])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    const failed = chat.messages.value.at(-1)!
    expect(failed).toMatchObject({ role: 'assistant', status: 'error', error: 'The assistant is busy. Try again.' })
    await chat.retry()
    expect(bodies[1]).toEqual({ message: 'Hi', conversationId: 'c1', sessionToken: 's1' })
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Hi', 'Second time lucky'])
  })

  it('treats a stream that ends without done as an error', async () => {
    const { api } = fakeApi([sseResponse([{ event: 'meta', data: { conversationId: 'c1' } }, { event: 'delta', data: { text: 'Half' } }])])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('Hi')
    expect(chat.messages.value.at(-1)).toMatchObject({ status: 'error', content: 'Half' })
  })

  it('reports HTTP errors and network failures without throwing', async () => {
    const { api } = fakeApi([errorResponse(403, 'tenant_suspended', "This shop's account is suspended"), () => Promise.reject(new TypeError('Failed to fetch'))])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('One')
    expect(chat.messages.value.at(-1)!.error).toBe("This shop's account is suspended")
    await chat.send('Two')
    expect(chat.messages.value.at(-1)!.error).toBe("Couldn't reach the shop's assistant. Check your connection and try again.")
  })

  it('ignores blank messages and messages sent while a reply is streaming', async () => {
    let release!: (r: Response) => void
    const { api, bodies } = fakeApi([() => new Promise<Response>((r) => (release = r))])
    const chat = useChat({ api, widgetKey: KEY })
    await chat.send('   ')
    const first = chat.send('Hi')
    await chat.send('Too soon')
    release(reply('ok'))
    await first
    expect(bodies).toHaveLength(1)
  })

  it('newChat aborts the reply in progress and forgets the conversation', async () => {
    saveSession(KEY, { conversationId: 'c1', sessionToken: 's1' })
    let signal!: AbortSignal
    const api = {
      fetchConfig: async () => { throw new Error('unused') },
      sendMessage: (_b: unknown, s: AbortSignal) => {
        signal = s
        return new Promise<Response>((_r, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      },
    }
    const chat = useChat({ api, widgetKey: KEY })
    const pending = chat.send('Hi')
    chat.newChat()
    await pending
    expect(signal.aborted).toBe(true)
    expect(chat.messages.value).toEqual([])
    expect(loadSession(KEY)).toBeNull()
    expect(chat.busy.value).toBe(false)
  })

  it('restores finished messages from this tab', () => {
    sessionStorage.setItem('helpix:wk_1', JSON.stringify([{ role: 'user', content: 'Earlier', tools: [] }]))
    const chat = useChat({ api: fakeApi([]).api, widgetKey: KEY })
    expect(chat.messages.value.map((m) => m.content)).toEqual(['Earlier'])
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -w apps/widget -- test/useChat.test.ts`
Expected: FAIL, because `../src/useChat` is not found.

- [ ] **Step 3: Implement**

`apps/widget/src/useChat.ts`:

```ts
import { ref, type Ref } from 'vue'
import type { ChatToolEvent } from '@helpix/shared/api-types'
import { CHAT_MESSAGE_MAX, chatEvents } from '@helpix/shared/chat'
import { readApiError, type SendBody, type WidgetApi } from './api'
import { clearSession, loadHistory, loadSession, saveHistory, saveSession } from './storage'

export interface WidgetMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tools: ChatToolEvent[]
  status: 'done' | 'streaming' | 'error'
  error?: string
}

const NETWORK_ERROR = "Couldn't reach the shop's assistant. Check your connection and try again."
const CUT_OFF = 'The reply was cut off. Try again.'

export function useChat({ api, widgetKey }: { api: WidgetApi; widgetKey: string }) {
  let nextId = 1
  const messages: Ref<WidgetMessage[]> = ref(
    loadHistory(widgetKey).map((m) => ({ ...m, id: nextId++, status: 'done' as const })),
  )
  const busy = ref(false)
  let controller: AbortController | null = null

  function persist() {
    saveHistory(
      widgetKey,
      messages.value.filter((m) => m.status === 'done').map(({ role, content, tools }) => ({ role, content, tools })),
    )
  }

  /** The reactive copy of the reply bubble, so in-place updates re-render. */
  function bubble(id: number): WidgetMessage {
    return messages.value.find((m) => m.id === id)!
  }

  function fail(id: number, error: string) {
    const m = bubble(id)
    m.status = 'error'
    m.error = error
  }

  async function runTurn(text: string, replyId: number, signal: AbortSignal, allowFreshStart: boolean): Promise<void> {
    const session = loadSession(widgetKey)
    const body: SendBody = { message: text }
    if (session) {
      body.conversationId = session.conversationId
      if (session.sessionToken) body.sessionToken = session.sessionToken
    }
    const res = await api.sendMessage(body, signal)
    if (!res.ok) {
      const err = await readApiError(res)
      // A stored conversation can disappear (database reset, storage copied between browsers): start over once.
      if (err.status === 404 && err.code === 'conversation_not_found' && session && allowFreshStart) {
        clearSession(widgetKey)
        return runTurn(text, replyId, signal, false)
      }
      return fail(replyId, err.message)
    }
    let sessionToken = session?.sessionToken ?? null
    for await (const e of chatEvents(res)) {
      const reply = bubble(replyId)
      if (e.event === 'meta') {
        sessionToken = e.data.sessionToken ?? sessionToken
        saveSession(widgetKey, { conversationId: e.data.conversationId, sessionToken })
      } else if (e.event === 'delta') {
        reply.content += e.data.text
      } else if (e.event === 'tool') {
        reply.tools.push(e.data)
      } else if (e.event === 'done') {
        reply.status = 'done'
        persist()
        return
      } else if (e.event === 'error') {
        return fail(replyId, e.data.message)
      }
    }
    fail(replyId, CUT_OFF)
  }

  async function start(text: string) {
    const reply: WidgetMessage = { id: nextId++, role: 'assistant', content: '', tools: [], status: 'streaming' }
    messages.value.push(reply)
    busy.value = true
    const ctrl = new AbortController()
    controller = ctrl
    try {
      await runTurn(text, reply.id, ctrl.signal, true)
    } catch {
      if (!ctrl.signal.aborted && messages.value.some((m) => m.id === reply.id)) fail(reply.id, NETWORK_ERROR)
    } finally {
      if (controller === ctrl) {
        controller = null
        busy.value = false
      }
    }
  }

  async function send(raw: string): Promise<void> {
    const text = raw.trim().slice(0, CHAT_MESSAGE_MAX)
    if (!text || busy.value) return
    messages.value.push({ id: nextId++, role: 'user', content: text, tools: [], status: 'done' })
    await start(text)
  }

  /** Resends the user message behind the last failed reply. The server stored nothing for the failed turn. */
  async function retry(): Promise<void> {
    const last = messages.value.at(-1)
    const user = messages.value.at(-2)
    if (busy.value || last?.status !== 'error' || user?.role !== 'user') return
    messages.value.pop()
    await start(user.content)
  }

  function newChat(): void {
    controller?.abort()
    controller = null
    busy.value = false
    messages.value = []
    clearSession(widgetKey)
  }

  return { messages, busy, send, retry, newChat }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w apps/widget && npm run typecheck -w apps/widget`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/widget
git commit -m "feat(widget): conversation state with stale-conversation recovery and retry"
```

---

### Task 8: Widget UI (launcher, panel, bubbles, composer)

**Files:**
- Replace: `apps/widget/src/App.vue`
- Create: `apps/widget/src/components/Launcher.vue`, `ChatPanel.vue`, `MessageBubble.vue`, `Composer.vue`
- Test: `apps/widget/test/chatPanel.test.ts`

**Interfaces:**
- Consumes: `useChat` (Task 7), `chipsFor` (`@helpix/shared/chat`), `HelpixLogo` (`@helpix/ui`), and the `App.vue` props from Task 6.
- Produces:
  - DOM hooks for tests and the smoke check: `[data-helpix-launcher]`, `[data-helpix-panel]`, `[data-role="user"|"assistant"]`, `[data-helpix-retry]`, `[data-helpix-new-chat]`
  - a `textarea` in the composer

- [ ] **Step 1: Write the failing test**

`apps/widget/test/chatPanel.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../src/App.vue'
import { WIDGET_CONFIG, errorResponse, fakeApi, sseResponse } from './helpers'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

function mountApp(replies: Response[]) {
  const { api, bodies } = fakeApi(replies)
  const state = reactive({ open: false })
  const wrapper = mount(App, { props: { config: { ...WIDGET_CONFIG, accentColor: '#123456' }, api, widgetKey: 'wk_1', state }, attachTo: document.body })
  return { wrapper, bodies, state }
}

const answer = (text: string) =>
  sseResponse([
    { event: 'meta', data: { conversationId: 'c1', sessionToken: 's1' } },
    { event: 'tool', data: { name: 'search_kb', status: 'ok', sources: [{ documentId: 'd1', title: 'Shipping' }] } },
    { event: 'delta', data: { text } },
    { event: 'done', data: { messageId: 'm1' } },
  ])

describe('widget UI', () => {
  it('shows the launcher in the accent colour and opens a panel headed with the shop name and greeting', async () => {
    const { wrapper } = mountApp([])
    const launcher = wrapper.get('[data-helpix-launcher]')
    expect(launcher.attributes('style')).toContain('background-color: rgb(18, 52, 86)')
    expect(launcher.attributes('aria-label')).toBe('Open chat')
    expect(wrapper.find('[data-helpix-panel]').exists()).toBe(false)
    await launcher.trigger('click')
    const panel = wrapper.get('[data-helpix-panel]')
    expect(panel.text()).toContain('Orchard Store')
    expect(panel.text()).toContain('Hi from Orchard')
    expect(panel.text()).toContain('Powered by')
    expect(launcher.attributes('aria-label')).toBe('Close chat')
  })

  it('sends with Enter, keeps Shift+Enter for new lines, and shows sources', async () => {
    const { wrapper, bodies, state } = mountApp([answer('We ship in 2 days.')])
    state.open = true
    await flushPromises()
    const box = wrapper.get('textarea')
    await box.setValue('How fast')
    await box.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(bodies).toHaveLength(0)
    await box.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(bodies[0]).toEqual({ message: 'How fast' })
    expect(wrapper.findAll('[data-role="assistant"]').at(-1)!.text()).toContain('We ship in 2 days.')
    expect(wrapper.text()).toContain('Shipping')
    expect((box.element as HTMLTextAreaElement).value).toBe('')
  })

  it('renders reply text as plain text', async () => {
    const { wrapper, state } = mountApp([answer('<img src=x onerror="window.pwned=1"> **bold**')])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const panel = wrapper.get('[data-helpix-panel]')
    expect(panel.find('img').exists()).toBe(false)
    expect(panel.text()).toContain('<img src=x onerror="window.pwned=1"> **bold**')
  })

  it('offers Try again after an error', async () => {
    const { wrapper, bodies, state } = mountApp([errorResponse(503, 'upstream_unavailable', 'A backend service is unavailable'), answer('Back now')])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('A backend service is unavailable')
    await wrapper.get('[data-helpix-retry]').trigger('click')
    await flushPromises()
    expect(bodies).toHaveLength(2)
    expect(wrapper.text()).toContain('Back now')
    expect(wrapper.find('[data-helpix-retry]').exists()).toBe(false)
  })

  it('New chat clears the transcript', async () => {
    const { wrapper, state } = mountApp([answer('First')])
    state.open = true
    await flushPromises()
    await wrapper.get('textarea').setValue('hi')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-helpix-new-chat]').trigger('click')
    expect(wrapper.findAll('[data-role="user"]')).toHaveLength(0)
    expect(localStorage.getItem('helpix:wk_1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -w apps/widget -- test/chatPanel.test.ts`
Expected: FAIL, because there is no launcher in the stub `App.vue`.

- [ ] **Step 3: Implement the components**

`apps/widget/src/components/Launcher.vue`:

```vue
<script setup lang="ts">
import { HelpixLogo } from '@helpix/ui'

defineProps<{ open: boolean; color: string }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <!-- 56 px, 16 px from the corner, white 28 px mark on the shop's accent (DESIGN.md "Chat surfaces"). -->
  <button
    type="button"
    data-helpix-launcher
    :aria-label="open ? 'Close chat' : 'Open chat'"
    :aria-expanded="open"
    class="fixed bottom-4 right-4 z-[2147483000] grid size-14 place-items-center rounded-full text-white shadow-[0_8px_24px_-6px_rgb(12_154_130/0.45)] transition-transform duration-150 ease-out hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 motion-reduce:transition-none"
    :style="{ backgroundColor: color }"
    @click="$emit('toggle')"
  >
    <svg v-if="open" viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
    <HelpixLogo v-else mark-only class="size-7 text-white" aria-hidden="true" />
  </button>
</template>
```

`apps/widget/src/components/MessageBubble.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { chipsFor } from '@helpix/shared/chat'
import type { WidgetMessage } from '../useChat'

const props = defineProps<{ message: WidgetMessage }>()
defineEmits<{ retry: [] }>()
const chips = computed(() => chipsFor(props.message.tools).filter((c) => c.tone === 'source'))
const typing = computed(() => props.message.status === 'streaming' && !props.message.content)
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="message.role === 'user' ? 'items-end' : 'items-start'" :data-role="message.role">
    <!-- Plain text only: replies are never rendered as HTML. -->
    <div
      v-if="message.content || typing"
      class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
      :class="message.role === 'user' ? 'rounded-br-md bg-foreground text-background' : 'rounded-bl-md bg-secondary text-secondary-foreground'"
    >
      <template v-if="message.content">{{ message.content }}</template>
      <span v-else class="inline-flex gap-1 py-1" role="status" aria-label="The assistant is typing">
        <span v-for="i in 3" :key="i" class="size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-pulse" :style="{ animationDelay: `${i * 150}ms` }" />
      </span>
    </div>
    <ul v-if="chips.length" class="flex max-w-[85%] flex-wrap gap-1.5" aria-label="Sources">
      <li v-for="chip in chips" :key="chip.key" class="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground" :title="`Source: ${chip.label}`">
        {{ chip.label }}
      </li>
    </ul>
    <p v-if="message.status === 'error'" class="flex max-w-[85%] items-center gap-2 text-xs text-destructive" role="alert">
      <span>{{ message.error }}</span>
      <button type="button" data-helpix-retry class="rounded-md font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" @click="$emit('retry')">
        Try again
      </button>
    </p>
  </div>
</template>
```

`apps/widget/src/components/Composer.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { CHAT_MESSAGE_MAX } from '@helpix/shared/chat'

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ send: [text: string] }>()
const text = ref('')

function submit() {
  if (props.busy || !text.value.trim()) return
  emit('send', text.value)
  text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="flex items-end gap-2 border-t border-border p-3" @submit.prevent="submit">
    <label class="sr-only" for="helpix-composer">Message</label>
    <textarea
      id="helpix-composer"
      v-model="text"
      rows="1"
      :maxlength="CHAT_MESSAGE_MAX"
      placeholder="Ask a question"
      class="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      @keydown="onKeydown"
    />
    <button
      type="submit"
      :disabled="busy || !text.trim()"
      class="h-10 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Send
    </button>
  </form>
</template>
```

`apps/widget/src/components/ChatPanel.vue`:

```vue
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { WidgetConfig } from '@helpix/shared/api-types'
import { HelpixLogo } from '@helpix/ui'
import type { WidgetMessage } from '../useChat'
import Composer from './Composer.vue'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ config: WidgetConfig; messages: WidgetMessage[]; busy: boolean }>()
defineEmits<{ send: [text: string]; retry: []; newChat: []; close: [] }>()

const list = ref<HTMLElement | null>(null)
// Follow the newest text while it streams in.
watch(
  () => props.messages.map((m) => m.content.length).join(),
  async () => {
    await nextTick()
    list.value?.scrollTo({ top: list.value.scrollHeight })
  },
)
</script>

<template>
  <section
    data-helpix-panel
    role="dialog"
    :aria-label="`Chat with ${config.shopName}`"
    class="fixed bottom-22 right-4 z-[2147483000] flex h-[min(640px,calc(100dvh-7rem))] w-[380px] flex-col overflow-hidden rounded-xl border border-border bg-background font-sans text-foreground shadow-[0_24px_48px_-12px_rgb(12_154_130/0.28)] max-[480px]:inset-0 max-[480px]:h-dvh max-[480px]:w-full max-[480px]:rounded-none"
  >
    <header class="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
      <h2 class="min-w-0 flex-1 truncate font-sans text-[15px] font-semibold tracking-normal">{{ config.shopName }}</h2>
      <button type="button" data-helpix-new-chat class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" @click="$emit('newChat')">
        New chat
      </button>
      <button type="button" aria-label="Close chat" class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" @click="$emit('close')">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div ref="list" class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
      <MessageBubble :message="{ id: 0, role: 'assistant', content: config.greeting, tools: [], status: 'done' }" />
      <MessageBubble v-for="m in messages" :key="m.id" :message="m" @retry="$emit('retry')" />
    </div>

    <Composer :busy="busy" @send="$emit('send', $event)" />

    <footer class="flex items-center justify-center gap-1.5 pb-2.5 text-[12px] text-muted-foreground">
      <span>Powered by</span>
      <HelpixLogo class="h-auto w-[72px]" />
    </footer>
  </section>
</template>
```

`apps/widget/src/App.vue`:

```vue
<script setup lang="ts">
import type { WidgetConfig } from '@helpix/shared/api-types'
import type { WidgetApi } from './api'
import ChatPanel from './components/ChatPanel.vue'
import Launcher from './components/Launcher.vue'
import { useChat } from './useChat'

const props = defineProps<{ config: WidgetConfig; api: WidgetApi; widgetKey: string; state: { open: boolean } }>()
const chat = useChat({ api: props.api, widgetKey: props.widgetKey })
</script>

<template>
  <div class="font-sans text-foreground antialiased">
    <Transition
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="translate-y-2 scale-[0.98] opacity-0"
      leave-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      leave-to-class="translate-y-2 scale-[0.98] opacity-0"
    >
      <ChatPanel
        v-if="state.open"
        class="origin-bottom-right"
        :config="config"
        :messages="chat.messages.value"
        :busy="chat.busy.value"
        @send="chat.send"
        @retry="chat.retry"
        @new-chat="chat.newChat"
        @close="state.open = false"
      />
    </Transition>
    <Launcher :open="state.open" :color="config.accentColor" @toggle="state.open = !state.open" />
  </div>
</template>
```

Notes for the implementer:
- `bottom-22` is 88 px: the 56 px launcher plus 16 px of offset plus a 16 px gap. On narrow screens the panel covers the launcher on purpose, and closing happens from the header button.
- Do not add `<style>` blocks to these SFCs. Library mode would emit them as a separate CSS file, which never reaches the shadow root.

- [ ] **Step 4: Run tests, typecheck and build**

Run: `npm test -w apps/widget && npm run typecheck -w apps/widget && npm run build -w apps/widget && ls apps/widget/dist`
Expected: PASS, and `dist` contains only `helpix-widget.js`.

- [ ] **Step 5: Commit**

```bash
git add apps/widget
git commit -m "feat(widget): launcher, chat panel, streamed bubbles with sources and retry"
```

---

### Task 9: Orchard Store demo (`demos/iphone-store`)

**Files:**
- Modify: `package.json` (workspaces add `"demos/*"`), `.gitignore` (add `*.local`)
- Create: `demos/iphone-store/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.development`
- Create: `demos/iphone-store/src/main.ts`, `App.vue`, `router.ts`, `styles.css`, `products.ts`, `cart.ts`, `env.d.ts`
- Create: `demos/iphone-store/src/components/PhoneArt.vue`, `src/pages/HomePage.vue`, `ProductPage.vue`, `BagPage.vue`
- Create: `demos/iphone-store/seed/shop.json`, `seed/agent.json`, `seed/kb/shipping.md`, `returns.md`, `warranty.md`, `protection-plan.md`, `trade-in.md`, `store-hours.md`
- Test: `demos/iphone-store/test/cart.test.ts`

**Interfaces:**
- Consumes: the widget script contract from Task 6 (`data-widget-key`, with the API base taken from the script `src`).
- Produces:
  - `seed/shop.json` `{ name, slug, origin, adminEmail, adminPassword }`
  - `seed/agent.json`, a full `AgentConfig`
  - `seed/kb/*.md`, where the first `# ` line is the document title

  All three are read by Task 10.

- [ ] **Step 1: Write the failing cart test**

`demos/iphone-store/test/cart.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { addToBag, bag, bagCount, bagTotal, clearBag, removeFromBag } from '../src/cart'
import { PRODUCTS } from '../src/products'

beforeEach(() => {
  localStorage.clear()
  clearBag()
})

describe('bag', () => {
  it('adds, merges identical lines and totals in cents', () => {
    const p = PRODUCTS[0]!
    addToBag(p.id, p.colors[0]!.name, p.storage[0]!.gb)
    addToBag(p.id, p.colors[0]!.name, p.storage[0]!.gb)
    expect(bag.value).toHaveLength(1)
    expect(bagCount.value).toBe(2)
    expect(bagTotal.value).toBe(2 * p.storage[0]!.priceCents)
  })

  it('removes a line and persists to localStorage', () => {
    const p = PRODUCTS[1]!
    addToBag(p.id, p.colors[0]!.name, p.storage[0]!.gb)
    expect(JSON.parse(localStorage.getItem('orchard:bag')!)).toHaveLength(1)
    removeFromBag(bag.value[0]!.key)
    expect(bag.value).toEqual([])
  })
})
```

- [ ] **Step 2: Scaffold and run to see it fail**

Root `package.json` workspaces: `["packages/*", "services/*", "apps/*", "demos/*"]`. `.gitignore`: append `*.local`.

`demos/iphone-store/package.json`:

```json
{
  "name": "@helpix/demo-iphone-store",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@helpix/ui": "*",
    "vue": "^3.5.43",
    "vue-router": "^5.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@vitejs/plugin-vue": "^6.0.9",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.3.3",
    "vite": "^8.3.1",
    "vue-tsc": "^3.3.11"
  }
}
```

`demos/iphone-store/tsconfig.json`: same as `apps/widget/tsconfig.json`. `src/env.d.ts`: same as the widget's.

`demos/iphone-store/vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// The tenant's allowed origin is exactly http://localhost:5174 (seed/shop.json), so never drift to another port.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  test: { environment: 'jsdom' },
})
```

`demos/iphone-store/.env.development` (committed defaults; `make seed-demos` writes the real key to `.env.development.local`, which takes precedence and is gitignored):

```
VITE_HELPIX_GATEWAY=http://localhost:4000
VITE_HELPIX_WIDGET_KEY=
```

Run: `npm install && npm test -w demos/iphone-store`
Expected: FAIL, because `../src/cart` is not found.

- [ ] **Step 3: Implement the catalogue and the bag**

`demos/iphone-store/src/products.ts`:

```ts
export interface Product {
  id: string
  name: string
  tagline: string
  description: string
  /** CSS colours for the product art. */
  colors: { name: string; body: string; accent: string }[]
  storage: { gb: number; priceCents: number }[]
  kind: 'phone' | 'accessory'
}

// A fictional brand for the Helpix demo. No real company's names, marks or photos.
export const PRODUCTS: Product[] = [
  {
    id: 'orchard-one-pro',
    name: 'Orchard One Pro',
    tagline: 'Titanium frame. Triple camera. All-day battery.',
    description: 'Our most capable phone: a 6.3-inch display, a 48 MP triple camera and a frame that shrugs off drops.',
    colors: [
      { name: 'Graphite', body: '#2B2D31', accent: '#55595F' },
      { name: 'Glacier', body: '#C9D3DA', accent: '#EEF2F5' },
      { name: 'Desert', body: '#B49A82', accent: '#D8C4AF' },
    ],
    storage: [{ gb: 256, priceCents: 109900 }, { gb: 512, priceCents: 129900 }, { gb: 1024, priceCents: 149900 }],
    kind: 'phone',
  },
  {
    id: 'orchard-one',
    name: 'Orchard One',
    tagline: 'Everything you need, nothing you don’t.',
    description: 'A 6.1-inch display, a 48 MP dual camera and the same fast chip as last year’s Pro.',
    colors: [
      { name: 'Midnight', body: '#1F2433', accent: '#3A4260' },
      { name: 'Sage', body: '#9FB3A0', accent: '#C9D8C9' },
      { name: 'Coral', body: '#E88B78', accent: '#F4B7AA' },
    ],
    storage: [{ gb: 128, priceCents: 79900 }, { gb: 256, priceCents: 89900 }],
    kind: 'phone',
  },
  {
    id: 'orchard-mini',
    name: 'Orchard Mini',
    tagline: 'Pocket-sized. Full-sized power.',
    description: 'A 5.4-inch phone that fits one hand, with the One’s camera and chip.',
    colors: [
      { name: 'Starlight', body: '#E6DFD3', accent: '#F7F3EC' },
      { name: 'Ink', body: '#202124', accent: '#3C3D41' },
    ],
    storage: [{ gb: 128, priceCents: 59900 }, { gb: 256, priceCents: 69900 }],
    kind: 'phone',
  },
  {
    id: 'orchard-buds',
    name: 'Orchard Buds',
    tagline: 'Noise cancelling. Six-hour battery.',
    description: 'Wireless earbuds with active noise cancelling and a case that charges on any Qi pad.',
    colors: [{ name: 'Snow', body: '#F2F2F2', accent: '#FFFFFF' }],
    storage: [{ gb: 0, priceCents: 17900 }],
    kind: 'accessory',
  },
]

export const productById = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id)

export const formatPrice = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
```

`demos/iphone-store/src/cart.ts`:

```ts
import { computed, ref } from 'vue'
import { productById } from './products'

export interface BagLine {
  key: string
  productId: string
  color: string
  gb: number
  quantity: number
}

const STORAGE_KEY = 'orchard:bag'

function load(): BagLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bag.value))
  } catch {
    // The bag still works for this page view.
  }
}

export const bag = ref<BagLine[]>(load())
export const bagCount = computed(() => bag.value.reduce((n, l) => n + l.quantity, 0))
export const bagTotal = computed(() =>
  bag.value.reduce((sum, l) => {
    const price = productById(l.productId)?.storage.find((s) => s.gb === l.gb)?.priceCents ?? 0
    return sum + price * l.quantity
  }, 0),
)

export function addToBag(productId: string, color: string, gb: number): void {
  const key = `${productId}:${color}:${gb}`
  const line = bag.value.find((l) => l.key === key)
  if (line) line.quantity += 1
  else bag.value.push({ key, productId, color, gb, quantity: 1 })
  save()
}

export function removeFromBag(key: string): void {
  bag.value = bag.value.filter((l) => l.key !== key)
  save()
}

export function clearBag(): void {
  bag.value = []
  save()
}
```

Run: `npm test -w demos/iphone-store`
Expected: PASS.

- [ ] **Step 4: Build the storefront**

`demos/iphone-store/index.html`:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orchard Store</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
    <!-- The Helpix embed, exactly as a shop would paste it. `make seed-demos` fills in the key. -->
    <script src="%VITE_HELPIX_GATEWAY%/widget/helpix-widget.js" data-widget-key="%VITE_HELPIX_WIDGET_KEY%" defer></script>
  </body>
</html>
```

`demos/iphone-store/src/styles.css`:

```css
@import "@helpix/ui/styles.css";
@source "./";

/* Orchard Store's own brand: a sleek dark palette. It overrides the helpix tokens for the storefront only;
   the widget keeps helpix's own tokens inside its shadow root. */
:root {
  --background: #050506;
  --foreground: #F5F5F7;
  --card: #111114;
  --card-foreground: #F5F5F7;
  --primary: #F5F5F7;
  --primary-foreground: #050506;
  --secondary: #1C1C21;
  --secondary-foreground: #F5F5F7;
  --muted: #18181C;
  --muted-foreground: #A1A1AA;
  --border: #26262C;
  --input: #26262C;
  --ring: #8AB4FF;
  --radius: 1rem;
}

@theme {
  --font-sans: -apple-system, "SF Pro Text", "Inter", system-ui, sans-serif;
  --font-display: -apple-system, "SF Pro Display", "Inter", system-ui, sans-serif;
}
```

`demos/iphone-store/src/main.ts`:

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles.css'

if (!import.meta.env.VITE_HELPIX_WIDGET_KEY) {
  console.warn('[orchard] No widget key yet. Run `make seed-demos` with the stack up, then restart this dev server.')
}

createApp(App).use(router).mount('#app')
```

`demos/iphone-store/src/router.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router'
import BagPage from './pages/BagPage.vue'
import HomePage from './pages/HomePage.vue'
import ProductPage from './pages/ProductPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/product/:id', component: ProductPage, props: true },
    { path: '/bag', component: BagPage },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
```

`demos/iphone-store/src/App.vue`:

```vue
<script setup lang="ts">
import { bagCount } from './cart'
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
    <header class="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <nav class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <RouterLink to="/" class="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          <span class="grid size-6 place-items-center rounded-full bg-foreground text-[11px] font-bold text-background" aria-hidden="true">O</span>
          Orchard
        </RouterLink>
        <RouterLink to="/" class="text-sm text-muted-foreground hover:text-foreground">Phones</RouterLink>
        <span class="flex-1" />
        <RouterLink to="/bag" class="text-sm text-muted-foreground hover:text-foreground">Bag ({{ bagCount }})</RouterLink>
      </nav>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-10">
      <RouterView />
    </main>
    <footer class="mx-auto max-w-6xl px-4 pb-24 text-xs text-muted-foreground">
      Orchard Store is a fictional shop for the Helpix demo. Nothing here is for sale.
    </footer>
  </div>
</template>
```

`demos/iphone-store/src/components/PhoneArt.vue`:

```vue
<script setup lang="ts">
defineProps<{ body: string; accent: string; kind: 'phone' | 'accessory'; size?: 'sm' | 'lg' }>()
</script>

<template>
  <!-- CSS-only product art: a rounded slab with a camera island, or a pair of earbuds. -->
  <div class="grid place-items-center" :class="size === 'lg' ? 'h-96' : 'h-56'" aria-hidden="true">
    <div
      v-if="kind === 'phone'"
      class="relative rounded-[2.2rem] shadow-2xl ring-1 ring-white/10"
      :class="size === 'lg' ? 'h-80 w-40' : 'h-44 w-22'"
      :style="{ background: `linear-gradient(160deg, ${accent}, ${body} 55%)` }"
    >
      <div class="absolute left-3 top-3 grid size-[38%] grid-cols-2 gap-1 rounded-2xl bg-black/25 p-1.5">
        <span v-for="i in 3" :key="i" class="rounded-full bg-black/70 ring-2 ring-white/10" />
      </div>
    </div>
    <div v-else class="flex gap-3">
      <span v-for="i in 2" :key="i" class="block h-20 w-10 rounded-full shadow-xl ring-1 ring-black/10" :style="{ background: `linear-gradient(180deg, ${accent}, ${body})` }" />
    </div>
  </div>
</template>
```

`demos/iphone-store/src/pages/HomePage.vue`:

```vue
<script setup lang="ts">
import PhoneArt from '../components/PhoneArt.vue'
import { formatPrice, PRODUCTS } from '../products'
</script>

<template>
  <section class="mb-12 max-w-2xl">
    <h1 class="font-display text-5xl font-semibold tracking-tight">The new Orchard lineup.</h1>
    <p class="mt-3 text-lg text-muted-foreground">Free two-day shipping, 30-day returns, and someone to ask in the corner of every page.</p>
  </section>
  <ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
    <li v-for="p in PRODUCTS" :key="p.id">
      <RouterLink :to="`/product/${p.id}`" class="block rounded-xl bg-card p-5 ring-1 ring-border transition hover:ring-foreground/30">
        <PhoneArt :body="p.colors[0]!.body" :accent="p.colors[0]!.accent" :kind="p.kind" />
        <h2 class="mt-4 font-display text-lg font-semibold">{{ p.name }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ p.tagline }}</p>
        <p class="mt-3 text-sm">From {{ formatPrice(p.storage[0]!.priceCents) }}</p>
      </RouterLink>
    </li>
  </ul>
</template>
```

`demos/iphone-store/src/pages/ProductPage.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { addToBag } from '../cart'
import PhoneArt from '../components/PhoneArt.vue'
import { formatPrice, productById } from '../products'

const props = defineProps<{ id: string }>()
const product = computed(() => productById(props.id))
const color = ref(0)
const storage = ref(0)
const added = ref(false)
watch(() => props.id, () => { color.value = 0; storage.value = 0; added.value = false })

function add() {
  const p = product.value!
  addToBag(p.id, p.colors[color.value]!.name, p.storage[storage.value]!.gb)
  added.value = true
}
</script>

<template>
  <p v-if="!product" class="text-muted-foreground">That product doesn’t exist. <RouterLink to="/" class="underline">Back to phones</RouterLink></p>
  <div v-else class="grid gap-10 md:grid-cols-2">
    <div class="rounded-xl bg-card ring-1 ring-border">
      <PhoneArt size="lg" :body="product.colors[color]!.body" :accent="product.colors[color]!.accent" :kind="product.kind" />
    </div>
    <div>
      <h1 class="font-display text-4xl font-semibold tracking-tight">{{ product.name }}</h1>
      <p class="mt-3 text-muted-foreground">{{ product.description }}</p>
      <fieldset class="mt-8">
        <legend class="text-sm font-medium">Colour: {{ product.colors[color]!.name }}</legend>
        <div class="mt-3 flex gap-3">
          <button
            v-for="(c, i) in product.colors"
            :key="c.name"
            type="button"
            :aria-label="c.name"
            :aria-pressed="i === color"
            class="size-9 rounded-full ring-2 ring-offset-2 ring-offset-background"
            :class="i === color ? 'ring-foreground' : 'ring-transparent'"
            :style="{ background: c.body }"
            @click="color = i"
          />
        </div>
      </fieldset>
      <fieldset v-if="product.kind === 'phone'" class="mt-6">
        <legend class="text-sm font-medium">Storage</legend>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="(s, i) in product.storage"
            :key="s.gb"
            type="button"
            :aria-pressed="i === storage"
            class="rounded-lg px-4 py-2 text-sm ring-1"
            :class="i === storage ? 'ring-foreground' : 'ring-border text-muted-foreground'"
            @click="storage = i"
          >
            {{ s.gb >= 1024 ? `${s.gb / 1024} TB` : `${s.gb} GB` }} · {{ formatPrice(s.priceCents) }}
          </button>
        </div>
      </fieldset>
      <button type="button" class="mt-8 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground" @click="add">
        Add to bag · {{ formatPrice(product.storage[storage]!.priceCents) }}
      </button>
      <p v-if="added" class="mt-3 text-sm text-muted-foreground" role="status">
        Added. <RouterLink to="/bag" class="underline">Review your bag</RouterLink>
      </p>
    </div>
  </div>
</template>
```

`demos/iphone-store/src/pages/BagPage.vue`:

```vue
<script setup lang="ts">
import { bag, bagTotal, removeFromBag } from '../cart'
import { formatPrice, productById } from '../products'
</script>

<template>
  <h1 class="font-display text-4xl font-semibold tracking-tight">Your bag</h1>
  <p v-if="bag.length === 0" class="mt-6 text-muted-foreground">Your bag is empty. <RouterLink to="/" class="underline">Browse phones</RouterLink></p>
  <template v-else>
    <ul class="mt-8 divide-y divide-border rounded-xl bg-card ring-1 ring-border">
      <li v-for="line in bag" :key="line.key" class="flex items-center gap-4 p-5">
        <div class="flex-1">
          <p class="font-medium">{{ productById(line.productId)?.name ?? line.productId }}</p>
          <p class="text-sm text-muted-foreground">{{ line.color }}<template v-if="line.gb"> · {{ line.gb >= 1024 ? `${line.gb / 1024} TB` : `${line.gb} GB` }}</template> · Qty {{ line.quantity }}</p>
        </div>
        <button type="button" class="text-sm text-muted-foreground underline" @click="removeFromBag(line.key)">Remove</button>
      </li>
    </ul>
    <div class="mt-6 flex items-center justify-between">
      <p class="text-lg">Total {{ formatPrice(bagTotal) }}</p>
      <button type="button" disabled class="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground opacity-50" title="This is a demo shop">
        Check out (demo)
      </button>
    </div>
  </template>
</template>
```

- [ ] **Step 5: Write the seed content**

`demos/iphone-store/seed/shop.json`:

```json
{
  "name": "Orchard Store",
  "slug": "orchard-store",
  "origin": "http://localhost:5174",
  "adminEmail": "admin@orchard.demo",
  "adminPassword": "orchard-demo-password"
}
```

`demos/iphone-store/seed/agent.json`:

```json
{
  "prompt": "You are the support assistant for Orchard Store, an online shop selling Orchard phones (Orchard One Pro, Orchard One, Orchard Mini) and Orchard Buds earbuds. Answer questions about shipping, returns, warranty, the Orchard Care protection plan, trade-ins and support hours using the knowledge base. Prices are in US dollars. If the knowledge base does not cover a question, say so and suggest emailing support@orchard.demo. You cannot see orders yet; if someone asks about an order, ask them to email support with their order number.",
  "tone": "professional",
  "toneNotes": "Sleek and confident, like a premium electronics store. Short sentences. No exclamation marks. Never more than three short paragraphs.",
  "greeting": "Hi, welcome to Orchard. Ask me about shipping, returns, warranty or trade-ins.",
  "accentColor": "#0C9A82",
  "modelOverride": null
}
```

Write six markdown files in `demos/iphone-store/seed/kb/`. Each starts with a `# Title` line and has 120–250 words of concrete, internally consistent policy. Use these facts exactly, because the smoke check and manual test ask about them:
- `shipping.md` "Shipping and delivery": free two-day shipping in the contiguous US on every order; next-day for $15 if ordered by 2 pm ET; Alaska/Hawaii 3–5 days; no international shipping; tracking email when the order ships.
- `returns.md` "Returns and refunds": 30 days from delivery; device must be in original condition with all accessories; free prepaid return label; refund to the original payment method within 5 business days of inspection; opened earbuds are returnable only if defective.
- `warranty.md` "Limited warranty": one year from purchase covering manufacturing defects; does not cover accidental damage, liquid damage or unauthorised repairs; claims through support@orchard.demo with the serial number.
- `protection-plan.md` "Orchard Care protection plan": $9.99 per month or $199 for two years; adds accidental-damage cover with two incidents per year, $29 screen repair and $99 other damage; buy within 60 days of purchase.
- `trade-in.md` "Trade-in program": trade in any Orchard phone or a phone from another brand in working condition; credit from $50 to $650 depending on model and condition; prepaid trade-in kit; credit applied within 7 days of inspection.
- `store-hours.md` "Support hours and contact": chat assistant 24/7; human support by email at support@orchard.demo, replies within one business day; phone support Monday to Friday 9 am–6 pm ET at (555) 010-0199; no physical stores.

- [ ] **Step 6: Typecheck, build and check the dev server**

Run: `npm run typecheck -w demos/iphone-store && npm run build -w demos/iphone-store && npm test -w demos/iphone-store`
Expected: PASS.

Vite may warn during the build that `%VITE_HELPIX_WIDGET_KEY%` is empty. That is fine, because the widget then logs its "add data-widget-key" warning.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore demos/iphone-store
git commit -m "feat(demos): Orchard Store storefront with seed KB and agent config"
```

---

### Task 10: Seed script, Makefile, Docker, docs

**Files:**
- Create: `scripts/seed-demos.mjs`
- Modify: `Makefile`, `docker/node-service.Dockerfile`, `.env.example`, `README.md`, `CLAUDE.md` (Commands and Architecture lines)

**Interfaces:**
- Consumes:
  - gateway routes: `POST /auth/login`, `GET/POST /admin/tenants`, `PATCH /admin/tenants/:id` (`{ allowedOrigins }`), `GET/POST /admin/tenants/:id/admins`, `GET /kb/documents`, `POST /kb/documents` (multipart `title`, then `file`), `PUT /agent/config/draft`, `POST /agent/config/publish`
  - the seed files from Task 9
- Produces:
  - `make seed-demos`
  - `demos/<shop>/.env.development.local` with `VITE_HELPIX_WIDGET_KEY` and `VITE_HELPIX_GATEWAY`

- [ ] **Step 1: Write the seed script**

`scripts/seed-demos.mjs`:

```js
// Provisions every demo shop (demos/*/seed/shop.json) through the gateway: tenant, admin, allowed origin, KB documents,
// published agent config, and the widget key written to the demo's .env.development.local. Safe to run repeatedly.
// Run with the stack up: `make seed-demos`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'
const READY_TIMEOUT_MS = 120_000

function fail(message, detail) {
  console.error(`seed-demos: ${message}`, detail ?? '')
  process.exit(1)
}

async function call(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  } catch {
    fail(`cannot reach the gateway at ${BASE}. Start the stack first (make start or make dev).`)
  }
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function must(label, promise, ...ok) {
  const res = await promise
  if (!ok.includes(res.status)) fail(`${label} failed (${res.status})`, res.json)
  return res.json
}

async function login(email, password) {
  const res = await call('POST', '/auth/login', { body: { email, password } })
  return res.status === 200 ? res.json.accessToken : null
}

const titleOf = (markdown, file) => /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? basename(file, '.md')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const root = await login(SUPER_EMAIL, SUPER_PASSWORD)
if (!root) fail('super-admin login failed. Check SEED_SUPERADMIN_EMAIL/PASSWORD in .env.')

const shops = readdirSync('demos').filter((d) => existsSync(join('demos', d, 'seed', 'shop.json')))
const summary = []

for (const dir of shops) {
  const seed = join('demos', dir, 'seed')
  const shop = JSON.parse(readFileSync(join(seed, 'shop.json'), 'utf8'))
  const agent = JSON.parse(readFileSync(join(seed, 'agent.json'), 'utf8'))
  console.log(`\n${shop.name}`)

  const { tenants } = await must('list tenants', call('GET', '/admin/tenants', { token: root }), 200)
  let tenant = tenants.find((t) => t.slug === shop.slug)
  if (!tenant) {
    tenant = await must('create tenant', call('POST', '/admin/tenants', { token: root, body: { name: shop.name, slug: shop.slug } }), 201)
    console.log('  created tenant')
  }
  if (tenant.status !== 'active') {
    await must('reactivate tenant', call('POST', `/admin/tenants/${tenant.id}/reactivate`, { token: root }), 200)
  }
  tenant = await must('set allowed origin', call('PATCH', `/admin/tenants/${tenant.id}`, { token: root, body: { allowedOrigins: [shop.origin] } }), 200)
  console.log(`  allowed origin ${shop.origin}`)

  const { admins } = await must('list admins', call('GET', `/admin/tenants/${tenant.id}/admins`, { token: root }), 200)
  if (!admins.some((a) => a.email === shop.adminEmail)) {
    await must('create admin', call('POST', `/admin/tenants/${tenant.id}/admins`, { token: root, body: { email: shop.adminEmail, password: shop.adminPassword } }), 201)
    console.log(`  created admin ${shop.adminEmail}`)
  }
  const token = await login(shop.adminEmail, shop.adminPassword)
  if (!token) fail(`cannot log in as ${shop.adminEmail}. Its password was changed; run make reset-db or fix it in the dashboard.`)

  const { documents } = await must('list documents', call('GET', '/kb/documents', { token }), 200)
  const have = new Set(documents.map((d) => d.title))
  const kbDir = join(seed, 'kb')
  for (const file of readdirSync(kbDir).filter((f) => f.endsWith('.md')).sort()) {
    const text = readFileSync(join(kbDir, file), 'utf8')
    const title = titleOf(text, file)
    if (have.has(title)) continue
    const form = new FormData()
    form.append('title', title) // fields before the file part: kb-service reads them from the file part
    form.append('file', new Blob([text], { type: 'text/markdown' }), file)
    await must(`upload ${file}`, call('POST', '/kb/documents', { token, form }), 202)
    console.log(`  uploaded ${title}`)
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    const { documents: docs } = await must('poll documents', call('GET', '/kb/documents', { token }), 200)
    const failed = docs.filter((d) => d.status === 'failed')
    if (failed.length) fail(`documents failed to process: ${failed.map((d) => `${d.title} (${d.error})`).join(', ')}`)
    if (docs.every((d) => d.status === 'ready')) break
    if (Date.now() > deadline) fail('documents still processing after 2 minutes')
    await sleep(1000)
  }
  console.log('  knowledge base ready')

  await must('save agent draft', call('PUT', '/agent/config/draft', { token, body: agent }), 200)
  await must('publish agent', call('POST', '/agent/config/publish', { token }), 200)
  console.log('  agent config published')

  writeFileSync(
    join('demos', dir, '.env.development.local'),
    `# Written by make seed-demos. Restart the demo dev server after it changes.\nVITE_HELPIX_GATEWAY=${BASE}\nVITE_HELPIX_WIDGET_KEY=${tenant.widgetKey}\n`,
  )
  summary.push({ shop: shop.name, url: shop.origin, admin: shop.adminEmail, password: shop.adminPassword })
}

console.log('\nDemo shops ready:')
console.table(summary)
```

(Checked against the code: `PATCH /admin/tenants/:id`, `/reactivate`, `PUT /agent/config/draft` and `/publish` answer 200; `POST /admin/tenants` and `/admins` answer 201; `POST /kb/documents` answers 202. `KbDocumentView` has `title`, `status` and `error`.)

- [ ] **Step 2: Makefile, Docker and env**

In `Makefile`:
- Add `seed-demos demo` to `.PHONY`.
- Add these targets:

```make
seed-demos: .env ## Create or refresh the demo shop tenants (KB, agent config, widget key) through the gateway (needs the stack running)
	node --env-file=.env scripts/seed-demos.mjs

demo: ## Run the Orchard Store demo dev server (http://localhost:5174)
	npm run dev -w demos/iphone-store
```

- Change `start` so the dashboard and the demo run together:

```make
start: up ## Docker stack (gateway :4000 serves the widget) + dashboard :5173 + Orchard Store demo :5174
	@trap 'trap - INT TERM EXIT; kill 0' INT TERM EXIT; \
	npm run dev -w apps/admin-dashboard & \
	npm run dev -w demos/iphone-store & \
	wait
```

- In `dev`, build the widget once before the services start, then keep it rebuilding: insert `npm run build -w apps/widget` as a line after `docker compose stop ...`, and add `npm run dev -w apps/widget & \` and `npm run dev -w demos/iphone-store & \` before `wait`. Update the `dev` help text to mention the widget and the demo.
- `smoke` help text: append ", widget".

`docker/node-service.Dockerfile`: after `RUN npm ci`, add:

```dockerfile
# The gateway serves the widget bundle (WIDGET_BUNDLE_PATH defaults to apps/widget/dist/helpix-widget.js).
RUN npm run build -w apps/widget
```

`.env.example`: after `CORS_ORIGINS`, add:

```
# The widget bundle the gateway serves at /widget/helpix-widget.js. Default: apps/widget/dist/helpix-widget.js.
# WIDGET_BUNDLE_PATH=
```

- [ ] **Step 3: Docs**

`README.md`: add a "Chat widget and demo shop" section after the existing quick start. It covers:
- the embed snippet (`<script src="http://localhost:4000/widget/helpix-widget.js" data-widget-key="wk_..." defer></script>`)
- `make seed-demos`, then the store at `http://localhost:5174` with the admin credentials from `seed/shop.json`
- the allowed-origin rule (the widget only works from origins on the tenant's list, which the super-admin edits on the tenant page)
- `window.Helpix.open()` / `close()`
- a "Shadow DOM styling" note recording the Task 0 finding (which option, and why)

`CLAUDE.md`:
- Under Commands, add `make seed-demos` and `make demo`.
- In the gateway bullet, add: "Widget calls use `x-helpix-widget-key` + `Origin`, resolved through `/internal/resolve-widget` and cached per (key, origin). Only `POST /chat/messages` and `GET /widget/config` accept it (`services/gateway/src/widget.ts`)."
- Add an `apps/widget` bullet: "Vue IIFE bundle mounted in a shadow root; Tailwind `@property` rules are re-declared for the shadow root by `shadowStyles.ts`; never add SFC `<style>` blocks."
- Add a `demos/` bullet.

- [ ] **Step 4: Verify typecheck, build and tests across the repo**

Run: `npm run typecheck && npm run build && make test`
Expected: all PASS, which is what CI runs, plus the tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demos.mjs Makefile docker/node-service.Dockerfile .env.example README.md CLAUDE.md
git commit -m "feat: make seed-demos, widget in dev/start/docker, docs for the widget and demo"
```

---

### Task 11: Smoke test, fresh reset and seed, manual check

**Files:**
- Create: `scripts/smoke-step4a.mjs`
- Modify: `package.json` (`smoke` script)

**Interfaces:**
- Consumes: everything above, through the gateway.

- [ ] **Step 1: Write the smoke script**

`scripts/smoke-step4a.mjs`:

```js
// End-to-end check of step 4a (widget surface) through the gateway. Run with the stack up: `npm run smoke`.
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'
const ORIGIN = 'http://smoke-a.test'
const LATE_ORIGIN = 'http://smoke-b.test' // never used before suspension, so the gateway cache cannot hide it

function check(condition, label, detail) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? '')
    process.exit(1)
  }
  console.log(`ok   ${label}`)
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  const type = res.headers.get('content-type') ?? ''
  return { status: res.status, type, text, json: text && type.includes('application/json') ? JSON.parse(text) : null }
}

const events = (text) =>
  text.split('\n\n').filter((b) => b.trim()).map((b) => ({
    event: /^event: (.*)$/m.exec(b)?.[1] ?? 'message',
    data: JSON.parse(/^data: (.*)$/m.exec(b)?.[1] ?? 'null'),
  }))

const suffix = Date.now().toString(36)
const root = (await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })).json.accessToken
check(root, 'super-admin login')
const tenant = (await call('POST', '/admin/tenants', { token: root, body: { name: 'Widget Smoke', slug: `widget-${suffix}` } })).json
await call('PATCH', `/admin/tenants/${tenant.id}`, { token: root, body: { allowedOrigins: [ORIGIN, LATE_ORIGIN] } })
const email = `widget-${suffix}@smoke.test`
await call('POST', `/admin/tenants/${tenant.id}/admins`, { token: root, body: { email, password: 'smoke-password-1' } })
const admin = (await call('POST', '/auth/login', { body: { email, password: 'smoke-password-1' } })).json.accessToken
check(admin, 'tenant admin login')

await call('POST', '/kb/documents/text', { token: admin, body: { title: 'Returns', text: 'Returns are accepted within 30 days of delivery with a free label.' } })
for (let i = 0; i < 60; i++) {
  const docs = (await call('GET', '/kb/documents', { token: admin })).json.documents
  if (docs.every((d) => d.status === 'ready')) break
  await new Promise((r) => setTimeout(r, 1000))
}
await call('PUT', '/agent/config/draft', {
  token: admin,
  body: { prompt: 'Widget smoke shop.', tone: 'concise', toneNotes: '', greeting: 'Smoke hello', accentColor: '#123456', modelOverride: null },
})
await call('POST', '/agent/config/publish', { token: admin })

const widget = (origin = ORIGIN) => ({ 'x-helpix-widget-key': tenant.widgetKey, origin })

const bundle = await call('GET', '/widget/helpix-widget.js')
check(bundle.status === 200 && bundle.type.startsWith('application/javascript'), 'gateway serves the widget bundle', bundle.status)

const cfg = await call('GET', '/widget/config', { headers: widget() })
check(cfg.status === 200 && cfg.json.shopName === 'Widget Smoke' && cfg.json.greeting === 'Smoke hello' && cfg.json.orderLookup === false, 'widget config is the published config', cfg.json)

const first = await call('POST', '/chat/messages', { headers: widget(), body: { message: 'What is your returns policy?' } })
const e1 = events(first.text)
check(first.status === 200 && first.type.startsWith('text/event-stream'), 'widget chat streams SSE', first.status)
const meta = e1.find((e) => e.event === 'meta')?.data
check(meta?.conversationId && meta?.sessionToken, 'first turn returns a conversation and session token', meta)
check(e1.at(-1)?.event === 'done', 'first turn ends with done', e1.at(-1))

const second = await call('POST', '/chat/messages', { headers: widget(), body: { message: 'Thanks', conversationId: meta.conversationId, sessionToken: meta.sessionToken } })
check(events(second.text).at(-1)?.event === 'done', 'second turn continues the conversation')

const stolen = await call('POST', '/chat/messages', { headers: widget(), body: { message: 'Hi', conversationId: meta.conversationId, sessionToken: 'wrong' } })
check(stolen.status === 404, 'a wrong session token gets 404', stolen.json)

const evil = await call('POST', '/chat/messages', { headers: widget('http://evil.test'), body: { message: 'Hi' } })
check(evil.status === 403 && evil.json.error.code === 'origin_not_allowed', 'a disallowed origin gets 403', evil.json)

const noOrigin = await call('GET', '/widget/config', { headers: { 'x-helpix-widget-key': tenant.widgetKey } })
check(noOrigin.status === 403, 'a request without Origin gets 403', noOrigin.json)

const wrongRoute = await call('GET', '/kb/documents', { headers: widget() })
check(wrongRoute.status === 403, 'a widget key cannot reach admin routes', wrongRoute.json)

const badKey = await call('GET', '/widget/config', { headers: { 'x-helpix-widget-key': 'wk_nope', origin: ORIGIN } })
check(badKey.status === 401, 'an unknown widget key gets 401', badKey.json)

await call('POST', `/admin/tenants/${tenant.id}/suspend`, { token: root })
const suspended = await call('GET', '/widget/config', { headers: widget(LATE_ORIGIN) })
check(suspended.status === 403 && suspended.json.error.code === 'tenant_suspended', 'a suspended tenant gets 403', suspended.json)

console.log('\nstep 4a smoke test passed')
```

In `package.json`, append ` && node --env-file=.env scripts/smoke-step4a.mjs` to the `smoke` script.

- [ ] **Step 2: Wipe local data and bring the stack up fresh, as the user asked**

This deletes all local Helpix data (tenants, admins, KB files, test DB). The user explicitly asked for it.

Run: `make reset-db FORCE=1`
Expected: the containers and volume are removed, `make up` rebuilds the images (including the widget build step) and prints `Ready: http://localhost:4000`.

- [ ] **Step 3: Smoke and seed**

Run: `make smoke && make seed-demos`
Expected:
- the step 1–3 and step 4a smoke scripts each print `... smoke test passed`
- the seed prints a table with Orchard Store at `http://localhost:5174`
- `demos/iphone-store/.env.development.local` contains a `wk_` key

Run: `make smoke` again
Expected: still passes, showing the smoke scripts don't depend on a clean DB.

Run: `make seed-demos` again
Expected: no uploads (idempotent), and the agent config is published again.

- [ ] **Step 4: Manual check in Chrome**

Run the demo: `npm run dev -w demos/iphone-store` (the Docker gateway serves the widget). Open `http://localhost:5174` in a new Chrome tab using the claude-in-chrome tools, and record a GIF (`orchard_widget.gif`).

Check each of these:
1. The launcher is 56 px, Mint, at the bottom right, with a white mark, and the dark storefront doesn't restyle it.
2. The panel header reads "Orchard Store", the greeting shows, and the footer shows "Powered by" plus the lockup.
3. Ask "How long does shipping take?". The reply streams and a "Shipping and delivery" source chip appears.
4. Reload the page and ask a follow-up. The same conversation continues. In the dashboard (log in as `admin@orchard.demo`), the Conversations page lists one real conversation with both turns.
5. Click "New chat". The transcript clears.
6. Resize to 375 px wide. The panel goes full-screen and the page doesn't scroll sideways.
7. In devtools, check that `getComputedStyle` on the panel has a non-`none` `box-shadow`. This confirms the `@property` fix in the real browser.
8. Read the console messages with the pattern `helpix`. There should be no errors.

Take screenshots of the closed launcher, the open panel with a sourced answer, and the mobile view. Report anything that doesn't match.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-step4a.mjs package.json
git commit -m "test: step 4a widget smoke test"
```
