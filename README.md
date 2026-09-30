# Helpix

Multitenant AI customer-support platform. Design: `docs/superpowers/specs/2026-09-30-helpix-design.md`.

## Admin dashboard

The dashboard (`apps/admin-dashboard`) is the UI over **tenant-auth**: every screen below talks to it through the gateway. A super-admin creates tenants (one per shop), manages each shop's widget key and allowed sites, adds the shop's admins, and can suspend a shop. Light and dark themes follow the system setting, or can be picked in the header.

### Sign in

Admins sign in with email and password. tenant-auth issues a 15-minute access token and a rotating refresh token; the dashboard refreshes silently.

| Light | Dark |
| --- | --- |
| ![Sign-in page, light theme](docs/screenshots/login-light.png) | ![Sign-in page, dark theme](docs/screenshots/login-dark.png) |

### Tenants

Every shop using helpix, with its status. Click a row to open it.

| Light | Dark |
| --- | --- |
| ![Tenant list, light theme](docs/screenshots/tenants-light.png) | ![Tenant list, dark theme](docs/screenshots/tenants-dark.png) |

### Create a tenant

The slug is filled in from the name, including Vietnamese names (`Cửa hàng Táo` → `cua-hang-tao`).

![New tenant dialog](docs/screenshots/new-tenant-light.png)

### Tenant detail

- **Widget key**: the public key the shop puts in its widget script tag. Copy it, or rotate it if it leaks.
- **Allowed sites**: the origins where the widget may run. Entries are normalized (`https://Shop.Example/` → `https://shop.example`).
- **Admins**: the people who manage this shop's knowledge base and agent.

| Light | Dark |
| --- | --- |
| ![Tenant detail, light theme](docs/screenshots/tenant-detail-light.png) | ![Tenant detail, dark theme](docs/screenshots/tenant-detail-dark.png) |

### Suspend a tenant

Suspending stops the shop's widget and blocks its admins from signing in. No data is deleted, and the tenant can be reactivated.

![Suspend confirmation dialog, dark theme](docs/screenshots/suspend-dialog-dark.png)

To refresh these images after a UI change, run the stack and dashboard (`make start` or `make dev`), then `make screenshots`. It creates the demo tenants if they are missing and uses your installed Google Chrome.

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
