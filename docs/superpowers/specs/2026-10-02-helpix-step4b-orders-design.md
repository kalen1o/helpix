# Helpix Step 4b — Shopper Identity and Order Lookup

Date: 2026-10-02
Status: Draft for review
Parent spec: `2026-09-30-helpix-design.md` (§2.3, §2.4, §3.2, §3.4, §3.5, §3.7, §5 Integrations, §6, §7). Follows `2026-10-01-helpix-step4a-widget-design.md`.

## 1. Goal and scope

Step 4 is split into three plans and PRs: 4a (widget and first demo, done), **4b (this spec)**, and 4c (second shop).

**4b** delivers the logged-in flow on Orchard Store:
1. A shopper creates an account or signs in on the demo with email and password.
2. The widget switches to that identity and starts a new conversation.
3. Asked "where's my order?", the agent looks up the shopper's orders through the shop's order API and answers in the shop's tone.
4. The shopper can place a fake order at checkout and ask about it.
5. Logged out, KB answers still work and the widget shows a sign-in hint for order questions.
6. A tenant admin configures all of this on a new Integrations page.

**4c (next spec, recorded here so it is not lost):** the Teen Fashion store, built in **React** (Vite + React + TypeScript + Tailwind, using only `@helpix/ui`'s CSS tokens, because its components are Vue), with its own backend, tone and KB. It proves the widget works on a non-Vue page and demonstrates two-tenant isolation.

Assumptions: local Docker demo. Playwright e2e and rate limits stay in step 5.

Success criteria:
- `make seed-demos` then `make start` (or `make dev`): sign in as `maya@orchard.demo` / `orchard-demo`, ask "where's my order?" and get her real order statuses. Check out, ask about the new order, and get "processing".
- Signed out, an order question gets the sign-in hint and no order data.
- A token for one customer can never read another customer's orders, and one tenant's keys and orders can never be used for another tenant.
- The order API key is never returned by any API, never logged, and never leaves tenant-auth in plain text.

## 2. Customer identity (shop JWT)

- **Shop public key:** uploaded on the Integrations page as an RS256 public key (PEM). tenant-auth parses it with `jose` and rejects anything that is not an RSA key of at least 2048 bits. It is stored in plain form with its SHA-256 fingerprint; it is not secret.
- **Token contract:** RS256 JWT with:
  - `sub`: the shop's customer ID, 1–200 characters
  - `aud`: the tenant's widget key, so a token minted for one Helpix tenant cannot be replayed on another
  - `exp`: required, at most 1 hour after `iat`
  - optional `email`

  Clock tolerance is 30 s.
- **Widget:**
  - `Helpix.identify(jwt)` keeps the token in memory only, never in storage, and sends it as `x-helpix-customer-token` on widget routes.
  - When the token's `sub` (read without verifying, only to compare) differs from the owner of the stored conversation, the widget clears the conversation and starts fresh. The stored session records `customerId` (null when anonymous).
  - `Helpix.logout()` drops the token and starts fresh. A conversation never changes owner (parent spec §3.2).
  - `identify` called before the widget has mounted is remembered and applied on mount.
- **Gateway:**
  - For a widget route carrying `x-helpix-customer-token`, it calls `POST /internal/resolve-widget` with `{ widgetKey, origin, customerToken }`.
  - tenant-auth verifies the token against the tenant's stored key (signature, `aud`, `exp`, `sub`) and returns `{ tenantId, customerId }`.
  - The gateway forwards `x-customer-id`. Client-sent `x-customer-id` is still stripped (`IDENTITY_HEADERS`).
  - Results are cached per (widget key, origin, SHA-256 of the token) for the smaller of `RESOLVE_CACHE_TTL_MS` and the time until `exp`.
  - `x-helpix-customer-token` is stripped before forwarding, like the widget key.
- **Rejections:** any token problem returns **401 `invalid_customer_token`**: bad signature, wrong `aud`, expired, malformed, `sub` missing or over 200 characters, tenant has no shop key, or token over 4 KB. The widget then drops the token, logs one `[helpix]` warning and continues anonymously. A shop's broken login must never break chat.
- **Playground:** unchanged. The admin-only test customer ID still comes from the request body (parent spec §3.7).

## 3. Order API integration

### 3.1 Storage and secrets

- Migration `services/tenant-auth/migrations/003_integrations.sql` adds `tenant_auth.integrations`, one row per tenant. Columns:
  - `tenant_id` (PK, FK → tenants ON DELETE CASCADE)
  - `shop_key_pem`, `shop_key_fingerprint`, `shop_key_updated_at`
  - `order_api_base_url`, `order_api_key_enc`, `order_api_updated_at`
  - `updated_at`
- `order_api_key_enc` is AES-256-GCM encrypted with a random 12-byte IV, stored as `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
- The master key is `SECRETS_MASTER_KEY` (base64 of exactly 32 bytes). tenant-auth refuses to start if it is missing or the wrong length. `.env.example` gets a placeholder and a generation command (`openssl rand -base64 32`).
- The plain key is never returned by any route, never logged, and never sent to another Helpix service.

### 3.2 Admin API

Routed by the gateway: new prefix `/integrations` → tenant-auth, admin bearer. Every route requires `tenant_admin`.

| Route | Body | Result |
|---|---|---|
| `GET /integrations` | — | `{ orderApi: { baseUrl, hasApiKey, updatedAt } \| null, shopKey: { fingerprint, updatedAt } \| null }` |
| `PUT /integrations/order-api` | `{ baseUrl, apiKey? }` | same view; omitting `apiKey` keeps the stored one; `apiKey` required when none is stored |
| `DELETE /integrations/order-api` | — | 204 |
| `POST /integrations/order-api/test` | `{ customerId }` | `{ ok, status, message }` from `GET {baseUrl}/orders?limit=1` |
| `PUT /integrations/shop-key` | `{ publicKeyPem }` | same view |
| `DELETE /integrations/shop-key` | — | 204 |

Validation:
- `baseUrl` must be an absolute `http(s)` URL of at most 500 characters, with no credentials, query string or fragment. A trailing slash is removed.
- `apiKey` must be 8–500 characters.
- `publicKeyPem` must be at most 10 KB.

### 3.3 Shop client (inside tenant-auth)

- Sends `GET {baseUrl}/orders/{orderId}` (`orderId` URL-encoded, 1–100 characters) and `GET {baseUrl}/orders?limit=5`, with headers `Authorization: Bearer <apiKey>`, `X-Customer-Id`, `Accept: application/json`.
- 5 s timeout; redirects are not followed (3xx is treated as unavailable); responses over 256 KB are rejected.
- Responses are validated against the `Order` contract (parent §3.5). The types and validator live in the new `@helpix/shared/orders` subpath. Order lists are capped at 5.
- Result mapping:

  | Shop response | Result |
  |---|---|
  | 200 with a valid body | `ok` |
  | 404 | `not_found` |
  | 401 or 403 | `misconfigured` |
  | 5xx, timeout, network error, invalid body, 3xx, oversized | `unavailable` |

- **Blocking internal addresses:** unless `ORDER_API_ALLOW_PRIVATE_HOSTS=true`, the base URL must be `https`, and the hostname must not resolve (checked at call time) to a loopback, private, link-local, CGNAT or unique-local address. This stops an admin from pointing it at Helpix's internal services. `.env.example` sets it to `true` for local demos, with a comment explaining it must be `false` in production.

### 3.4 Internal routes for chat-service

Both require `x-internal-caller: chat`, like `/internal/agent-config`:
- `GET /internal/orders/:tenantId/:orderId?customerId=` → `{ status: 'ok' | 'not_found' | 'unavailable' | 'misconfigured' | 'not_configured', order? }`
- `GET /internal/orders/:tenantId?customerId=` → `{ status, orders? }`

`customerId` is required, and tenant-auth uses exactly the value it receives.

## 4. Agent: `lookup_order`

- `GET /internal/agent-config/:tenantId` gains `orderLookup: boolean`, true when the tenant has an order API configured.
- `lookup_order` is offered when `orderLookup` is true **and** the turn has a customer: the gateway-verified `x-customer-id` on `/chat/messages`, or the playground's test customer ID.
- Tool definition: `lookup_order({ orderId? })`. With `orderId` it looks up one order; without it, it lists the customer's 5 most recent orders. The model never supplies a customer ID; chat-service fills it in from the request.
- What the model is told for each result:

  | Result | Message to the model |
  |---|---|
  | `ok` | the order or orders as JSON |
  | `not_found` | "No order with that number on this customer's account." |
  | `unavailable` or `misconfigured` | "The shop's order system can't be reached right now; say you can't check orders at the moment and never guess." |

  The stored `ToolActivity` keeps the status and the order data; this is the only place Helpix stores order data (parent §3.1).
- Stream `tool` event: `{ name: 'lookup_order', status, sources: [], order?: { orderId, status } }`. The widget shows an order chip ("Order #1047 · processing"), or "Couldn't check your order" on error.
- Platform rules gain:
  - Use `lookup_order` for questions about the customer's orders.
  - If it is not available, tell the customer to sign in on the shop to ask about orders.
  - Never state order details that did not come from `lookup_order`.
- The `search_kb` prefetch stays as it is. Orders are not prefetched.
- `GET /widget/config` returns `orderLookup` (true when configured). While no customer is identified and `orderLookup` is true, the widget shows "Sign in on <shop name> to ask about your orders" under the composer.

## 5. Orchard demo backend, accounts and checkout

### 5.1 Backend

`demos/iphone-store/server/` is a Fastify app on port **4101**. It runs on the host via `tsx`, started by `make dev`, `make start` and `make demo` alongside the Vite storefront. Vite proxies `/api` to it.

State lives in `demos/iphone-store/.data/` (gitignored):
- `customers.json`, `orders.json` (customers and orders created at runtime)
- `shop-key.pem` (RSA private key)
- `order-api-key`
- `session-secret`

The seed creates these files.

**Shopper API** (same-origin through the Vite proxy):
- `POST /api/signup { name, email, password }`
  - Validation: name 1–80 characters; email normalised to lowercase and unique; password at least 8 characters.
  - Creates the customer with ID `cust_<random>` and signs them in.
- `POST /api/login { email, password }`: a wrong email or a wrong password gives the same error, "Email or password is incorrect".
- `POST /api/logout`
- `GET /api/me` → `{ customer: { id, name, email } | null, helpixToken?: string }`. The token is a fresh RS256 JWT with `sub` = customer ID, `aud` = widget key and `exp` = 1 hour.
- `POST /api/checkout { items: { productId, color, gb, quantity }[] }`
  - Requires sign-in; 1–20 lines, quantity 1–10.
  - Creates a `processing` order with ID `1001`, `1002`, … (continuing after the seeded ones) and returns `{ orderId }`.

Security, demo-grade on purpose (the pages say "demo shop"):
- Passwords are hashed with Node `crypto.scrypt` (16-byte salt, compared with `timingSafeEqual`).
- Sessions are a signed httpOnly `SameSite=Lax` cookie.
- No email verification, password reset or rate limiting.

**Order API** (contract §3.5):
- `GET /orders/:orderId` and `GET /orders?limit=`
- Requires `Authorization: Bearer <order-api-key>`; anything else gets 401.
- Returns only orders owned by `X-Customer-Id`; another customer's order gets 404, the same as an unknown one.

### 5.2 Storefront

- New pages: "Sign in" and "Create account", both email and password with inline errors. The header shows the customer's name and "Sign out".
- On load and after signing in or up, the storefront calls `Helpix.identify(helpixToken)`. It re-fetches `/api/me` every 30 minutes and on window focus, so the token never expires mid-chat. Sign-out calls `Helpix.logout()`.
- Checkout is enabled when signed in ("Place demo order, no payment") and goes to an "Order #1047 placed" confirmation. Signed out, it links to Sign in.

### 5.3 Seed data and seeding

- `seed/customers.json` has three accounts with fixed IDs and known passwords: `cust_maya` (`maya@orchard.demo`), `cust_leo` (`leo@orchard.demo`) and `cust_ana` (`ana@orchard.demo`), all with password `orchard-demo`. The seed hashes the passwords when it first creates `.data/customers.json`; the file itself holds no plain passwords.
- `seed/orders.json` gives them about eight orders in states processing, shipped (with tracking), delivered, cancelled and returned, plus a `note` and `eta` where they make sense.
- `make seed-demos` additionally (still idempotent):
  1. Generates the RSA key pair, order API key and session secret into `.data/` if missing.
  2. Uploads the public key (`PUT /integrations/shop-key`).
  3. Saves the order API (`PUT /integrations/order-api`) with base URL `DEMO_ORDER_API_URL`.
  4. Runs "test connection" with `cust_maya`, failing loudly if it does not pass.
  5. Writes the widget key where the backend reads it (for `aud`).
- The base URL depends on where tenant-auth runs. The Makefile passes `DEMO_ORDER_API_URL`:
  - `http://host.docker.internal:4101` for `make start` (Docker). docker-compose adds `extra_hosts: ["host.docker.internal:host-gateway"]` to tenant-auth for Linux.
  - `http://localhost:4101` for `make dev`.
- The demo customers and passwords are printed in the seed summary.

## 6. Dashboard

- **Integrations page** (tenant admins, new nav item):
  - **Order API card:** base URL, write-only API key ("Key saved · Replace" once stored), Save and Remove. "Test connection" takes a test customer ID and shows success or the failure in plain words, e.g. "The shop rejected the API key (401)", "Timed out after 5 s", "The response didn't match the order format".
  - **Shop sign-in key card:** paste or upload a PEM, show the fingerprint and date added, Replace and Remove. Help text explains that the shop keeps the private key, and lists the required claims (`sub` = customer ID, `aud` = widget key, `exp` at most 1 hour).
  - Removing either uses `ConfirmDialog`.
- **Playground:** the existing test customer ID turns on `lookup_order` when the order API is configured.
- **Conversation detail:** `lookup_order` activity shows the order ID asked about, the status and the order returned.

## 7. Error handling

| Situation | Shopper sees | Admin / logs |
|---|---|---|
| Shop down, timeout, invalid body | "I can't check orders right now" (never a guess) | status `unavailable` on the tool activity |
| Order not found or not theirs | "I couldn't find that order on your account" | `not_found` |
| Wrong API key | "I can't check orders right now" | `misconfigured`; "Test connection" shows 401 |
| No order API configured | asked to contact the shop (tool not offered) | — |
| Signed out | sign-in hint, tool not offered | — |
| Bad or expired shopper token | chat keeps working anonymously | one widget console warning; gateway 401 |

## 8. Testing

- **tenant-auth:**
  - encryption: round trip; a wrong master key or a tampered ciphertext fails; the key never appears in any response
  - integrations admin routes, validation and isolation
  - shop client against a fake shop: 200, 404, 401, 5xx, timeout, invalid body, oversized body, redirect
  - blocking of internal addresses
  - JWT verification: bad signature, wrong `aud`, expired, missing key, oversized
  - isolation: tenant A's key, token or orders never work for B
- **gateway:** customer token → `x-customer-id`; client `x-customer-id` and `x-helpix-customer-token` are stripped upstream; 401 pass-through; cache TTL capped by `exp`; preflight allows `x-helpix-customer-token`.
- **chat-service:** `lookup_order` offered only with a customer and `orderLookup`; the model cannot choose the customer; results map to the right messages and stored activity; the playground test customer turns it on.
- **widget:** identify and logout reset the conversation; identify before mount; the 401 fallback to anonymous; the sign-in hint; the order chip.
- **demo backend:** signup and login validation, password hashing, identical error for a wrong email or password, checkout, order API auth and ownership (another customer's order gives 404).
- **dashboard:** Integrations page states (empty, saved, replace, test results).
- **smoke-step4b:** signs up a fresh shopper on a temporary tenant, configures integrations, mints a token, checks out, asks the agent about the order through the gateway, and checks a wrong customer, a foreign order, a bad token and a signed-out shopper.
- **Manual Chrome check:**
  1. Sign in as Maya and ask "where's my order?".
  2. Check out and ask about the new order.
  3. Sign out, ask again, and see the sign-in hint.
  4. Create a new account and see an empty order history.

## 9. Out of scope (4b)

The Teen Fashion store (4c, React), real payments, email verification, password reset, rate limiting (step 5), Playwright (step 5), and widget history loaded from the server.
