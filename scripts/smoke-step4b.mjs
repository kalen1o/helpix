// End-to-end check of step 4b (shopper identity and order lookup) through the gateway. Run with the stack up: `npm run smoke`.
// It starts its own fake order API in this process; tenant-auth must be able to reach it (see orderApiHost) and needs
// ORDER_API_ALLOW_PRIVATE_HOSTS=true, as for the local demo.
import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { createServer } from 'node:http'

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'
const ORIGIN = 'http://smoke-orders.test'

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

/** Same detection as `make seed-demos`: tenant-auth in Docker reaches this host as host.docker.internal. */
function orderApiHost() {
  if (process.env.SMOKE_ORDER_API_HOST) return process.env.SMOKE_ORDER_API_HOST
  try {
    const id = execFileSync('docker', ['compose', 'ps', '--status', 'running', '-q', 'tenant-auth'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return id ? 'host.docker.internal' : 'localhost'
  } catch {
    return 'localhost'
  }
}

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
/** RS256 = RSASSA-PKCS1-v1_5 with SHA-256, which is what node:crypto sign() does with an RSA key. */
function mintToken(privateKey, claims) {
  const input = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}`
  return `${input}.${sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`
}
const fingerprintOf = (pem) =>
  createHash('sha256').update(createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex').match(/../g).join(':')

// ---- A fake shop order API for two customers ----
const API_KEY = randomBytes(24).toString('base64url')
const ORDERS = {
  smoke_ann: [
    {
      orderId: '5001',
      status: 'shipped',
      placedAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-29T08:00:00.000Z',
      items: [{ name: 'Smoke Phone', quantity: 1, variant: 'Black · 128 GB' }],
      eta: '2026-10-03T18:00:00.000Z',
      tracking: { carrier: 'Swift Parcel', number: 'SP5001', url: 'https://track.example.com/SP5001' },
    },
    {
      orderId: '5003',
      status: 'delivered',
      placedAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-03T15:00:00.000Z',
      items: [{ name: 'Smoke Case', quantity: 2 }],
    },
  ],
  smoke_ben: [
    {
      orderId: '5002',
      status: 'processing',
      placedAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
      items: [{ name: 'Smoke Buds', quantity: 1 }],
    },
  ],
}
const seen = [] // { path, customerId } of every request with the right key

const shop = createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(401, { error: 'unauthorized' })
  const customerId = String(req.headers['x-customer-id'] ?? '')
  const url = new URL(req.url ?? '/', 'http://shop.local')
  seen.push({ path: url.pathname, customerId })
  const mine = Object.hasOwn(ORDERS, customerId) ? ORDERS[customerId] : []
  if (url.pathname === '/orders') return send(200, { orders: mine.slice(0, Number(url.searchParams.get('limit') ?? 5)) })
  const match = /^\/orders\/([^/]+)$/.exec(url.pathname)
  const order = match && mine.find((o) => o.orderId === decodeURIComponent(match[1]))
  return order ? send(200, order) : send(404, { error: 'not_found' })
})
await new Promise((resolve) => shop.listen(0, '0.0.0.0', resolve))
const SHOP_URL = `http://${orderApiHost()}:${shop.address().port}`
console.log(`fake order API for tenant-auth: ${SHOP_URL}`)

// ---- Tenant, admin, agent ----
const suffix = Date.now().toString(36)
const root = (await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })).json.accessToken
check(root, 'super-admin login')
const tenant = (await call('POST', '/admin/tenants', { token: root, body: { name: 'Orders Smoke', slug: `orders-${suffix}` } })).json
await call('PATCH', `/admin/tenants/${tenant.id}`, { token: root, body: { allowedOrigins: [ORIGIN] } })
const email = `orders-${suffix}@smoke.test`
await call('POST', `/admin/tenants/${tenant.id}/admins`, { token: root, body: { email, password: 'smoke-password-1' } })
const admin = (await call('POST', '/auth/login', { body: { email, password: 'smoke-password-1' } })).json.accessToken
check(admin, 'tenant admin login')
await call('PUT', '/agent/config/draft', {
  token: admin,
  body: { prompt: 'Orders smoke shop.', tone: 'concise', toneNotes: '', greeting: 'Hello', accentColor: '#123456', modelOverride: null },
})
await call('POST', '/agent/config/publish', { token: admin })

// ---- Integrations ----
const none = await call('GET', '/integrations', { token: admin })
check(none.status === 200 && none.json.orderApi === null && none.json.shopKey === null, 'a new tenant has no integrations', none.json)

const shopKeys = keyPair()
const savedKey = await call('PUT', '/integrations/shop-key', { token: admin, body: { publicKeyPem: shopKeys.publicKey } })
check(savedKey.status === 200 && savedKey.json.shopKey?.fingerprint === fingerprintOf(shopKeys.publicKey), 'shop key saved with its SHA-256 fingerprint', savedKey.json)

const WRONG_KEY = 'wrong-key-0000'
const wrong = await call('PUT', '/integrations/order-api', { token: admin, body: { baseUrl: SHOP_URL, apiKey: WRONG_KEY } })
if (wrong.status === 400 && wrong.json?.error?.code === 'invalid_base_url') {
  console.error(`FAIL ${SHOP_URL} was refused as a private address: set ORDER_API_ALLOW_PRIVATE_HOSTS=true in .env and restart tenant-auth`)
  process.exit(1)
}
check(wrong.status === 200 && wrong.json.orderApi?.baseUrl === SHOP_URL && wrong.json.orderApi.hasApiKey === true, 'order API saved', wrong.json)
check(!wrong.text.includes(WRONG_KEY), 'the saved view never contains the API key')

const rejected = await call('POST', '/integrations/order-api/test', { token: admin, body: { customerId: 'smoke_ann' } })
check(rejected.status === 200 && rejected.json.ok === false && rejected.json.status === 'misconfigured', 'test connection reports a rejected key as misconfigured', rejected.json)

const fixed = await call('PUT', '/integrations/order-api', { token: admin, body: { baseUrl: SHOP_URL, apiKey: API_KEY } })
check(fixed.status === 200 && !fixed.text.includes(API_KEY), 'order API key replaced and never echoed', fixed.status)
const testedFrom = seen.length
const tested = await call('POST', '/integrations/order-api/test', { token: admin, body: { customerId: 'smoke_ann' } })
if (tested.json?.status === 'unavailable') {
  console.error(`FAIL tenant-auth cannot reach ${SHOP_URL}. With tenant-auth in Docker, check extra_hosts in docker-compose.yml; set SMOKE_ORDER_API_HOST to override.`)
  process.exit(1)
}
check(tested.status === 200 && tested.json.ok === true && tested.json.status === 'ok', 'test connection passes against the fake shop', tested.json)
check(seen.length > testedFrom && seen.slice(testedFrom).every((r) => r.customerId === 'smoke_ann'), 'the shop saw only the test customer', seen.slice(testedFrom))

// ---- Widget ----
const widget = (extra = {}) => ({ 'x-helpix-widget-key': tenant.widgetKey, origin: ORIGIN, ...extra })
const cfg = await call('GET', '/widget/config', { headers: widget() })
check(cfg.status === 200 && cfg.json.orderLookup === true, 'widget config turns on order lookup once the order API is set', cfg.json)

const now = Math.floor(Date.now() / 1000)
const tokenFor = (sub, { aud = tenant.widgetKey, key = shopKeys.privateKey, iat = now, exp = now + 600 } = {}) => mintToken(key, { sub, aud, iat, exp })
const ask = (message, headers = {}) => call('POST', '/chat/messages', { headers: widget(headers), body: { message } })
const asShopper = (token) => ({ 'x-helpix-customer-token': token })
const lookups = (res) => events(res.text).filter((e) => e.event === 'tool' && e.data.name === 'lookup_order').map((e) => e.data)

const otherKeys = keyPair()
for (const [label, token] of [
  ['a token signed by another key', tokenFor('smoke_ann', { key: otherKeys.privateKey })],
  ['a token minted for another widget key (aud)', tokenFor('smoke_ann', { aud: 'wk_someone_else' })],
  ['an expired token', tokenFor('smoke_ann', { iat: now - 7200, exp: now - 3600 })],
  ['a token valid for more than an hour', tokenFor('smoke_ann', { exp: now + 7200 })],
  ['a token without sub', mintToken(shopKeys.privateKey, { aud: tenant.widgetKey, iat: now, exp: now + 600 })],
  ['a malformed token', 'not.a.jwt'],
]) {
  const res = await ask('What is the status of order 5001?', asShopper(token))
  check(res.status === 401 && res.json?.error?.code === 'invalid_customer_token', `${label} gets 401 invalid_customer_token`, res.json ?? res.status)
}

const annFrom = seen.length
const annTurn = await ask('What is the status of order 5001?', asShopper(tokenFor('smoke_ann')))
check(annTurn.status === 200 && events(annTurn.text).at(-1)?.event === 'done', 'a verified shopper chats and the turn completes', events(annTurn.text).at(-1))

{
  const found = lookups(annTurn)
  check(found.some((t) => t.status === 'ok' && t.orders?.some((o) => o.orderId === '5001' && o.status === 'shipped')), "lookup_order returns the shopper's order 5001 (shipped)", found)
  check(seen.slice(annFrom).every((r) => r.customerId === 'smoke_ann'), "the shop was asked only about the token's customer", seen.slice(annFrom))

  const benFrom = seen.length
  const benTurn = await ask('What is the status of order 5001?', asShopper(tokenFor('smoke_ben')))
  const benLookups = lookups(benTurn)
  check(benLookups.length > 0 && !benTurn.text.includes('Smoke Phone'), "another customer's order 5001 is never returned", benLookups)
  check(benLookups.some((t) => t.status === 'empty'), "another customer's order is not_found (chip 'Order not found')", benLookups)
  check(seen.slice(benFrom).every((r) => r.customerId === 'smoke_ben'), "the shop was asked only about the second token's customer", seen.slice(benFrom))
}

const anonFrom = seen.length
const anon = await ask('Where is my order 5001?', { 'x-customer-id': 'smoke_ann' })
check(anon.status === 200 && events(anon.text).at(-1)?.event === 'done', 'a signed-out shopper still chats (a spoofed x-customer-id is ignored)')
check(lookups(anon).length === 0 && seen.length === anonFrom, 'signed out, lookup_order is not offered and the shop is never called', lookups(anon))

// ---- Removing the integrations ----
const removedApi = await call('DELETE', '/integrations/order-api', { token: admin })
check(removedApi.status === 204, 'order API removed')
const cfgAfter = await call('GET', '/widget/config', { headers: widget() })
check(cfgAfter.json?.orderLookup === false, 'widget config turns order lookup off again', cfgAfter.json)
const removedKey = await call('DELETE', '/integrations/shop-key', { token: admin })
check(removedKey.status === 204, 'shop key removed')
// A new sub gives a token the gateway has never cached.
const noKey = await ask('Hi', asShopper(tokenFor('smoke_cat')))
check(noKey.status === 401 && noKey.json?.error?.code === 'invalid_customer_token', 'with no shop key, a token gets 401', noKey.json ?? noKey.status)

shop.close()
console.log('\nstep 4b smoke test passed')
