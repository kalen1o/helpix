<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/lockup/helpix-lockup-on-dark.svg">
    <img src="brand/logo/lockup/helpix-lockup-primary.svg" alt="helpix" width="280">
  </picture>
</p>

<p align="center">
  <strong>The AI support agent that lives in a shop's chat widget.</strong><br>
  A multitenant customer-support platform: one helpix, many shops.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-0C9A82?logo=nodedotjs&logoColor=white" alt="Node 22+">
  <img src="https://img.shields.io/badge/TypeScript-5.9-0C9A82?logo=typescript&logoColor=white" alt="TypeScript 5.9">
  <img src="https://img.shields.io/badge/Vue-3-0C9A82?logo=vuedotjs&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/Fastify-5-0C9A82?logo=fastify&logoColor=white" alt="Fastify 5">
  <img src="https://img.shields.io/badge/PostgreSQL-0C9A82?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Tailwind-4-0C9A82?logo=tailwindcss&logoColor=white" alt="Tailwind 4">
</p>

<p align="center">
  <a href="#admin-dashboard">Dashboard</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="#test">Test</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="docs/superpowers/specs/2026-09-30-helpix-design.md">Design spec</a>
</p>

<p align="center">
  <img src="docs/screenshots/tenants-light.png" alt="helpix admin dashboard: tenant list" width="820">
</p>

---

## Admin dashboard

The dashboard (`apps/admin-dashboard`) is the UI over **tenant-auth**. Every screen below talks to it through the gateway. A super-admin creates tenants (one per shop), manages each shop's widget key and allowed sites, adds the shop's admins, and can suspend a shop. Light and dark themes follow the system setting, or can be picked in the header.

Tenant admins land on the **Knowledge base**: upload PDF, DOCX, Markdown or TXT files (up to 10 MB) or paste text, watch each document go from *Processing* to *Ready*, preview it (PDFs in the browser viewer, Markdown rendered, DOCX as extracted text), download or delete it, and re-index after the embedding model changes.

### 🔐 Sign in

Admins sign in with email and password. tenant-auth issues a 15-minute access token and a rotating refresh token; the dashboard refreshes silently.

| Light | Dark |
| --- | --- |
| ![Sign-in page, light theme](docs/screenshots/login-light.png) | ![Sign-in page, dark theme](docs/screenshots/login-dark.png) |

### 🏪 Tenants

Every shop using helpix, with its status. Click a row to open it.

| Light | Dark |
| --- | --- |
| ![Tenant list, light theme](docs/screenshots/tenants-light.png) | ![Tenant list, dark theme](docs/screenshots/tenants-dark.png) |

### ➕ Create a tenant

The slug is filled in from the name, including Vietnamese names (`Cửa hàng Táo` → `cua-hang-tao`).

<p align="center">
  <img src="docs/screenshots/new-tenant-light.png" alt="New tenant dialog" width="560">
</p>

### 🔑 Tenant detail

| | |
| --- | --- |
| **Widget key** | The public key the shop puts in its widget script tag. Copy it, or rotate it if it leaks. |
| **Allowed sites** | The origins where the widget may run. Entries are normalized (`https://Shop.Example/` → `https://shop.example`). |
| **Admins** | The people who manage this shop's knowledge base and agent. |

| Light | Dark |
| --- | --- |
| ![Tenant detail, light theme](docs/screenshots/tenant-detail-light.png) | ![Tenant detail, dark theme](docs/screenshots/tenant-detail-dark.png) |

### ⏸️ Suspend a tenant

Suspending stops the shop's widget and blocks its admins from signing in. No data is deleted, and the tenant can be reactivated.

<p align="center">
  <img src="docs/screenshots/suspend-dialog-dark.png" alt="Suspend confirmation dialog, dark theme" width="560">
</p>

> [!TIP]
> To refresh these images after a UI change, run the stack and dashboard (`make start` or `make dev`), then `make screenshots`. It creates the demo tenants if they are missing and uses your installed Google Chrome.

## Run locally

**Requirements:** Node 22, Docker, make.

```bash
make setup    # npm install; creates .env from .env.example (then change the secrets)
make start    # Docker stack (postgres :5433, tenant-auth, kb-service, gateway http://localhost:4000) + dashboard http://localhost:5173
make dev      # or: hot reload — postgres in Docker, services and dashboard run locally; Ctrl-C stops all
make down     # stop the Docker stack (data is kept)
make reset-db # delete ALL data and reseed the super-admin from .env (asks first; FORCE=1 skips)
```

Embeddings default to an offline `fake` provider, which is fine for development. For real answers use GLM: set `EMBEDDING_PROVIDER=openai-compatible` and `EMBEDDING_API_KEY` in `.env` (see `.env.example`). If your `.env` predates the knowledge base, copy the `KB_SERVICE_URL` and `EMBEDDING_*` lines from `.env.example` into it. kb-service needs pgvector 0.8 or newer (the Docker image `pgvector/pgvector:pg16` provides it), because search uses `hnsw.iterative_scan`.

Run `make` to list every target. Without make: `docker compose up -d --build` then `npm run dev -w apps/admin-dashboard`.

Log in with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` from `.env`.

## Test

```bash
make test       # starts postgres if needed; tests use the helpix_test database on port 5433
make typecheck
make smoke      # end-to-end through the gateway (tenants, then knowledge base); needs the full stack running (make up)
```

> [!NOTE]
> TypeScript is pinned to ~5.9 at the root (vue-tsc does not support TS 7).

## Architecture

```mermaid
flowchart LR
  D[admin-dashboard<br/>Vue 3] --> G[gateway<br/>:4000]
  W[shop chat widget] --> G
  G -- identity headers --> T[tenant-auth]
  G -- identity headers --> K[kb-service]
  K -- embeddings --> L[(GLM embedding-3)]
  T --> P[(PostgreSQL + pgvector)]
  K --> P
  K --> F[(KB files volume)]
```

| Path | What it is |
| --- | --- |
| `services/gateway` | The only public entry point; resolves credentials into identity headers. |
| `services/tenant-auth` | Tenants, admins, widget keys, sessions. Reachable only through the gateway. |
| `services/kb-service` | Knowledge base: uploads, text extraction, chunking, embeddings, pgvector search, re-indexing. Reachable only through the gateway. |
| `packages/llm` | Provider adapter: GLM / OpenAI-compatible embeddings (chat in step 3) and an offline fake. |
| `packages/shared` | Error format, header names, DB helpers, API types. |
| `packages/ui` | Shared Tailwind components (`@helpix/ui`) and theme tokens. |
| `apps/admin-dashboard` | Super-admin and tenant-admin UI. |
| `brand` | Logo, lockups, app icons and the [brand sheet](brand/brand-sheet.html). |

> [!IMPORTANT]
> The gateway caches admin-token resolutions for up to 30 s (`RESOLVE_CACHE_TTL_MS`), so suspending a tenant or revoking an admin takes effect at the gateway within that window.

---

<p align="center">
  <img src="brand/logo/refined/h-pixel-mint.svg" alt="" width="36"><br>
  <sub>h for help, the pixel for pix.</sub>
</p>
