import type { Directive } from 'vue'
import { animate } from 'motion-v'

/*
 * Springs, in Apple's terms: Motion's `bounce` is roughly 1 − damping ratio and `visualDuration` is the response.
 * Everything a person can grab or redirect uses a spring, because a spring starts from the value on screen and
 * keeps its velocity when the target changes. Fixed-duration curves stay for fades and one-off entrances.
 */

/** Default for UI state: critically damped (damping 1.0), response 0.3 s. No overshoot. */
export const SPRING = { type: 'spring', bounce: 0, visualDuration: 0.3 } as const
/** Repositioning a selection (nav pill, segmented thumb): damping 1.0, response 0.4 s. */
export const SPRING_MOVE = { type: 'spring', bounce: 0, visualDuration: 0.4 } as const
/** Drawer / sheet after a flick: damping 0.8, response 0.3 s. Only use when the gesture carried momentum. */
export const SPRING_FLICK = { type: 'spring', bounce: 0.2, visualDuration: 0.3 } as const

/** The --ease-out token from globals.css, for Motion's fixed-duration animations. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Staggered entrance. Only items that mount shortly after a page opens animate, so polling, filtering,
// tab switches and "load more" render without motion.
const ENTRANCE_WINDOW_MS = 1200
const STAGGER_MS = 35
const STAGGER_MAX = 8
let pageStartedAt = Number.NEGATIVE_INFINITY

/** Call when a page opens (the app layout does this on every route change). */
export function markPageStart() {
  pageStartedAt = performance.now()
}

/**
 * `v-enter="index"`: fade in from 4 px below over 200 ms, staggered 35 ms per item for the first 8.
 * Reduced motion: an opacity fade of 150 ms, no offset and no stagger.
 */
export const vEnter: Directive<HTMLElement, number | undefined> = {
  mounted(el, { value }) {
    if (performance.now() - pageStartedAt > ENTRANCE_WINDOW_MS) return
    const reduced = prefersReducedMotion()
    const index = Math.min(value ?? 0, STAGGER_MAX)
    el.style.opacity = '0'
    animate(el, reduced ? { opacity: [0, 1] } : { opacity: [0, 1], y: [4, 0] }, {
      duration: reduced ? 0.15 : 0.2,
      ease: EASE_OUT,
      delay: reduced ? 0 : (index * STAGGER_MS) / 1000,
    })
  },
}

/** A short horizontal shake, macOS-style, for a rejected submission. Skipped under reduced motion. */
export function shake(el: Element | null | undefined) {
  if (!el || prefersReducedMotion()) return
  animate(el, { x: [0, -8, 7, -5, 3, 0] }, { duration: 0.4, ease: 'easeOut' })
}
