import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import ConfirmDialog from '../src/components/ConfirmDialog.vue'

beforeAll(() => {
  // jsdom does not implement modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})

const baseProps = { open: true, title: 'Suspend Shop?', description: 'Really?', confirmLabel: 'Suspend' }

describe('ConfirmDialog', () => {
  it('renders an action error inside the dialog as an alert', () => {
    const w = mount(ConfirmDialog, { props: { ...baseProps, error: 'Tenant not found' } })
    const alert = w.find('dialog [role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe('Tenant not found')
  })

  it('renders no alert without an error', () => {
    const w = mount(ConfirmDialog, { props: { ...baseProps, error: null } })
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})
