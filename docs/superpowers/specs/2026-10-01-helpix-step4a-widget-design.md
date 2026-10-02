# Helpix Step 4a — Widget and First Demo Shop

Date: 2026-10-01
Status: Draft for review
Parent spec: `2026-09-30-helpix-design.md` (sections 2.3, 2.5, 6, 7, 11 step 4)

## 1. Goal and scope

Step 4 of the build order is split in two plans and two PRs.

**4a (this spec):** the iPhone demo store runs locally with the Helpix widget embedded. An anonymous visitor opens the widget and gets streamed answers from that shop's KB in that shop's tone. The widget renders correctly styled inside a Shadow DOM and is refused on origins the tenant has not allowed.

**4b (later spec):** shop JWT public keys and RS256 verification, `Helpix.identify` / `logout`, order-API config with AES-GCM encrypted keys, the order API contract types, `lookup_order`, the Integrations page, the demo orders backend and fake login, and the teen fashion store.

Assumptions: the demos are for local runs and showing people, not production hosting. Playwright e2e stays in step 5.

Success criteria:
- `make seed-demos` then `make dev` gives a working iPhone store on `http://localhost:5174` whose widget answers from its KB.
- The same widget key used from another origin gets 403. A suspended tenant's widget gets 403.
- Shadows, rings, transforms and the native `<dialog>` render styled inside the shadow root.

## 2. Gateway widget surface

