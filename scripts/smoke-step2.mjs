// End-to-end check of step 2 (knowledge base) through the gateway. Run with the stack up: `npm run smoke`.
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'

async function call(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const buf = Buffer.from(await res.arrayBuffer())
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  return { status: res.status, buf, json: isJson && buf.length ? JSON.parse(buf.toString()) : null }
}

function check(condition, label, detail) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? '')
    process.exit(1)
  }
  console.log(`ok   ${label}`)
}

async function waitSettled(token, id) {
  for (let i = 0; i < 60; i++) {
    const res = await call('GET', `/kb/documents/${id}`, { token })
    if (res.json?.status !== 'processing') return res.json
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`document ${id} still processing after 30 s`)
}

const suffix = Date.now().toString(36)
const root = await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })
check(root.status === 200, 'super-admin login', root.json)
const rootToken = root.json.accessToken

async function makeTenant(slug) {
  const t = await call('POST', '/admin/tenants', { token: rootToken, body: { name: `KB ${slug}`, slug: `${slug}-${suffix}` } })
  check(t.status === 201, `create tenant ${slug}`, t.json)
  const email = `${slug}-${suffix}@smoke.test`
  const admin = await call('POST', `/admin/tenants/${t.json.id}/admins`, { token: rootToken, body: { email, password: 'smoke-password-1' } })
  check(admin.status === 201, `create admin for ${slug}`, admin.json)
  const login = await call('POST', '/auth/login', { body: { email, password: 'smoke-password-1' } })
  check(login.status === 200, `tenant admin ${slug} login`, login.json)
  return login.json.accessToken
}

const a = await makeTenant('kb-a')
const b = await makeTenant('kb-b')

const md = `# Returns\n\nRefunds are accepted within 30 days of delivery. Reference ${suffix}.`
const form = new FormData()
form.append('title', 'Return policy')
form.append('file', new Blob([md], { type: 'text/markdown' }), 'returns.md')
const up = await call('POST', '/kb/documents', { token: a, form })
check(up.status === 202 && up.json.status === 'processing', 'upload Markdown returns 202 processing', up.json)
const id = up.json.id

const ready = await waitSettled(a, id)
check(ready.status === 'ready' && ready.chunkCount >= 1, 'document becomes ready with chunks', ready)

const file = await call('GET', `/kb/documents/${id}/file`, { token: a })
check(file.status === 200 && file.buf.toString() === md, 'download returns the original bytes')

const hit = await call('POST', '/kb/search', { token: a, body: { query: 'refunds within 30 days of delivery' } })
check(hit.status === 200 && hit.json.results[0]?.documentId === id, 'search finds the document', hit.json)

const leak = await call('POST', '/kb/search', { token: b, body: { query: 'refunds within 30 days of delivery' } })
check(leak.status === 200 && leak.json.results.every((r) => r.documentId !== id), "tenant B's search never returns A's chunks", leak.json)
for (const [method, path] of [['GET', ''], ['GET', '/file'], ['GET', '/text'], ['DELETE', '']]) {
  const res = await call(method, `/kb/documents/${id}${path}`, { token: b })
  check(res.status === 404, `tenant B ${method} /kb/documents/:id${path} is 404`, res.json)
}

const paste = await call('POST', '/kb/documents/text', { token: a, body: { title: 'Opening hours', text: 'Open Monday to Friday, 9 to 5.' } })
check(paste.status === 202, 'paste text returns 202', paste.json)
check((await waitSettled(a, paste.json.id)).status === 'ready', 'pasted text becomes ready')

const idx = await call('GET', '/kb/reindex', { token: a })
check(idx.status === 200 && idx.json.total >= 2 && idx.json.done === idx.json.total, 'index is up to date', idx.json)

const superList = await call('GET', '/kb/documents', { token: rootToken })
check(superList.status === 403, 'super-admin has no KB of its own (403)', superList.json)

const fake = new FormData()
fake.append('file', new Blob(['not a pdf']), 'fake.pdf')
const bad = await call('POST', '/kb/documents', { token: a, form: fake })
check(bad.status === 415 && bad.json.error.code === 'unsupported_file_type', 'a mislabelled file is refused (415)', bad.json)

const huge = new FormData()
huge.append('file', new Blob([Buffer.alloc(12 * 1024 * 1024, 'a')]), 'huge.txt')
const big = await call('POST', '/kb/documents', { token: a, form: huge })
check(big.status === 413, 'a file over the upload limit is refused (413)', big.json)

const del = await call('DELETE', `/kb/documents/${id}`, { token: a })
check(del.status === 204, 'delete returns 204')
check((await call('GET', `/kb/documents/${id}`, { token: a })).status === 404, 'deleted document is gone')

console.log('\nstep 2 smoke test passed')
