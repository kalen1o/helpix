/**
 * In-process background work (spec §4.1): uploads return immediately and processing happens here. It can be replaced
 * by a real queue without changing the API. Work in flight is lost on restart; the startup sweep marks it failed.
 */
export interface JobRunner {
  /** Queues `job`. A rejection goes to `onError`; it is never thrown to the caller. */
  run(job: () => Promise<void>): void
  /** Resolves once nothing is queued or running. Used by tests. */
  idle(): Promise<void>
}

export function createJobRunner(opts: { concurrency: number; onError: (err: unknown) => void }): JobRunner {
  const queue: (() => Promise<void>)[] = []
  let active = 0
  let waiters: (() => void)[] = []

  function settle() {
    if (active > 0 || queue.length > 0) return
    const resolve = waiters
    waiters = []
    for (const r of resolve) r()
  }

  function pump() {
    while (active < opts.concurrency && queue.length > 0) {
      const job = queue.shift()!
      active++
      void (async () => {
        try {
          await job()
        } catch (err) {
          opts.onError(err)
        } finally {
          active--
          pump()
          settle()
        }
      })()
    }
  }

  return {
    run(job) {
      queue.push(job)
      pump()
    },
    idle() {
      if (active === 0 && queue.length === 0) return Promise.resolve()
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}
