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

TypeScript is pinned to ~5.9 at the root (vue-tsc does not support TS 7).

## Layout

- `services/gateway` — the only public entry point; resolves credentials into identity headers.
  It caches admin-token resolutions for up to 30 s (`RESOLVE_CACHE_TTL_MS`), so suspending a tenant or revoking an admin takes effect at the gateway within that window.
- `services/tenant-auth` — tenants, admins, widget keys, sessions. Reachable only through the gateway.
- `packages/shared` — error format, header names, DB helpers, API types.
- `packages/ui` — shared Tailwind components (`@helpix/ui`) and theme tokens.
- `apps/admin-dashboard` — super-admin and tenant-admin UI.
