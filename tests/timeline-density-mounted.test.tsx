/** @vitest-environment happy-dom */

import { act } from 'react'
import { describe, expect, it } from 'vitest'

import { Timeline } from '../src/components/Timeline'
import { createLyricLine, createLyricWord, createProject, createVocalTrack } from '../src/lib/model'
import {
  DENSITY_TRACK_COUNT,
  createMaximumDensityProject,
} from './support/timeline-density-fixture'
import { mountTimeline } from './support/timeline-mounted-harness'

describe('mounted Timeline density budget', () => {
  it('keeps all 150k logical words selectable while mounting at most 96 timing buttons per track', () => {
    const project = createMaximumDensityProject()
    const allIds = new Set(
      project.tracks.flatMap((track) =>
        track.lines.flatMap((line) => line.words.map((word) => word.id)),
      ),
    )
    expect(allIds).toHaveLength(150_000)
    const scope = mountTimeline(
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={project.durationMs!}
        currentMs={0}
        zoom={1}
        activeTrackId={project.tracks[0]!.id}
        selectedWordIds={allIds}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={() => undefined}
        onShiftWords={() => undefined}
        onResizeWord={() => undefined}
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />,
    )

    expect(scope.querySelectorAll('.timeline-word')).toHaveLength(DENSITY_TRACK_COUNT * 96)
    expect(scope.querySelectorAll('.timeline-word__handle')).toHaveLength(
      DENSITY_TRACK_COUNT * 96 * 2,
    )
    expect(scope.querySelectorAll('.timeline-line-label')).toHaveLength(DENSITY_TRACK_COUNT * 96)
    expect(scope.querySelectorAll('.timeline-density-aggregate')).toHaveLength(DENSITY_TRACK_COUNT)
    expect(scope.querySelectorAll('.timeline-word.is-selected').length).toBeGreaterThan(0)
    expect(scope.querySelectorAll('.timeline-word.is-selected').length).toBeLessThanOrEqual(
      DENSITY_TRACK_COUNT * 96,
    )
    expect(scope.querySelectorAll('.timeline-line-label__word.is-selected').length).toBeGreaterThan(
      0,
    )
    expect(
      scope.querySelectorAll('.timeline-line-label__word.is-selected').length,
    ).toBeLessThanOrEqual(DENSITY_TRACK_COUNT * 96)
  })

  it('anchors aggregate feedback inside the current lane viewport at the start, middle, and end', () => {
    const project = createProject({
      durationMs: 3_000,
      tracks: [
        createVocalTrack({
          id: 'dense-vertical',
          lines: Array.from({ length: 160 }, (_, ordinal) =>
            createLyricLine('', {
              id: `dense-vertical-line-${ordinal}`,
              words: Array.from({ length: 160 }, (_, wordIndex) =>
                createLyricWord(`W${ordinal}-${wordIndex}`, {
                  id: `dense-vertical-word-${ordinal}-${wordIndex}`,
                  startMs: wordIndex * 10,
                  endMs: wordIndex * 10 + 5,
                }),
              ),
            }),
          ),
        }),
      ],
    })
    const scope = mountTimeline(
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={project.durationMs!}
        currentMs={0}
        zoom={1}
        activeTrackId={project.tracks[0]!.id}
        selectedWordIds={new Set()}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={() => undefined}
        onShiftWords={() => undefined}
        onResizeWord={() => undefined}
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />,
    )
    const viewport = scope.querySelector<HTMLDivElement>('.timeline-viewport')!
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 120 })
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 600 })
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!
    const aggregate = () => lane.querySelector<HTMLElement>('.timeline-density-aggregate')!
    const firstWordTop = Number.parseFloat(
      lane.querySelector<HTMLElement>('.timeline-word')!.style.top,
    )
    const laneTop = 104

    const scroll = (top: number) => {
      viewport.scrollTop = top
      act(() => viewport.dispatchEvent(new Event('scroll', { bubbles: true })))
      return Number.parseFloat(aggregate().style.top)
    }

    expect(scroll(laneTop + firstWordTop)).toBe(firstWordTop + 3)
    expect(scroll(laneTop + firstWordTop + 1_500)).toBe(firstWordTop + 1_503)
    expect(scroll(laneTop + firstWordTop + 3_180)).toBeGreaterThanOrEqual(firstWordTop + 3_180)
    expect(aggregate().style.left).toBe('8px')
  })
})
