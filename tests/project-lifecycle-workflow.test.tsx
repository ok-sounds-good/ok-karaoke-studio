// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDemoProject, parseProject, serializeProject } from '../src/lib/model'
import {
  buttonContaining,
  clickButton,
  clickDialogButton,
  deferred,
  mountApp,
  replaceProjectTitle,
  type StudioHarness,
} from './support/app-harness'

describe('project close and restore workflow', () => {
  let harness: StudioHarness
  let unmount: () => Promise<void>

  beforeEach(async () => {
    const mounted = await mountApp()
    harness = mounted.harness
    unmount = mounted.unmount
  })

  afterEach(async () => {
    await unmount()
  })

  it('closes a clean project immediately through one explicit unload approval', async () => {
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(harness.resolveWindowClose).toHaveBeenCalledWith(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    const approvedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(approvedUnload)
    expect(approvedUnload.defaultPrevented).toBe(false)
    const unapprovedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unapprovedUnload)
    expect(unapprovedUnload.defaultPrevented).toBe(true)
  })

  it('saves a canonically dirty project successfully before closing', async () => {
    await replaceProjectTitle('Close after save')
    await act(async () => {
      harness.sendWindowCloseRequest('app')
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Save changes before closing?')
    expect(dialog?.textContent).toContain('Save & close')
    expect(dialog?.textContent).toContain("Don't save")
    expect(dialog?.textContent).toContain('Keep editing')
    await clickButton('Save & close')

    expect(harness.saveProject).toHaveBeenCalledOnce()
    expect(harness.resolveWindowClose).toHaveBeenCalledWith(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the close choice open when the save dialog is canceled', async () => {
    harness.saveProject.mockResolvedValueOnce(null)
    await replaceProjectTitle('Cancel save dialog')
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await clickButton('Save & close')

    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before closing?',
    )
  })

  it('keeps the close choice open when saving fails', async () => {
    harness.saveProject.mockRejectedValueOnce(new Error('disk unavailable'))
    await replaceProjectTitle('Fail save')
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await clickButton('Save & close')

    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before closing?',
    )
    expect(document.body.textContent).toContain('disk unavailable')
  })

  it('keeps the close choice open when the project changes during its save', async () => {
    const pendingSave = deferred<{ path: string }>()
    harness.saveProject.mockImplementationOnce(() => pendingSave.promise)
    await replaceProjectTitle('Save this revision')
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await act(async () => {
      buttonContaining('Save & close').click()
      await Promise.resolve()
    })
    await replaceProjectTitle('Newer unsaved revision')
    await act(async () => {
      pendingSave.resolve({ path: '/saved/older-close-revision.oks' })
      await pendingSave.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before closing?',
    )
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
  })

  it("closes without saving only the pending close request", async () => {
    await replaceProjectTitle('Discard on close')
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await clickButton("Don't save")

    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(harness.resolveWindowClose).toHaveBeenCalledWith(true)
    const approvedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(approvedUnload)
    expect(approvedUnload.defaultPrevented).toBe(false)
    const laterUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(laterUnload)
    expect(laterUnload.defaultPrevented).toBe(true)
  })

  it('keeps a canonically dirty project open when requested', async () => {
    await replaceProjectTitle('Keep this open')
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await clickButton('Keep editing')

    expect(harness.resolveWindowClose).toHaveBeenCalledWith(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
  })

  it('keeps canonical Keep editing visible until main exactly acknowledges cancellation', async () => {
    harness.resolveWindowClose
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    await replaceProjectTitle('Retry canonical cancellation')
    await act(async () => {
      harness.sendWindowCloseRequest()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await clickButton('Keep editing')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before closing?',
    )
    expect(document.body.textContent).toContain(
      'pending window close request was not canceled. Keep editing and try again.',
    )
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(false)

    await clickButton('Keep editing')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
    expect(harness.resolveWindowClose).toHaveBeenCalledTimes(2)
  })

  it('resolves draft-only window close before allowing the native close to continue', async () => {
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())

    await act(async () => harness.sendWindowCloseRequest())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Resolve video style changes',
    )
    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    await clickButton('Keep editing')
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(false)

    await act(async () => harness.sendWindowCloseRequest())
    await clickButton('Discard & continue')
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(true)
    expect(document.querySelector('#video-style-heading')).toBeNull()
  })

  it('keeps Style close cancellation visible and retryable until main acknowledges it', async () => {
    harness.resolveWindowClose.mockRejectedValueOnce(new Error('main close request still latched'))
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())
    await act(async () => harness.sendWindowCloseRequest())
    await clickDialogButton('Keep editing')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'main close request still latched',
    )
    expect(document.querySelector('#video-style-heading')).not.toBeNull()
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(false)

    await clickDialogButton('Keep editing')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('#video-style-heading')).not.toBeNull()
    await act(async () => harness.sendWindowCloseRequest('app'))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Resolve video style changes',
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      'main close request still latched',
    )
  })

  it('keeps Style open when main reports that no native-close latch was canceled', async () => {
    harness.resolveWindowClose.mockResolvedValueOnce(false)
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())
    await act(async () => harness.sendWindowCloseRequest())
    await clickDialogButton('Keep editing')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'pending window close request was not canceled',
    )
    expect(document.querySelector('#video-style-heading')).not.toBeNull()
    await clickDialogButton('Keep editing')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('#video-style-heading')).not.toBeNull()
  })

  it('lets an OS close request supersede the draft Cancel guard without stacking modals', async () => {
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())
    await act(async () => document.querySelector<HTMLButtonElement>(
      '.video-style-editor__actions button:first-of-type',
    )?.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Discard video style changes?',
    )

    await act(async () => harness.sendWindowCloseRequest())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Resolve video style changes',
    )
  })

  it('requires a canonical close decision after applying a style draft', async () => {
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())

    await act(async () => harness.sendWindowCloseRequest('app'))
    await clickButton('Apply & continue')
    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before closing?',
    )
    await clickButton("Don't save")
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(true)
  })

  it('discards only the style draft before resolving canonical project changes', async () => {
    await replaceProjectTitle('Canonical change remains')
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())

    await act(async () => harness.sendWindowCloseRequest())
    await clickButton('Discard & continue')
    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before closing?',
    )
    expect(document.querySelector('[aria-label="Karaoke preview"]')?.className).not.toContain(
      'is-solid',
    )
  })

  it('declines an exact pending open without resetting the current project or media', async () => {
    await replaceProjectTitle('Keep current project')
    const opened = createDemoProject()
    opened.title = 'Declined project'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'declined-renderer-open',
      path: '/projects/declined.oks',
      contents: serializeProject(opened),
    })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    harness.resolveProjectAudio.mockClear()
    harness.resolveProjectBackground.mockClear()

    await clickButton('Workflow')
    await clickButton('Open .oks')

    expect(harness.settleProjectOpen).toHaveBeenCalledWith('declined-renderer-open', false)
    expect(harness.resolveProjectAudio).not.toHaveBeenCalled()
    expect(harness.resolveProjectBackground).not.toHaveBeenCalled()
    expect(document.querySelector('.topbar__document')?.textContent).toContain(
      'Keep current project',
    )
  })

  it('rejects invalid pending contents without resetting the current project or media', async () => {
    await replaceProjectTitle('Still current project')
    harness.openProject.mockResolvedValueOnce({
      requestId: 'invalid-renderer-open',
      path: '/projects/invalid.oks',
      contents: '{}',
    })
    harness.resolveProjectAudio.mockClear()
    harness.resolveProjectBackground.mockClear()

    await clickButton('Workflow')
    await clickButton('Open .oks')

    expect(harness.settleProjectOpen).toHaveBeenCalledWith('invalid-renderer-open', false)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(harness.resolveProjectAudio).not.toHaveBeenCalled()
    expect(harness.resolveProjectBackground).not.toHaveBeenCalled()
    expect(document.querySelector('.topbar__document')?.textContent).toContain(
      'Still current project',
    )
  })

  it('deliberately clears a dormant image path before switching a reopened project to Image', async () => {
    const opened = createDemoProject()
    opened.stageStyle.background.mode = 'gradient'
    opened.stageStyle.background.imagePath = '/images/dormant-stage.png'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'dormant-background-open',
      path: '/projects/dormant.oks',
      contents: serializeProject(opened),
    })
    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(harness.settleProjectOpen).toHaveBeenCalledWith('dormant-background-open', true)
    await clickButton('Style')
    const image = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Image'))
    if (!image) throw new Error('Image background option was not mounted')
    await act(async () => image.click())

    expect(document.querySelector('.image-source-card')?.textContent).toContain('No image selected')
    expect(document.querySelector('.image-source-card')?.textContent).not.toContain(
      'dormant-stage.png',
    )
    expect(document.querySelector('.video-style-editor__actions')?.textContent).toContain(
      'imagePath is required in image mode',
    )
  })

  it('stops stale A restore after its background await before starting audio over B', async () => {
    const backgroundA = deferred<StudioMediaRestoreResult<StudioBackgroundImageResult>>()
    const backgroundB = deferred<StudioMediaRestoreResult<StudioBackgroundImageResult>>()
    const projectA = createDemoProject()
    projectA.title = 'Project A'
    projectA.audioPath = '/audio/a.mp3'
    projectA.stageStyle.background.mode = 'image'
    projectA.stageStyle.background.imagePath = '/images/a.png'
    const projectB = createDemoProject()
    projectB.title = 'Project B'
    projectB.audioPath = '/audio/b.mp3'
    projectB.stageStyle.background.mode = 'image'
    projectB.stageStyle.background.imagePath = '/images/b.png'
    harness.openProject
      .mockResolvedValueOnce({ requestId: 'project-a-open', path: '/projects/a.oks', contents: serializeProject(projectA) })
      .mockResolvedValueOnce({ requestId: 'project-b-open', path: '/projects/b.oks', contents: serializeProject(projectB) })
    harness.resolveProjectBackground.mockImplementation((path: string) => (
      path.endsWith('/a.oks') ? backgroundA.promise : backgroundB.promise
    ))
    harness.resolveProjectAudio.mockResolvedValue({ status: 'missing' })

    await act(async () => {
      harness.sendMenuAction('open')
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.resolveProjectBackground).toHaveBeenCalledWith('/projects/a.oks')
    await act(async () => {
      harness.sendMenuAction('open')
      await Promise.resolve()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.resolveProjectBackground).toHaveBeenCalledWith('/projects/b.oks')
    await act(async () => {
      backgroundB.resolve({
        status: 'success',
        media: {
          name: 'b.png',
          path: '/images/b.png',
          url: 'studio-media://background/b',
        },
      })
      await backgroundB.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await act(async () => {
      backgroundA.resolve({
        status: 'stale',
      })
      await backgroundA.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(harness.resolveProjectAudio).toHaveBeenCalledTimes(2)
    expect(harness.resolveProjectAudio).toHaveBeenCalledWith('/projects/a.oks')
    expect(harness.resolveProjectAudio).toHaveBeenCalledWith('/projects/b.oks')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project B')
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage).toContain(
      'studio-media://background/b',
    )
  })

  it.each(['apply', 'cancel'] as const)(
    'does not let deferred project background A overwrite chosen B after Style %s',
    async (resolution) => {
      const backgroundA = deferred<StudioMediaRestoreResult<StudioBackgroundImageResult>>()
      const opened = createDemoProject()
      opened.stageStyle.background.mode = 'image'
      opened.stageStyle.background.imagePath = '/images/a.png'
      harness.openProject.mockResolvedValueOnce({
        requestId: `style-race-${resolution}`,
        path: `/projects/style-race-${resolution}.oks`,
        contents: serializeProject(opened),
      })
      harness.resolveProjectBackground.mockImplementationOnce(() => backgroundA.promise)
      harness.chooseBackgroundImage.mockResolvedValueOnce({
        name: 'b.png',
        path: '/images/b.png',
        url: 'studio-media://background/b',
      })

      await act(async () => {
        harness.sendMenuAction('open')
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })
      await clickButton('Style')
      expect(harness.retainBackground).toHaveBeenCalledWith(null)
      await clickButton('Replace')
      if (resolution === 'apply') {
        await clickButton('Apply & close')
      } else {
        await act(async () => document.querySelector<HTMLButtonElement>(
          '.video-style-editor__actions button:first-of-type',
        )?.click())
        await clickButton('Discard changes')
      }
      await act(async () => {
        backgroundA.resolve({ status: 'stale' })
        await backgroundA.promise
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })

      const stage = document.querySelector<HTMLElement>('.karaoke-stage')!
      if (resolution === 'apply') {
        expect(stage.style.backgroundImage).toContain('studio-media://background/b')
      } else {
        expect(stage.style.backgroundImage).not.toContain('studio-media://background/b')
        expect(document.body.textContent).toContain('Linked image restoration was canceled')
      }
    },
  )

  it('keeps a background restore current when Import Audio supersedes only audio', async () => {
    vi.stubGlobal('AudioContext', class {
      async close() {}
      async decodeAudioData() {
        return { getChannelData: () => new Float32Array([0]) }
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0),
    })))
    const backgroundA = deferred<StudioMediaRestoreResult<StudioBackgroundImageResult>>()
    const opened = createDemoProject()
    opened.audioPath = '/audio/a.mp3'
    opened.stageStyle.background.mode = 'image'
    opened.stageStyle.background.imagePath = '/images/a.png'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'per-kind-import-audio',
      path: '/projects/per-kind-import-audio.oks',
      contents: serializeProject(opened),
    })
    harness.resolveProjectBackground.mockImplementationOnce(() => backgroundA.promise)
    harness.resolveProjectAudio.mockResolvedValueOnce({ status: 'stale' })
    harness.importAudio.mockResolvedValueOnce({
      path: '/audio/b.mp3',
      name: 'b.mp3',
      url: 'studio-media://audio/b',
    })

    await act(async () => {
      harness.sendMenuAction('open')
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await act(async () => {
      harness.sendMenuAction('import-audio')
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.importAudio).toHaveBeenCalledOnce()
    await act(async () => {
      backgroundA.resolve({
        status: 'success',
        media: {
          name: 'a.png',
          path: '/images/a.png',
          url: 'studio-media://background/a',
        },
      })
      await backgroundA.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage)
      .toContain('studio-media://background/a')
    await act(async () => harness.sendMenuAction('save'))
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).audioPath)
      .toBe('/audio/b.mp3')
  })
})
