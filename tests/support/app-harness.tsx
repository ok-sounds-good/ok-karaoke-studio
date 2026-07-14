import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import App from '../../src/App'

export interface StudioHarness {
  studio: StudioApi
  cancelVideoExport: ReturnType<typeof vi.fn>
  chooseBackgroundImage: ReturnType<typeof vi.fn>
  exportText: ReturnType<typeof vi.fn>
  exportVideo: ReturnType<typeof vi.fn>
  importAudio: ReturnType<typeof vi.fn>
  openProject: ReturnType<typeof vi.fn>
  releaseBackground: ReturnType<typeof vi.fn>
  retainBackground: ReturnType<typeof vi.fn>
  resolveProjectAudio: ReturnType<typeof vi.fn>
  resolveProjectBackground: ReturnType<typeof vi.fn>
  resetProjectScope: ReturnType<typeof vi.fn>
  resolveWindowClose: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
  settleProjectOpen: ReturnType<typeof vi.fn>
  sendMenuAction: (action: StudioMenuAction) => void
  sendLinkedAssetInvalidated: (invalidation: StudioLinkedAssetInvalidation) => void
  sendWindowCloseRequest: (action?: StudioWindowCloseAction) => void
}

export function createStudioHarness(): StudioHarness {
  const openProject = vi.fn(async () => null)
  const saveProject = vi.fn(async () => ({ path: '/saved/project.oks' }))
  const settleProjectOpen = vi.fn(async () => true)
  const importAudio = vi.fn(async () => null)
  const exportText = vi.fn(async () => ({ path: '/exports/project.oks' }))
  const exportVideo = vi.fn(async () => null)
  const cancelVideoExport = vi.fn(async () => true)
  const chooseBackgroundImage = vi.fn(async () => null)
  const releaseBackground = vi.fn(async () => undefined)
  const retainBackground = vi.fn(async () => true)
  const resolveProjectAudio = vi.fn(async () => ({ status: 'missing' as const }))
  const resolveProjectBackground = vi.fn(async () => ({ status: 'missing' as const }))
  const resetProjectScope = vi.fn(async () => true)
  const resolveWindowClose = vi.fn(async () => true)
  let menuActionListener: ((action: StudioMenuAction) => void) | null = null
  let linkedAssetInvalidatedListener:
    ((invalidation: StudioLinkedAssetInvalidation) => void) | null = null
  let windowCloseListener: ((action: StudioWindowCloseAction) => void) | null = null
  const onMenuAction = vi.fn((callback: (action: StudioMenuAction) => void) => {
    menuActionListener = callback
    return () => {
      if (menuActionListener === callback) menuActionListener = null
    }
  })
  const studio = {
    openProject,
    saveProject,
    settleProjectOpen,
    importAudio,
    chooseBackgroundImage,
    releaseBackground,
    retainBackground,
    resolveProjectAudio,
    resolveProjectBackground,
    resetProjectScope,
    releaseAudio: vi.fn(async () => undefined),
    importLrc: vi.fn(async () => null),
    exportText,
    exportVideo,
    cancelVideoExport,
    resolveWindowClose,
    onVideoExportProgress: vi.fn(() => () => undefined),
    onMenuAction,
    onLinkedAssetInvalidated: vi.fn((callback: (
      invalidation: StudioLinkedAssetInvalidation,
    ) => void) => {
      linkedAssetInvalidatedListener = callback
      return () => {
        if (linkedAssetInvalidatedListener === callback) linkedAssetInvalidatedListener = null
      }
    }),
    onWindowCloseRequest: vi.fn((callback: (action: StudioWindowCloseAction) => void) => {
      windowCloseListener = callback
      return () => {
        if (windowCloseListener === callback) windowCloseListener = null
      }
    }),
  } as unknown as StudioApi

  return {
    studio,
    cancelVideoExport,
    chooseBackgroundImage,
    exportText,
    exportVideo,
    importAudio,
    openProject,
    releaseBackground,
    retainBackground,
    resolveProjectAudio,
    resolveProjectBackground,
    resetProjectScope,
    resolveWindowClose,
    saveProject,
    settleProjectOpen,
    sendLinkedAssetInvalidated: (invalidation) => linkedAssetInvalidatedListener?.(invalidation),
    sendMenuAction: (action) => menuActionListener?.(action),
    sendWindowCloseRequest: (action = 'window') => windowCloseListener?.(action),
  }
}

export async function mountApp() {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  const harness = createStudioHarness()
  Object.defineProperty(window, 'studio', { configurable: true, value: harness.studio })
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    value: vi.fn(() => true),
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<App />))

  return {
    harness,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
      Object.defineProperty(window, 'studio', { configurable: true, value: undefined })
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    },
  }
}

export async function selectValue(ariaLabel: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`[aria-label="${ariaLabel}"]`)
  if (!select) throw new Error(`Could not find select: ${ariaLabel}`)
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

export function buttonContaining(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Could not find button containing: ${label}`)
  return button
}

export async function clickButton(label: string) {
  await act(async () => {
    buttonContaining(label).click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

export async function replaceTextarea(text: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) throw new Error('Lyrics textarea was not mounted')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!setter) throw new Error('Textarea value setter is unavailable')
    setter.call(textarea, text)
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
  })
}

export async function replaceProjectTitle(text: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Project inspector"] input')
  if (!input) throw new Error('Project title input was not mounted')
  await setInputValue(input, text)
}

export async function replaceInputValue(ariaLabel: string, text: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${ariaLabel}"]`)
  if (!input) throw new Error(`Input was not mounted: ${ariaLabel}`)
  await setInputValue(input, text)
}

async function setInputValue(input: HTMLInputElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('Input value setter is unavailable')
    setter.call(input, text)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
  })
}

export async function clickDialogButton(label: string) {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  const button = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Dialog button was not mounted: ${label}`)
  await act(async () => {
    button.click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

export async function pressKey(code: string, init: KeyboardEventInit = {}) {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    key: code === 'Space' ? ' ' : code,
    ...init,
  })))
}

export async function releaseKey(code: string, init: KeyboardEventInit = {}) {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    code,
    key: code === 'Space' ? ' ' : code,
    ...init,
  })))
}

export async function tapSyncWord() {
  await pressKey('Space')
  await releaseKey('Space')
}

export function timelineTimingLabels() {
  return [...document.querySelectorAll<HTMLElement>('.timeline-word')]
    .map((word) => word.getAttribute('aria-label'))
}
