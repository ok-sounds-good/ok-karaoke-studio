// @vitest-environment happy-dom

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncAidCue } from '../src/components/KaraokePreview'
import {
  SYNC_AID_GEOMETRY,
  syncAidBrightness,
  syncAidPosition,
} from '../src/lib/sync-aid-geometry'
import { STAGE_LAYOUT } from '../src/lib/stage-layout'
import {
  cloneStageStyle,
  cloneVocalStyle,
  resolveVocalStyle,
  type VocalAlignment,
} from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const { installKaraokeRuntime } = require('../electron/video-style-render-runtime.cjs') as {
  installKaraokeRuntime(): void
}

interface RuntimeWindow extends Window {
  prepareKaraokeAssets(runtime: Record<string, unknown>): Promise<unknown>
  renderKaraokeFrame(state: Record<string, unknown>, sequence: number): boolean
}

const leadingEdges = {
  left: 128,
  center: 710,
  right: 1_292,
} as const

const defaultStageStyle = cloneStageStyle()
const hiddenRuntimeText = { ...defaultStageStyle.stageFrame.brand, visible: false }

function runtimeLineStyle(alignment: VocalAlignment) {
  const vocal = cloneVocalStyle()
  vocal.alignment = alignment
  return {
    ...resolveVocalStyle(defaultStageStyle.lyrics, vocal),
    color: defaultStageStyle.lyrics.unsungColor,
  }
}

function rectangle(left: number, width: number) {
  return {
    bottom: 100,
    height: 100,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }
}

