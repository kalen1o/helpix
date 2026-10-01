import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import SegmentedControl from '../src/components/SegmentedControl.vue'
import StatPanel from '../src/components/StatPanel.vue'
import { project, rubberband, shouldDismiss } from '../src/lib/sheet'

describe('sheet gesture math', () => {
  it('projects a release forward with exponential deceleration', () => {
    expect(project(0)).toBe(0)
    // 1000 px/s at a 0.99 rate comes to rest about 99 px further on.
    expect(project(1000)).toBeCloseTo(99, 0)
    expect(project(-1000)).toBeCloseTo(-99, 0)
  })

  it('rubber-bands: follows less the further past the edge, never past the dimension', () => {
    const small = rubberband(20, 400)
    const large = rubberband(400, 400)
    expect(small).toBeLessThan(20)
    expect(large / 400).toBeLessThan(small / 20)
    expect(rubberband(10_000, 400)).toBeLessThan(400)
  })

  it('dismisses when the projected rest point passes halfway, and never on an upward flick', () => {
    expect(shouldDismiss(250, 0, 400)).toBe(true)
    expect(shouldDismiss(100, 0, 400)).toBe(false)
    // A short drag with a quick throw still closes.
    expect(shouldDismiss(60, 1600, 400)).toBe(true)
    // Far down, but flicked back up: keep it.
    expect(shouldDismiss(350, -200, 400)).toBe(false)
  })
})

describe('StatPanel', () => {
  it('shows the label, the value and the caption; only the headline metric is Mint', () => {
    const w = mount(StatPanel, { props: { label: 'Documents', value: 12, caption: '3.4 MB in total', emphasis: true } })
    expect(w.text()).toContain('Documents')
    expect(w.text()).toContain('12')
    expect(w.text()).toContain('3.4 MB in total')
    expect(w.find('.text-brand').text()).toBe('12')
  })

  it('lifts on hover only when it is interactive', () => {
    expect(mount(StatPanel, { props: { label: 'A', value: 1 } }).classes().join(' ')).not.toContain('hover:-translate-y-0.5')
    expect(mount(StatPanel, { props: { label: 'A', value: 1, as: 'button' } }).classes().join(' ')).toContain('hover:-translate-y-0.5')
  })
})

describe('SegmentedControl', () => {
  it('marks the selected option and updates the model on click', async () => {
    const Harness = defineComponent({
      components: { SegmentedControl },
      setup: () => ({
        value: ref<'a' | 'b'>('a'),
        options: [
          { value: 'a', label: 'Customers' },
          { value: 'b', label: 'Playground' },
        ],
      }),
      template: `<SegmentedControl v-model="value" :options="options" label="Kind" />`,
    })
    const w = mount(Harness)
    const [a, b] = w.findAll('button')
    expect(a!.attributes('aria-pressed')).toBe('true')
    expect(b!.attributes('aria-pressed')).toBe('false')
    await b!.trigger('click')
    expect((w.vm as unknown as { value: string }).value).toBe('b')
    expect(b!.attributes('aria-pressed')).toBe('true')
  })
})
