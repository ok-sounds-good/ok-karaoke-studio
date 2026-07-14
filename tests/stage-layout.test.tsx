// @vitest-environment happy-dom

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { createProject } from '../src/lib/karaoke'
import {
  logicalStageLayoutAtWidth,
  lyricGapPx,
  previewStageLayoutVariables,
  STAGE_LAYOUT,
} from '../src/lib/stage-layout'
import {
  cloneStageStyle,
  cloneVocalStyle,
  resolveVocalStyle,
} from '../src/lib/video-style'
import { SYNC_AID_GEOMETRY } from '../src/lib/sync-aid-geometry'

const require = createRequire(import.meta.url)
const packagedLayout = require('../electron/stage-layout.json') as typeof STAGE_LAYOUT
const { installKaraokeRuntime } = require('../electron/video-style-render-runtime.cjs') as {
  installKaraokeRuntime(): void
}
const videoDocument = require('../electron/video-style-document.cjs') as {
  renderDocument(options: { width: number; height: number }): string
}

interface RuntimeWindow extends Window {
  backgroundDataUrl: string
  prepareKaraokeAssets(runtime: Record<string, unknown>): Promise<unknown>
  renderKaraokeFrame(state: Record<string, unknown>, sequence: number): boolean
}

function runtimeText() {
  return { ...cloneStageStyle().stageFrame.brand, visible: false }
}

