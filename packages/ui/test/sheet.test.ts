import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useSheetDrag } from '../src/lib/sheet'

const HEIGHT = 400

function harness(onDismiss: () => void) {
  return mount(
    defineComponent({
      setup() {
        const el = ref<HTMLElement | null>(null)
        const sheet = useSheetDrag(el, { enabled: () => true, onDismiss })
        return () => h('div', { ref: el, ...sheet.handlers }, [h('div', { 'data-sheet-grab': '', class: 'grab' }), h('button', { class: 'btn' }, 'OK')])
      },
    }),
    { attachTo: document.body },
  )
}

/** A pointer event with a chosen timestamp, so velocity is deterministic. */
function pointer(type: string, y: number, t: number) {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX: 100, clientY: y }) as MouseEvent & { pointerId: number }
  Object.defineProperty(e, 'pointerId', { value: 1 })
  Object.defineProperty(e, 'timeStamp', { value: t })
  return e
}

/** Drag from y=0 down to `distance`, in `steps` moves `stepMs` apart, then hold `holdMs` and release. */
function drag(target: Element, root: Element, distance: number, steps: number, stepMs: number, holdMs = 0) {
  let t = 1000
  target.dispatchEvent(pointer('pointerdown', 0, t))
  for (let i = 1; i <= steps; i++) {
    t += stepMs
    root.dispatchEvent(pointer('pointermove', (distance * i) / steps, t))
  }
  t += holdMs
  if (holdMs) root.dispatchEvent(pointer('pointermove', distance, t))
  root.dispatchEvent(pointer('pointerup', distance, t))
}

function setup() {
  const onDismiss = vi.fn()
  const w = harness(onDismiss)
  const root = w.element as HTMLElement
  Object.defineProperty(root, 'offsetHeight', { value: HEIGHT })
  root.setPointerCapture = () => {}
  return { w, root, onDismiss, grab: root.querySelector('.grab')! }
}

describe('useSheetDrag', () => {
  it('tracks the pointer 1:1 once past the threshold', () => {
    const { root, grab, w } = setup()
    grab.dispatchEvent(pointer('pointerdown', 0, 1000))
    root.dispatchEvent(pointer('pointermove', 5, 1016)) // under the 10px threshold: nothing moves
    expect(root.style.translate).toBe('')
    root.dispatchEvent(pointer('pointermove', 20, 1032)) // commits here and rebases
    root.dispatchEvent(pointer('pointermove', 80, 1048))
    expect(root.style.translate).toBe('0 60px')
    w.unmount()
  })

  it('snaps back after a slow, short drag that comes to rest', () => {
    const { root, grab, onDismiss, w } = setup()
    drag(grab, root, 120, 12, 30, 200)
    expect(onDismiss).not.toHaveBeenCalled()
    w.unmount()
  })

  it('dismisses a slow drag released past halfway', () => {
    const { root, grab, onDismiss, w } = setup()
    drag(grab, root, 260, 26, 30, 200)
    expect(onDismiss).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('dismisses a short, fast flick by projecting its momentum', () => {
    const { root, grab, onDismiss, w } = setup()
    drag(grab, root, 90, 3, 16)
    expect(onDismiss).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('resists when pulled up, and never starts from a control', () => {
    const { root, grab, onDismiss, w } = setup()
    grab.dispatchEvent(pointer('pointerdown', 200, 1000))
    root.dispatchEvent(pointer('pointermove', 180, 1016))
    root.dispatchEvent(pointer('pointermove', 100, 1032))
    const up = Number(root.style.translate.split(' ')[1]!.replace('px', ''))
    expect(up).toBeLessThan(0)
    expect(up).toBeGreaterThan(-80)
    root.dispatchEvent(pointer('pointerup', 100, 1032))

    root.querySelector('.btn')!.dispatchEvent(pointer('pointerdown', 0, 2000))
    root.dispatchEvent(pointer('pointermove', 300, 2016))
    root.dispatchEvent(pointer('pointerup', 300, 2016))
    expect(onDismiss).not.toHaveBeenCalled()
    w.unmount()
  })
})
