// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FontSelector, normalizeInstalledFonts } from '../src/components/FontSelector'
import { PUBLIC_FONT_CAPTURE_EVENT } from '../src/components/PublicFontSelector'
import { VideoStyleWorkspace } from '../src/components/VideoStyleWorkspace'
import { VocalStylePane } from '../src/components/VocalStylePane'
import { createProject } from '../src/lib/karaoke'
import { createVideoStyleDraft } from '../src/lib/style-session'
import {
  DEFAULT_STAGE_STYLE,
  cloneVocalStyle,
  fontFaceKey,
  fontTypefaceKey,
  resolveVocalStyle,
  type FontSizeStyle,
} from '../src/lib/video-style'

describe('video style editor UI', () => {
  it('normalizes installed faces and previews the selected typeface, style, and size', () => {
    const fonts = normalizeInstalledFonts([
      {
        family: 'Avenir Next',
        fullName: 'Avenir Next Demi Bold',
        postscriptName: 'AvenirNext-DemiBold',
        style: 'Demi Bold',
      },
    ])
    const markup = renderToStaticMarkup(
      <FontSelector
        value={{ typeface: fonts[0], fontStyle: fonts[0].faces[0], sizePx: 72 }}
        fonts={fonts}
        accessState="ready"
        onTypefaceChange={() => undefined}
        onFontStyleChange={() => undefined}
        onSizeChange={() => undefined}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    )

    expect(markup).toContain('Typeface')
    expect(markup).toContain('Style')
    expect(markup).toContain('Size')
    expect(markup).toContain('This is Avenir Next')
    expect(markup).toContain('value="72"')
  })

  it('keeps deterministic system fonts available when enumeration is unavailable', () => {
    const markup = renderToStaticMarkup(
      <FontSelector
        value={DEFAULT_STAGE_STYLE.lyrics}
        fonts={[]}
        accessState="unavailable"
        onTypefaceChange={() => undefined}
        onFontStyleChange={() => undefined}
        onSizeChange={() => undefined}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    )

    expect(markup).toContain('System UI')
    expect(markup).toContain('System Monospace')
    expect(markup).toContain('This is System UI')
  })

  it('keeps a retired persisted face selected until the installed catalog is explicitly chosen', () => {
    const installed = normalizeInstalledFonts([
      {
        family: 'Moving Family',
        fullName: 'Moving Family Regular',
        postscriptName: 'MovingFamily-Regular',
        style: 'Regular',
      },
      {
        family: 'Moving Family',
        fullName: 'Moving Family New Bold',
        postscriptName: 'MovingFamily-NewBold',
        style: 'New Bold',
      },
    ])
    const persisted: FontSizeStyle = {
      typeface: {
        kind: 'local',
        family: 'Moving Family',
        faces: [
          {
            fullName: 'Moving Family Retired Demi',
            style: 'Retired Demi',
            postscriptName: 'MovingFamily-RetiredDemi',
            weight: 600,
            slant: 'normal',
          },
        ],
      },
      fontStyle: {
        fullName: 'Moving Family Retired Demi',
        style: 'Retired Demi',
        postscriptName: 'MovingFamily-RetiredDemi',
        weight: 600,
        slant: 'normal',
      },
      sizePx: 72,
    }
    const markup = renderToStaticMarkup(
      <FontSelector
        value={persisted}
        fonts={installed}
        accessState="ready"
        onTypefaceChange={() => undefined}
        onFontStyleChange={() => undefined}
        onSizeChange={() => undefined}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    )

    expect(markup).toContain('Moving Family (saved, missing)')
    expect(markup).toContain('Moving Family (installed)')
    expect(markup).toContain('Retired Demi')
    expect(markup).toContain('Requested: Moving Family Retired Demi (missing)')
    expect(markup).toContain('Use installed Moving Family')
  })

  it.each([8, 82, 118, 400])(
    'renders the font sample at the selected %i logical pixels without saturation',
    (sizePx) => {
      const markup = renderToStaticMarkup(
        <FontSelector
          value={{ ...DEFAULT_STAGE_STYLE.lyrics, sizePx }}
          fonts={[]}
          accessState="unavailable"
          onTypefaceChange={() => undefined}
          onFontStyleChange={() => undefined}
          onSizeChange={() => undefined}
          onRetry={() => undefined}
          onBack={() => undefined}
        />,
      )

      expect(markup).toContain(`aria-label="Font sample at ${sizePx} logical pixels"`)
      expect(markup).toContain(`font-size:${sizePx}px`)
    },
  )

  it('keeps an unresolved but valid linked path applyable while showing its warning', () => {
    const project = createProject()
    const draft = createVideoStyleDraft(project)
    draft.stageStyle.background.mode = 'image'
    draft.stageStyle.background.imagePath = '/missing/background.png'
    const markup = renderToStaticMarkup(
      <VideoStyleWorkspace
        project={project}
        activeTrack={project.tracks[0]}
        draft={draft}
        backgroundUrl={null}
        backgroundError="Relink this background image"
        settling={false}
        onDraftChange={() => undefined}
        onChooseBackground={() => undefined}
        onClearBackground={() => undefined}
        onSelectBackgroundMode={() => undefined}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    )

    for (const label of ['Background', 'Project lyrics', 'Title card', 'Stage frame', 'Vocal']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Relink this background image')
    expect(markup.match(/Relink this background image/gu)).toHaveLength(1)
    expect(markup).not.toContain('role="alert"')
    expect(markup).toContain('Apply &amp; close')
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply &amp; close<\/button>/)
  })

  it('uses an assertive editor error only for a real background settlement failure', () => {
    const project = createProject()
    const draft = createVideoStyleDraft(project)
    draft.stageStyle.background.mode = 'image'
    draft.stageStyle.background.imagePath = '/missing/background.png'
    const markup = renderToStaticMarkup(
      <VideoStyleWorkspace
        project={project}
        activeTrack={project.tracks[0]}
        draft={draft}
        backgroundUrl={null}
        backgroundError="Relink this background image"
        settlementError="The linked background authorization could not be retained"
        settling={false}
        onDraftChange={() => undefined}
        onChooseBackground={() => undefined}
        onClearBackground={() => undefined}
        onSelectBackgroundMode={() => undefined}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    )

    expect(markup.match(/Relink this background image/gu)).toHaveLength(1)
    expect(markup).toMatch(
      /role="alert">The linked background authorization could not be retained<\/p>/u,
    )
  })

  it('blocks image mode until a linked path has been chosen', () => {
    const project = createProject()
    const draft = createVideoStyleDraft(project)
    draft.stageStyle.background.mode = 'image'
    draft.stageStyle.background.imagePath = null
    const markup = renderToStaticMarkup(
      <VideoStyleWorkspace
        project={project}
        activeTrack={project.tracks[0]}
        draft={draft}
        backgroundUrl={null}
        backgroundError={null}
        settling={false}
        onDraftChange={() => undefined}
        onChooseBackground={() => undefined}
        onClearBackground={() => undefined}
        onSelectBackgroundMode={() => undefined}
        onCancel={() => undefined}
        onApply={() => undefined}
      />,
    )

    expect(markup).toContain('imagePath is required in image mode')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Apply &amp; close<\/button>/)
  })
})

