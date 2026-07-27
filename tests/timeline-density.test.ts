import { describe, expect, it } from 'vitest'

import {
  TIMELINE_WORD_DOM_CAP_PER_TRACK,
  buildTimelineTrackLayout,
  timelineMountedWords,
  timelineLabelsInRect,
  timelineLineRegionsInRect,
  timelineMountedLabels,
  timelineWordsInRect,
  timelineWordsInViewport,
} from '../src/components/timeline-geometry'
import { timelineSyncRevealPosition } from '../src/components/Timeline'
import {
  createLyricLine,
  createLyricWord,
  createVocalTrack,
  parseProject,
  serializeProject,
  validateProject,
} from '../src/lib/model'
import { createMaximumDensityProject, DENSITY_WORD_COUNT } from './support/timeline-density-fixture'

const projectSchema = require('../electron/project-schema.cjs') as {
  parseProjectJson(json: string): { tracks: { lines: { words: unknown[] }[] }[] }
}
const videoExport = require('../electron/video-export.cjs') as {
  parseProjectForVideo(json: string): { tracks: { lines: { words: unknown[] }[] }[] }
}

describe('Timeline density indexes', () => {
  it('keeps the complete 150k schedule while ordinal and viewport lookups stay indexed', () => {
    const project = createMaximumDensityProject()
    const layouts = project.tracks.map((track) => buildTimelineTrackLayout(track, 0, 72))
    const total = layouts.reduce((count, layout) => count + layout.words.length, 0)
    const target = layouts[4]!.wordById.get('density-4-0')

    expect(total).toBe(DENSITY_WORD_COUNT)
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([])
    const serialized = serializeProject(project)
    expect(parseProject(serialized)).toStrictEqual(project)
    for (const decoded of [
      projectSchema.parseProjectJson(serialized),
      videoExport.parseProjectForVideo(serialized),
    ]) {
      expect(decoded.tracks).toHaveLength(8)
      expect(decoded.tracks.flatMap((track) => track.lines)).toHaveLength(20_000)
      expect(
        decoded.tracks.flatMap((track) => track.lines).flatMap((line) => line.words),
      ).toHaveLength(150_000)
    }
    expect(target?.word.id).toBe('density-4-0')
    expect(
      timelineWordsInViewport(layouts[4]!, target!.left + 0.01, target!.left + target!.width - 0.01)
        .values,
    ).toEqual([target])
  })

  it('uses an overlap-safe interval index and replaces distant ordinary records at the fixed cap', () => {
    const track = createVocalTrack({
      id: 'overlap',
      lines: Array.from({ length: 160 }, (_, ordinal) =>
        createLyricLine(`Word ${ordinal}`, {
          id: `line-${ordinal}`,
          words: [
            createLyricWord(`Word${ordinal}`, {
              id: `word-${ordinal}`,
              startMs: 1_000,
              endMs: 2_000,
            }),
          ],
        }),
      ),
    })
    const layout = buildTimelineTrackLayout(track, 0, 72)
    const forced = new Set(['word-159'])
    const mounted = timelineMountedWords(layout, 0, 3_000, forced)

    expect(
      timelineWordsInViewport(layout, (1_000 * 72) / 1000, (2_000 * 72) / 1000).values,
    ).toHaveLength(160)
    expect(mounted.words).toHaveLength(TIMELINE_WORD_DOM_CAP_PER_TRACK)
    expect(mounted.words.map((word) => word.word.id)).toContain('word-159')
    expect(mounted.omittedCount).toBe(1)
  })

  it('bounds an accepted 150k-word single-line overlap without spreading dense arrays', () => {
    const line = createLyricLine('', {
      id: 'overlap-boundary',
      words: Array.from({ length: DENSITY_WORD_COUNT }, (_, ordinal) =>
        createLyricWord('Overlap', {
          id: `overlap-${ordinal}`,
          startMs: 1_000,
          endMs: 2_000,
        }),
      ),
    })
    const layout = buildTimelineTrackLayout(
      createVocalTrack({ id: 'overlap-boundary', lines: [line] }),
      0,
      72,
    )
    const query = timelineWordsInViewport(layout, 72, 144, 96)
    const miss = timelineWordsInViewport(layout, 10_000_000, 10_000_001, 96)
    const logarithmicBound = Math.ceil(Math.log2(DENSITY_WORD_COUNT + 1)) + 2

    expect(layout.words).toHaveLength(DENSITY_WORD_COUNT)
    expect(layout.indexStats.comparisons).toBeLessThanOrEqual(
      12 * DENSITY_WORD_COUNT * Math.ceil(Math.log2(DENSITY_WORD_COUNT + 1)),
    )
    expect(layout.indexStats.nodes).toBe(2 * DENSITY_WORD_COUNT + 1)
    expect(query.values).toHaveLength(96)
    expect(query.visited).toBe(97)
    expect(query.truncated).toBe(true)
    expect(miss.values).toEqual([])
    expect(miss.nodesVisited).toBeLessThanOrEqual(logarithmicBound)
  })

  it('queries both axes before applying the record cap, including the 150th sequential word', () => {
    const track = createVocalTrack({
      id: 'sequential',
      lines: [
        createLyricLine('', {
          id: 'sequential-line',
          words: Array.from({ length: 160 }, (_, ordinal) =>
            createLyricWord(`W${ordinal}`, {
              id: `sequential-${ordinal}`,
              startMs: ordinal * 1_000,
              endMs: ordinal * 1_000 + 500,
            }),
          ),
        }),
      ],
    })
    const layout = buildTimelineTrackLayout(track, 0, 72)
    const target = layout.wordById.get('sequential-150')!
    const mounted = timelineMountedWords(
      layout,
      target.left - 1,
      target.left + target.width + 1,
      new Set(['sequential-0']),
      96,
      target.top,
      target.top + 1,
    )

    expect(mounted.words.map((word) => word.word.id)).toEqual(['sequential-0', 'sequential-150'])
  })

  it('changes coincident-row results with vertical scroll and preserves forced focus/sync replacement', () => {
    const track = createVocalTrack({
      id: 'stacked',
      lines: Array.from({ length: 160 }, (_, ordinal) =>
        createLyricLine('', {
          id: `stacked-line-${ordinal}`,
          words: [
            createLyricWord(`W${ordinal}`, {
              id: `stacked-${ordinal}`,
              startMs: 1_000,
              endMs: 2_000,
            }),
          ],
        }),
      ),
    })
    const layout = buildTimelineTrackLayout(track, 0, 72)
    const first = layout.wordById.get('stacked-0')!
    const last = layout.wordById.get('stacked-159')!
    const firstWindow = timelineWordsInRect(
      layout,
      first.left,
      first.left + first.width,
      first.top,
      first.top + 1,
      96,
    )
    const lastWindow = timelineWordsInRect(
      layout,
      last.left,
      last.left + last.width,
      last.top,
      last.top + 1,
      96,
    )
    expect(firstWindow.values.map((word) => word.word.id)).toEqual(['stacked-0'])
    expect(lastWindow.values.map((word) => word.word.id)).toEqual(['stacked-159'])
    expect(
      timelineMountedWords(
        layout,
        first.left,
        first.left + first.width,
        new Set(['stacked-159']),
        96,
        first.top,
        first.top + 1,
      ).words.map((word) => word.word.id),
    ).toContain('stacked-159')
  })

  it('keeps label fragments and line regions independently bounded in both axes', () => {
    const track = createVocalTrack({
      id: 'labels',
      lines: [
        createLyricLine('', {
          id: 'label-line',
          words: [
            createLyricWord('Early', { id: 'label-early', startMs: 0, endMs: 10 }),
            createLyricWord('Late', { id: 'label-80', startMs: 1_000, endMs: 1_010 }),
          ],
        }),
      ],
    })
    const layout = buildTimelineTrackLayout(track, 0, 720)
    const target = layout.wordById.get('label-80')!
    const label = layout.labelByWordId.get(target.word.id)!
    const labels = timelineLabelsInRect(
      layout,
      label.left,
      label.left + label.width,
      label.top,
      label.top + 1,
    )
    const regions = timelineLineRegionsInRect(
      layout,
      label.left,
      label.left + label.width,
      label.top,
      label.top + 1,
    )
    const forced = timelineMountedLabels(layout, 0, 1, 0, 1, new Set(['label-80']))

    expect(labels.values.map((value) => value.word.word.id)).toEqual(['label-80'])
    expect(regions.values.map((value) => value.line.id)).toEqual(['label-line'])
    expect(forced.map((value) => value.word.word.id)).toContain('label-80')
    expect(target.left).toBeGreaterThan(label.left + label.width)
  })

  it('changes bounded label and region identities when a vertically stacked viewport scrolls', () => {
    const layout = buildTimelineTrackLayout(
      createVocalTrack({
        id: 'vertical-labels',
        lines: Array.from({ length: 120 }, (_, ordinal) =>
          createLyricLine('', {
            id: `vertical-line-${ordinal}`,
            words: [
              createLyricWord(`V${ordinal}`, {
                id: `vertical-word-${ordinal}`,
                startMs: 1_000,
                endMs: 2_000,
              }),
            ],
          }),
        ),
      }),
      0,
      72,
    )
    const first = layout.labelByWordId.get('vertical-word-0')!
    const last = layout.labelByWordId.get('vertical-word-119')!

    expect(
      timelineLabelsInRect(
        layout,
        first.left,
        first.left + first.width,
        first.top,
        first.top + 1,
      ).values.map((label) => label.word.word.id),
    ).toEqual(['vertical-word-0'])
    expect(
      timelineLineRegionsInRect(
        layout,
        last.left,
        last.left + last.width,
        last.top,
        last.top + 1,
      ).values.map((line) => line.line.id),
    ).toEqual(['vertical-line-119'])
  })

  it('reveals a sync target on both axes, including a vertically hidden target already in view horizontally', () => {
    expect(
      timelineSyncRevealPosition(
        { left: 1_000, top: 0, width: 800, height: 400 },
        { left: 1_200, width: 20, top: 2_000, height: 17 },
      ),
    ).toEqual({ left: 1_000, top: 1_872 })
    expect(
      timelineSyncRevealPosition(
        { left: 0, top: 0, width: 800, height: 400 },
        { left: 2_000, width: 20, top: 2_000, height: 17 },
      ),
    ).toEqual({ left: 1_744, top: 1_872 })
  })
})
