import { EmbeddingError } from '@helpix/llm'
import type { FastifyPluginAsync } from 'fastify'
import { AppError } from '@helpix/shared'
import type { KbSearchResponse } from '@helpix/shared/api-types'
import type { KbDeps } from '../deps'
import { scopedTenant } from '../lib/context'
import { search } from '../search'

const searchBody = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  },
} as const

export const searchRoutes: FastifyPluginAsync<KbDeps> = async (app, deps) => {
  app.post<{ Body: { query: string; limit?: number } }>(
    '/kb/search',
    { schema: { body: searchBody } },
    async (req): Promise<KbSearchResponse> => {
      const tenantId = scopedTenant(req)
      try {
        return { results: await search(deps, tenantId, req.body.query, req.body.limit ?? deps.config.searchTopK) }
      } catch (e) {
        if (e instanceof EmbeddingError) throw new AppError(503, 'embedding_unavailable', 'The embedding service is unavailable')
        throw e
      }
    },
  )
}
