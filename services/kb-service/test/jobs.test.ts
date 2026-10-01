import { describe, expect, it, vi } from 'vitest'
import { createJobRunner } from '../src/jobs'

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('createJobRunner', () => {
  it('never runs more than `concurrency` jobs at once and runs them all', async () => {
    const jobs = createJobRunner({ concurrency: 2, onError: vi.fn() })
    let active = 0
    let peak = 0
    let done = 0
    for (let i = 0; i < 6; i++) {
      jobs.run(async () => {
        active++
        peak = Math.max(peak, active)
        await tick()
        active--
        done++
      })
    }
    await jobs.idle()
    expect(done).toBe(6)
    expect(peak).toBe(2)
  })

  it('reports a failing job and keeps going', async () => {
    const onError = vi.fn()
    const jobs = createJobRunner({ concurrency: 1, onError })
    const ran: number[] = []
    jobs.run(async () => { throw new Error('boom') })
    jobs.run(async () => { ran.push(2) })
    await jobs.idle()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
    expect(ran).toEqual([2])
  })

  it('is idle immediately when nothing was queued', async () => {
    await expect(createJobRunner({ concurrency: 1, onError: vi.fn() }).idle()).resolves.toBeUndefined()
  })
})
