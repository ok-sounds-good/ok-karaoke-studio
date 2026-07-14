// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVideoStyleController } from '../src/hooks/useVideoStyleController'
import { createProject } from '../src/lib/karaoke'
import { cloneVideoStyleDraft } from '../src/lib/style-session'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('video style controller validation boundary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(window, 'studio', { configurable: true, value: undefined })
  })

  function installBackgroundStudio({
    releaseBackground = vi.fn(async () => undefined),
    retainBackground = vi.fn(async () => true),
    resolveWindowClose = vi.fn(async () => true),
  } = {}) {
    Object.defineProperty(window, 'studio', {
      configurable: true,
      value: { releaseBackground, retainBackground, resolveWindowClose },
    })
    return { releaseBackground, retainBackground, resolveWindowClose }
  }

  it('refuses lifecycle Apply when an invalid draft bypasses input normalization', async () => {
    const project = createProject()
    const commitProject = vi.fn()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    const invalid = cloneVideoStyleDraft(controller!.draft!)
    invalid.stageStyle.stageFrame.lineWidthPx = 1.25
    await act(async () => controller!.setDraft(invalid))
    await act(async () => controller!.requestCommand('save'))

    expect(controller!.draftValid).toBe(false)
    expect(controller!.lifecycleCommand).toBe('save')
    await expect(controller!.resolveCommand(true)).resolves.toBe(false)
    expect(controller!.lifecycleCommand).toBe('save')
    expect(commitProject).not.toHaveBeenCalled()
  })

  it('awaits deactivation of a null baseline before completing confirmed Cancel', async () => {
    const release = deferred<void>()
    const { retainBackground } = installBackgroundStudio({
      retainBackground: vi.fn((url: string | null) => (
        url === null ? release.promise.then(() => true) : Promise.resolve(true)
      )),
    })
    const project = createProject()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject: vi.fn() })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.setBackgroundMode('solid'))
    let discard!: Promise<boolean>
    act(() => { discard = controller!.discardChanges() })

    expect(retainBackground).toHaveBeenCalledOnce()
    expect(retainBackground).toHaveBeenCalledWith(null)
    expect(controller!.settling).toBe(true)
    expect(controller!.draft).not.toBeNull()
    await act(async () => {
      release.resolve()
      await discard
    })
    expect(controller!.settling).toBe(false)
    expect(controller!.draft).toBeNull()
  })

  it('retains and restores an image baseline before discarding a replacement', async () => {
    const { retainBackground } = installBackgroundStudio()
    const project = createProject()
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/images/original.png'
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject: vi.fn() })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.background.setUrl('studio-media://background/original'))
    await act(async () => controller!.open(project))
    await act(async () => controller!.applyBackgroundImage(
      '/images/replacement.png',
      'studio-media://background/replacement',
    ))
    await act(async () => { await controller!.discardChanges() })

    expect(retainBackground).toHaveBeenCalledOnce()
    expect(retainBackground).toHaveBeenCalledWith('studio-media://background/original')
    expect(controller!.background.url).toBe('studio-media://background/original')
    expect(controller!.draft).toBeNull()
  })

  it('awaits replacement retention before Apply commits and closes', async () => {
    const retention = deferred<boolean>()
    const { retainBackground } = installBackgroundStudio({
      retainBackground: vi.fn(() => retention.promise),
    })
    const project = createProject()
    const commitProject = vi.fn()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.applyBackgroundImage(
      '/images/replacement.png',
      'studio-media://background/replacement',
    ))
    let applied!: Promise<boolean>
    act(() => { applied = controller!.apply() })

    expect(retainBackground).toHaveBeenCalledWith('studio-media://background/replacement')
    expect(commitProject).not.toHaveBeenCalled()
    expect(controller!.draft).not.toBeNull()
    await act(async () => {
      retention.resolve(true)
      await applied
    })
    expect(commitProject).toHaveBeenCalledOnce()
    expect(commitProject.mock.calls[0][0].stageStyle.background).toMatchObject({
      mode: 'image',
      imagePath: '/images/replacement.png',
    })
    expect(controller!.draft).toBeNull()
  })

  it('awaits baseline settlement before lifecycle Discard queues Export', async () => {
    const release = deferred<void>()
    installBackgroundStudio({
      retainBackground: vi.fn((url: string | null) => (
        url === null ? release.promise.then(() => true) : Promise.resolve(true)
      )),
    })
    const project = createProject()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject: vi.fn() })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.setBackgroundMode('solid'))
    await act(async () => controller!.requestCommand('export'))
    let resolved!: Promise<boolean>
    act(() => { resolved = controller!.resolveCommand(false) })

    expect(controller!.resolvedCommand).toBeNull()
    expect(controller!.lifecycleCommand).toBe('export')
    await act(async () => {
      release.resolve()
      await resolved
    })
    expect(controller!.resolvedCommand).toMatchObject({ command: 'export', project })
    expect(controller!.draft).toBeNull()
  })

  it('keeps a failed lifecycle settlement visible and retryable', async () => {
    const { retainBackground } = installBackgroundStudio({
      retainBackground: vi.fn(async () => false),
    })
    const project = createProject()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject: vi.fn() })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.applyBackgroundImage(
      '/images/replacement.png',
      'studio-media://background/replacement',
    ))
    await act(async () => controller!.requestCommand('save'))
    await act(async () => {
      await expect(controller!.resolveCommand(true)).resolves.toBe(false)
    })

    expect(controller!.lifecycleError).toContain('could not be retained')
    expect(controller!.lifecycleCommand).toBe('save')
    expect(controller!.draft).not.toBeNull()
    retainBackground.mockResolvedValueOnce(true)
    await act(async () => {
      await expect(controller!.resolveCommand(true)).resolves.toBe(true)
    })
    expect(controller!.lifecycleError).toBeNull()
    expect(controller!.resolvedCommand?.command).toBe('save')
  })

  it.each(['save', 'export'] as const)(
    'silently settles a choose-then-revert background before clean %s',
    async (command) => {
      const release = deferred<void>()
      const { retainBackground } = installBackgroundStudio({
        retainBackground: vi.fn((url: string | null) => (
          url === null ? release.promise.then(() => true) : Promise.resolve(true)
        )),
      })
      const project = createProject()
      let controller: ReturnType<typeof useVideoStyleController> | null = null

      function Harness() {
        controller = useVideoStyleController({ project, commitProject: vi.fn() })
        return null
      }

      await act(async () => root.render(<Harness />))
      await act(async () => controller!.open(project))
      await act(async () => controller!.applyBackgroundImage(
        '/images/reverted.png',
        'studio-media://background/reverted',
      ))
      await act(async () => controller!.setBackgroundMode('gradient'))
      expect(controller!.dirty).toBe(false)

      await act(async () => controller!.requestCommand(command))
      expect(retainBackground).toHaveBeenCalledOnce()
      expect(retainBackground).toHaveBeenCalledWith(null)
      expect(controller!.settling).toBe(true)
      expect(controller!.lifecycleCommand).toBeNull()
      await act(async () => {
        release.resolve()
        await release.promise
        await Promise.resolve()
      })
      expect(controller!.resolvedCommand?.command).toBe(command)
      expect(controller!.draft).toBeNull()
    },
  )

  it('applies a missing linked image path while preserving its canonical readiness error', async () => {
    const { retainBackground } = installBackgroundStudio()
    const project = createProject()
    const commitProject = vi.fn()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.applyBackgroundImage(
      '/images/missing.png',
      'studio-media://background/missing',
    ))
    await act(async () => {
      controller!.background.setUrl(null)
      controller!.background.setError('Relink the missing background image')
    })
    await act(async () => { await controller!.apply() })

    expect(retainBackground).toHaveBeenCalledWith(null)
    expect(commitProject).toHaveBeenCalledOnce()
    expect(commitProject.mock.calls[0][0].stageStyle.background).toMatchObject({
      imagePath: '/images/missing.png',
      mode: 'image',
    })
    expect(controller!.background.url).toBeNull()
    expect(controller!.background.error).toBe('Relink the missing background image')
  })

  it('uses the latest native-close command received while Apply is settling', async () => {
    const retention = deferred<boolean>()
    const { resolveWindowClose } = installBackgroundStudio({
      retainBackground: vi.fn(() => retention.promise),
    })
    const project = createProject()
    const commitProject = vi.fn()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.applyBackgroundImage(
      '/images/next.png',
      'studio-media://background/next',
    ))
    await act(async () => controller!.requestCommand('save'))
    let resolution!: Promise<boolean>
    act(() => { resolution = controller!.resolveCommand(true) })
    await act(async () => controller!.requestCommand('close'))
    expect(controller!.lifecycleCommand).toBe('close')
    expect(controller!.windowClosePending).toBe(true)

    await act(async () => {
      retention.resolve(true)
      await resolution
    })
    expect(commitProject).toHaveBeenCalledOnce()
    expect(controller!.resolvedCommand?.command).toBe('close')
    expect(controller!.windowClosePending).toBe(false)
    expect(resolveWindowClose).not.toHaveBeenCalled()
  })

  it('cancels a superseded native close before continuing the latest Export', async () => {
    const release = deferred<void>()
    const { resolveWindowClose } = installBackgroundStudio({
      retainBackground: vi.fn((url: string | null) => (
        url === null ? release.promise.then(() => true) : Promise.resolve(true)
      )),
    })
    const project = createProject()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject: vi.fn() })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.setBackgroundMode('solid'))
    await act(async () => controller!.requestCommand('close'))
    let resolution!: Promise<boolean>
    act(() => { resolution = controller!.resolveCommand(false) })
    await act(async () => controller!.requestCommand('export'))

    await act(async () => {
      release.resolve()
      await resolution
    })
    expect(resolveWindowClose).toHaveBeenCalledOnce()
    expect(resolveWindowClose).toHaveBeenCalledWith(false)
    expect(controller!.resolvedCommand?.command).toBe('export')
    expect(controller!.windowClosePending).toBe(false)
  })

  it('keeps a failed native-close cancellation visible and retryable', async () => {
    const resolveWindowClose = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    installBackgroundStudio({ resolveWindowClose })
    const project = createProject()
    let controller: ReturnType<typeof useVideoStyleController> | null = null

    function Harness() {
      controller = useVideoStyleController({ project, commitProject: vi.fn() })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controller!.open(project))
    await act(async () => controller!.setBackgroundMode('solid'))
    await act(async () => controller!.requestCommand('close'))
    await act(async () => controller!.requestCommand('export'))
    await act(async () => {
      await expect(controller!.resolveCommand(false)).resolves.toBe(false)
    })
    expect(controller!.lifecycleError).toContain('was not canceled')
    expect(controller!.lifecycleCommand).toBe('export')
    expect(controller!.windowClosePending).toBe(true)
    expect(controller!.draft).not.toBeNull()

    await act(async () => {
      await expect(controller!.resolveCommand(false)).resolves.toBe(true)
    })
    expect(controller!.lifecycleError).toBeNull()
    expect(controller!.resolvedCommand?.command).toBe('export')
    expect(controller!.windowClosePending).toBe(false)
  })
})
