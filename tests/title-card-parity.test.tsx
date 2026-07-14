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

const require = createRequire(import.meta.url)
const { frameStateAt } = require('../electron/video-export.cjs') as {
  frameStateAt(project: unknown, playbackMs: number): {
    artist: string
    showTitle: boolean
    title: string
  }
}

function projectWithLineLeadIn() {
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
      createVocalTrack({ id: 'lead', lines: [line] }),
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
  it('uses the offset-adjusted line lead-in rather than the later first word', () => {
    const project = projectWithLineLeadIn()

    // The first word starts at 3800 ms in playback time. With the 3000 ms
    // preview, the title yields at 800 ms; the earlier line boundary is not used.
    for (const playbackMs of [799, 800, 1_299]) {
      expect(previewShowsTitle(playbackMs)).toBe(frameStateAt(project, playbackMs).showTitle)
    }
    expect(previewShowsTitle(799)).toBe(true)
    expect(previewShowsTitle(800)).toBe(false)
  })

  it('keeps the title card visible when no valid timed line exists', () => {
    const project = createProject({
      tracks: [createVocalTrack({
        id: 'untimed-title-track',
        lines: [createLyricLine('Still untimed')],
      })],
    })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={0}
        lyricMs={0}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('class="title-card"')
    expect(frameStateAt(project, 0).showTitle).toBe(true)
  })

  it('uses identical title and footer fallbacks when metadata is empty', () => {
    const project = createProject({ artist: '', title: '' })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={0}
        lyricMs={0}
        selectedWordIds={new Set()}
      />,
    )
    const exported = frameStateAt(project, 0)

    expect(exported).toMatchObject({ artist: 'Unknown artist', title: 'Untitled song' })
    expect(markup).toContain('Unknown artist')
    expect(markup).toContain('Untitled song')
    expect(markup).toContain('Unknown artist · Untitled song')
  })
})
