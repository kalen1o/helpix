# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

helpix is a multitenant AI customer-support platform: one deployment serves many shops, and each shop gets a chat widget backed by an agent that answers from the shop's knowledge base. It is an npm-workspaces monorepo (Node 22, TypeScript ~5.9, ESM everywhere, Fastify 5, Postgres + pgvector, Vue 3 + Tailwind 4). It is built in numbered steps. The design spec is `docs/superpowers/specs/2026-09-30-helpix-design.md`, and each step has a plan in `docs/superpowers/plans/` (step 1 foundation, step 2 KB, step 3 agent, step 4a widget, step 4b shopper identity and orders). Check the relevant plan's "Global Constraints" before changing a service.

## Commands

```bash
make setup        # npm install + create .env from .env.example
make start        # full Docker stack (gateway on :4000 serves the widget) + dashboard :5173 + Orchard Store demo :5174 and its backend :4101
make dev          # hot reload: postgres in Docker, services + dashboard run locally via tsx watch; also builds/watches the widget and runs the demo + its backend
make db           # start only Postgres (host port 5433, NOT 5432)
make reset-db     # wipe all data and reseed the super-admin (FORCE=1 skips the prompt)
make seed-demos   # create/refresh the demo shop tenant (KB, agent config, widget key, shop key, order API) via the gateway; needs the stack AND the demo backend running
make demo         # Orchard Store demo: storefront :5174 + backend :4101
make test         # starts postgres, then runs every workspace's vitest suite
make typecheck    # tsc / vue-tsc --noEmit in every workspace
make smoke        # end-to-end scripts through the gateway; needs the stack running
make screenshots  # regenerate README screenshots (stack + dashboard running, uses local Chrome)
```

Per workspace (`-w` takes the path):

```bash
npm test -w services/kb-service                          # one workspace
npm test -w services/kb-service -- test/search.test.ts   # one file
npm test -w services/kb-service -- -t "name of test"     # one test by name
npm run dev -w services/gateway                          # one service with hot reload (reads ../../.env)
```

DB-backed tests use the `helpix_test` database on `localhost:5433` (override with `TEST_DATABASE_URL`). Postgres must be running (`make db`). The init script `docker/postgres/init.sql` creates `helpix_test` and the `vector` extension, so it only runs on a fresh volume. Service vitest configs set `fileParallelism: false` because the test files share one database.

CI (`.github/workflows/ci.yml`) runs only `npm run typecheck` and `npm run build`. It runs no tests.

TypeScript is pinned to ~5.9 at the root because vue-tsc does not support TS 7.

## Architecture

```
admin-dashboard / shop widget ──► gateway :4000 ──► tenant-auth :4001   (schema tenant_auth)
                                                ├─► kb-service  :4002   (schema kb, files in .data/kb)
                                                └─► chat-service :4003  (schema chat) ──► tenant-auth, kb-service over HTTP
```

