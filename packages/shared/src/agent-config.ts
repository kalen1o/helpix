// Pure TypeScript with no Node imports: the dashboard imports it through `@helpix/shared/agent-config`.
import type { AgentConfig, TonePreset } from './api-types'

export const TONE_PRESETS: readonly TonePreset[] = ['friendly', 'professional', 'playful', 'concise']
export const AGENT_PROMPT_MAX = 8000
export const TONE_NOTES_MAX = 500
export const GREETING_MAX = 300
export const ACCENT_COLOR_PATTERN = '^#[0-9a-fA-F]{6}$'
export const MODEL_NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'

export const DEFAULT_AGENT_CONFIG: Readonly<AgentConfig> = Object.freeze({
  prompt: '',
  tone: 'friendly',
  toneNotes: '',
  greeting: 'Hi! How can I help you today?',
  // Mint 600, the brand colour of the widget launcher.
  accentColor: '#0C9A82',
  modelOverride: null,
})

/** Request-body schema for a complete AgentConfig (Fastify/AJV). */
export const AGENT_CONFIG_SCHEMA = {
  type: 'object',
  required: ['prompt', 'tone', 'toneNotes', 'greeting', 'accentColor', 'modelOverride'],
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', maxLength: AGENT_PROMPT_MAX },
    tone: { type: 'string', enum: [...TONE_PRESETS] },
    toneNotes: { type: 'string', maxLength: TONE_NOTES_MAX },
    greeting: { type: 'string', minLength: 1, maxLength: GREETING_MAX, pattern: '\\S' },
    accentColor: { type: 'string', pattern: ACCENT_COLOR_PATTERN },
    modelOverride: { type: ['string', 'null'], pattern: MODEL_NAME_PATTERN },
  },
} as const

/** A complete config from one stored by an older version: missing or invalid fields take the defaults. */
export function withAgentDefaults(stored: Partial<AgentConfig> | null | undefined): AgentConfig {
  const d = DEFAULT_AGENT_CONFIG
  const s = stored ?? {}
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
  return {
    prompt: str(s.prompt, d.prompt),
    tone: TONE_PRESETS.includes(s.tone as TonePreset) ? (s.tone as TonePreset) : d.tone,
    toneNotes: str(s.toneNotes, d.toneNotes),
    greeting: str(s.greeting, d.greeting),
    accentColor: str(s.accentColor, d.accentColor),
    modelOverride: typeof s.modelOverride === 'string' ? s.modelOverride : null,
  }
}

export function sameAgentConfig(a: AgentConfig, b: AgentConfig): boolean {
  return (
    a.prompt === b.prompt &&
    a.tone === b.tone &&
    a.toneNotes === b.toneNotes &&
    a.greeting === b.greeting &&
    a.accentColor === b.accentColor &&
    a.modelOverride === b.modelOverride
  )
}
