// @vitest-environment happy-dom

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KaraokePreview } from '../src/components/KaraokePreview'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import {
  cloneFontFace,
  cloneStageStyle,
  cloneTypeface,
  cloneVocalStyle,
  genericFontFace,
  SYSTEM_MONOSPACE_TYPEFACE,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
} from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const videoDomain = require('../electron/video-style-domain.cjs') as {
  frameStateAt(project: unknown, playbackMs: number): {
    stageStyle: ReturnType<typeof cloneStageStyle>
    lines: Array<{ id: string; trackId: string; style: Record<string, unknown> }>
    syncAids: Array<{ lineId: string; trackId: string }>
  }
}
const { installKaraokeRuntime } = require('../electron/video-style-render-runtime.cjs') as {
  installKaraokeRuntime(): void
}

interface RuntimeWindow extends Window {
  prepareKaraokeAssets(runtime: Record<string, unknown>): Promise<{
    fontFallbacks: Array<{ requested: string; effective: string }>
  }>
}

describe('persisted stage style rendering parity', () => {
  let container: HTMLDivElement
  let root: Root
  let style: HTMLStyleElement

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    style = document.createElement('style')
    style.textContent = [
      '../src/styles.css',
      '../src/identity.css',
      '../src/stage-rendering.css',
      '../src/video-style.css',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
    document.head.append(style)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    style.remove()
    vi.unstubAllGlobals()
  })

  it('lets configured lyric and frame values win in Preview and reach MP4 unchanged', async () => {
    const stageStyle = cloneStageStyle()
    stageStyle.lyrics.typeface = cloneTypeface(SYSTEM_MONOSPACE_TYPEFACE)
    stageStyle.lyrics.fontStyle = cloneFontFace(
      genericFontFace(SYSTEM_MONOSPACE_TYPEFACE, 'Bold'),
    )
    stageStyle.lyrics.sizePx = 96
    stageStyle.lyrics.unsungColor = '#123456'
    stageStyle.stageFrame.lineColor = '#654321'
    stageStyle.stageFrame.lineWidthPx = 7
    const word = createLyricWord('Grounded', { startMs: 5_000, endMs: 6_000 })
    const line = createLyricLine('Grounded', {
      startMs: 5_000,
      endMs: 6_000,
      words: [word],
    })
    const project = createProject({
      stageStyle,
      tracks: [createVocalTrack({ lines: [line] })],
    })

    await act(async () => root.render(
      <KaraokePreview
        project={project}
        playbackMs={2_500}
        lyricMs={2_500}
        selectedWordIds={new Set()}
      />,
    ))

    const stage = container.querySelector<HTMLElement>('.karaoke-stage')!
    const lineNode = container.querySelector<HTMLElement>('.stage-line')!
    const paragraph = container.querySelector<HTMLElement>('.stage-line p')!
    const wordNode = container.querySelector<HTMLElement>('.stage-word')!
    const frame = container.querySelector<HTMLElement>('.karaoke-stage__safe-area')!
    expect(lineNode.style.getPropertyValue('--lyric-font-size')).toBe('5cqw')
    expect(lineNode.style.fontWeight).toBe('700')
    expect(lineNode.style.fontFamily).toContain('ui-monospace')
    expect(lineNode.style.getPropertyValue('--unsung-color')).toBe('#123456')
    expect(stage.style.getPropertyValue('--stage-frame-color')).toBe('#654321')
    expect(stage.style.getPropertyValue('--stage-frame-width')).toBe(`${7 / 19.2}cqw`)
    expect(getComputedStyle(lineNode).fontWeight).toBe('700')
    expect(getComputedStyle(paragraph).fontWeight).toBe('inherit')
    expect(getComputedStyle(wordNode).color).toBe('#123456')
    expect(getComputedStyle(frame).borderTopColor).toBe('#654321')

    const exported = videoDomain.frameStateAt(project, 2_500)
    expect(exported.lines[0].style).toMatchObject({
      typeface: expect.objectContaining({ kind: 'system-monospace' }),
      fontStyle: expect.objectContaining({ style: 'Bold', weight: 700 }),
      sizePx: 96,
      unsungColor: '#123456',
    })
    expect(exported.stageStyle.stageFrame).toMatchObject({
      lineColor: '#654321',
      lineWidthPx: 7,
    })
  })

  it('keeps a retired saved face on the same fallback until Typeface replacement is explicit', async () => {
    const retiredFace: FontFaceDescriptor = {
      fullName: 'Moving Family Retired Demi',
      style: 'Retired Demi',
      postscriptName: 'MovingFamily-RetiredDemi',
      weight: 600,
      slant: 'normal',
    }
    const retiredTypeface: FontTypefaceDescriptor = {
      kind: 'local',
      family: 'Moving Family',
      faces: [retiredFace],
    }
    const installedFace: FontFaceDescriptor = {
      fullName: 'Moving Family New Bold',
      style: 'New Bold',
      postscriptName: 'MovingFamily-NewBold',
      weight: 700,
      slant: 'normal',
    }
    const installedTypeface: FontTypefaceDescriptor = {
      kind: 'local',
      family: 'Moving Family',
      faces: [installedFace],
    }
    const sources: string[] = []
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    })
    vi.stubGlobal('FontFace', class {
      private readonly source: string

      constructor(_family: string, source: string) {
        this.source = source
        sources.push(source)
      }

      async load() {
        if (this.source.includes('Retired')) throw new Error('retired')
        return this
      }
    })

    const stageStyle = cloneStageStyle()
    stageStyle.lyrics.typeface = cloneTypeface(retiredTypeface)
    stageStyle.lyrics.fontStyle = cloneFontFace(retiredFace)
    const line = createLyricLine('Catalog parity', {
      startMs: 5_000,
      endMs: 6_000,
      words: [createLyricWord('Catalog', { startMs: 5_000, endMs: 6_000 })],
    })
    const project = createProject({
      stageStyle,
      tracks: [createVocalTrack({ lines: [line] })],
    })
    await act(async () => {
      root.render(
        <KaraokePreview
          project={project}
          playbackMs={2_500}
          lyricMs={2_500}
          selectedWordIds={new Set()}
        />,
      )
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(container.textContent).toContain(
      'Requested font Moving Family Retired Demi is unavailable; previewing with System UI.',
    )
    expect(container.querySelector<HTMLElement>('.stage-line')?.style.fontFamily).toContain(
      'system-ui',
    )

    installKaraokeRuntime()
    const runtimeWindow = window as unknown as RuntimeWindow
    await expect(runtimeWindow.prepareKaraokeAssets({
      backgroundDataUrl: '',
      fonts: [{ typeface: retiredTypeface, fontStyle: retiredFace }],
    })).resolves.toEqual({
      fontFallbacks: [{
        requested: 'Moving Family Retired Demi',
        effective: 'System UI',
      }],
    })

    const replacementStage = cloneStageStyle(stageStyle)
    replacementStage.lyrics.typeface = cloneTypeface(installedTypeface)
    const replacement = {
      ...project,
      stageStyle: replacementStage,
    }
    await act(async () => {
      root.render(
        <KaraokePreview
          project={replacement}
          playbackMs={2_500}
          lyricMs={2_500}
          selectedWordIds={new Set()}
        />,
      )
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    const previewLine = container.querySelector<HTMLElement>('.stage-line')!
    expect(previewLine.style.fontWeight).toBe('700')
    expect(previewLine.style.fontFamily).toMatch(/oks-local-/u)
    expect(container.textContent).not.toContain('Retired Demi is unavailable')
    expect(replacement.stageStyle.lyrics.fontStyle).toEqual(retiredFace)

    const frame = videoDomain.frameStateAt(replacement, 2_500)
    expect(frame.lines[0].style).toMatchObject({
      typeface: installedTypeface,
      fontStyle: installedFace,
    })
    installKaraokeRuntime()
    await expect(runtimeWindow.prepareKaraokeAssets({
      backgroundDataUrl: '',
      fonts: [{ typeface: installedTypeface, fontStyle: retiredFace }],
    })).resolves.toEqual({ fontFallbacks: [] })
    expect(sources).toContain('local("MovingFamily-RetiredDemi")')
    expect(sources).toContain('local("MovingFamily-NewBold")')
  })

  it('emits sync aids only for globally admitted track-line entries', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        add: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ready: Promise.resolve(),
      },
    })
    const makeTrack = (trackId: string, lineId: string, startMs: number) => {
      const vocalStyle = cloneVocalStyle()
      vocalStyle.syncAid.enabled = true
      return createVocalTrack({
        id: trackId,
        name: trackId,
        vocalStyle,
        lines: [createLyricLine(lineId, {
          id: lineId,
          startMs,
          endMs: startMs + 1_000,
          words: [createLyricWord(lineId, {
            id: `${lineId}-word`,
            startMs,
            endMs: startMs + 1_000,
          })],
        })],
      })
    }
    const lead = makeTrack('lead', 'lead-line', 5_000)
    const harmony = makeTrack('harmony', 'harmony-line', 5_000)
    const project = createProject({
      lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
      tracks: [lead, harmony],
    })

    await act(async () => root.render(
      <KaraokePreview
        project={project}
        playbackMs={2_000}
        lyricMs={2_000}
        selectedWordIds={new Set()}
      />,
    ))
    expect([...container.querySelectorAll<HTMLElement>('.sync-aid')]
      .map((node) => node.dataset.syncLine)).toEqual(['lead:lead-line'])
    expect(videoDomain.frameStateAt(project, 2_000)).toMatchObject({
      lines: [{ trackId: 'lead', id: 'lead-line' }],
      syncAids: [{ trackId: 'lead', lineId: 'lead-line' }],
    })

    lead.muted = true
    harmony.solo = true
    const selected = { ...project, tracks: [{ ...lead }, { ...harmony }] }
    await act(async () => root.render(
      <KaraokePreview
        project={selected}
        playbackMs={2_000}
        lyricMs={2_000}
        selectedWordIds={new Set()}
      />,
    ))
    expect([...container.querySelectorAll<HTMLElement>('.sync-aid')]
      .map((node) => node.dataset.syncLine)).toEqual(['harmony:harmony-line'])
    expect(videoDomain.frameStateAt(selected, 2_000)).toMatchObject({
      lines: [{ trackId: 'harmony', id: 'harmony-line' }],
      syncAids: [{ trackId: 'harmony', lineId: 'harmony-line' }],
    })
  })

  it.each(['clear', 'scroll'] as const)(
    'matches the timed-only Preview window in MP4 %s planning',
    async (advanceMode) => {
      const untimed = createLyricLine('Untimed neighbor', { id: 'untimed-neighbor' })
      const timed = createLyricLine('Timed line', {
        id: 'timed-line',
        startMs: 5_000,
        endMs: 6_000,
        words: [createLyricWord('Timed', {
          id: 'timed-word',
          startMs: 5_000,
          endMs: 6_000,
        })],
      })
      const project = createProject({
        lyricDisplay: { lineCount: 2, advanceMode },
        tracks: [createVocalTrack({ lines: [untimed, timed] })],
      })

      await act(async () => root.render(
        <KaraokePreview
          project={project}
          playbackMs={2_000}
          lyricMs={2_000}
          selectedWordIds={new Set()}
        />,
      ))
      expect([...container.querySelectorAll('.stage-line p')]
        .map((node) => node.textContent?.trim())).toEqual(['Timed'])
      expect(videoDomain.frameStateAt(project, 2_000).lines.map(({ id }) => id)).toEqual([
        'timed-line',
      ])
    },
  )
})
