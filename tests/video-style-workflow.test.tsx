// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDemoProject, parseProject, serializeProject } from '../src/lib/model'
import {
  clickButton,
  clickDialogButton,
  deferred,
  mountApp,
  pressKey,
  replaceInputValue,
  type StudioHarness,
} from './support/app-harness'

describe('video style workflow', () => {
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

  it('resolves a changed style draft before saving and persists the applied style', async () => {
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())

    const save = document.querySelector<HTMLButtonElement>('[aria-label="Save project"]')
    if (!save) throw new Error('Save action was not mounted')
    await act(async () => save.click())

    const guard = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(guard?.textContent).toContain('Resolve video style changes')
    expect(guard?.textContent).toContain('Apply & Save')
    expect(guard?.textContent).toContain('Discard & Save')
    expect(guard?.textContent).toContain('Keep editing')
    expect(harness.saveProject).not.toHaveBeenCalled()

    await clickButton('Apply & Save')
    expect(harness.saveProject).toHaveBeenCalledOnce()
    const saved = parseProject(harness.saveProject.mock.calls[0][0].contents)
    expect(saved.stageStyle.background.mode).toBe('solid')
    expect(document.querySelector('[aria-label="Video style font selector"]')).toBeNull()
    expect(document.querySelector('#video-style-heading')).toBeNull()
  })

  it('awaits linked-image retention before continuing Save from the style lifecycle', async () => {
    const retention = deferred<boolean>()
    harness.chooseBackgroundImage.mockResolvedValueOnce({
      name: 'stage.png',
      path: '/images/stage.png',
      url: 'studio-media://background/stage',
    })
    harness.retainBackground.mockImplementationOnce(() => retention.promise)
    await clickButton('Style')
    const image = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Image'))
    if (!image) throw new Error('Image background option was not mounted')
    await act(async () => image.click())
    await clickButton('Choose image')
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Save project"]')?.click())
    await clickDialogButton('Apply & Save')

    expect(harness.retainBackground).toHaveBeenCalledWith('studio-media://background/stage')
    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Resolve video style changes',
    )
    await act(async () => {
      retention.resolve(true)
      await retention.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.saveProject).toHaveBeenCalledOnce()
    const saved = parseProject(harness.saveProject.mock.calls[0][0].contents)
    expect(saved.stageStyle.background).toMatchObject({
      mode: 'image',
      imagePath: '/images/stage.png',
    })
  })

  it('awaits linked-image retention before opening Export from the style lifecycle', async () => {
    const retention = deferred<boolean>()
    harness.chooseBackgroundImage.mockResolvedValueOnce({
      name: 'stage.png',
      path: '/images/stage.png',
      url: 'studio-media://background/stage',
    })
    harness.retainBackground.mockImplementationOnce(() => retention.promise)
    await clickButton('Style')
    const image = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Image'))
    if (!image) throw new Error('Image background option was not mounted')
    await act(async () => image.click())
    await clickButton('Choose image')
    await clickButton('Export')
    await clickDialogButton('Apply & Export')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Resolve video style changes',
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Export karaoke')
    await act(async () => {
      retention.resolve(true)
      await retention.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Export karaoke')
  })

  it('keeps failed lifecycle Discard visible and retryable before Save', async () => {
    harness.retainBackground.mockRejectedValueOnce(new Error('restore denied'))
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Save project"]')?.click())
    await clickDialogButton('Discard & Save')

    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('restore denied')
    expect(document.querySelector('#video-style-heading')).not.toBeNull()
    await clickDialogButton('Discard & Save')
    expect(harness.saveProject).toHaveBeenCalledOnce()
    expect(document.querySelector('#video-style-heading')).toBeNull()
  })

  it('uses an in-app discard guard for Cancel and Escape, including from a focused input', async () => {
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())

    const cancel = document.querySelector<HTMLButtonElement>(
      '.video-style-editor__actions button:first-of-type',
    )
    await act(async () => cancel?.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Discard video style changes?',
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Discard changes')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Keep editing')
    expect(window.confirm).not.toHaveBeenCalled()

    await clickButton('Keep editing')
    const color = document.querySelector<HTMLInputElement>('.style-color-field input')
    color?.focus()
    await pressKey('Escape')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Discard video style changes?',
    )

    await clickButton('Discard changes')
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(document.querySelector('#video-style-heading')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('.project-style-button'))
  })

  it('keeps a failed confirmed Cancel visible and retryable', async () => {
    harness.retainBackground.mockRejectedValueOnce(new Error('original image access expired'))
    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())
    await act(async () => document.querySelector<HTMLButtonElement>(
      '.video-style-editor__actions button:first-of-type',
    )?.click())
    await clickDialogButton('Discard changes')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'original image access expired',
    )
    expect(document.querySelector('#video-style-heading')).not.toBeNull()
    await clickDialogButton('Discard changes')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('#video-style-heading')).toBeNull()
  })

  it('keeps keyboard focus inside section and font navigation, then returns it to Style', async () => {
    await clickButton('Style')
    const heading = document.querySelector<HTMLHeadingElement>('#video-style-heading')
    const selectedSection = document.querySelector<HTMLButtonElement>(
      '.style-sections [aria-current="page"]',
    )
    expect(heading?.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(heading)
    expect(selectedSection?.textContent).toContain('Background')

    selectedSection?.focus()
    await act(async () => selectedSection?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowDown',
      code: 'ArrowDown',
    })))
    expect(document.activeElement?.textContent).toContain('Project lyrics')
    expect(document.querySelector('[aria-current="page"]')?.textContent).toContain('Project lyrics')

    const fontControl = document.querySelector<HTMLButtonElement>('.font-summary')
    if (!fontControl) throw new Error('Project font control was not mounted')
    await act(async () => fontControl.click())
    const search = document.querySelector<HTMLInputElement>('[placeholder="Search typefaces"]')
    expect(document.activeElement).toBe(search)
    await act(async () => search?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
      code: 'Escape',
    })))
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(document.querySelector('.font-summary'))

    const lyricsSection = document.querySelector<HTMLButtonElement>(
      '.style-sections [aria-current="page"]',
    )
    lyricsSection?.focus()
    await act(async () => lyricsSection?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Home',
      code: 'Home',
    })))
    expect(document.activeElement?.textContent).toContain('Background')
    await act(async () => document.querySelector<HTMLButtonElement>(
      '.video-style-editor__actions button:first-of-type',
    )?.click())
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(document.activeElement).toBe(document.querySelector('.project-style-button'))
  })

  it('uses Left and Right to move style sections without seeking the playhead', async () => {
    await clickButton('Style')
    const background = document.querySelector<HTMLButtonElement>(
      '.style-sections [aria-current="page"]',
    )
    if (!background) throw new Error('Background section was not mounted')
    background.focus()
    const initialTime = document.querySelector('.time-readout strong')?.textContent
    const right = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'ArrowRight',
      key: 'ArrowRight',
    })
    await act(async () => background.dispatchEvent(right))
    expect(right.defaultPrevented).toBe(true)
    expect(document.activeElement?.textContent).toContain('Project lyrics')
    expect(document.querySelector('.time-readout strong')?.textContent).toBe(initialTime)

    const lyrics = document.activeElement as HTMLButtonElement
    const left = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'ArrowLeft',
      key: 'ArrowLeft',
    })
    await act(async () => lyrics.dispatchEvent(left))
    expect(left.defaultPrevented).toBe(true)
    expect(document.activeElement?.textContent).toContain('Background')
    expect(document.querySelector('.time-readout strong')?.textContent).toBe(initialTime)
  })

  it('creates an inherited Sung override as exactly one undoable quick edit', async () => {
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')
    expect(quick?.textContent).toContain('#FF8A2B')
    await act(async () => quick?.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Sung color for Lead Vocal',
    )
    expect(document.querySelector<HTMLInputElement>('[aria-label="Sung color hex"]')?.value).toBe(
      '#FF8A2B',
    )
    await replaceInputValue('Sung color hex', '#ABCDEF')
    await clickDialogButton('Apply color')

    expect(quick?.textContent).toContain('#ABCDEF')
    const undo = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!
    expect(undo.disabled).toBe(false)
    await act(async () => undo.click())
    expect(quick?.textContent).toContain('#FF8A2B')
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
  })

  it('seeds the quick editor from an existing override and restores it with one Undo', async () => {
    const opened = createDemoProject()
    opened.tracks[0].vocalStyle.sungColor = '#112233'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'override-open',
      path: '/projects/override.oks',
      contents: serializeProject(opened),
    })
    await clickButton('Workflow')
    await clickButton('Open .oks')
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')!
    expect(quick.textContent).toContain('#112233')
    await act(async () => quick.click())
    expect(document.querySelector<HTMLInputElement>('[aria-label="Sung color hex"]')?.value).toBe(
      '#112233',
    )
    await replaceInputValue('Sung color hex', '#334455')
    await clickDialogButton('Apply color')
    expect(quick.textContent).toContain('#334455')
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click())
    expect(quick.textContent).toContain('#112233')
  })

  it('cancels the transactional Sung editor without changing project history', async () => {
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')!
    await act(async () => quick.click())
    await replaceInputValue('Sung color hex', '#ABCDEF')
    await clickDialogButton('Cancel')

    expect(quick.textContent).toContain('#FF8A2B')
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('treats an unchanged inherited Sung Apply as a semantic no-op', async () => {
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')!
    await act(async () => quick.click())
    await clickDialogButton('Apply color')

    expect(quick.textContent).toContain('#FF8A2B')
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
  })

  it('preserves an existing equal Sung override without creating history', async () => {
    const opened = createDemoProject()
    opened.tracks[0].vocalStyle.sungColor = '#112233'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'equal-override-open',
      path: '/projects/equal-override.oks',
      contents: serializeProject(opened),
    })
    await clickButton('Workflow')
    await clickButton('Open .oks')
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')!
    await act(async () => quick.click())
    await clickDialogButton('Apply color')

    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Save project"]')?.click())
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
      .tracks[0].vocalStyle.sungColor).toBe('#112233')
  })

  it('keeps a quick Sung edit in the style draft until overall Apply', async () => {
    await clickButton('Style')
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')!
    await act(async () => quick.click())
    await replaceInputValue('Sung color hex', '#445566')
    await clickDialogButton('Apply color')

    expect(quick.textContent).toContain('#445566')
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
    await clickButton('Apply & close')
    expect(document.querySelector('#video-style-heading')).toBeNull()
    expect(quick.textContent).toContain('#445566')
    const undo = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!
    expect(undo.disabled).toBe(false)
    await act(async () => undo.click())
    expect(quick.textContent).toContain('#FF8A2B')
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
  })

  it('treats unchanged Sung Apply inside Style as a draft and history no-op', async () => {
    await clickButton('Style')
    const quick = document.querySelector<HTMLButtonElement>('[aria-label="Edit Track 1 Sung color"]')!
    await act(async () => quick.click())
    await clickDialogButton('Apply color')
    await clickButton('Apply & close')

    expect(document.querySelector('#video-style-heading')).toBeNull()
    expect(quick.textContent).toContain('#FF8A2B')
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
  })

  it('undoes and redoes linked backgrounds as atomic path, URL, and capability bindings', async () => {
    const opened = createDemoProject()
    opened.stageStyle.background.mode = 'image'
    opened.stageStyle.background.imagePath = '/images/a.png'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'background-history-open',
      path: '/projects/background-history.oks',
      contents: serializeProject(opened),
    })
    harness.resolveProjectBackground.mockResolvedValueOnce({
      status: 'success',
      media: {
        name: 'a.png',
        path: '/images/a.png',
        url: 'studio-media://background/a',
      },
    })
    await clickButton('Workflow')
    await clickButton('Open .oks')

    harness.chooseBackgroundImage.mockResolvedValueOnce({
      name: 'b.png',
      path: '/images/b.png',
      url: 'studio-media://background/b',
    })
    await clickButton('Style')
    await clickButton('Replace')
    await clickButton('Apply & close')
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage)
      .toContain('studio-media://background/b')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.retainBackground).toHaveBeenLastCalledWith('studio-media://background/a')
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage)
      .toContain('studio-media://background/a')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.retainBackground).toHaveBeenLastCalledWith('studio-media://background/b')
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage)
      .toContain('studio-media://background/b')

    await clickButton('Style')
    const solid = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find((input) => input.parentElement?.textContent?.includes('Solid'))
    if (!solid) throw new Error('Solid background option was not mounted')
    await act(async () => solid.click())
    await clickButton('Apply & close')
    expect(harness.retainBackground).toHaveBeenLastCalledWith(null)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.retainBackground).toHaveBeenLastCalledWith('studio-media://background/b')

    harness.chooseBackgroundImage.mockResolvedValueOnce({
      name: 'missing.png',
      path: '/images/missing.png',
      url: 'studio-media://background/missing',
    })
    await clickButton('Style')
    await clickButton('Replace')
    await act(async () => harness.sendLinkedAssetInvalidated({
      kind: 'background',
      path: '/images/missing.png',
      message: 'Linked image disappeared after selection',
    }))
    await clickButton('Apply & close')
    expect(harness.retainBackground).toHaveBeenLastCalledWith(null)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.retainBackground).toHaveBeenLastCalledWith('studio-media://background/b')
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage)
      .toContain('studio-media://background/b')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.retainBackground).toHaveBeenLastCalledWith(null)
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.backgroundImage)
      .not.toContain('studio-media://background/b')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(harness.retainBackground).toHaveBeenLastCalledWith('studio-media://background/b')

    await act(async () => harness.sendMenuAction('save'))
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
      .stageStyle.background).toMatchObject({
      mode: 'image',
      imagePath: '/images/b.png',
    })
  })
})
