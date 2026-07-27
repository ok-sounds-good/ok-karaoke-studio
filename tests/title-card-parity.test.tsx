import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { KaraokePreview } from '../src/components/KaraokePreview'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import { cloneVocalStyle } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const { frameStateAt } = require('../electron/video-export.cjs') as {
  frameStateAt(project: unknown, playbackMs: number): { showTitle: boolean; lines: unknown[] }
}

function projectWithLineLeadIn() {
  const vocalStyle = cloneVocalStyle()
  vocalStyle.previewMs = 1_500
  vocalStyle.syncAid = { enabled: false, minLeadMs: 1_000, maxLeadMs: 1_500 }
  const mutedEarlierLine = createLyricLine('Muted count-in', {
    startMs: 0,
    endMs: 500,
    words: [createLyricWord('Muted', { startMs: 0, endMs: 500 })],
  })
  const line = createLyricLine('Wait for me', {
    id: 'line-with-lead-in',
    startMs: 2_000,
    endMs: 4_500,
    words: [
      createLyricWord('Wait', { startMs: 3_000, endMs: 3_500 }),
      createLyricWord('for', { startMs: 3_500, endMs: 4_000 }),
      createLyricWord('me', { startMs: 4_000, endMs: 4_500 }),
    ],
  })
  return createProject({
    offsetMs: 800,
    tracks: [
      createVocalTrack({ id: 'muted', muted: true, lines: [mutedEarlierLine] }),
      createVocalTrack({ id: 'lead', vocalStyle, lines: [line] }),
    ],
  })
}

function previewShowsTitle(playbackMs: number) {
  const project = projectWithLineLeadIn()
  const markup = renderToStaticMarkup(
    <KaraokePreview
      project={project}
      playbackMs={playbackMs}
      lyricMs={playbackMs - project.offsetMs}
      selectedWordIds={new Set()}
    />,
  )
  return markup.includes('class="title-card"')
}

describe('Live Preview and MP4 title-card parity', () => {
  it('uses Preview time before the first sung word rather than an earlier line range', () => {
    const project = projectWithLineLeadIn()

    // The first word starts at 3800 ms after offset, so 1500 ms Preview ends the title at 2300 ms.
    for (const playbackMs of [2_299, 2_300]) {
      expect(previewShowsTitle(playbackMs)).toBe(frameStateAt(project, playbackMs).showTitle)
    }
    expect(previewShowsTitle(2_299)).toBe(true)
    expect(previewShowsTitle(2_300)).toBe(false)
  })

  it('keeps the title card visible when no valid timed line exists', () => {
    const project = createProject({
      tracks: [createVocalTrack({ id: 'untimed-lead', lines: [createLyricLine('Still untimed')] })],
    })
    const markup = renderToStaticMarkup(
      <KaraokePreview project={project} playbackMs={0} lyricMs={0} selectedWordIds={new Set()} />,
    )

    expect(markup).toContain('class="title-card"')
    expect(frameStateAt(project, 0).showTitle).toBe(true)
  })

  it('gates lyrics and preserves the title at the opening boundary', () => {
    const project = projectWithLineLeadIn()
    project.opening = { leadInMs: 2_000, titleTiming: { mode: 'until-lyrics' } }
    const before = frameStateAt(project, 1_999)
    const at = frameStateAt(project, 2_000)

    expect(before.lines).toEqual([])
    expect(before.showTitle).toBe(true)
    expect(at.showTitle).toBe(true)
  })

  it('keeps the title when every timed lyric window has expired before the opening', () => {
    const project = createProject({
      offsetMs: -2_000,
      opening: { leadInMs: 1_000, titleTiming: { mode: 'until-lyrics' } },
      lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
      tracks: [
        createVocalTrack({
          id: 'expired-track',
          lines: [
            createLyricLine('Already gone', {
              startMs: 0,
              endMs: 500,
              words: [createLyricWord('Already', { startMs: 0, endMs: 500 })],
            }),
          ],
        }),
      ],
    })

    for (const playbackMs of [1_000, 3_000]) {
      const state = frameStateAt(project, playbackMs)
      expect(state.showTitle).toBe(true)
      expect(state.lines).toEqual([])
    }
  })

  it('keeps the title when the only lyric window completes exactly at the opening', () => {
    const project = createProject({
      offsetMs: -500,
      opening: { leadInMs: 1_000, titleTiming: { mode: 'until-lyrics' } },
      lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
      tracks: [
        createVocalTrack({
          id: 'opening-equality-track',
          lines: [
            createLyricLine('Exactly finished', {
              startMs: 0,
              endMs: 500,
              words: [createLyricWord('Exactly', { startMs: 0, endMs: 500 })],
            }),
          ],
        }),
      ],
    })

    for (const playbackMs of [1_000, 1_001, 3_000]) {
      const state = frameStateAt(project, playbackMs)
      expect(state.showTitle).toBe(true)
      expect(state.lines).toEqual([])
    }
  })

  it('waits for the later eligible window when an earlier window is already expired', () => {
    const vocalStyle = cloneVocalStyle()
    vocalStyle.previewMs = 1_500
    vocalStyle.syncAid = { enabled: false, minLeadMs: 1_000, maxLeadMs: 1_500 }
    const project = createProject({
      offsetMs: -2_000,
      opening: { leadInMs: 1_000, titleTiming: { mode: 'until-lyrics' } },
      lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
      tracks: [
        createVocalTrack({
          id: 'later-track',
          vocalStyle,
          lines: [
            createLyricLine('Expired', {
              startMs: 0,
              endMs: 500,
              words: [createLyricWord('Expired', { startMs: 0, endMs: 500 })],
            }),
            createLyricLine('Later', {
              startMs: 5_000,
              endMs: 5_500,
              words: [createLyricWord('Later', { startMs: 5_000, endMs: 5_500 })],
            }),
          ],
        }),
      ],
    })

    expect(frameStateAt(project, 2_499).showTitle).toBe(true)
    expect(frameStateAt(project, 2_500).showTitle).toBe(false)
  })
})