describe('font selector event ownership', () => {
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
  })

  it('does not mutate selection on open and emits only the field the user changes', async () => {
    const fonts = normalizeInstalledFonts([
      {
        family: 'First Family',
        fullName: 'First Family Regular',
        postscriptName: 'FirstFamily-Regular',
        style: 'Regular',
      },
      {
        family: 'First Family',
        fullName: 'First Family Bold',
        postscriptName: 'FirstFamily-Bold',
        style: 'Bold',
      },
      {
        family: 'Second Family',
        fullName: 'Second Family Regular',
        postscriptName: 'SecondFamily-Regular',
        style: 'Regular',
      },
    ])
    const value = { typeface: fonts[0], fontStyle: fonts[0].faces[0], sizePx: 72 }
    const onTypefaceChange = vi.fn()
    const onFontStyleChange = vi.fn()
    const onSizeChange = vi.fn()
    await act(async () => root.render(
      <FontSelector
        value={value}
        fonts={fonts}
        accessState="ready"
        onTypefaceChange={onTypefaceChange}
        onFontStyleChange={onFontStyleChange}
        onSizeChange={onSizeChange}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    ))

    expect(onTypefaceChange).not.toHaveBeenCalled()
    expect(onFontStyleChange).not.toHaveBeenCalled()
    expect(onSizeChange).not.toHaveBeenCalled()

    const [typefaceSelect, styleSelect] = container.querySelectorAll('select')
    await act(async () => {
      typefaceSelect.value = fontTypefaceKey(fonts[1])
      typefaceSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onTypefaceChange).toHaveBeenCalledOnce()
    expect(onFontStyleChange).not.toHaveBeenCalled()
    expect(onSizeChange).not.toHaveBeenCalled()

    await act(async () => {
      styleSelect.value = fontFaceKey(fonts[0].faces[1])
      styleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onTypefaceChange).toHaveBeenCalledOnce()
    expect(onFontStyleChange).toHaveBeenCalledOnce()
    expect(onSizeChange).not.toHaveBeenCalled()

    const size = container.querySelector<HTMLInputElement>('input[type="number"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(size, '96')
      size.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onTypefaceChange).toHaveBeenCalledOnce()
    expect(onFontStyleChange).toHaveBeenCalledOnce()
    expect(onSizeChange).toHaveBeenCalledWith(96)
  })

  it('renders the smoke boundary through the real FontSelector with public props', async () => {
    const project = createProject()
    const secret = 'CodexInstalledTypeface-DoNotLeak'
    const priorDescriptor = Object.getOwnPropertyDescriptor(window, 'queryLocalFonts')
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: vi.fn().mockResolvedValue([{
        family: secret,
        fullName: `${secret} Regular`,
        postscriptName: 'CodexInstalledTypeface-Regular',
        style: 'Regular',
      }]),
    })
    try {
      await act(async () => root.render(
        <VideoStyleWorkspace
          project={project}
          activeTrack={project.tracks[0]}
          draft={createVideoStyleDraft(project)}
          backgroundUrl={null}
          backgroundError={null}
          settling={false}
          onDraftChange={() => undefined}
          onChooseBackground={() => undefined}
          onClearBackground={() => undefined}
          onSelectBackgroundMode={() => undefined}
          onCancel={() => undefined}
          onApply={() => undefined}
        />,
      ))
      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => button.textContent?.trim() === 'Project lyrics')
          ?.click()
      })
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-font-target="lyrics"]')?.click()
        await Promise.resolve()
      })
      expect(container.textContent).toContain(secret)

      await act(async () => {
        window.dispatchEvent(new CustomEvent(PUBLIC_FONT_CAPTURE_EVENT))
      })
      const boundary = container.querySelector<HTMLElement>('#oks-public-font-capture')!
      expect(boundary.dataset.oksPublicFontCapture).toBe('ready')
      expect(boundary.querySelector('.font-selector')).not.toBeNull()
      expect(boundary.querySelector<HTMLInputElement>('.font-search input')?.value).toBe('System')
      expect([...boundary.querySelectorAll(
        '.font-selector__columns label:first-child select option',
      )].map(
        (option) => option.textContent,
      )).toEqual(['System UI', 'System Monospace'])
      expect(boundary.textContent).toContain('This is System UI')
      expect(boundary.textContent).not.toContain(secret)
      expect(boundary.textContent).toContain('Apply & close')
    } finally {
      if (priorDescriptor) Object.defineProperty(window, 'queryLocalFonts', priorDescriptor)
      else delete (window as unknown as Record<string, unknown>).queryLocalFonts
    }
  })

  it('keeps the committed sample while searching and commits an explicitly chosen only result', async () => {
    const fonts = normalizeInstalledFonts([
      {
        family: 'First Family',
        fullName: 'First Family Regular',
        postscriptName: 'FirstFamily-Regular',
        style: 'Regular',
      },
      {
        family: 'Only Search Result',
        fullName: 'Only Search Result Regular',
        postscriptName: 'OnlySearchResult-Regular',
        style: 'Regular',
      },
    ])
    const value = { typeface: fonts[0], fontStyle: fonts[0].faces[0], sizePx: 72 }
    const onTypefaceChange = vi.fn()
    await act(async () => root.render(
      <FontSelector
        value={value}
        fonts={fonts}
        accessState="ready"
        onTypefaceChange={onTypefaceChange}
        onFontStyleChange={() => undefined}
        onSizeChange={() => undefined}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    ))

    const search = container.querySelector<HTMLInputElement>('[placeholder="Search typefaces"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'Only Search',
      )
      search.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Only Search' }))
    })
    const typeface = container.querySelector<HTMLSelectElement>('select')!
    const sample = container.querySelector<HTMLElement>('.font-selector__sample')!
    expect(typeface.value).toBe('')
    expect(sample.textContent).toBe('This is First Family')
    expect(onTypefaceChange).not.toHaveBeenCalled()

    await act(async () => {
      typeface.value = fontTypefaceKey(fonts[1])
      typeface.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onTypefaceChange).toHaveBeenCalledOnce()
    expect(onTypefaceChange).toHaveBeenCalledWith(fonts[1])
  })

  it('replaces a retired catalog only through an explicit Typeface action', async () => {
    const installed = normalizeInstalledFonts([{
      family: 'Moving Family',
      fullName: 'Moving Family New Bold',
      postscriptName: 'MovingFamily-NewBold',
      style: 'New Bold',
    }])
    const retiredFace = {
      fullName: 'Moving Family Retired Demi',
      style: 'Retired Demi',
      postscriptName: 'MovingFamily-RetiredDemi',
      weight: 600,
      slant: 'normal' as const,
    }
    const onTypefaceChange = vi.fn()
    const onFontStyleChange = vi.fn()
    const onSizeChange = vi.fn()
    await act(async () => root.render(
      <FontSelector
        value={{
          typeface: { kind: 'local', family: 'Moving Family', faces: [retiredFace] },
          fontStyle: retiredFace,
          sizePx: 72,
        }}
        fonts={installed}
        accessState="ready"
        onTypefaceChange={onTypefaceChange}
        onFontStyleChange={onFontStyleChange}
        onSizeChange={onSizeChange}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    ))

    expect(onTypefaceChange).not.toHaveBeenCalled()
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('Use installed Moving Family'))
        ?.click()
    })
    expect(onTypefaceChange).toHaveBeenCalledWith(installed[0])
    expect(onFontStyleChange).not.toHaveBeenCalled()
    expect(onSizeChange).not.toHaveBeenCalled()
  })

  it('enables vocal typeface, style, and size overrides independently', async () => {
    const project = createProject()
    const style = cloneVocalStyle()
    const resolved = resolveVocalStyle(project.stageStyle.lyrics, style)
    const changedStyles: Array<typeof style> = []
    const onChange = vi.fn((mutation: (next: typeof style) => void) => {
      const next = cloneVocalStyle(style)
      mutation(next)
      changedStyles.push(next)
    })
    await act(async () => root.render(
      <VocalStylePane
        track={project.tracks[0]}
        style={style}
        resolved={resolved}
        projectLyrics={project.stageStyle.lyrics}
        syncValid
        onChange={onChange}
        onChooseFont={() => undefined}
      />,
    ))

    const toggle = async (label: string) => {
      const control = [...container.querySelectorAll<HTMLLabelElement>('label')]
        .find((candidate) => candidate.textContent?.includes(label))
        ?.querySelector<HTMLInputElement>('input')
      if (!control) throw new Error(`Missing ${label} toggle`)
      await act(async () => control.click())
      return changedStyles.at(-1)!
    }

    const typefaceOnly = await toggle('Use project typeface')
    expect(typefaceOnly.typeface).toEqual(resolved.typeface)
    expect(typefaceOnly.fontStyle).toBeNull()
    expect(typefaceOnly.sizePx).toBeNull()

    const styleOnly = await toggle('Use project style')
    expect(styleOnly.typeface).toBeNull()
    expect(styleOnly.fontStyle).toEqual(resolved.fontStyle)
    expect(styleOnly.sizePx).toBeNull()

    const sizeOnly = await toggle('Use project size')
    expect(sizeOnly.typeface).toBeNull()
    expect(sizeOnly.fontStyle).toBeNull()
    expect(sizeOnly.sizePx).toBe(resolved.sizePx)
  })
})
