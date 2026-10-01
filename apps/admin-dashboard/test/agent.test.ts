import { describe, expect, it } from 'vitest'
import type { AgentConfig } from '@helpix/shared/api-types'
import { configProblem, TONE_OPTIONS } from '../src/lib/agent'

const OK: AgentConfig = { prompt: '', tone: 'friendly', toneNotes: '', greeting: 'Hi!', accentColor: '#0C9A82', modelOverride: null }

describe('configProblem', () => {
  it('accepts a valid config', () => {
    expect(configProblem(OK)).toBeNull()
  })

  it.each([
    [{ prompt: 'x'.repeat(8001) }, 'The instructions are limited to 8,000 characters.'],
    [{ toneNotes: 'x'.repeat(501) }, 'Tone notes are limited to 500 characters.'],
    [{ greeting: '   ' }, 'Add a greeting for the chat widget.'],
    [{ greeting: 'x'.repeat(301) }, 'The greeting is limited to 300 characters.'],
    [{ accentColor: 'mint' }, 'Use a hex colour like #0C9A82.'],
  ])('reports %j', (patch, message) => {
    expect(configProblem({ ...OK, ...patch })).toBe(message)
  })
})

it('offers every tone preset', () => {
  expect(TONE_OPTIONS.map((t) => t.value)).toEqual(['friendly', 'professional', 'playful', 'concise'])
})
