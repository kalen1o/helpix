import { onBeforeUnmount, type Ref } from 'vue'
import { animate, motionValue } from 'motion-v'
import { SPRING, SPRING_FLICK } from '../motion'

/*
 * Swipe-to-dismiss for dialogs shown as bottom sheets on narrow screens.
 * The sheet tracks the finger 1:1 from where it was grabbed, resists when pulled up (rubber-band),
 * projects the release velocity forward to decide between closing and snapping back, and hands that
 * velocity to the spring so there is no seam between dragging and animating. A sheet that is still
 * moving can be grabbed again: the drag continues from its on-screen position.
 */

/** Movement before a press becomes a drag, so taps and horizontal scrolls are not hijacked. */
const DRAG_THRESHOLD_PX = 10
/** Only the last stretch of movement counts toward release velocity. */
const VELOCITY_WINDOW_MS = 100
/** About one display frame: a shorter gap between samples is coalesced input and would inflate velocity. */
const MIN_SAMPLE_SPAN_MS = 16

/** Apple's rubber-band: the further past the edge, the less the sheet follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/** Where a release at `velocity` (px/s) would come to rest. 0.99 is a snappy deceleration rate. */
export function project(velocity: number, decelerationRate = 0.99): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

/** Should a release at `offset` px with `velocity` px/s dismiss a sheet `height` px tall? */
export function shouldDismiss(offset: number, velocity: number, height: number): boolean {
  // An upward flick always keeps the sheet, however far down it was released.
  if (velocity < 0) return false
  return offset + project(velocity) > height / 2
}

const INTERACTIVE = 'input, textarea, select, button, a[href], label, [contenteditable=""], [contenteditable="true"]'

interface Sample {
  y: number
  t: number
}

function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // The pointer is already gone (released between events); tracking still works without capture.
  }
}

export function useSheetDrag(target: Ref<HTMLElement | null>, opts: { enabled: () => boolean; onDismiss: () => void }) {
  const offset = motionValue(0)
  let controls: ReturnType<typeof animate> | null = null
  let press: { id: number; x: number; y: number; from: number } | null = null
  let dragging = false
  let lastPressDragged = false
  let samples: Sample[] = []

  const unsubscribe = offset.on('change', (value) => {
    const el = target.value
    if (!el) return
    // `translate` is separate from `transform`, so the drag never fights the CSS enter/exit transition.
    el.style.translate = value === 0 ? '' : `0 ${value}px`
    // Lets CSS lighten the backdrop as the sheet travels down.
    el.style.setProperty('--hx-sheet-progress', String(Math.max(0, Math.min(1, value / (el.offsetHeight || 1)))))
  })

  function settle(to: number, velocity: number, transition: typeof SPRING | typeof SPRING_FLICK) {
    const el = target.value
    el?.setAttribute('data-dragging', '')
    controls = animate(offset, to, { ...transition, velocity })
    void controls.then(() => {
      controls = null
      if (!press) el?.removeAttribute('data-dragging')
    })
  }

  function velocityOf(samples: Sample[]): number {
    const last = samples[samples.length - 1]
    const first = samples.find((s) => last!.t - s.t <= VELOCITY_WINDOW_MS) ?? last
    if (!first || !last || first === last) return 0
    return ((last.y - first.y) / Math.max(last.t - first.t, MIN_SAMPLE_SPAN_MS)) * 1000
  }

  function onPointerDown(e: PointerEvent) {
    const el = target.value
    if (!el || !opts.enabled() || e.button !== 0) return
    const fromTarget = e.target instanceof Element ? e.target : null
    if (fromTarget?.closest(INTERACTIVE)) return
    // Inside scrolled content, a downward swipe scrolls back up first; only the grab strip always drags.
    const scroller = fromTarget?.closest('[data-sheet-scroll]')
    if (scroller && scroller.scrollTop > 0 && !fromTarget?.closest('[data-sheet-grab]')) return

    // Catch a sheet in flight: stop the spring and continue from its presentation value.
    const moving = controls !== null
    lastPressDragged = false
    controls?.stop()
    controls = null
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, from: offset.get() }
    samples = [{ y: e.clientY, t: e.timeStamp }]
    dragging = moving
    if (moving) {
      capture(el, e.pointerId)
      el.setAttribute('data-dragging', '')
    }
  }

  function onPointerMove(e: PointerEvent) {
    const el = target.value
    if (!el || !press || e.pointerId !== press.id) return
    if (!dragging) {
      const dx = e.clientX - press.x
      const dy = e.clientY - press.y
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      // Mostly sideways: not ours (text selection, horizontal scroll).
      if (Math.abs(dx) > Math.abs(dy)) {
        press = null
        return
      }
      dragging = true
      capture(el, e.pointerId)
      el.setAttribute('data-dragging', '')
      // Rebase at the commit point, so crossing the threshold does not make the sheet jump.
      press = { ...press, y: e.clientY, from: offset.get() }
    }
    samples.push({ y: e.clientY, t: e.timeStamp })
    if (samples.length > 12) samples.shift()
    const raw = press.from + (e.clientY - press.y)
    offset.set(raw >= 0 ? raw : -rubberband(-raw, el.offsetHeight))
  }

  function onPointerUp(e: PointerEvent) {
    const el = target.value
    if (!el || !press || e.pointerId !== press.id) return
    const wasDragging = dragging
    press = null
    dragging = false
    lastPressDragged = wasDragging
    if (!wasDragging) return
    const velocity = e.type === 'pointercancel' ? 0 : velocityOf(samples)
    if (shouldDismiss(offset.get(), velocity, el.offsetHeight)) {
      // Leaving: no bounce, just carry the throw off the bottom edge while the dialog closes.
      settle(el.offsetHeight + 24, velocity, SPRING)
      opts.onDismiss()
    } else {
      // Snapping home overshoots a little only when the release had real momentum.
      settle(0, velocity, Math.abs(velocity) > 300 ? SPRING_FLICK : SPRING)
    }
  }

  /** Put the sheet back at rest instantly (call before it opens again). */
  function reset() {
    controls?.stop()
    controls = null
    press = null
    dragging = false
    offset.jump(0)
    target.value?.removeAttribute('data-dragging')
  }

  onBeforeUnmount(() => {
    controls?.stop()
    unsubscribe()
  })

  return {
    reset,
    /** True when the last press turned into a drag, so the click that follows it is not a backdrop tap. */
    didDrag: () => lastPressDragged,
    handlers: {
      onPointerdown: onPointerDown,
      onPointermove: onPointerMove,
      onPointerup: onPointerUp,
      onPointercancel: onPointerUp,
    },
  }
}
