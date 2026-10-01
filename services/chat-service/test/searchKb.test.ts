import { describe, expect, it } from 'vitest'
import { createSearchKbTool, SEARCH_KB_TOOL } from '../src/agent/searchKb'
import { fakeKb, TENANT_A, TENANT_B } from './helpers'

const hit = { documentId: 'd1', title: 'Returns', position: 0, text: 'Refunds within 30 days.', score: 0.8 }

describe('search_kb', () => {
  it('describes a single required query argument', () => {
    expect(SEARCH_KB_TOOL.name).toBe('search_kb')
    expect(SEARCH_KB_TOOL.parameters).toMatchObject({ required: ['query'], properties: { query: { type: 'string' } } })
  })

  it("returns titled passages to the model and the full hits to the transcript", async () => {
    const kb = fakeKb({ [TENANT_A]: [hit] })
    const out = await createSearchKbTool(kb, TENANT_A, 'req').run('{"query":"  refunds  "}')
    expect(JSON.parse(out.content)).toEqual({ results: [{ title: 'Returns', text: 'Refunds within 30 days.' }] })
    expect(out.activity).toEqual({ name: 'search_kb', arguments: { query: '  refunds  ' }, status: 'ok', results: [hit], error: null })
    expect(kb.calls).toEqual([{ tenantId: TENANT_A, query: 'refunds' }])
  })

  it("searches the requester's tenant even when the model passes another tenant id", async () => {
    const kb = fakeKb({ [TENANT_B]: [hit] })
    const out = await createSearchKbTool(kb, TENANT_A, 'req').run(JSON.stringify({ query: 'refunds', tenantId: TENANT_B }))
    expect(kb.calls).toEqual([{ tenantId: TENANT_A, query: 'refunds' }])
    expect(out.activity.status).toBe('empty')
  })

  it("tells the model to say it doesn't know when nothing matches", async () => {
    const out = await createSearchKbTool(fakeKb(), TENANT_A, 'req').run('{"query":"warranty"}')
    const content = JSON.parse(out.content)
    expect(content.results).toEqual([])
    expect(content.note).toContain("Say you don't know")
    expect(out.activity).toMatchObject({ status: 'empty', results: [], error: null })
  })

  it('reports an unavailable knowledge base instead of failing the turn', async () => {
    const out = await createSearchKbTool(fakeKb({}, { down: true }), TENANT_A, 'req').run('{"query":"warranty"}')
    expect(JSON.parse(out.content)).toEqual({ error: expect.stringContaining('unavailable') })
    expect(out.activity).toMatchObject({ status: 'error', results: [], error: 'knowledge_base_unavailable' })
  })

  it.each([['not json'], ['[]'], ['{}'], ['{"query":"   "}'], ['{"query":42}']])('refuses arguments %s without searching', async (raw) => {
    const kb = fakeKb()
    const out = await createSearchKbTool(kb, TENANT_A, 'req').run(raw)
    expect(kb.calls).toEqual([])
    expect(out.activity).toMatchObject({ status: 'error', error: 'invalid_arguments' })
    expect(JSON.parse(out.content).error).toContain('query')
  })

  it('caps a very long query at 500 characters', async () => {
    const kb = fakeKb()
    await createSearchKbTool(kb, TENANT_A, 'req').run(JSON.stringify({ query: 'x'.repeat(900) }))
    expect(kb.calls[0]!.query).toHaveLength(500)
  })
})