- **Credential:** header `x-helpix-widget-key`. The gateway calls the existing tenant-auth `POST /internal/resolve-widget` with `{ widgetKey, origin }` (the request's `Origin`) and caches the result per (key, origin) in a `TtlCache` with `RESOLVE_CACHE_TTL_MS`. Errors from the resolver (401 `invalid_widget_key`, 403 `tenant_suspended`, 403 `origin_not_allowed`) pass through, and are not cached. A widget request without an `Origin` header is rejected with 403 `origin_not_allowed`.
- **Forwarding:** widget requests are forwarded with `x-tenant-id` and the internal token, with no role and no admin ID. Client-supplied identity headers are stripped as today.
- **Widget-reachable routes:** exactly `POST /chat/messages` (chat-service, unchanged) and `GET /widget/config` (tenant-auth, new). A widget key on any other path returns 403 `forbidden`. A request carrying both a widget key and an `Authorization` header returns 400 `ambiguous_credentials`.
- **`GET /widget/config`** (tenant-auth, needs `x-tenant-id` and no role) returns `WidgetConfig { shopName, greeting, accentColor, orderLookup }` from the tenant's **published** agent config with defaults applied. `orderLookup` is always `false` in 4a.
- **CORS:** for widget routes the CORS layer reflects any origin and allows `content-type` and `x-helpix-widget-key`. The real origin check is the tenant's `allowed_origins`, enforced by the resolver. Admin routes keep the existing `corsOrigins` allowlist. Preflight responses never call the resolver.
- **Bundle:** the gateway serves `apps/widget/dist/helpix-widget.js` at `GET /widget/helpix-widget.js` (`application/javascript`, `cache-control: public, max-age=300`), path configured by `WIDGET_BUNDLE_PATH`. A missing file returns 404. The Docker image copies the built bundle.
- `services/gateway/src/path.ts` rules still apply to every routed request. These changes are security-sensitive and need tests for each rejection above.

## 3. Widget (`apps/widget`)

### 3.1 Spike first (Task 0, throwaway)

Mount a shadow root with the compiled `@helpix/ui` CSS and check in Chrome: shadow, ring, translate/scale, a gradient, and a native `<dialog>` opened from inside the shadow root. Expected finding: `@property` rules are ignored inside shadow roots, so the `--tw-*` variables have no initial values. Choose one fix, whichever passes the visual check:
- (a) extract the `@property` blocks from the compiled CSS at build time and inject them once into `document.head` (they register globally and do not style the host page); or
- (b) add a `:host, *, ::before, ::after, ::backdrop` rule that sets every `--tw-*` initial value.

Outcome: `shadowSafeCss` applies (b). It also converts every `rem` in declaration blocks to `px` (x16), because rem resolves against the host page's `<html>` font-size even inside a shadow root (Shopify Dawn sets `html{font-size:62.5%}`), which would shrink the widget. Selectors are left untouched.

Record the result in the plan and in the widget's README section. The spike code is not kept.

### 3.2 Build and bootstrap

- Vite library mode, one IIFE file `helpix-widget.js`, with Vue bundled. Compiled CSS is imported as a string and applied with `adoptedStyleSheets`, falling back to a `<style>` element.
- Theme tokens are declared on `:host`. Fonts: Instrument Sans is loaded by a `<link>` added once to `document.head`, because `@font-face` inside a shadow root is ignored. The system font stack is the fallback.
- On load, the script finds its own `<script data-widget-key>` element, creates a host `<div>` with an open shadow root appended to `document.body`, and mounts the Vue app inside. The API base is the origin of the script's `src`, overridable with `data-api-base`.
- Global: `window.Helpix = { open(), close(), identify(jwt), logout() }`. `identify` and `logout` are no-ops in 4a.
- If `GET /widget/config` fails (bad key, wrong origin, suspended), the widget logs one console warning and renders nothing.

### 3.3 UI

Follows `DESIGN.md` and the brand sheet:
- Launcher: 56 px circle, 16 px from bottom and right, white mark at 28 px on Mint 600 or the tenant accent colour.
- Panel: header with the shop name (not helpix) and a close button, greeting as the first agent bubble, message list, composer (Enter sends, Shift+Enter newline, 2000-character limit), and a footer with "Powered by" plus the helpix lockup at 12 px.
- Agent bubbles use the Mint wash, customer bubbles Ink. Message text is plain text with `whitespace-pre-wrap`, never HTML.
- A typing indicator until the first delta. Source chips from `tool` events with `search_kb` sources.
- An `error` event shows the message with "Try again", which resends the same user message (it was not stored server-side).
- Mobile: under 480 px wide the panel goes full-screen.
- Respects `prefers-reduced-motion`.

### 3.4 Streaming and state

- `fetch` with `readSseEvents` from `@helpix/shared/sse`. Headers: `x-helpix-widget-key`, `content-type`. Body: `{ message, conversationId?, sessionToken? }`.
- `localStorage` key `helpix:<widgetKey>` holds `{ conversationId, sessionToken }`. The messages shown in this tab are kept in `sessionStorage` under the same key. Storage access is wrapped in try/catch, and the widget works without it.
- A 404 `conversation_not_found` clears the stored conversation and silently retries once as a new conversation.
- Closing the panel does not abort a reply in progress. "New chat" aborts it and clears the stored conversation.

### 3.5 Tests

Vitest with `@vue/test-utils` and jsdom: the stream-event reducer, storage reset and retry on 404, the Try-again path, script-tag bootstrapping (key and API base), and mounting into a shadow root.

## 4. iPhone demo store (`demos/iphone-store`)

- A Vite + Vue 3 storefront on port 5174 with routes for the product grid, product detail and cart (client-side, checkout disabled).
- A fictional brand, "Orchard Store". It must not use Apple's name, logo or product photos. It may sell "phones" with invented model names and use CSS or SVG product art.
- A sleek dark palette set by overriding `@helpix/ui` tokens on the demo's own `:root`.
- Embeds `<script src="{VITE_HELPIX_GATEWAY}/widget/helpix-widget.js" data-widget-key="{VITE_HELPIX_WIDGET_KEY}">` in `index.html` via Vite env substitution.
- No backend in 4a.
- `seed/kb/*.md` covers shipping, returns, warranty, device protection plan, trade-in and store hours. `seed/agent.json` holds the prompt, tone preset `professional` with notes, the greeting and the accent colour.

## 5. Seeding

`make seed-demos` runs `scripts/seed-demos.mjs` against the gateway. It is idempotent and does the following for each demo directory with a `seed/` folder:
1. Log in as super-admin with the `.env` seed credentials.
2. Find the tenant by slug or create it. Find or create its tenant admin, with demo credentials printed at the end.
3. Set `allowed_origins` to the demo's origin.
4. Log in as the tenant admin. Upload each KB file whose title is not already present. Poll until all documents are `ready`, failing on `failed`.
5. Save the draft agent config from `agent.json`, then publish it.
6. Write `VITE_HELPIX_WIDGET_KEY` and `VITE_HELPIX_GATEWAY` to `demos/<shop>/.env.development.local` (gitignored; not `.env.local`, because the committed `.env.development` would override `.env.local` in Vite's precedence).

`make dev` and `make start` also start the demo dev server.

## 6. Testing and verification

- **Gateway:**
  - unknown key → 401
  - missing or disallowed origin → 403
  - suspended tenant → 403
  - widget key on a non-widget path → 403
  - widget key plus bearer token → 400
  - a client-sent `x-tenant-id` / `x-customer-id` is stripped
  - preflight succeeds without a resolver call
  - (key, origin) caching, and errors are not cached
  - the bundle route returns 404 when the file is missing
- **tenant-auth:** `GET /widget/config` returns the published config with defaults, is tenant-isolated, and rejects requests with an admin role.
- **Widget:** the unit tests in 3.5.
- **Smoke:** `scripts/smoke-step4a.mjs` (through the gateway, stack running; it creates its own tenant rather than using the seeded demo) does the following:
  - fetches `/widget/config` with the demo origin
  - streams one `/chat/messages` turn to `done`
  - sends a second message on the same conversation with the session token
  - repeats the turn from a bad origin and expects 403
- **Manual:** load the demo in Chrome, chat, check the styling inside the shadow root, and take screenshots.

## 7. Out of scope (4a)

JWT verification, customer identity, orders, `lookup_order`, Integrations page, the teen store, demo backends, loading server-side conversation history in the widget, rate limits, Playwright.