function runtimeState(lineCount: number, background = cloneStageStyle().background) {
  const stageStyle = cloneStageStyle()
  stageStyle.background = { ...background }
  const lyricStyle = {
    ...resolveVocalStyle(stageStyle.lyrics, cloneVocalStyle()),
    color: stageStyle.lyrics.unsungColor,
  }
  return {
    artist: 'Artist',
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index}`,
      trackId: 'track',
      style: lyricStyle,
      words: [{ progress: 0, text: `Line ${index + 1}` }],
    })),
    playbackMs: 0,
    showTitle: lineCount === 0,
    stageStyle: {
      ...stageStyle,
      stageFrame: {
        ...stageStyle.stageFrame,
        brand: runtimeText(),
        clock: runtimeText(),
        footer: runtimeText(),
      },
    },
    syncAids: [],
    title: 'Title',
  }
}

describe('packaged Preview and MP4 stage layout', () => {
  let container: HTMLDivElement
  let runtimeHost: HTMLDivElement
  let root: Root
  let styleSheet: HTMLStyleElement

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    runtimeHost = document.createElement('div')
    styleSheet = document.createElement('style')
    styleSheet.textContent = [
      '../src/styles.css',
      '../src/identity.css',
      '../src/stage-rendering.css',
      '../src/video-style.css',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
    document.head.append(styleSheet)
    document.body.append(container)
    document.body.append(runtimeHost)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    runtimeHost.remove()
    styleSheet.remove()
  })

  it('imports one JSON contract and scales its logical 1080p geometry to 1280 by 720', () => {
    expect(STAGE_LAYOUT).toEqual(packagedLayout)
    expect(STAGE_LAYOUT.stage).toEqual({ widthPx: 1_920, heightPx: 1_080 })
    expect([1, 2, 3, 4, 5].map(lyricGapPx)).toEqual([35, 32, 29, 26, 23])

    const variables = previewStageLayoutVariables(3)
    expect(variables['--stage-content-left']).toBe(`${128 / 19.2}cqw`)
    expect(variables['--stage-lyric-gap']).toBe(`${29 / 19.2}cqw`)
    expect(variables['--stage-title-shadow']).toBe('none')
    expect(variables['--stage-grain-color']).toBe('#000000')

    expect(logicalStageLayoutAtWidth(3, 1_280)).toEqual({
      stage: { widthPx: 1_280, heightPx: 720 },
      content: {
        topPx: 140 * 2 / 3,
        rightPx: 128 * 2 / 3,
        bottomPx: 120 * 2 / 3,
        leftPx: 128 * 2 / 3,
      },
      frame: {
        topPx: 64 * 2 / 3,
        rightPx: 96 * 2 / 3,
        bottomPx: 64 * 2 / 3,
        leftPx: 96 * 2 / 3,
        radiusPx: 20,
      },
      lyricGapPx: 29 * 2 / 3,
      scale: 2 / 3,
    })

    const document = videoDocument.renderDocument({ width: 1_280, height: 720 })
    expect(document).toContain('width: 1920px')
    expect(document).toContain('height: 1080px')
    expect(document).toContain('inset: 64px 96px 64px 96px')
    expect(document).toContain('color: #000000')
    expect(document).toContain('transform: scale(0.6666666666666666, 0.6666666666666666)')
    const sceneCss = document.match(/\.scene\s*\{([^}]*)\}/u)?.[1] ?? ''
    expect(sceneCss).not.toMatch(/border(?:-radius)?\s*:/u)
    expect(sceneCss).not.toMatch(/box-shadow\s*:/u)
  })

  it('uses the packaged lyric gap for every actual runtime line count from one through five', async () => {
    runtimeHost.innerHTML = `
      <div id="scene"><div id="frame"></div><div id="brand"></div><div id="clock"></div>
      <main id="content"></main><div id="syncs"></div><footer id="footer"></footer></div>
    `
    installKaraokeRuntime()
    const runtimeWindow = window as unknown as RuntimeWindow
    await runtimeWindow.prepareKaraokeAssets({
      backgroundDataUrl: '',
      fonts: [],
      stageLayout: STAGE_LAYOUT,
      syncAidGeometry: SYNC_AID_GEOMETRY,
    })

    for (const lineCount of [1, 2, 3, 4, 5]) {
      runtimeWindow.renderKaraokeFrame(runtimeState(lineCount), lineCount)
      expect(runtimeHost.querySelector<HTMLElement>('.lines')?.style.gap).toBe(
        `${STAGE_LAYOUT.lyric.gapsPx[lineCount]}px`,
      )
    }
  })

  it('preserves selected solid, gradient, and linked-image backgrounds in Preview and MP4', async () => {
    const project = createProject()
    project.stageStyle.background = {
      mode: 'solid',
      solidColor: '#123456',
      gradientStartColor: '#234567',
      gradientEndColor: '#345678',
      imagePath: null,
    }
    await act(async () => root.render(
      <KaraokePreview project={project} playbackMs={0} lyricMs={0} selectedWordIds={new Set()} />,
    ))
    const preview = container.querySelector<HTMLElement>('.karaoke-stage')!
    expect(preview.style.background).toBe('#123456')
    expect(preview.style.backgroundImage).not.toMatch(/gradient|url/iu)

    project.stageStyle.background.mode = 'gradient'
    await act(async () => root.render(
      <KaraokePreview project={{ ...project }} playbackMs={0} lyricMs={0} selectedWordIds={new Set()} />,
    ))
    expect(preview.style.background).toContain('linear-gradient(145deg')
    expect(preview.style.background).toContain('#234567')
    expect(preview.style.background).toContain('#345678')
    expect(preview.style.background.match(/linear-gradient/gu)).toHaveLength(1)

    const linkedUrl = 'studio-media://asset/background/stage.png'
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/images/stage.png'
    await act(async () => root.render(
      <KaraokePreview
        project={{ ...project }}
        playbackMs={0}
        lyricMs={0}
        selectedWordIds={new Set()}
        backgroundUrl={linkedUrl}
      />,
    ))
    expect(preview.style.backgroundColor).toBe('#345678')
    expect(preview.style.backgroundImage).toContain(linkedUrl)
    expect(preview.style.backgroundPosition).toContain('center')
    expect(preview.style.backgroundSize).toBe('cover')
    const computedPreview = getComputedStyle(preview)
    expect(computedPreview.borderTopWidth).toBe('0px')
    expect(computedPreview.borderRadius).toBe('0px')
    expect(computedPreview.boxShadow).toBe('none')
    expect(computedPreview.backgroundImage).toContain(linkedUrl)
    expect(computedPreview.backgroundImage).not.toContain('gradient')
    const previewGrain = container.querySelector<HTMLElement>('.karaoke-stage__grain')!
    expect(getComputedStyle(previewGrain).color).toBe(STAGE_LAYOUT.grain.color)
    expect(getComputedStyle(previewGrain).opacity).toBe(String(STAGE_LAYOUT.grain.opacity))

    runtimeHost.innerHTML = `
      <div id="scene"><div id="frame"></div><div id="brand"></div><div id="clock"></div>
      <main id="content"></main><div id="syncs"></div><footer id="footer"></footer></div>
    `
    installKaraokeRuntime()
    const runtimeWindow = window as unknown as RuntimeWindow
    await runtimeWindow.prepareKaraokeAssets({
      backgroundDataUrl: '',
      fonts: [],
      stageLayout: STAGE_LAYOUT,
      syncAidGeometry: SYNC_AID_GEOMETRY,
    })
    runtimeWindow.backgroundDataUrl = linkedUrl
    runtimeWindow.renderKaraokeFrame(runtimeState(0, project.stageStyle.background), 1)
    const exported = runtimeHost.querySelector<HTMLElement>('#scene')!
    expect(exported.style.backgroundColor).toBe('#345678')
    expect(exported.style.backgroundImage).toContain(linkedUrl)
    expect(exported.style.backgroundPosition).toContain('center')
    expect(exported.style.backgroundSize).toBe('cover')
  })
})
