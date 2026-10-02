// Provisions every demo shop (demos/*/seed/shop.json) through the gateway: tenant, admin, allowed origin, KB documents,
// published agent config, and the widget key written to the demo's .env.development.local. Shops with their own
// backend (demos/<shop>/server/main.ts) also get shopper sign-in and order lookup: an RSA key pair, order API key and
// session secret in demos/<shop>/.data/ (kept when present), the public key and order API saved on the tenant, and a
// passing "test connection". Safe to run repeatedly.
// Run with the stack and the demo backend up: `make seed-demos`.
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'
// Where tenant-auth reaches the demo backend. The Makefile picks host.docker.internal when tenant-auth runs in Docker.
const ORDER_API_URL = (process.env.DEMO_ORDER_API_URL ?? 'http://localhost:4101').replace(/\/+$/, '')
const READY_TIMEOUT_MS = 120_000

function fail(message, detail) {
  console.error(`seed-demos: ${message}`, detail ?? '')
  process.exit(1)
}

async function call(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  } catch {
    fail(`cannot reach the gateway at ${BASE}. Start the stack first (make start or make dev).`)
  }
  const text = await res.text()
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
  }
  return { status: res.status, json }
}

async function must(label, promise, ...ok) {
  const res = await promise
  if (!ok.includes(res.status)) fail(`${label} failed (${res.status})`, res.json)
  return res.json
}

async function login(email, password) {
  const res = await call('POST', '/auth/login', { body: { email, password } })
  return res.status === 200 ? res.json.accessToken : null
}

