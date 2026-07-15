// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createDemoProject, parseProject, serializeProject } from '../src/lib/model'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const captures = new WeakMap<HTMLElement, Set<number>>()

interface StudioHarness {
  studio: StudioApi
  emitClose: (request: StudioWindowCloseRequest) => void
  openProject: ReturnType<typeof vi.fn>
  resetProjectScope: ReturnType<typeof vi.fn>
  resolveWindowClose: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
}

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        const pointers = captures.get(this) ?? new Set<number>()
        pointers.add(pointerId)
        captures.set(this, pointers)
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        return captures.get(this)?.has(pointerId) ?? false
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(pointerId: number) {
        captures.get(this)?.delete(pointerId)
      },
    },
    scrollTo: { configurable: true, value() {} },
    scrollBy: { configurable: true, value() {} },
  })
})

function createStudioHarness(): StudioHarness {
  let closeListener: ((request: StudioWindowCloseRequest) => void) | null = null
  let pendingClose: StudioWindowCloseRequest | null = null
  const openProject = vi.fn(async () => null)
  const resetProjectScope = vi.fn(async () => true)
  const saveProject = vi.fn(async () => ({ path: '/saved/project.oks' }))
  const resolveWindowClose = vi.fn(async (requestId: string) => {
    if (pendingClose?.requestId !== requestId) return false
    pendingClose = null
    return true
  })
  const studio = {
    openProject,
    settleProjectOpen: vi.fn(async () => true),
    resetProjectScope,
    saveProject,
    importAudio: vi.fn(async () => null),
    resolveProjectAudio: vi.fn(async () => null),
    releaseAudio: vi.fn(async () => undefined),
    importLrc: vi.fn(async () => null),
    exportText: vi.fn(async () => ({ path: '/exports/project.oks' })),
    exportVideo: vi.fn(async () => null),
    cancelVideoExport: vi.fn(async () => true),
    onVideoExportProgress: vi.fn(() => () => undefined),
    onMenuAction: vi.fn(() => () => undefined),
    onWindowCloseRequest: vi.fn((callback: typeof closeListener) => {
      closeListener = callback
      return () => {
        if (closeListener === callback) closeListener = null
      }
    }),
    getPendingWindowClose: vi.fn(async () => pendingClose),
    resolveWindowClose,
  } as unknown as StudioApi

  return {
    studio,
    emitClose(request) {
      pendingClose = request
      closeListener?.(request)
    },
    openProject,
    resetProjectScope,
    resolveWindowClose,
    saveProject,
  }
}

function buttonByText(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`Could not find button: ${label}`)
  return button
}

