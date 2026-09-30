import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { Badge, Button, Card, cn, Dialog, DialogContent, HelpixLogo, Input } from '../src/index'

// jsdom does not implement modal dialogs; emulate the parts we rely on.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

describe('cn', () => {
  it('merges conflicting Tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})

describe('Button', () => {
  it('defaults to type=button so it never submits a form by accident', () => {
    expect(mount(Button, { slots: { default: 'Go' } }).attributes('type')).toBe('button')
  })

  it('applies variant and size classes and lets a class prop override', () => {
    const w = mount(Button, { props: { variant: 'destructive', size: 'sm', class: 'px-8' }, slots: { default: 'Delete' } })
    expect(w.text()).toBe('Delete')
    expect(w.classes()).toContain('bg-destructive')
    expect(w.classes()).toContain('px-8')
    expect(w.classes()).not.toContain('px-3')
  })

  it('passes through disabled and form attributes', () => {
    const w = mount(Button, { attrs: { disabled: true, form: 'f1' }, props: { type: 'submit' } })
    expect(w.attributes('disabled')).toBeDefined()
    expect(w.attributes('form')).toBe('f1')
    expect(w.attributes('type')).toBe('submit')
  })
})

describe('Input', () => {
  it('supports v-model', async () => {
    const w = mount(Input, { props: { modelValue: 'a', 'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }) } })
    await w.find('input').setValue('hello')
    expect(w.props('modelValue')).toBe('hello')
  })
})

describe('Badge and slot primitives', () => {
  it('Badge applies its variant', () => {
    expect(mount(Badge, { props: { variant: 'secondary' } }).classes()).toContain('bg-secondary')
  })

  it('Card renders its slot and merges class and attributes', () => {
    const w = mount(Card, { props: { class: 'p-8' }, attrs: { 'data-x': '1' }, slots: { default: 'Body' } })
    expect(w.text()).toBe('Body')
    expect(w.classes()).toContain('p-8')
    expect(w.attributes('data-x')).toBe('1')
  })
})

describe('HelpixLogo', () => {
  it('renders the outlined lockup (no live text) with an accessible name and themed colours', () => {
    const w = mount(HelpixLogo)
    expect(w.element.tagName.toLowerCase()).toBe('svg')
    expect(w.attributes('aria-label')).toBe('helpix')
    expect(w.attributes('viewBox')).toBe('0.00 -74.00 306.99 88.60')
    expect(w.text()).toBe('')
    expect(w.find('g.text-brand rect').exists()).toBe(true)
    expect(w.find('path.fill-foreground').exists()).toBe(true)
    expect(w.html()).not.toContain('#0C9A82')
  })

  it('renders only the square mark with markOnly', () => {
    const w = mount(HelpixLogo, { props: { markOnly: true } })
    expect(w.attributes('viewBox')).toBe('0 0 100 100')
    expect(w.find('path').attributes('d')).toBe('M31 21 V79 M31 58 C31 46.5 39 39.5 48.5 39.5 C58 39.5 66 46.5 66 58 V79')
    expect(w.find('path.fill-foreground').exists()).toBe(false)
  })
})

describe('Dialog', () => {
  const Harness = defineComponent({
    components: { Dialog, DialogContent },
    setup() {
      return { open: ref(false) }
    },
    template: `<Dialog v-model:open="open"><DialogContent><p class="inside">Hi</p></DialogContent></Dialog>`,
  })

  it('renders content only while open and opens as a modal', async () => {
    const w = mount(Harness, { attachTo: document.body })
    expect(w.find('.inside').exists()).toBe(false)
    ;(w.vm as unknown as { open: boolean }).open = true
    await nextTick()
    await nextTick()
    expect(w.find('dialog').attributes('open')).toBeDefined()
    expect(w.find('.inside').exists()).toBe(true)
    w.unmount()
  })

  it('sets open to false when the dialog closes (Escape) or the backdrop is clicked', async () => {
    const w = mount(Harness, { attachTo: document.body })
    const vm = w.vm as unknown as { open: boolean }
    vm.open = true
    await nextTick()
    w.find('dialog').element.dispatchEvent(new Event('close'))
    await nextTick()
    expect(vm.open).toBe(false)

    vm.open = true
    await nextTick()
    await w.find('dialog').trigger('click')
    expect(vm.open).toBe(false)
    w.unmount()
  })

  it('does not close when clicking inside the content', async () => {
    const w = mount(Harness, { attachTo: document.body })
    const vm = w.vm as unknown as { open: boolean }
    vm.open = true
    await nextTick()
    await nextTick()
    await w.find('.inside').trigger('click')
    expect(vm.open).toBe(true)
    w.unmount()
  })
})
