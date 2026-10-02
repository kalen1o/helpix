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
