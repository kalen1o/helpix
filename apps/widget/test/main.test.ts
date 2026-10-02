import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WidgetController } from '../src/bootstrap'

const { mountWidget } = vi.hoisted(() => ({ mountWidget: vi.fn() }))
vi.mock('../src/bootstrap', () => ({
  readScriptConfig: () => ({ widgetKey: 'wk_1', apiBase: 'http://gw' }),
  mountWidget,
}))

function fakeController() {
  return { open: vi.fn(), close: vi.fn(), destroy: vi.fn(), identify: vi.fn(), logout: vi.fn() } satisfies WidgetController
}

/** Loads main.ts afresh. The mount stays pending until `finish` is called, as when the config is still loading. */
async function boot() {
  let resolve!: (c: WidgetController | null) => void
  mountWidget.mockReturnValue(new Promise<WidgetController | null>((r) => (resolve = r)))
  vi.resetModules()
  await import('../src/main')
  expect(mountWidget).toHaveBeenCalledTimes(1)
  const initialToken = (mountWidget.mock.calls[0]![1] as { initialToken: () => string | null }).initialToken
  const finish = async (c: WidgetController | null) => {
    resolve(c)
    await new Promise((r) => setTimeout(r, 0))
  }
  return { helpix: window.Helpix!, initialToken, finish }
}

beforeEach(() => {
  delete (window as { Helpix?: unknown }).Helpix
  mountWidget.mockReset()
})

describe('window.Helpix', () => {
  it('remembers the latest identify before mount and mounts with it', async () => {
    const { helpix, initialToken, finish } = await boot()
    helpix.identify('jwt-1')
    helpix.identify('jwt-2')
    expect(initialToken()).toBe('jwt-2')
    const c = fakeController()
    await finish(c)
    expect(c.identify).not.toHaveBeenCalled()
    helpix.identify('jwt-3')
    expect(c.identify).toHaveBeenCalledWith('jwt-3')
    helpix.logout()
    expect(c.logout).toHaveBeenCalledTimes(1)
  })

  it('logout before mount drops a pending identify', async () => {
    const { helpix, initialToken, finish } = await boot()
    helpix.identify('jwt-1')
    helpix.logout()
    expect(initialToken()).toBeNull()
    const c = fakeController()
    await finish(c)
    expect(c.identify).not.toHaveBeenCalled()
    expect(c.logout).not.toHaveBeenCalled()
  })

  it('passes on an identify that lands after the token was read but before the mount finished', async () => {
    const { helpix, initialToken, finish } = await boot()
    helpix.identify('jwt-1')
    initialToken()
    helpix.identify('jwt-2')
    const c = fakeController()
    await finish(c)
    expect(c.identify).toHaveBeenCalledWith('jwt-2')
  })

  it('passes on a logout that lands after the token was read but before the mount finished', async () => {
    const { helpix, initialToken, finish } = await boot()
    helpix.identify('jwt-1')
    initialToken()
    helpix.logout()
    const c = fakeController()
    await finish(c)
    expect(c.logout).toHaveBeenCalledTimes(1)
  })

  it('opens after mount when open() was called early', async () => {
    const { helpix, finish } = await boot()
    helpix.open()
    const c = fakeController()
    await finish(c)
    expect(c.open).toHaveBeenCalledTimes(1)
  })
})
