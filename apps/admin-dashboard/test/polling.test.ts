import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { usePolling } from '../src/lib/polling'

function host(tick: () => Promise<void>, active: Ref<boolean>, intervalMs = 1000) {
  return mount(defineComponent({ setup() { usePolling(tick, intervalMs, active); return () => null } }))
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('usePolling', () => {
  it('ticks while active, pauses when inactive and stops on unmount', async () => {
    const tick = vi.fn(async () => {})
    const active = ref(true)
    const w = host(tick, active)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(3)
    active.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(3)
    active.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    expect(tick).toHaveBeenCalledTimes(4)
    w.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(tick).toHaveBeenCalledTimes(4)
  })

  it('never overlaps a slow tick and survives a failing one', async () => {
    let calls = 0
    const tick = vi.fn(async () => {
      calls++
      if (calls === 1) await new Promise((r) => setTimeout(r, 5000))
      if (calls === 2) throw new Error('network')
    })
    host(tick, ref(true))
    await vi.advanceTimersByTimeAsync(1000) // first tick starts, runs 5 s
    await vi.advanceTimersByTimeAsync(4500)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1500) // finished at 6 s, next at 7 s (fails)
    expect(tick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000) // keeps polling after a failure
    expect(tick).toHaveBeenCalledTimes(3)
  })
})
