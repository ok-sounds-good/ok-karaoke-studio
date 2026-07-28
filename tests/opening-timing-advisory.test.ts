/** @vitest-environment happy-dom */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { OpeningTimingAdvisory } from '../src/components/OpeningTimingAdvisory'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import {
  openingTimingAdvisoryForProject,
  openingTimingFactsForProject,
} from '../src/lib/stage-frame-state'

describe('opening timing advisory schedule', () => {
  it('reports only temporal title intersections and combines lyric and sync-aid types', () => {
    const project = createProject({
      opening: { leadInMs: 0, titleTiming: { mode: 'fixed', durationMs: 5_000 } },
      tracks: [
        createVocalTrack({
          id: 'lead',
          vocalStyle: {
            ...createVocalTrack({ id: 'style' }).vocalStyle,
            previewMs: 2_000,
            syncAid: { enabled: true, minLeadMs: 500, maxLeadMs: 1_500 },
          },
          lines: [
            createLyricLine('First', {
              startMs: 2_000,
              endMs: 3_000,
              words: [createLyricWord('First', { startMs: 2_000, endMs: 3_000 })],
            }),
          ],
        }),
      ],
    })

    expect(openingTimingAdvisoryForProject(project)).toEqual([
      { startMs: 0, endMs: 500, types: ['lyrics'] },
      { startMs: 500, endMs: 2_000, types: ['lyrics', 'sync aids'] },
      { startMs: 2_000, endMs: 3_000, types: ['lyrics'] },
    ])
  })

  it('has no advisory for an until-lyrics handoff or a title that ends before output lyrics', () => {
    const project = createProject({
      tracks: [
        createVocalTrack({
          id: 'lead',
          lines: [
            createLyricLine('First', {
              startMs: 2_000,
              endMs: 3_000,
              words: [createLyricWord('First', { startMs: 2_000, endMs: 3_000 })],
            }),
          ],
        }),
      ],
    })
    expect(openingTimingAdvisoryForProject(project)).toEqual([])
    project.opening = { leadInMs: 0, titleTiming: { mode: 'fixed', durationMs: 0 } }
    expect(openingTimingAdvisoryForProject(project)).toEqual([])
  })

  it('clamps output intervals at lead-in and discards lyric windows finished before output', () => {
    const line = (startMs: number, endMs: number) =>
      createLyricLine('Offset', {
        startMs,
        endMs,
        words: [createLyricWord('Offset', { startMs, endMs })],
      })
    const project = createProject({
      offsetMs: -1_500,
      opening: { leadInMs: 1_000, titleTiming: { mode: 'fixed', durationMs: 4_000 } },
      tracks: [createVocalTrack({ id: 'lead', lines: [line(0, 500), line(1_000, 3_000)] })],
    })
    expect(openingTimingAdvisoryForProject(project)).toEqual([
      { startMs: 1_000, endMs: 2_500, types: ['lyrics'] },
    ])
  })

  it('reports the full queued Scroll overlap against a fixed title', () => {
    const line = (text: string, startMs: number, endMs: number) =>
      createLyricLine(text, {
        startMs,
        endMs,
        words: [createLyricWord(text, { startMs, endMs })],
      })
    const project = createProject({
      opening: { leadInMs: 0, titleTiming: { mode: 'fixed', durationMs: 1_000 } },
      lyricDisplay: { lineCount: 1, advanceMode: 'scroll' },
      tracks: [
        createVocalTrack({
          id: 'lead',
          vocalStyle: {
            ...createVocalTrack({ id: 'style' }).vocalStyle,
            previewMs: 0,
            syncAid: { enabled: false, minLeadMs: 0, maxLeadMs: 0 },
          },
          lines: [
            line('One', 0, 100),
            line('Two', 100, 200),
            line('Three', 200, 300),
            line('Four', 300, 400),
          ],
        }),
      ],
    })

    expect(openingTimingAdvisoryForProject(project)).toEqual([
      { startMs: 0, endMs: 1_000, types: ['lyrics'] },
    ])
  })

  it('does not let a blank-section reset retain discarded Scroll windows in the advisory', () => {
    const line = (text: string, startMs: number, endMs: number) =>
      createLyricLine(text, {
        startMs,
        endMs,
        words: [createLyricWord(text, { startMs, endMs })],
      })
    const project = createProject({
      opening: { leadInMs: 0, titleTiming: { mode: 'fixed', durationMs: 1_000 } },
      lyricDisplay: { lineCount: 1, advanceMode: 'scroll' },
      tracks: [
        createVocalTrack({
          id: 'lead',
          vocalStyle: {
            ...createVocalTrack({ id: 'style' }).vocalStyle,
            previewMs: 0,
            syncAid: { enabled: false, minLeadMs: 0, maxLeadMs: 0 },
          },
          lines: [
            line('One', 0, 100),
            line('Two', 100, 200),
            line('Three', 200, 900),
            line('Discarded', 300, 400),
            createLyricLine('', { words: [] }),
            line('Reset', 500, 600),
          ],
        }),
      ],
    })

    expect(openingTimingAdvisoryForProject(project)).toEqual([
      { startMs: 0, endMs: 600, types: ['lyrics'] },
    ])
  })

  it('retains the last settled advisory during sync defer and resets dismissal on replacement', () => {
    const rootNode = document.createElement('div')
    const root = createRoot(rootNode)
    const interval = [{ startMs: 1_000, endMs: 2_000, types: ['lyrics'] as const }]
    const render = (deferred: boolean, intervals = interval, sessionKey = 'one') =>
      act(() =>
        root.render(
          createElement(OpeningTimingAdvisory, {
            deferred,
            intervals,
            sessionKey,
            onReview: () => undefined,
          }),
        ),
      )
    render(false)
    expect(rootNode.textContent).toContain('Title overlaps')
    act(() => rootNode.querySelector<HTMLButtonElement>('button:last-child')!.click())
    expect(rootNode.textContent).toBe('')
    render(true, [{ startMs: 3_000, endMs: 4_000, types: ['sync aids'] }])
    expect(rootNode.textContent).toBe('')
    render(false, [{ startMs: 3_000, endMs: 4_000, types: ['sync aids'] }])
    expect(rootNode.textContent).toContain('sync aids')
    render(false, [{ startMs: 3_000, endMs: 4_000, types: ['sync aids'] }], 'reopened')
    expect(rootNode.textContent).toContain('Title overlaps')
    act(() => root.unmount())
  })

  it('reports facts from output-eligible mute/solo-aware windows only', () => {
    const project = createProject({
      opening: { leadInMs: 1_000, titleTiming: { mode: 'until-lyrics' } },
      tracks: [
        createVocalTrack({ id: 'muted', muted: true, lines: [createLyricLine('Muted')] }),
        createVocalTrack({ id: 'solo', solo: true, lines: [createLyricLine('Solo')] }),
      ],
    })
    expect(openingTimingFactsForProject(project)).toEqual({
      titleEndMs: Number.POSITIVE_INFINITY,
      lyricStartMs: null,
    })
  })
})
