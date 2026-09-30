// End-to-end check of step 1 through the gateway. Run with the stack up: `npm run smoke`.
import http from 'node:http'

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null, requestId: res.headers.get('x-request-id') }
}

// Sends the path verbatim on the request line. fetch() resolves `..` and `%2e%2e` client-side, which would
// hide a gateway traversal bug, so traversal probes go through node:http instead.
function rawPost(path, body) {
  const url = new URL(BASE)
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, method: 'POST', path, headers: { 'content-type': 'application/json' } },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

function check(condition, label, detail) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? '')
    process.exit(1)
  }
  console.log(`ok   ${label}`)
}

const suffix = Date.now().toString(36)

const health = await call('GET', '/health')
check(health.status === 200 && health.requestId, 'gateway health with request id', health)

const root = await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })
check(root.status === 200, 'super-admin login', root.json)
const rootToken = root.json.accessToken

const tenant = await call('POST', '/admin/tenants', { token: rootToken, body: { name: `Smoke ${suffix}`, slug: `smoke-${suffix}` } })
check(tenant.status === 201 && tenant.json.widgetKey.startsWith('wk_'), 'create tenant', tenant.json)
const tenantId = tenant.json.id

const ownerEmail = `owner-${suffix}@smoke.test`
const admin = await call('POST', `/admin/tenants/${tenantId}/admins`, { token: rootToken, body: { email: ` ${ownerEmail.toUpperCase()} `, password: 'password-1' } })
check(admin.status === 201 && admin.json.email === ownerEmail, 'create tenant admin with normalized email', admin.json)

const owner = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'password-1' } })
check(owner.status === 200, 'tenant admin login', owner.json)

const me = await call('GET', '/me', { token: owner.json.accessToken, headers: { 'x-admin-id': root.json.admin.id, 'x-tenant-id': 'spoofed' } })
check(me.status === 200 && me.json.admin.email === ownerEmail && me.json.tenant.id === tenantId, 'spoofed identity headers are ignored', me.json)

const forbidden = await call('GET', '/admin/tenants', { token: owner.json.accessToken })
check(forbidden.status === 403 && forbidden.json.error.requestId === forbidden.requestId, 'tenant admin cannot use super-admin routes; error carries request id', forbidden.json)

const internal = await call('POST', '/internal/resolve-admin', { body: { accessToken: rootToken } })
check(internal.status === 404, 'internal routes are not exposed', internal.json)

for (const path of ['/auth/../internal/resolve-admin', '/auth/%2e%2e/internal/resolve-widget']) {
  const probe = await rawPost(path, { accessToken: rootToken, widgetKey: tenant.json.widgetKey, origin: null })
  check(probe.status === 404 && probe.json?.error?.code === 'not_found', `gateway rejects traversal ${path}`, probe)
}

const suspended = await call('POST', `/admin/tenants/${tenantId}/suspend`, { token: rootToken })
check(suspended.status === 200 && suspended.json.status === 'suspended', 'suspend tenant', suspended.json)

const blockedLogin = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'password-1' } })
check(blockedLogin.status === 403 && blockedLogin.json.error.code === 'tenant_suspended', 'suspended tenant admin cannot log in', blockedLogin.json)

const blockedRefresh = await call('POST', '/auth/refresh', { body: { refreshToken: owner.json.refreshToken } })
check(blockedRefresh.status === 403, 'suspended tenant admin cannot refresh', blockedRefresh.json)

const reactivated = await call('POST', `/admin/tenants/${tenantId}/reactivate`, { token: rootToken })
check(reactivated.json.status === 'active', 'reactivate tenant', reactivated.json)
const again = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'password-1' } })
check(again.status === 200, 'tenant admin can log in after reactivation', again.json)

console.log('\nStep 1 smoke test passed.')
