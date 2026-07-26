// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceDivider } from '../src/components/WorkspaceDivider'

const STORAGE_KEY = 'studio.workspace-stage-height'

function storageStub() {
  const values: Record<string, string> = {}
  return {
    clear: () => {
      for (const key of Object.keys(values)) delete values[key]
    },
    getItem: (key: string) => values[key] ?? null,
    removeItem: (key: string) => delete values[key],
    setItem: (key: string, value: string) => {
      values[key] = String(value)
    },
  } as Storage
}

describe('WorkspaceDivider', () => {
  let container: HTMLDivElement
  let root: Root
  let observedResize: (() => void) | null
  let stageHeight = 428
  let computedStyle: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storageStub() })
    stageHeight = 428
    observedResize = null
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observedResize = callback
        }
        disconnect() {}
        observe() {}
      },
    )
    computedStyle = vi.fn((element: Element) => {
      const root = element.classList.contains('unified-workspace')
      return {
        getPropertyValue: (property: string) =>
          root
            ? ({
                '--workspace-divider-size': '9px',
                '--workspace-timing-min': '260px',
                '--workspace-top-min': '270px',
                'padding-bottom': '9px',
                'padding-top': '9px',
              }[property] ?? '')
            : '',
      } as CSSStyleDeclaration
    })
    vi.stubGlobal('getComputedStyle', computedStyle)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <WorkspaceDivider
          stage={<section aria-label="Karaoke preview">Stage</section>}
          timing={<section aria-label="Lyric Timing">Timing</section>}
        />,
      )
    })
    const workspace = container.querySelector<HTMLElement>('.unified-workspace')!
    const stage = container.querySelector<HTMLElement>('.workspace-top')!
    Object.defineProperty(workspace, 'clientHeight', {
      configurable: true,
      value: 1000,
      writable: true,
    })
    Object.defineProperty(workspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => DOMRect.fromRect({ height: 1000, top: 20 }),
    })
    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        DOMRect.fromRect({
          height:
            Number.parseFloat(workspace.style.getPropertyValue('--workspace-top-height')) ||
            stageHeight,
        }),
    })
    await act(async () => observedResize?.())
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function divider() {
    const element = container.querySelector<HTMLDivElement>('.workspace-divider')
    if (!element) throw new Error('Divider missing')
    Object.defineProperties(element, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() },
    })
    return element
  }

  async function resize(height: number) {
    const workspace = container.querySelector<HTMLElement>('.unified-workspace')!
    Object.defineProperty(workspace, 'clientHeight', {
      configurable: true,
      value: height,
      writable: true,
    })
    await act(async () => observedResize?.())
  }

  it('keeps Stage, separator, and Timing in order with separator semantics and no default override', () => {
    const workspace = container.querySelector<HTMLElement>('.unified-workspace')!
    const children = [...workspace.children]
    const separator = divider()
    expect(children.map((child) => child.className)).toEqual([
      'workspace-top',
      'workspace-divider',
      'workspace-timing',
    ])
    expect(separator.getAttribute('role')).toBe('separator')
    expect(separator.getAttribute('aria-orientation')).toBe('horizontal')
    expect(separator.getAttribute('aria-controls')).toBe(
      'workspace-stage-region workspace-timing-region',
    )
    expect(separator.getAttribute('aria-valuetext')).toContain('Stage Monitor')
    expect(workspace.style.getPropertyValue('--workspace-top-height')).toBe('')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it.each(['nope', '-0.2', '1.1', '44', '0.50', 'NaN'])(
    'ignores invalid stored ratio %s without a write',
    async (stored) => {
      await act(async () => root.unmount())
      window.localStorage.setItem(STORAGE_KEY, stored)
      const setItem = vi.spyOn(window.localStorage, 'setItem')
      root = createRoot(container)
      await act(async () => {
        root.render(<WorkspaceDivider stage={<div />} timing={<div />} />)
      })
      expect(container.querySelector<HTMLElement>('.unified-workspace')?.style.cssText).toBe('')
      expect(setItem).not.toHaveBeenCalled()
    },
  )

  it('treats unavailable preference storage as an optional enhancement', async () => {
    await act(async () => root.unmount())
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage blocked')
        },
        setItem: () => {
          throw new Error('storage blocked')
        },
      },
    })
    root = createRoot(container)
    await act(async () => root.render(<WorkspaceDivider stage={<div />} timing={<div />} />))
    const separator = divider()
    await act(async () => {
      expect(() =>
        separator.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' })),
      ).not.toThrow()
    })
  })

  it('uses pointer Y with capture, ignores foreign pointers, and persists once on release', async () => {
    const separator = divider()
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    await act(async () => {
      separator.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 300, pointerId: 7 }),
      )
      separator.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 9 }),
      )
      separator.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientY: 420, pointerId: 7 }),
      )
    })
    await act(async () =>
      separator.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientY: 420, pointerId: 7 }),
      ),
    )
    expect(separator.setPointerCapture).toHaveBeenCalledWith(7)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(Number(window.localStorage.getItem(STORAGE_KEY))).toBeGreaterThan(0.3)
  })

  it('rolls a drag back on cancellation or capture loss without persistence', async () => {
    const separator = divider()
    const workspace = container.querySelector<HTMLElement>('.unified-workspace')!
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    await act(async () => {
      separator.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 400, pointerId: 7 }),
      )
      separator.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 7 }),
      )
      separator.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }))
    })
    expect(workspace.style.getPropertyValue('--workspace-top-height')).toBe('')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('rolls back on lost capture and releases safely during unmount', async () => {
    const separator = divider()
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    await act(async () => {
      separator.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 400, pointerId: 7 }),
      )
      separator.dispatchEvent(
        new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }),
      )
    })
    expect(setItem).not.toHaveBeenCalled()
    await act(async () => {
      separator.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 400, pointerId: 8 }),
      )
      root.unmount()
    })
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(8)
  })

  it('preserves a stored desired ratio through resize clamping without writing', async () => {
    await act(async () => root.unmount())
    window.localStorage.setItem(STORAGE_KEY, '0.7')
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    root = createRoot(container)
    await act(async () => root.render(<WorkspaceDivider stage={<div />} timing={<div />} />))
    const workspace = container.querySelector<HTMLElement>('.unified-workspace')!
    const stage = container.querySelector<HTMLElement>('.workspace-top')!
    Object.defineProperty(workspace, 'clientHeight', {
      configurable: true,
      value: 600,
      writable: true,
    })
    Object.defineProperty(workspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => DOMRect.fromRect({ height: 600, top: 20 }),
    })
    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        DOMRect.fromRect({
          height:
            Number.parseFloat(workspace.style.getPropertyValue('--workspace-top-height')) || 260,
        }),
    })
    await act(async () => observedResize?.())
    const clamped = Number.parseFloat(workspace.style.getPropertyValue('--workspace-top-height'))
    await resize(1400)
    const restored = Number.parseFloat(workspace.style.getPropertyValue('--workspace-top-height'))
    expect(restored).toBeGreaterThan(clamped)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0.7')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('supports Up, Down, Shift, Home, and End with dynamic bounds', async () => {
    const separator = divider()
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) {
      await act(async () =>
        separator.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key })),
      )
    }
    await act(async () =>
      separator.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp', shiftKey: true }),
      ),
    )
    expect(Number(separator.getAttribute('aria-valuemin'))).toBeGreaterThanOrEqual(0)
    expect(Number(separator.getAttribute('aria-valuemax'))).toBeLessThanOrEqual(100)
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(separator.getAttribute('aria-valuemax')),
    )
    expect(setItem).toHaveBeenCalled()
  })

  it('does not measure or persist on an ordinary child rerender', async () => {
    computedStyle.mockClear()
    await act(async () => {
      root.render(<WorkspaceDivider stage={<div>Updated stage</div>} timing={<div />} />)
    })
    expect(computedStyle).not.toHaveBeenCalled()
  })

  it('disables pointer and keyboard resizing while Sync Focus owns the top lane', async () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem')
    await act(async () => {
      root.render(<WorkspaceDivider isSyncing stage={<div />} timing={<div />} />)
    })
    const separator = divider()
    await act(async () => {
      separator.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 500, pointerId: 7 }),
      )
      separator.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }))
    })
    expect(separator.getAttribute('aria-disabled')).toBe('true')
    expect(separator.tabIndex).toBe(-1)
    expect(setItem).not.toHaveBeenCalled()
  })
})