function buttonByLabel(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Could not find labelled button: ${label}`)
  return button
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click())
  await settle()
}

async function chooseSize(value: string) {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="Project lyric font size"]')
  if (!select) throw new Error('Project lyric font size was not mounted')
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY = 0,
) {
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        button: 0,
        pointerId,
        clientX,
        clientY,
      }),
    ),
  )
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })))
}

describe('project typography App integration', () => {
  let container: HTMLDivElement
  let root: Root
  let harness: StudioHarness
  let queryLocalFonts: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    harness = createStudioHarness()
    queryLocalFonts = vi.fn(async () => [])
    Object.defineProperty(window, 'studio', { configurable: true, value: harness.studio })
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: queryLocalFonts,
    })
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await settle()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(window, 'studio', { configurable: true, value: undefined })
    Reflect.deleteProperty(window, 'queryLocalFonts')
    vi.restoreAllMocks()
  })

  async function openDemo() {
    harness.openProject.mockResolvedValueOnce({
      requestId: 'demo-open-request',
      path: '/projects/demo.oks',
      contents: serializeProject(createDemoProject()),
    })
    await click(buttonByLabel('Open project'))
    expect(document.querySelectorAll('.timeline-word').length).toBeGreaterThan(0)
  }

  it('opens beside the identity, replaces the editing workspace, and keeps playback available', async () => {
    await openDemo()
    const style = buttonByText('Style')
    const selectedWord = document.querySelector<HTMLButtonElement>('.timeline-word')!
    dispatchPointer(selectedWord, 'pointerdown', 40, 100)
    dispatchPointer(selectedWord, 'pointerup', 40, 100)
    expect(selectedWord.getAttribute('aria-pressed')).toBe('true')
    expect(style.closest('.topbar__brand')).not.toBeNull()
    expect(style.getAttribute('aria-disabled')).toBe('false')
    await click(document.querySelector<HTMLButtonElement>('.sync-button')!)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    expect(style.getAttribute('aria-label')).toContain('Exit lyric synchronization first')
    await click(document.querySelector<HTMLButtonElement>('.sync-button')!)
    expect(style.getAttribute('aria-disabled')).toBe('false')
    await click(buttonByLabel('Stop'))
    style.focus()

    await click(style)

    expect(queryLocalFonts).toHaveBeenCalledOnce()
    expect(style.getAttribute('aria-label')).toContain('Style editor is already open')
    expect(document.querySelector('.style-workspace')).not.toBeNull()
    expect(document.querySelector('[aria-label="Project inspector"]')).toBeNull()
    expect(document.querySelector('[aria-label="Lyric Timing"]')).toBeNull()
    expect(document.querySelector('[aria-label="Project lyrics design preview"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Sing the first words and see the rest')
    expect(document.body.textContent).not.toContain('This is')
    expect(document.querySelector<HTMLButtonElement>('.sync-button')?.disabled).toBe(true)
    expect(buttonByLabel('Play').disabled).toBe(false)
    expect(buttonByLabel('Stop').disabled).toBe(false)
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="Playback speed"]')?.disabled,
    ).toBe(false)
    expect(document.querySelector<HTMLInputElement>('[aria-label="Volume"]')?.disabled).toBe(false)

    await click(buttonByLabel('Play'))
    expect(buttonByLabel('Pause')).not.toBeNull()
    expect(document.querySelector('.style-workspace')).not.toBeNull()
    const stop = buttonByLabel('Stop')
    stop.focus()
    dispatchKey(stop, { code: 'Space', key: ' ', shiftKey: true })
    expect(buttonByLabel('Play')).not.toBeNull()
    dispatchKey(document, { code: 'Delete', key: 'Delete' })
    expect(buttonByLabel('Undo').disabled).toBe(true)
    await click(buttonByText('Cancel'))

    expect(document.querySelector('.style-workspace')).toBeNull()
    expect(document.activeElement).toBe(style)
    expect(buttonByLabel('Undo').disabled).toBe(true)
  })

  it('preserves semantic no-op state and applies one undoable lyric-style step', async () => {
    const style = buttonByText('Style')
    await click(style)
    await click(buttonByText('Apply & close'))
    expect(buttonByLabel('Undo').disabled).toBe(true)
    expect(document.querySelector('[title="Unsaved changes"]')).toBeNull()

    await click(style)
    await chooseSize('96')
    await click(buttonByText('Apply & close'))
    expect(buttonByLabel('Undo').disabled).toBe(false)
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()

    await click(buttonByLabel('Save project'))
    expect(
      parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).stageStyle.lyrics.sizePx,
    ).toBe(96)
    await click(buttonByLabel('Undo'))
    await click(buttonByLabel('Save project'))
    expect(
      parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).stageStyle.lyrics.sizePx,
    ).toBe(82)
    expect(buttonByLabel('Redo').disabled).toBe(false)
  })

  it('offers Keep, Discard, and Apply before ordinary actions and never opens Export behind Style', async () => {
    await click(buttonByText('Style'))
    await chooseSize('96')
    await click(buttonByLabel('Save project'))

    expect(document.querySelector('.style-workspace')).not.toBeNull()
    expect(buttonByText('Keep editing')).not.toBeNull()
    expect(buttonByText('Discard changes')).not.toBeNull()
    expect(buttonByText('Apply changes')).not.toBeNull()
    expect(harness.saveProject).not.toHaveBeenCalled()
    await click(buttonByText('Keep editing'))
    expect(document.querySelector('.style-workspace')).not.toBeNull()

    await click(buttonByLabel('Save project'))
    await click(buttonByText('Discard changes'))
    expect(harness.saveProject).toHaveBeenCalledOnce()
    expect(
      parseProject(harness.saveProject.mock.calls[0][0].contents).stageStyle.lyrics.sizePx,
    ).toBe(82)

    await click(buttonByText('Style'))
    await chooseSize('96')
    await click(buttonByText('Export'))
    expect(document.body.textContent).toContain('Finish editing project lyrics?')
    expect(document.body.textContent).not.toContain('Export karaoke')
    await click(buttonByText('Apply changes'))
    expect(document.body.textContent).toContain('Export karaoke')
    expect(document.querySelector('.style-workspace')).toBeNull()
  })

  it('refuses Style entry while lyrics or Export already owns a dialog', async () => {
    const style = buttonByText('Style')
    await click(buttonByText('Edit text'))
    expect(style.getAttribute('aria-label')).toContain('Close the lyric editor first')
    dispatchKey(buttonByText('Cancel'), { code: 'Space', key: ' ', shiftKey: true })
    expect(buttonByLabel('Play')).not.toBeNull()
    await click(style)
    expect(document.body.textContent).toContain('Edit Lead Vocal')
    expect(document.querySelector('.style-workspace')).toBeNull()
    await click(buttonByText('Cancel'))

    await click(buttonByText('Export'))
    expect(style.getAttribute('aria-label')).toContain('Close Export first')
    await click(style)
    expect(document.body.textContent).toContain('Export karaoke')
    expect(document.querySelector('.style-workspace')).toBeNull()
    await click(buttonByLabel('Close dialog'))
  })

  it('reactively explains pending project transitions and active video exports', async () => {
    let finishReset!: (value: boolean) => void
    harness.resetProjectScope.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finishReset = resolve)),
    )
    await click(buttonByLabel('New project'))
    const style = buttonByText('Style')
    expect(style.getAttribute('aria-label')).toContain('current project action')
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()

    await act(async () => finishReset(true))
    await settle()
    expect(style.getAttribute('aria-disabled')).toBe('false')

    const progress = vi.mocked(harness.studio.onVideoExportProgress).mock.calls[0][0]
    act(() => progress({ phase: 'preparing', completed: 0, total: 1 }))
    expect(style.getAttribute('aria-label')).toContain('active video export')
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()
  })

  it('preserves exact native request IDs for Keep and Discard', async () => {
    await click(buttonByText('Style'))
    await chooseSize('96')
    const windowRequest = {
      requestId: '11111111-1111-4111-8111-111111111111',
      action: 'window',
    } as const
    await act(async () => harness.emitClose(windowRequest))

    expect(document.body.textContent).toContain('close this window')
    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    await click(buttonByText('Keep editing'))
    expect(harness.resolveWindowClose).toHaveBeenCalledWith(windowRequest.requestId, false)
    expect(document.querySelector('.style-workspace')).not.toBeNull()

    const appRequest = {
      requestId: '22222222-2222-4222-8222-222222222222',
      action: 'app',
    } as const
    await act(async () => harness.emitClose(appRequest))
    expect(document.body.textContent).toContain('quit the Studio')
    await click(buttonByText('Discard changes'))
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(appRequest.requestId, true)
    expect(document.querySelector('.style-workspace')).toBeNull()

    await click(buttonByText('Style'))
    await chooseSize('104')
    const appliedRequest = {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'window',
    } as const
    await act(async () => harness.emitClose(appliedRequest))
    await click(buttonByText('Apply changes'))
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(appliedRequest.requestId, true)
    expect(document.querySelector('.style-workspace')).toBeNull()
  })

  it('blocks Style from pointer acquisition through timing and marquee completion', async () => {
    await openDemo()
    const style = buttonByText('Style')
    const word = document.querySelector<HTMLButtonElement>('.timeline-word')!
    dispatchPointer(word, 'pointerdown', 41, 100)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()
    dispatchPointer(word, 'pointerup', 41, 100)
    expect(style.getAttribute('aria-disabled')).toBe('false')

    const lane = document.querySelector<HTMLElement>('.timeline-lane.is-active')!
    dispatchPointer(lane, 'pointerdown', 42, 300, 30)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointercancel', 42, 300, 30)
    expect(style.getAttribute('aria-disabled')).toBe('false')
    await click(style)
    expect(document.querySelector('.style-workspace')).not.toBeNull()
  })
})
