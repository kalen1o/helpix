import { mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { Badge, Button, Card, cn, CopyButton, Dialog, DialogContent, EmptyState, HelpixLogo, Input } from '../src/index'

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

    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vm.open = true
    await nextTick()
    now.mockReturnValue(1300)
    await w.find('dialog').trigger('pointerdown')
    await w.find('dialog').trigger('click')
    expect(vm.open).toBe(false)
    now.mockRestore()
    w.unmount()
  })

  it('ignores a backdrop click right after opening (the second click of a double-click)', async () => {
    const w = mount(Harness, { attachTo: document.body })
    const vm = w.vm as unknown as { open: boolean }
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vm.open = true
    await nextTick()
    now.mockReturnValue(1100)
    await w.find('dialog').trigger('pointerdown')
    await w.find('dialog').trigger('click')
    expect(vm.open).toBe(true)
    now.mockRestore()
    w.unmount()
  })

  it('does not close when a press starts inside the content and ends on the backdrop (text selection)', async () => {
    const w = mount(Harness, { attachTo: document.body })
    const vm = w.vm as unknown as { open: boolean }
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vm.open = true
    await nextTick()
    await nextTick()
    now.mockReturnValue(2000)
    await w.find('.inside').trigger('pointerdown')
    await w.find('dialog').trigger('click')
    expect(vm.open).toBe(true)
    now.mockRestore()
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

describe('design polish', () => {
  afterEach(() => vi.useRealTimers())

  it('Button gives press feedback and only transitions specific properties', () => {
    const classes = mount(Button).classes()
    expect(classes).toContain('active:scale-[0.97]')
    expect(classes.some((c) => c === 'transition-all')).toBe(false)
  })

  it('Button destructive-outline is a quiet destructive style', () => {
    const classes = mount(Button, { props: { variant: 'destructive-outline' } }).classes()
    expect(classes).toContain('text-destructive')
    expect(classes).not.toContain('bg-destructive')
  })

  it('Badge renders a status dot and soft tints', () => {
    const w = mount(Badge, { props: { variant: 'negative', dot: true }, slots: { default: 'suspended' } })
    expect(w.classes()).toContain('bg-destructive/10')
    expect(w.find('span[aria-hidden="true"]').exists()).toBe(true)
    expect(w.text()).toBe('suspended')
  })

  it('EmptyState shows title, description and the action slot', () => {
    const w = mount(EmptyState, {
      props: { title: 'No tenants yet', description: 'Create one.' },
      slots: { default: '<button>Create</button>' },
    })
    expect(w.text()).toContain('No tenants yet')
    expect(w.text()).toContain('Create one.')
    expect(w.find('button').text()).toBe('Create')
  })

  it('CopyButton copies, confirms, and resets; reports failure without throwing', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mount(CopyButton, { props: { value: 'wk_123' } })

    await w.trigger('click')
    await Promise.resolve()
    await nextTick()
    expect(writeText).toHaveBeenCalledWith('wk_123')
    expect(w.text()).toBe('Copied')
    vi.advanceTimersByTime(1500)
    await nextTick()
    expect(w.text()).toBe('Copy')

    await w.trigger('click')
    await Promise.resolve()
    await nextTick()
    expect(w.text()).toBe('Copy failed')
  })

  it('DialogContent keeps its content during the exit transition, then unmounts it', async () => {
    const Harness = defineComponent({
      components: { Dialog, DialogContent },
      setup: () => ({ open: ref(true) }),
      template: `<Dialog v-model:open="open"><DialogContent><p class="inside">Hi</p></DialogContent></Dialog>`,
    })
    const w = mount(Harness, { attachTo: document.body })
    vi.useFakeTimers()
    ;(w.vm as unknown as { open: boolean }).open = false
    await nextTick()
    await nextTick()
    expect(w.find('.inside').exists()).toBe(true)
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(w.find('.inside').exists()).toBe(false)
    w.unmount()
  })
})

describe('DialogContent dialogClass', () => {
  it('merges dialogClass into the dialog element, overriding the default width', () => {
    const Harness = defineComponent({
      setup: () => () => h(Dialog, { open: true }, () => h(DialogContent, { dialogClass: 'max-w-4xl' }, () => 'Body')),
    })
    const dialog = mount(Harness).find('dialog')
    expect(dialog.classes()).toContain('max-w-4xl')
    expect(dialog.classes()).not.toContain('max-w-lg')
  })
})