describe('sync-aid physical geometry', () => {
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
    vi.restoreAllMocks()
  })

  it.each(Object.entries(leadingEdges))(
    'starts fully off-stage and ends 24 logical px before %s lyrics in Preview',
    async (alignment, leadingEdgePx) => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList.contains('karaoke-stage')) {
          return rectangle(0, SYNC_AID_GEOMETRY.stageWidth)
        }
        if (this.classList.contains('stage-line__text')) return rectangle(leadingEdgePx, 500)
        return rectangle(0, 0)
      })
      await act(async () => root.render(
        <div className="karaoke-stage">
          <span className="stage-line__text" data-sync-line="track:line">Lyrics</span>
          <SyncAidCue
            alignment={alignment as keyof typeof leadingEdges}
            color="#22D3EE"
            lineKey="track:line"
            progress={1}
          />
        </div>,
      ))

      const cue = container.querySelector<HTMLElement>('.sync-aid')!
      const position = syncAidPosition(leadingEdgePx)
      expect(position.startLeftPx + SYNC_AID_GEOMETRY.cueWidthPx).toBeLessThanOrEqual(0)
      expect(position.travelPx).toBeGreaterThanOrEqual(SYNC_AID_GEOMETRY.minimumTravelPx)
      expect(position.endLeftPx + SYNC_AID_GEOMETRY.cueWidthPx).toBe(
        leadingEdgePx - SYNC_AID_GEOMETRY.gapPx,
      )
      expect(cue.style.getPropertyValue('--sync-start')).toBe(
        `${position.startLeftPx / 19.2}cqw`,
      )
      expect(cue.style.getPropertyValue('--sync-end')).toBe(`${position.endLeftPx / 19.2}cqw`)
      expect(cue.style.getPropertyValue('--sync-travel')).toBe(`${position.travelPx / 19.2}cqw`)
    },
  )

  it.each(Object.entries(leadingEdges))(
    'uses the same measured destination for %s lyrics in the MP4 runtime',
    async (alignment, leadingEdgePx) => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.id === 'scene') return rectangle(0, SYNC_AID_GEOMETRY.stageWidth)
        if (this.classList.contains('lyric-text')) return rectangle(leadingEdgePx, 500)
        return rectangle(0, 0)
      })
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
      document.body.innerHTML = `
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
      runtimeWindow.renderKaraokeFrame({
        artist: 'Artist',
        lines: [{
          id: 'line',
          trackId: 'track',
          style: {
            ...runtimeLineStyle(alignment as VocalAlignment),
            sungColor: '#22D3EE',
            unsungColor: '#123456',
          },
          words: [{ progress: 0, text: 'Lyrics' }],
        }],
        playbackMs: 0,
        showTitle: false,
        stageStyle: {
          background: { mode: 'solid', solidColor: '#000000' },
          stageFrame: {
            enabled: false,
            lineColor: '#000000',
            lineWidthPx: 0,
            brand: hiddenRuntimeText,
            clock: hiddenRuntimeText,
            footer: hiddenRuntimeText,
          },
          titleCard: {},
        },
        syncAids: [{
          lineId: 'line',
          progress: 1,
          style: { alignment, sungColor: '#22D3EE' },
          trackId: 'track',
        }],
        title: 'Title',
      }, 1)

      const indicator = document.querySelector<HTMLElement>('.sync i')!
      const position = syncAidPosition(leadingEdgePx)
      expect(indicator.style.left).toBe(`${position.startLeftPx}px`)
      expect(indicator.style.transform).toBe(`translateX(${position.travelPx}px)`)
      expect(position.endLeftPx + SYNC_AID_GEOMETRY.cueWidthPx).toBe(
        leadingEdgePx - SYNC_AID_GEOMETRY.gapPx,
      )
    },
  )

  it('uses three fixed brightness steps without translation under reduced motion', async () => {
    expect([0.1, 0.5, 0.9].map(syncAidBrightness)).toEqual([0.35, 0.65, 1])
    const leadingEdgePx = leadingEdges.center
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.id === 'scene') return rectangle(0, SYNC_AID_GEOMETRY.stageWidth)
      if (this.classList.contains('lyric-text')) return rectangle(leadingEdgePx, 500)
      return rectangle(0, 0)
    })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    document.body.innerHTML = `
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
    const state = {
      artist: 'Artist',
      lines: [{
        id: 'line',
        trackId: 'track',
        style: {
          ...runtimeLineStyle('center'),
          sungColor: '#22D3EE',
          unsungColor: '#123456',
        },
        words: [{ progress: 0, text: 'Lyrics' }],
      }],
      playbackMs: 0,
      showTitle: false,
      stageStyle: {
        background: { mode: 'solid', solidColor: '#000000' },
        stageFrame: {
          enabled: false,
          lineColor: '#000000',
          lineWidthPx: 0,
          brand: hiddenRuntimeText,
          clock: hiddenRuntimeText,
          footer: hiddenRuntimeText,
        },
        titleCard: {},
      },
      syncAids: [{
        lineId: 'line',
        progress: 0.1,
        style: { alignment: 'center', sungColor: '#22D3EE' },
        trackId: 'track',
      }],
      title: 'Title',
    }
    runtimeWindow.renderKaraokeFrame(state, 1)
    const indicator = document.querySelector<HTMLElement>('.sync i')!
    expect(indicator.style.left).toBe(`${syncAidPosition(leadingEdgePx).endLeftPx}px`)
    expect(indicator.style.transform).toBe('none')
    expect(indicator.style.opacity).toBe('0.35')
    state.syncAids[0].progress = 0.5
    runtimeWindow.renderKaraokeFrame(state, 2)
    expect(indicator.style.opacity).toBe('0.65')
    state.syncAids[0].progress = 0.9
    runtimeWindow.renderKaraokeFrame(state, 3)
    expect(indicator.style.opacity).toBe('1')

    const liveCss = readFileSync(join(process.cwd(), 'src/stage-rendering.css'), 'utf8')
    expect(liveCss).toMatch(
      /prefers-reduced-motion:[\s\S]*left:\s*var\(--sync-end\)[\s\S]*transform:\s*none/,
    )
    expect(liveCss).toMatch(/prefers-reduced-motion:[\s\S]*opacity:\s*var\(--sync-brightness\)/)
  })
})
