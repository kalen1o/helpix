import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig, AgentConfigState, ChatModelsResponse } from '@helpix/shared/api-types'
import { ApiError } from '../src/api/client'
import { api } from '../src/auth/session'
import AgentPage from '../src/pages/AgentPage.vue'

vi.mock('@/auth/session', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), stream: vi.fn() },
  session: { state: { me: { tenant: { name: 'iPhone Store' } } } },
}))

const CONFIG: AgentConfig = {
  prompt: 'We sell refurbished iPhones.',
  tone: 'friendly',
  toneNotes: '',
  greeting: 'Hi! How can I help?',
  accentColor: '#0C9A82',
  modelOverride: null,
}
const stateOf = (draft: AgentConfig, published: AgentConfig | null = null): AgentConfigState => ({
  draft,
  published,
  draftUpdatedAt: '2026-10-01T08:00:00Z',
  publishedAt: published ? '2026-10-01T08:00:00Z' : null,
})

function backend(state: AgentConfigState, models: ChatModelsResponse = { defaultModel: 'glm-4.5-air', overrides: [] }) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/agent/config') return state
    if (path === '/chat/models') return models
    throw new Error(`unexpected GET ${path}`)
  })
}

const button = (w: VueWrapper, label: string) => w.findAll('button').find((b) => b.text() === label)!

beforeEach(() => {
  for (const fn of Object.values(api)) vi.mocked(fn as (...a: unknown[]) => unknown).mockReset()
})

describe('AgentPage', () => {
  it('loads the draft into the form and shows that it is live', async () => {
    backend(stateOf(CONFIG, CONFIG))
    const w = mount(AgentPage)
    await flushPromises()
    expect((w.find('#agent-prompt').element as HTMLTextAreaElement).value).toBe(CONFIG.prompt)
    expect(w.text()).toContain('Live')
    expect(button(w, 'Save draft').attributes('disabled')).toBeDefined()
    expect(button(w, 'Publish').attributes('disabled')).toBeDefined()
  })

  it('marks edits as unsaved and saves the draft', async () => {
    backend(stateOf(CONFIG))
    const edited = { ...CONFIG, prompt: 'New rules' }
    vi.mocked(api.put).mockResolvedValue(stateOf(edited))
    const w = mount(AgentPage)
    await flushPromises()
    await w.find('#agent-prompt').setValue('New rules')
    expect(w.text()).toContain('Unsaved changes')
    await button(w, 'Save draft').trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/agent/config/draft', edited)
    expect(w.text()).toContain('Draft not published')
    expect(w.text()).toContain('Draft saved')
  })

  it('publishes unsaved edits by saving them first', async () => {
    backend(stateOf(CONFIG, CONFIG))
    const edited = { ...CONFIG, tone: 'concise' as const }
    vi.mocked(api.put).mockResolvedValue(stateOf(edited, CONFIG))
    vi.mocked(api.post).mockResolvedValue(stateOf(edited, edited))
    const w = mount(AgentPage)
    await flushPromises()
    await w.find('input[type="radio"][value="concise"]').setValue(true)
    await button(w, 'Publish').trigger('click')
    await flushPromises()
    expect(api.put).toHaveBeenCalledWith('/agent/config/draft', edited)
    expect(api.post).toHaveBeenCalledWith('/agent/config/publish')
    expect(vi.mocked(api.put).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(api.post).mock.invocationCallOrder[0]!)
    expect(w.text()).toContain('Live')
  })

  it('blocks saving and publishing an invalid config and says why', async () => {
    backend(stateOf(CONFIG))
    const w = mount(AgentPage)
    await flushPromises()
    await w.find('#agent-greeting').setValue('  ')
    expect(w.text()).toContain('Add a greeting for the chat widget.')
    expect(button(w, 'Save draft').attributes('disabled')).toBeDefined()
    expect(button(w, 'Publish').attributes('disabled')).toBeDefined()
  })

  it('shows the model picker only when the platform allows overrides', async () => {
    backend(stateOf(CONFIG))
    const plain = mount(AgentPage)
    await flushPromises()
    expect(plain.find('#agent-model').exists()).toBe(false)

    backend(stateOf(CONFIG), { defaultModel: 'glm-4.5-air', overrides: ['glm-4.6'] })
    const w = mount(AgentPage)
    await flushPromises()
    expect(w.find('#agent-model').text()).toContain('Platform default (glm-4.5-air)')
    await w.find('#agent-model').setValue('glm-4.6')
    expect(w.text()).toContain('Unsaved changes')
  })

  it('shows why a save failed', async () => {
    backend(stateOf(CONFIG))
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, 'validation_error', 'body/greeting must match pattern "\\S"'))
    const w = mount(AgentPage)
    await flushPromises()
    await w.find('#agent-prompt').setValue('x')
    await button(w, 'Save draft').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('body/greeting must match pattern')
  })
})