const titleOf = (markdown, file) => /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? basename(file, '.md')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Creates the shop's secrets in `.data/` when missing; existing files are kept so sessions and keys survive re-seeding. */
function ensureShopSecrets(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  const privatePath = join(dataDir, 'shop-key.pem')
  const publicPath = join(dataDir, 'shop-key.pub.pem')
  if (existsSync(privatePath) && !existsSync(publicPath)) {
    writeFileSync(publicPath, createPublicKey(readFileSync(privatePath)).export({ type: 'spki', format: 'pem' }))
    console.log('  derived the shop public key from the existing private key')
  } else if (!existsSync(privatePath) || !existsSync(publicPath)) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    writeFileSync(privatePath, privateKey, { mode: 0o600 })
    writeFileSync(publicPath, publicKey)
    console.log('  generated the shop sign-in key pair')
  }
  for (const file of ['order-api-key', 'session-secret']) {
    const path = join(dataDir, file)
    if (!existsSync(path)) {
      writeFileSync(path, `${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 })
      console.log(`  generated ${file}`)
    }
  }
  return {
    publicKeyPem: readFileSync(publicPath, 'utf8'),
    orderApiKey: readFileSync(join(dataDir, 'order-api-key'), 'utf8').trim(),
  }
}

const backendHint = (dir) =>
  `Is the demo backend running? Start it with make demo (make start and make dev also run it): ` +
  `curl -s localhost:4101/orders should answer 401. tenant-auth calls it at ${ORDER_API_URL}; ` +
  `a local URL also needs ORDER_API_ALLOW_PRIVATE_HOSTS=true in .env (restart tenant-auth after changing it). ` +
  `Backend files: demos/${dir}/server.`

const root = await login(SUPER_EMAIL, SUPER_PASSWORD)
if (!root) fail('super-admin login failed. Check SEED_SUPERADMIN_EMAIL/PASSWORD in .env.')

const shops = readdirSync('demos').filter((d) => existsSync(join('demos', d, 'seed', 'shop.json')))
const summary = []
const shoppers = []

for (const dir of shops) {
  const seed = join('demos', dir, 'seed')
  const shop = JSON.parse(readFileSync(join(seed, 'shop.json'), 'utf8'))
  const agent = JSON.parse(readFileSync(join(seed, 'agent.json'), 'utf8'))
  console.log(`\n${shop.name}`)

  const { tenants } = await must('list tenants', call('GET', '/admin/tenants', { token: root }), 200)
  let tenant = tenants.find((t) => t.slug === shop.slug)
  if (!tenant) {
    tenant = await must('create tenant', call('POST', '/admin/tenants', { token: root, body: { name: shop.name, slug: shop.slug } }), 201)
    console.log('  created tenant')
  }
  if (tenant.status !== 'active') {
    await must('reactivate tenant', call('POST', `/admin/tenants/${tenant.id}/reactivate`, { token: root }), 200)
  }
  tenant = await must('set allowed origin', call('PATCH', `/admin/tenants/${tenant.id}`, { token: root, body: { allowedOrigins: [shop.origin] } }), 200)
  console.log(`  allowed origin ${shop.origin}`)

  const { admins } = await must('list admins', call('GET', `/admin/tenants/${tenant.id}/admins`, { token: root }), 200)
  if (!admins.some((a) => a.email === shop.adminEmail)) {
    await must('create admin', call('POST', `/admin/tenants/${tenant.id}/admins`, { token: root, body: { email: shop.adminEmail, password: shop.adminPassword } }), 201)
    console.log(`  created admin ${shop.adminEmail}`)
  }
  const token = await login(shop.adminEmail, shop.adminPassword)
  if (!token) fail(`cannot log in as ${shop.adminEmail}. Its password was changed; run make reset-db or fix it in the dashboard.`)

  const { documents } = await must('list documents', call('GET', '/kb/documents', { token }), 200)
  const have = new Set(documents.map((d) => d.title))
  const kbDir = join(seed, 'kb')
  for (const file of readdirSync(kbDir).filter((f) => f.endsWith('.md')).sort()) {
    const text = readFileSync(join(kbDir, file), 'utf8')
    const title = titleOf(text, file)
    if (have.has(title)) continue
    const form = new FormData()
    form.append('title', title) // fields before the file part: kb-service reads them from the file part
    form.append('file', new Blob([text], { type: 'text/markdown' }), file)
    await must(`upload ${file}`, call('POST', '/kb/documents', { token, form }), 202)
    console.log(`  uploaded ${title}`)
  }

  // A document that failed in an earlier run keeps its title (so it is not re-uploaded): retry it instead.
  for (const doc of documents.filter((d) => d.status === 'failed')) {
    await must(`retry ${doc.title}`, call('POST', `/kb/documents/${doc.id}/retry`, { token }), 202, 409)
    console.log(`  retrying ${doc.title}`)
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    const { documents: docs } = await must('poll documents', call('GET', '/kb/documents', { token }), 200)
    const failed = docs.filter((d) => d.status === 'failed')
    if (failed.length) fail(`documents failed to process: ${failed.map((d) => `${d.title} (${d.error})`).join(', ')}`)
    if (docs.every((d) => d.status === 'ready')) break
    if (Date.now() > deadline) fail('documents still processing after 2 minutes')
    await sleep(1000)
  }
  console.log('  knowledge base ready')

  await must('save agent draft', call('PUT', '/agent/config/draft', { token, body: agent }), 200)
  await must('publish agent', call('POST', '/agent/config/publish', { token }), 200)
  console.log('  agent config published')

  writeFileSync(
    join('demos', dir, '.env.development.local'),
    `# Written by make seed-demos. Restart the demo dev server after it changes.\nVITE_HELPIX_GATEWAY=${BASE}\nVITE_HELPIX_WIDGET_KEY=${tenant.widgetKey}\n`,
  )

  if (existsSync(join('demos', dir, 'server', 'main.ts'))) {
    const dataDir = join('demos', dir, '.data')
    const { publicKeyPem, orderApiKey } = ensureShopSecrets(dataDir)
    // The backend reads this for the token's `aud`, on every request, so no restart is needed.
    writeFileSync(join(dataDir, 'widget-key'), `${tenant.widgetKey}\n`)

    await must('upload shop key', call('PUT', '/integrations/shop-key', { token, body: { publicKeyPem } }), 200)
    console.log('  shop sign-in key uploaded')

    const saved = await call('PUT', '/integrations/order-api', { token, body: { baseUrl: ORDER_API_URL, apiKey: orderApiKey } })
    if (saved.status !== 200) {
      const hint = saved.json?.error?.code === 'invalid_base_url' ? ' Set ORDER_API_ALLOW_PRIVATE_HOSTS=true in .env and restart tenant-auth.' : ''
      fail(`saving the order API ${ORDER_API_URL} failed (${saved.status}).${hint}`, saved.json)
    }
    console.log(`  order API ${ORDER_API_URL}`)

    const customers = JSON.parse(readFileSync(join(seed, 'customers.json'), 'utf8'))
    const tester = customers[0].id
    const test = await must('test the order API', call('POST', '/integrations/order-api/test', { token, body: { customerId: tester } }), 200)
    if (!test.ok) fail(`the order API test for ${tester} did not pass: ${test.status}, ${test.message}\n  ${backendHint(dir)}`)
    console.log(`  order API test passed (${tester})`)

    for (const c of customers) shoppers.push({ shop: shop.name, email: c.email, password: c.password, customerId: c.id })
  }

  summary.push({ shop: shop.name, url: shop.origin, admin: shop.adminEmail, password: shop.adminPassword })
}

console.log('\nDemo shops ready:')
console.table(summary)
if (shoppers.length) {
  console.log('\nDemo shoppers (sign in on the store):')
  console.table(shoppers)
}