- **The gateway is the only public entry point.** It routes by prefix (`/auth`, `/me`, `/admin`, `/agent`, `/integrations` → tenant-auth; `/kb` → kb-service; `/chat` → chat-service). It resolves the admin bearer token through tenant-auth's `/internal/*` resolver and caches the result for `RESOLVE_CACHE_TTL_MS` (≤30 s). It then forwards the request with identity headers (`x-tenant-id`, `x-admin-id`, `x-helpix-role`, `x-internal-token`). It strips client-supplied identity headers (`IDENTITY_HEADERS` in `packages/shared/src/headers.ts`) and streams bodies, including SSE, through without parsing them. `services/gateway/src/path.ts` rejects path traversal and any `/internal` path before routing. Treat changes there as security-sensitive.
- **Widget calls** use `x-helpix-widget-key` + `Origin`, resolved through `/internal/resolve-widget` and cached per (key, origin, token hash when a shopper token is sent). Only `POST /chat/messages` and `GET /widget/config` accept it (`services/gateway/src/widget.ts`).
- **Shopper identity:** the shop signs an RS256 JWT (`sub` = customer ID, `aud` = widget key, `exp` ≤ 1 h) and the widget sends it as `x-helpix-customer-token`. The gateway has tenant-auth verify it in `/internal/resolve-widget` against the tenant's uploaded public key, forwards `x-customer-id`, and strips the token. Any token problem is 401 `invalid_customer_token`. The customer ID comes only from `x-customer-id` (or the playground's admin-supplied test customer), never from the body or the model.
- **tenant-auth integrations** (`/integrations`, tenant_admin; table `tenant_auth.integrations`): the shop public key and the order API (base URL + key encrypted with `SECRETS_MASTER_KEY`, AES-256-GCM). tenant-auth is the only service that calls a shop's order API (`src/lib/shopClient.ts`: 5 s timeout, no redirects, 256 KB cap, private hosts blocked unless `ORDER_API_ALLOW_PRIVATE_HOSTS=true`), for "test connection" and for chat-service via `/internal/orders/*`. The plain key never leaves tenant-auth and is never logged.
- **Backend services trust only the gateway.** Every service checks `x-internal-token` (`requireInternalToken`) and reads identity with `readContext()` from `@helpix/shared`. The tenant comes **only** from the `x-tenant-id` header, never from the body, the query or LLM tool arguments. Every query filters by `tenant_id`, and each service has `isolation.test.ts` suites that check this.
- **Each service owns one Postgres schema** and never reads another service's tables. Cross-service data goes over HTTP with the internal token. For example, chat-service fetches agent config from tenant-auth `/internal/agent-config/*` (with `x-internal-caller: chat`) and searches the KB through kb-service.
- **Migrations** are plain `services/<svc>/migrations/NNN_name.sql` files, applied on service startup by `migrate()` in `packages/shared/src/db.ts` (advisory-locked, recorded in `<schema>.schema_migrations`). Add a new numbered file. Never edit one that has already been applied.
- **Service layout:** `server.ts` (wiring: config, pool, migrate, real deps) → `app.ts` `buildApp(deps)` (Fastify app, no I/O at import) → `routes/`, `repos/` (SQL), `deps.ts` (the injectable deps interface). Tests build the app with test deps from `test/helpers.ts` and use `app.inject()` with the headers the gateway would send (`tenantHeaders()`, `serviceHeaders()`).
- **Errors** everywhere use `AppError` + `registerErrorHandler` and the shape `{ error: { code, message, requestId } }`. After an SSE stream starts, failures are sent as an `error` event instead.
- **kb-service:** upload (PDF/DOCX/MD/TXT ≤10 MB, or pasted text) → extract (`unpdf`, `mammoth`) → chunk → embed → pgvector. It runs as in-process background jobs (`jobs.ts`). On startup, documents stuck in processing are swept to failed. Search uses `hnsw.iterative_scan`, so it needs pgvector ≥0.8.
- **chat-service:** `turn.ts` runs one turn. It builds the prompt in a fixed order (platform rules, including the turn's sign-in/order context → tenant prompt → tone → history trimmed to a token budget → user message), then runs `agent/loop.ts` with the `search_kb` tool, capped by `CHAT_MAX_TOOL_ROUNDS`. `lookup_order` is offered only when the agent config says `orderLookup` and the turn has a customer; chat-service supplies the customer ID itself. Orders are never prefetched. Every turn first runs `search_kb` with the customer's message (the loop's `prefetch`), because models skip the tool and invent answers when the shop prompt seems to cover a question, and GLM ignores `tool_choice`. It streams `meta`/`delta`/`tool`/`done` SSE events. The user and assistant messages are stored together only when the turn succeeds. A client disconnect aborts the model call and stores nothing. Conversation ownership mismatches return the same 404 as an unknown ID.
- **packages/llm:** separate embedding and chat providers. Both have an OpenAI-compatible implementation (GLM by default) and an offline `fake`. Chat reads only `CHAT_*` env vars and embeddings read only `EMBEDDING_*`. Never mix them. `fake` is the default for development and is what tests use.
- **packages/shared:** exported as TS source (no build step), with subpath exports `./api-types`, `./agent-config`, `./chat`, `./sse`, `./orders` (`Order` contract and `parseOrder`), `./testing`. The DTOs in `api-types.ts` are shared by the services and the dashboard.
- **apps/widget:** Vue IIFE bundle mounted in a shadow root; Tailwind `@property` rules are re-declared for the shadow root by `shadowStyles.ts`; never add SFC `<style>` blocks. Its vitest config (and the demo's) passes `--no-experimental-webstorage` because the default shell node may be v25 (the repo pins 22 via `.nvmrc`).
- **demos/:** sample shops (`demos/iphone-store`, the Orchard Store). Each has `seed/` (`shop.json`, `agent.json`, `kb/*.md`) that `make seed-demos` pushes through the gateway, and reads `VITE_HELPIX_GATEWAY` / `VITE_HELPIX_WIDGET_KEY` from the gitignored `.env.development.local`. Orchard also has a Fastify backend (`server/`, port 4101, run with `npm run server -w demos/iphone-store`) with demo accounts (`seed/customers.json`, password `orchard-demo`), fake checkout and the order API; its state and secrets live in the gitignored `demos/iphone-store/.data/`. Vite proxies `/api` to it.
- **packages/ui + apps/admin-dashboard:** Vue 3 + Tailwind 4 with in-house components from `@helpix/ui`. Do not add a component library. Follow `DESIGN.md` (colour tokens, type, logo usage, chat bubbles, motion), which summarises `brand/brand-sheet.html` and `packages/ui/src/styles/globals.css`. Assistant/chat text renders as plain text (`whitespace-pre-wrap`), never as HTML. Markdown documents in the KB preview are rendered with `marked` + `dompurify`.

## Environment

`.env` at the repo root is shared by `make dev` (each service runs `tsx --env-file=../../.env`) and by Docker Compose. Docker Compose overrides the URLs and ports. When new variables appear in `.env.example`, existing `.env` files need them copied in by hand.

tenant-auth needs `SECRETS_MASTER_KEY` (base64 of 32 bytes, `openssl rand -base64 32`) or it will not start. `ORDER_API_ALLOW_PRIVATE_HOSTS=true` is for local demos only. `make seed-demos` passes `DEMO_ORDER_API_URL` (Docker: `http://host.docker.internal:4101`, `make dev`: `http://localhost:4101`); override it as a shell variable (`DEMO_ORDER_API_URL=... make seed-demos`), not in `.env`.
