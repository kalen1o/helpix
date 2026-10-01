import type { AgentConfig, TonePreset } from '@helpix/shared/api-types'
import { ACCENT_COLOR_PATTERN, AGENT_PROMPT_MAX, GREETING_MAX, TONE_NOTES_MAX } from '@helpix/shared/agent-config'

export { AGENT_PROMPT_MAX, GREETING_MAX, sameAgentConfig, TONE_NOTES_MAX } from '@helpix/shared/agent-config'

export const TONE_OPTIONS: { value: TonePreset; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Friendly', hint: 'Warm and conversational.' },
  { value: 'professional', label: 'Professional', hint: 'Courteous and precise, no slang.' },
  { value: 'playful', label: 'Playful', hint: 'Upbeat, light humour, the odd emoji.' },
  { value: 'concise', label: 'Concise', hint: 'As few words as possible.' },
]

const COLOR = new RegExp(ACCENT_COLOR_PATTERN)

/** The first thing the server would reject in this config, as a message for the admin; null when it is valid. */
export function configProblem(c: AgentConfig): string | null {
  if (c.prompt.length > AGENT_PROMPT_MAX) return `The instructions are limited to ${AGENT_PROMPT_MAX.toLocaleString('en-US')} characters.`
  if (c.toneNotes.length > TONE_NOTES_MAX) return `Tone notes are limited to ${TONE_NOTES_MAX} characters.`
  if (!c.greeting.trim()) return 'Add a greeting for the chat widget.'
  if (c.greeting.length > GREETING_MAX) return `The greeting is limited to ${GREETING_MAX} characters.`
  if (!COLOR.test(c.accentColor)) return 'Use a hex colour like #0C9A82.'
  return null
}
