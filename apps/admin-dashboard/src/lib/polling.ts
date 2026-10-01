import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Calls `tick` every `intervalMs` while `active` is true, never overlapping a slow tick. Stops on unmount. */
export function usePolling(tick: () => Promise<void>, intervalMs: number, active: Ref<boolean>): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  function schedule() {
    clearTimeout(timer)
    timer = undefined
    if (!stopped && active.value) timer = setTimeout(run, intervalMs)
  }

  async function run() {
    try {
      await tick()
    } catch {
      // The next tick tries again; the page shows its own load errors.
    } finally {
      schedule()
    }
  }

  watch(active, schedule, { immediate: true })
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })
}
