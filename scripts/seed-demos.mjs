// Provisions every demo shop (demos/*/seed/shop.json) through the gateway: tenant, admin, allowed origin, KB documents,
// published agent config, and the widget key written to the demo's .env.development.local. Safe to run repeatedly.
// Run with the stack up: `make seed-demos`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'
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

const root = await login(SUPER_EMAIL, SUPER_PASSWORD)
if (!root) fail('super-admin login failed. Check SEED_SUPERADMIN_EMAIL/PASSWORD in .env.')

const shops = readdirSync('demos').filter((d) => existsSync(join('demos', d, 'seed', 'shop.json')))
const summary = []

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
  summary.push({ shop: shop.name, url: shop.origin, admin: shop.adminEmail, password: shop.adminPassword })
}

console.log('\nDemo shops ready:')
console.table(summary)
