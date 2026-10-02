import type { ToolDefinition } from '@helpix/llm'
import type { ToolActivity } from '@helpix/shared/api-types'
import { KbUnavailableError, type KbClient } from '../clients/kb'

export interface ToolOutcome {
  /** What the model sees as the tool result. */
  content: string
  /** What the transcript stores and the stream reports. */
  activity: ToolActivity
}

export interface AgentTool {
  definition: ToolDefinition
  run(rawArguments: string): Promise<ToolOutcome>
}

export const SEARCH_KB_TOOL: ToolDefinition = {
  name: 'search_kb',
  description: "Search the shop's knowledge base (policies, FAQs, product notes). Returns the most relevant passages with their titles.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look up, in a few words.' } },
    required: ['query'],
    additionalProperties: false,
  },
}

const MAX_QUERY_CHARS = 500
const NOTHING_FOUND = "Nothing relevant is in the shop's knowledge base. Say you don't know and suggest contacting the shop directly."
const KB_DOWN = "The knowledge base is unavailable right now. Tell the customer you could not check the shop's documents."

/** The model's raw tool arguments as an object, or null when they are not a JSON object. */
export function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw)
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** search_kb for one turn. The tenant is fixed here from the gateway header; the model only supplies the query. */
export function createSearchKbTool(kb: KbClient, tenantId: string, requestId: string): AgentTool {
  return {
    definition: SEARCH_KB_TOOL,
    async run(raw) {
      const args = parseArguments(raw)
      const activity = (over: Partial<ToolActivity>): ToolActivity => ({
        name: SEARCH_KB_TOOL.name,
        arguments: args,
        status: 'ok',
        results: [],
        error: null,
        ...over,
      })
      const query = typeof args?.query === 'string' ? args.query.trim().slice(0, MAX_QUERY_CHARS) : ''
      if (!query) {
        return {
          content: JSON.stringify({ error: 'Invalid arguments: "query" must be a non-empty string.' }),
          activity: activity({ status: 'error', error: 'invalid_arguments' }),
        }
      }
      let results
      try {
        results = await kb.search(tenantId, query, requestId)
      } catch (e) {
        if (!(e instanceof KbUnavailableError)) throw e
        return { content: JSON.stringify({ error: KB_DOWN }), activity: activity({ status: 'error', error: 'knowledge_base_unavailable' }) }
      }
      if (results.length === 0) {
        return { content: JSON.stringify({ results: [], note: NOTHING_FOUND }), activity: activity({ status: 'empty' }) }
      }
      return {
        content: JSON.stringify({ results: results.map((r) => ({ title: r.title, text: r.text })) }),
        activity: activity({ results }),
      }
    },
  }
}
