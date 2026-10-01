import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSession, loadHistory, loadSession, saveHistory, saveSession } from '../src/storage'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('widget storage', () => {
  it('round-trips the session per widget key', () => {
    saveSession('wk_a', { conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession('wk_a')).toEqual({ conversationId: 'c1', sessionToken: 's1' })
    expect(loadSession('wk_b')).toBeNull()
    expect(localStorage.getItem('helpix:wk_a')).toBe('{"conversationId":"c1","sessionToken":"s1"}')
    clearSession('wk_a')
    expect(loadSession('wk_a')).toBeNull()
  })

  it('ignores corrupt or wrongly shaped values', () => {
    localStorage.setItem('helpix:wk_a', 'not json')
    expect(loadSession('wk_a')).toBeNull()
    localStorage.setItem('helpix:wk_a', '{"conversationId":42}')
    expect(loadSession('wk_a')).toBeNull()
    sessionStorage.setItem('helpix:wk_a', '{"nope":true}')
    expect(loadHistory('wk_a')).toEqual([])
  })

  it('keeps finished messages in sessionStorage', () => {
    const msgs = [{ role: 'user' as const, content: 'hi', tools: [] }, { role: 'assistant' as const, content: 'hello', tools: [] }]
    saveHistory('wk_a', msgs)
    expect(loadHistory('wk_a')).toEqual(msgs)
  })

  it('works when storage throws (blocked cookies, private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(() => saveSession('wk_a', { conversationId: 'c1', sessionToken: null })).not.toThrow()
    expect(loadSession('wk_a')).toBeNull()
    expect(() => clearSession('wk_a')).not.toThrow()
    expect(loadHistory('wk_a')).toEqual([])
  })
})
