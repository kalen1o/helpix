# Helpix

Multitenant AI customer-support platform. Design: `docs/superpowers/specs/2026-09-30-helpix-design.md`.

## Run locally

Requirements: Node 22, Docker, make.

```bash
make setup    # npm install; creates .env from .env.example (then change the secrets)
make start    # Docker stack (postgres :5433, tenant-auth, gateway http://localhost:4000) + dashboard http://localhost:5173
make dev      # or: hot reload — postgres in Docker, tenant-auth/gateway/dashboard run locally; Ctrl-C stops all
make down     # stop the Docker stack (data is kept)
make reset-db # delete ALL data and reseed the super-admin from .env (asks first; FORCE=1 skips)
```

Run `make` to list every target. Without make: `docker compose up -d --build` then `npm run dev -w apps/admin-dashboard`.

Log in with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` from `.env`.

## Test

```bash
make test       # starts postgres if needed; tests use the helpix_test database on port 5433
make typecheck
make smoke      # end-to-end through the gateway; needs the full stack running (make up)
```

TypeScript is pinned to ~5.9 at the root (vue-tsc does not support TS 7).

## Layout

- `services/gateway` — the only public entry point; resolves credentials into identity headers.
  It caches admin-token resolutions for up to 30 s (`RESOLVE_CACHE_TTL_MS`), so suspending a tenant or revoking an admin takes effect at the gateway within that window.
- `services/tenant-auth` — tenants, admins, widget keys, sessions. Reachable only through the gateway.
- `packages/shared` — error format, header names, DB helpers, API types.
- `packages/ui` — shared Tailwind components (`@helpix/ui`) and theme tokens.
- `apps/admin-dashboard` — super-admin and tenant-admin UI.
