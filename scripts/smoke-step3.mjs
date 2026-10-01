// End-to-end check of step 3 (agent) through the gateway. Run with the stack up: `npm run smoke`.
// Works with CHAT_PROVIDER=fake (deterministic) and with a real model (then only the shape of the stream is checked).
const BASE = process.env.GATEWAY_URL ?? 'http://localhost:4000'
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@helpix.local'
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'change-me-please'
const FAKE_LLM = (process.env.CHAT_PROVIDER || 'fake') === 'fake'

async function call(method, path, { token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, json: text && (res.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(text) : null }
}

/** POSTs a chat turn and reads the whole SSE stream. */
async function chat(token, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('text/event-stream')) return { status: res.status, events: [], json: await res.json().catch(() => null) }
  const events = (await res.text())
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1] ?? 'message',
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null'),
    }))
  return { status: res.status, events }
}

const text = (events) => events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('')

function check(condition, label, detail) {
  if (!condition) {
    console.error(`FAIL ${label}`, detail ?? '')
    process.exit(1)
  }
  console.log(`ok   ${label}`)
}

const suffix = Date.now().toString(36)
const root = await call('POST', '/auth/login', { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })
check(root.status === 200, 'super-admin login', root.json)
const rootToken = root.json.accessToken

async function makeTenant(slug) {
  const t = await call('POST', '/admin/tenants', { token: rootToken, body: { name: `Agent ${slug}`, slug: `${slug}-${suffix}` } })
  check(t.status === 201, `create tenant ${slug}`, t.json)
  const email = `${slug}-${suffix}@smoke.test`
  const admin = await call('POST', `/admin/tenants/${t.json.id}/admins`, { token: rootToken, body: { email, password: 'smoke-password-1' } })
  check(admin.status === 201, `create admin for ${slug}`, admin.json)
  const login = await call('POST', '/auth/login', { body: { email, password: 'smoke-password-1' } })
  check(login.status === 200, `tenant admin ${slug} login`, login.json)
  return login.json.accessToken
}

const a = await makeTenant('agent-a')
const b = await makeTenant('agent-b')

// A document for the agent to cite.
const doc = await call('POST', '/kb/documents/text', {
  token: a,
  body: { title: 'Return policy', text: `Refunds are accepted within 30 days of delivery. Reference ${suffix}.` },
})
check(doc.status === 202, 'paste a KB document', doc.json)
for (let i = 0; i < 60; i++) {
  const d = await call('GET', `/kb/documents/${doc.json.id}`, { token: a })
  if (d.json?.status !== 'processing') {
    check(d.json?.status === 'ready', 'document becomes ready', d.json)
    break
  }
  await new Promise((r) => setTimeout(r, 500))
}

// Agent config: defaults, draft, publish.
const initial = await call('GET', '/agent/config', { token: a })
check(initial.status === 200 && initial.json.published === null, 'agent config starts unpublished', initial.json)
const draft = { ...initial.json.draft, prompt: 'You answer for a phone shop. Keep it short.', tone: 'concise' }
const saved = await call('PUT', '/agent/config/draft', { token: a, body: draft })
check(saved.status === 200 && saved.json.draft.tone === 'concise', 'save the draft', saved.json)
const published = await call('POST', '/agent/config/publish', { token: a })
check(published.status === 200 && published.json.published?.tone === 'concise', 'publish the draft', published.json)
const badDraft = await call('PUT', '/agent/config/draft', { token: a, body: { ...draft, accentColor: 'mint' } })
check(badDraft.status === 400, 'an invalid draft is refused (400)', badDraft.json)

// Playground: a streamed answer that cites the document. The question shares words with the document because the
// offline fake embeddings only match on shared words.
const QUESTION = 'Are refunds accepted after delivery?'
const first = await chat(a, '/chat/playground', { message: QUESTION, config: draft })
check(first.status === 200 && first.events[0]?.event === 'meta', 'playground streams, meta first', first)
check(first.events.at(-1)?.event === 'done', 'the turn ends with done', first.events.at(-1))
check(text(first.events).trim().length > 0, 'the reply has text', first.events)
const tool = first.events.find((e) => e.event === 'tool')
if (FAKE_LLM || tool) {
  check(tool?.data.sources.some((s) => s.documentId === doc.json.id), 'search_kb cites the uploaded document', tool)
} else {
  console.log('note the model answered without calling search_kb (allowed for a real model)')
}
const conversationId = first.events[0].data.conversationId

const second = await chat(a, '/chat/playground', { message: 'And for opened items?', config: draft, conversationId })
check(second.events.at(-1)?.event === 'done' && second.events[0].data.conversationId === conversationId, 'the test chat continues')

// Transcripts.
const list = await call('GET', '/chat/conversations?kind=playground', { token: a })
const listed = list.json?.conversations.find((c) => c.id === conversationId)
check(listed?.messageCount === 4 && listed.preview === QUESTION, 'the playground chat is listed with 4 messages', list.json)
const realList = await call('GET', '/chat/conversations', { token: a })
check(realList.json?.conversations.every((c) => c.id !== conversationId), 'it is not listed with customer conversations')
const detail = await call('GET', `/chat/conversations/${conversationId}`, { token: a })
check(detail.status === 200 && detail.json.messages.length === 4, 'the transcript has both turns', detail.json)
if (FAKE_LLM) check(detail.json.messages[1].tools[0]?.results.length > 0, 'the transcript keeps the search results', detail.json.messages[1])

// Isolation and roles.
check((await call('GET', `/chat/conversations/${conversationId}`, { token: b })).status === 404, "tenant B cannot read A's transcript (404)")
check(
  (await call('GET', '/chat/conversations?kind=playground', { token: b })).json.conversations.length === 0,
  "tenant B's list is empty",
)
const stolen = await chat(b, '/chat/playground', { message: 'Hi', config: draft, conversationId })
check(stolen.status === 404, "tenant B cannot continue A's test chat (404)", stolen.json)
const asCustomer = await chat(a, '/chat/messages', { message: 'Hi' })
check(asCustomer.status === 403, 'admins cannot use the customer chat route (403)', asCustomer.json)
check((await call('GET', '/agent/config', { token: rootToken })).status === 403, 'the super-admin has no agent config (403)')

console.log('\nstep 3 smoke test passed')
