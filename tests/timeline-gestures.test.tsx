import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { projectForTimingPreview, type ActiveTimingDraft } from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import {
  createTimelineGestureSession,
  timingDraftForGesture,
} from '../src/components/timeline-gestures'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import {
  MAX_PROJECT_DURATION_MS,
  hasValidationErrors,
  validateProject,
} from '../src/lib/project-validation'
import {
  applyTimingDraft,
  constrainWordResizeTiming,
  constrainWordShiftDelta,
  patchWord,
  type ProjectTimingDraft,
  shiftWords,
} from '../src/utils'
import {
  DENSITY_WORD_COUNT,
  createOneTrackMaximumDensityProject,
} from './support/timeline-density-fixture'

describe('live timeline timing drafts', () => {
  function timedProject() {
    const line = createLyricLine('Move resize', {
      id: 'line',
      words: [
        createLyricWord('Move', { id: 'move', startMs: 1_000, endMs: 2_000 }),
        createLyricWord('resize', { id: 'resize', startMs: 2_100, endMs: 3_000 }),
      ],
      startMs: 1_000,
      endMs: 3_000,
    })
    return createProject({
      updatedAt: '2026-01-02T03:04:05.000Z',
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })
  }

  function neighborBoundProject() {
    return createProject({
      durationMs: 10_000,
      tracks: [
        createVocalTrack({
          id: 'lead',
          lines: [
            createLyricLine('Before Moving', {
              id: 'first-line',
              startMs: 1_000,
              endMs: 2_200,
              words: [
                createLyricWord('Before', { id: 'before', startMs: 1_000, endMs: 1_500 }),
                createLyricWord('Moving', { id: 'moving', startMs: 2_000, endMs: 2_200 }),
              ],
            }),
            createLyricLine('Together After', {
              id: 'second-line',
              startMs: 2_400,
              endMs: 2_900,
              words: [
                createLyricWord('Together', { id: 'together', startMs: 2_400, endMs: 2_600 }),
                createLyricWord('After', { id: 'after', startMs: 2_700, endMs: 2_900 }),
              ],
            }),
          ],
        }),
      ],
    })
  }

  it('clamps single and grouped moves to lyric-order neighbors across line boundaries', () => {
    const project = neighborBoundProject()

    expect(constrainWordShiftDelta(project, new Set(['moving']), -2_000)).toBe(-500)
    expect(constrainWordShiftDelta(project, new Set(['moving']), 2_000)).toBe(200)
    expect(constrainWordShiftDelta(project, new Set(['moving', 'together']), -2_000)).toBe(-500)
    expect(constrainWordShiftDelta(project, new Set(['moving', 'together']), 2_000)).toBe(100)

    const movedEarlier = shiftWords(project, new Set(['moving']), -2_000)
    const movedLater = shiftWords(project, new Set(['moving', 'together']), 2_000)
    expect(movedEarlier.tracks[0].lines[0].words[1]).toMatchObject({
      startMs: 1_500,
      endMs: 1_700,
    })
    expect(movedLater.tracks[0].lines[0].words[1]).toMatchObject({
      startMs: 2_100,
      endMs: 2_300,
    })
    expect(movedLater.tracks[0].lines[1].words[0]).toMatchObject({
      startMs: 2_500,
      endMs: 2_700,
    })
  })

  it('preserves adjacent sub-80ms durations without creating overlap', () => {
    const line = createLyricLine('Short words', {
      id: 'short-line',
      startMs: 0,
      endMs: 100,
      words: [
        createLyricWord('Short', { id: 'short-first', startMs: 0, endMs: 50 }),
        createLyricWord('words', { id: 'short-second', startMs: 50, endMs: 100 }),
      ],
    })
    const project = createProject({
      durationMs: 1_000,
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })
    const ids = new Set(['short-first', 'short-second'])
    const gesture = {
      wordId: 'short-first',
      mode: 'move' as const,
      originalStart: 0,
      originalEnd: 50,
      ids,
      deltaMs: 100,
    }

    const preview = applyTimingDraft(project, timingDraftForGesture(project, gesture))
    const moved = shiftWords(project, ids, 100)
    const expected = [
      expect.objectContaining({ startMs: 100, endMs: 150 }),
      expect.objectContaining({ startMs: 150, endMs: 200 }),
    ]
    expect(preview.tracks[0].lines[0].words).toEqual(expected)
    expect(moved.tracks[0].lines[0].words).toEqual(expected)
    expect(constrainWordResizeTiming(project, 'short-first', 'end', 0, 200)).toEqual({
      startMs: 0,
      endMs: 50,
    })
    expect(constrainWordResizeTiming(project, 'short-second', 'start', -100, 100)).toEqual({
      startMs: 50,
      endMs: 100,
    })
  })

  it('applies positive and negative offsets to the project-duration move ceiling', () => {
    const projectAtOffset = (offsetMs: number) =>
      createProject({
        durationMs: 1_000,
        offsetMs,
        tracks: [
          createVocalTrack({
            id: `lead-${offsetMs}`,
            lines: [
              createLyricLine('Bounded', {
                id: `line-${offsetMs}`,
                startMs: 0,
                endMs: 100,
                words: [
                  createLyricWord('Bounded', {
                    id: `word-${offsetMs}`,
                    startMs: 0,
                    endMs: 100,
                  }),
                ],
              }),
            ],
          }),
        ],
      })

    const positive = projectAtOffset(100)
    const negative = projectAtOffset(-100)
    expect(constrainWordShiftDelta(positive, new Set(['word-100']), 10_000)).toBe(800)
    expect(constrainWordShiftDelta(negative, new Set(['word--100']), 10_000)).toBe(1_000)
  })

  it('keeps accepted shifts and resizes within the remaining opening-adjusted timing budget', () => {
    const openingMs = 1_000
    const offsetMs = 500
    const timingCeiling = MAX_PROJECT_DURATION_MS - openingMs - offsetMs
    const project = createProject({
      opening: { leadInMs: openingMs, titleTiming: { mode: 'until-lyrics' } },
      offsetMs,
      tracks: [
        createVocalTrack({
          id: 'opening-bounded-lead',
          lines: [
            createLyricLine('Bounded', {
              id: 'opening-bounded-line',
              startMs: timingCeiling - 200,
              endMs: timingCeiling - 100,
              words: [
                createLyricWord('Bounded', {
                  id: 'opening-bounded-word',
                  startMs: timingCeiling - 200,
                  endMs: timingCeiling - 100,
                }),
              ],
            }),
          ],
        }),
      ],
    })

    expect(constrainWordShiftDelta(project, new Set(['opening-bounded-word']), 1_000)).toBe(100)
    expect(
      hasValidationErrors(
        validateProject(shiftWords(project, new Set(['opening-bounded-word']), 1_000)),
      ),
    ).toBe(false)

    const resize = constrainWordResizeTiming(
      project,
      'opening-bounded-word',
      'end',
      timingCeiling - 200,
      timingCeiling + 1_000,
    )
    expect(resize).toEqual({ startMs: timingCeiling - 200, endMs: timingCeiling })
    expect(
      hasValidationErrors(validateProject(patchWord(project, 'opening-bounded-word', resize!))),
    ).toBe(false)
  })

  it('clamps both resize edges to the nearest timed words across line boundaries', () => {
    const project = neighborBoundProject()

    expect(constrainWordResizeTiming(project, 'together', 'start', 100, 2_600)).toEqual({
      startMs: 2_200,
      endMs: 2_600,
    })
    expect(constrainWordResizeTiming(project, 'moving', 'end', 2_000, 9_000)).toEqual({
      startMs: 2_000,
      endMs: 2_400,
    })
  })

  it('uses the same cross-line clamps for gesture drafts and committed edits', () => {
    const project = neighborBoundProject()
    const moveGesture = {
      wordId: 'moving',
      mode: 'move' as const,
      originalStart: 2_000,
      originalEnd: 2_200,
      ids: new Set(['moving', 'together']),
      deltaMs: 2_000,
    }
    const movePreview = applyTimingDraft(project, timingDraftForGesture(project, moveGesture))
    const moveCommit = shiftWords(project, moveGesture.ids, moveGesture.deltaMs)
    expect(movePreview.tracks[0].lines[0].words[1]).toEqual(moveCommit.tracks[0].lines[0].words[1])
    expect(movePreview.tracks[0].lines[1].words[0]).toEqual(moveCommit.tracks[0].lines[1].words[0])

    const resizeGesture = {
      wordId: 'together',
      mode: 'start' as const,
      originalStart: 2_400,
      originalEnd: 2_600,
      ids: new Set(['together']),
      deltaMs: -2_000,
    }
    const resizeDraft = timingDraftForGesture(project, resizeGesture)
    const resizePreview = applyTimingDraft(project, resizeDraft)
    const constrained = constrainWordResizeTiming(project, 'together', 'start', 400, 2_600)!
    const resizeCommit = patchWord(project, 'together', constrained)
    expect(resizePreview.tracks[0].lines[1].words[0]).toEqual(
      resizeCommit.tracks[0].lines[1].words[0],
    )
  })

  it('publishes actual gesture-session moves through the App preview projection', () => {
    const project = timedProject()
    const draftEvents: Array<ActiveTimingDraft | null> = []
    const shifts: Array<{ ids: Set<string>; deltaMs: number }> = []
    let activeDraft: ActiveTimingDraft | null = null
    const context = {
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (timings: ReturnType<typeof timingDraftForGesture> | null) => {
        activeDraft = timings ? { revision: 7, timings } : null
        draftEvents.push(activeDraft)
      },
      onShiftWords: (ids: Set<string>, deltaMs: number) => shifts.push({ ids, deltaMs }),
      onResizeWord: () => undefined,
    }
    const session = createTimelineGestureSession(() => context)
    const captureTarget = new EventTarget()
    expect(
      session.begin({
        wordId: 'move',
        mode: 'move',
        originalStart: 1_000,
        originalEnd: 2_000,
        ids: new Set(['move', 'resize']),
        deltaMs: 0,
        clientX: 100,
        pointerId: 41,
        captureTarget,
      }),
    ).toBe(true)
    expect(session.move(41, captureTarget, 600)).toBe(true)

    const previewProject = projectForTimingPreview(project, 7, activeDraft)
    const committedMarkup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set(['move'])}
      />,
    )
    const previewMarkup = renderToStaticMarkup(
      <KaraokePreview
        project={previewProject}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set(['move'])}
      />,
    )

    expect(activeDraft!.timings.get('move')).toEqual({ startMs: 1_500, endMs: 2_500 })
    expect(activeDraft!.timings.get('resize')).toEqual({ startMs: 2_600, endMs: 3_500 })
    expect(previewProject.tracks[0].lines[0]).toMatchObject({ startMs: 1_500, endMs: 3_500 })
    expect(committedMarkup).toContain('--word-progress:50%')
    expect(previewMarkup).toContain('--word-progress:0%')
    expect(previewMarkup).not.toContain('--word-progress:50%')
    expect(project.tracks[0].lines[0].words[0]).toMatchObject({ startMs: 1_000, endMs: 2_000 })
    expect(previewProject.updatedAt).toBe(project.updatedAt)

    expect(session.finish(41, captureTarget)).toBe(true)
    expect(draftEvents.at(-1)).toBeNull()
    expect(shifts).toEqual([{ ids: new Set(['move', 'resize']), deltaMs: 500 }])
  })

  it('renders edge-resize drafts with the same minimum-duration bounds as commit', () => {
    const project = timedProject()
    let currentDraft: ReturnType<typeof timingDraftForGesture> | null = null
    const resizeCommits: Array<{ startMs: number; endMs: number }> = []
    const context = {
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (draft: ReturnType<typeof timingDraftForGesture> | null) => {
        currentDraft = draft
      },
      onShiftWords: () => undefined,
      onResizeWord: (_wordId: string, startMs: number, endMs: number) =>
        resizeCommits.push({ startMs, endMs }),
    }
    const session = createTimelineGestureSession(() => context)
    const startTarget = new EventTarget()
    expect(
      session.begin({
        wordId: 'move',
        mode: 'start',
        originalStart: 1_000,
        originalEnd: 2_000,
        ids: new Set(['move']),
        deltaMs: 0,
        clientX: 100,
        pointerId: 51,
        captureTarget: startTarget,
      }),
    ).toBe(true)
    expect(session.move(51, startTarget, 2_100)).toBe(true)
    expect(currentDraft!.get('move')).toEqual({ startMs: 1_920, endMs: 2_000 })
    expect(applyTimingDraft(project, currentDraft!).tracks[0].lines[0].startMs).toBe(1_920)
    expect(session.finish(51, startTarget)).toBe(true)

    const endTarget = new EventTarget()
    expect(
      session.begin({
        wordId: 'move',
        mode: 'end',
        originalStart: 1_000,
        originalEnd: 2_000,
        ids: new Set(['move']),
        deltaMs: 0,
        clientX: 2_100,
        pointerId: 52,
        captureTarget: endTarget,
      }),
    ).toBe(true)
    expect(session.move(52, endTarget, 100)).toBe(true)
    expect(currentDraft!.get('move')).toEqual({ startMs: 1_000, endMs: 1_080 })
    expect(session.finish(52, endTarget)).toBe(true)

    expect(resizeCommits).toEqual([
      { startMs: 1_920, endMs: 2_000 },
      { startMs: 1_000, endMs: 1_080 },
    ])
    expect(project.tracks[0].lines[0].startMs).toBe(1_000)
  })

  it('preserves untouched line timing and makes draft and committed moves agree', () => {
    const movedLine = createLyricLine('Timed word', {
      id: 'moved-line',
      startMs: 1_000,
      endMs: 2_000,
      words: [createLyricWord('Timed', { id: 'timed', startMs: 1_000, endMs: 2_000 })],
    })
    const lineTimedOnly = createLyricLine('Line timed only', {
      id: 'line-only',
      startMs: 5_000,
      endMs: 6_000,
    })
    const project = createProject({
      tracks: [createVocalTrack({ id: 'lead', lines: [movedLine, lineTimedOnly] })],
    })
    const untouchedLine = project.tracks[0].lines[1]
    const gesture = {
      wordId: 'timed',
      mode: 'move' as const,
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['timed']),
      deltaMs: 375,
    }
    const preview = applyTimingDraft(project, timingDraftForGesture(project, gesture))
    const committed = shiftWords(project, gesture.ids, gesture.deltaMs)

    expect(committed.tracks[0].lines[1]).toBe(untouchedLine)
    expect(committed.tracks[0].lines[1]).toMatchObject({ startMs: 5_000, endMs: 6_000 })
    expect(preview.tracks[0].lines[1]).toBe(untouchedLine)
    expect(committed.tracks[0].lines[0].words[0]).toEqual(preview.tracks[0].lines[0].words[0])
    expect(committed.tracks[0].lines[0]).toMatchObject({ startMs: 1_375, endMs: 2_375 })
  })

  it('owns one pointer and ignores stale cancellation from another gesture', () => {
    const project = timedProject()
    const draftEvents: Array<ReturnType<typeof timingDraftForGesture> | null> = []
    const shifts: number[] = []
    const context = {
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (draft: ReturnType<typeof timingDraftForGesture> | null) =>
        draftEvents.push(draft),
      onShiftWords: (_ids: Set<string>, deltaMs: number) => shifts.push(deltaMs),
      onResizeWord: () => undefined,
    }
    const session = createTimelineGestureSession(() => context)
    const firstTarget = new EventTarget()
    const nextTarget = new EventTarget()
    const gesture = {
      wordId: 'move',
      mode: 'move' as const,
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['move']),
      deltaMs: 0,
      clientX: 100,
      pointerId: 7,
      captureTarget: firstTarget,
    }

    expect(session.begin(gesture)).toBe(true)
    expect(session.begin({ ...gesture, pointerId: 8, captureTarget: nextTarget })).toBe(false)
    expect(session.move(8, nextTarget, 600)).toBe(false)
    expect(session.cancel(8, nextTarget)).toBe(false)
    expect(draftEvents).toEqual([])
    expect(session.move(7, firstTarget, 350)).toBe(true)
    expect(draftEvents).toHaveLength(1)
    expect(session.cancel(7, firstTarget)).toBe(true)
    expect(draftEvents.at(-1)).toBeNull()

    expect(session.begin({ ...gesture, captureTarget: nextTarget })).toBe(true)
    expect(session.cancel(7, firstTarget)).toBe(false)
    expect(session.owns(7, nextTarget)).toBe(true)
    expect(session.finish(7, nextTarget)).toBe(true)
    expect(shifts).toEqual([])
  })

  it('returns original project identity for no-op move and resize commits', () => {
    const project = timedProject()
    const line = project.tracks[0].lines[0]
    const word = line.words[0]
    const resizeCommits: Array<{ startMs: number; endMs: number }> = []
    const captureTarget = new EventTarget()
    const session = createTimelineGestureSession(() => ({
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: () => undefined,
      onShiftWords: () => undefined,
      onResizeWord: (_wordId, startMs, endMs) => resizeCommits.push({ startMs, endMs }),
    }))

    expect(shiftWords(project, new Set([word.id]), 0)).toBe(project)
    expect(patchWord(project, word.id, { startMs: word.startMs, endMs: word.endMs })).toBe(project)
    expect(patchWord(project, 'missing', { startMs: 100, endMs: 200 })).toBe(project)
    expect(project.tracks[0].lines[0]).toBe(line)
    expect(
      session.begin({
        wordId: word.id,
        mode: 'start',
        originalStart: word.startMs!,
        originalEnd: word.endMs!,
        ids: new Set([word.id]),
        deltaMs: 0,
        clientX: 100,
        pointerId: 12,
        captureTarget,
      }),
    ).toBe(true)
    expect(session.finish(12, captureTarget)).toBe(true)
    expect(resizeCommits).toEqual([])
  })

  it('plans exact 5,000-word single anchor drags and both resize edges before repeated moves', () => {
    const project = createOneTrackMaximumDensityProject()
    expect(hasValidationErrors(validateProject(project))).toBe(false)
    const words = project.tracks[0]!.lines.flatMap((line) => line.words)
    const anchors = [words[0]!, words[Math.floor(words.length / 2)]!, words.at(-1)!]

    for (const anchor of anchors) {
      for (const mode of ['move', 'start', 'end'] as const) {
        const drafts: ProjectTimingDraft[] = []
        const shifts: number[] = []
        const resizes: Array<{ startMs: number; endMs: number }> = []
        const session = createTimelineGestureSession(() => ({
          project,
          pixelsPerSecond: 1_000,
          onTimingDraftChange: (draft) => {
            if (draft) drafts.push(draft)
          },
          onShiftWords: (_ids, deltaMs) => shifts.push(deltaMs),
          onResizeWord: (_id, startMs, endMs) => resizes.push({ startMs, endMs }),
        }))
        const captureTarget = new EventTarget()
        const originalEnd = anchor.endMs!
        const gesture = {
          wordId: anchor.id,
          mode,
          originalStart: anchor.startMs!,
          originalEnd,
          ids: new Set([anchor.id]),
          deltaMs: 0,
          clientX: 100,
          pointerId: 1,
          captureTarget,
        }

        expect(session.begin(gesture)).toBe(true)
        expect(session.move(1, captureTarget, 112)).toBe(true)
        expect(drafts).toHaveLength(1)
        expect(drafts[0]).toEqual(timingDraftForGesture(project, { ...gesture, deltaMs: 12 }))
        expect(session.finish(1, captureTarget)).toBe(true)
        expect(shifts.length + resizes.length).toBe(1)
      }
    }
  })

  it.each([
    { label: 'zero-duration end', wordEndMs: 1_000, originalEnd: 1_000, deltaMs: 1 },
    { label: 'null end', wordEndMs: null, originalEnd: 1_360, deltaMs: 100 },
    { label: 'backwards end', wordEndMs: 900, originalEnd: 900, deltaMs: 100 },
  ])(
    'keeps the end-resize draft equal to the final commit for a defensive $label state',
    ({ wordEndMs, originalEnd, deltaMs }) => {
      const word = createLyricWord('Defensive', {
        id: 'defensive-word',
        startMs: 1_000,
        endMs: wordEndMs,
      })
      const project = createProject({
        durationMs: 5_000,
        tracks: [
          createVocalTrack({
            id: 'defensive-lead',
            lines: [
              createLyricLine('Defensive', {
                id: 'defensive-line',
                startMs: word.startMs,
                endMs: word.endMs,
                words: [word],
              }),
            ],
          }),
        ],
      })
      const drafts: ProjectTimingDraft[] = []
      const commits: Array<{ startMs: number; endMs: number }> = []
      const session = createTimelineGestureSession(() => ({
        project,
        pixelsPerSecond: 1_000,
        onTimingDraftChange: (draft) => {
          if (draft) drafts.push(draft)
        },
        onShiftWords: () => undefined,
        onResizeWord: (_wordId, startMs, endMs) => commits.push({ startMs, endMs }),
      }))
      const captureTarget = new EventTarget()
      expect(
        session.begin({
          wordId: word.id,
          mode: 'end',
          originalStart: word.startMs!,
          originalEnd,
          ids: new Set([word.id]),
          deltaMs: 0,
          clientX: 100,
          pointerId: 77,
          captureTarget,
        }),
      ).toBe(true)
      expect(session.move(77, captureTarget, 100 + deltaMs)).toBe(true)
      expect(session.finish(77, captureTarget)).toBe(true)
      expect(commits).toHaveLength(1)
      expect(drafts.at(-1)?.get(word.id)).toEqual(commits[0])
    },
  )

  it('keeps repeated exact 5,000-word drafts bounded, ordered, and out of the project walk', () => {
    const project = createOneTrackMaximumDensityProject()
    const ids = new Set(
      project.tracks[0]!.lines.flatMap((line) => line.words.map((word) => word.id)),
    )
    expect(ids).toHaveLength(DENSITY_WORD_COUNT)
    const first = project.tracks[0]!.lines[0]!.words[0]!
    const drafts: ProjectTimingDraft[] = []
    const shifts: number[] = []
    const session = createTimelineGestureSession(() => ({
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (draft) => {
        if (draft) drafts.push(draft)
      },
      onShiftWords: (_ids, deltaMs) => shifts.push(deltaMs),
      onResizeWord: () => undefined,
    }))
    const captureTarget = new EventTarget()
    expect(
      session.begin({
        wordId: first.id,
        mode: 'move',
        originalStart: first.startMs!,
        originalEnd: first.endMs!,
        ids,
        deltaMs: 0,
        clientX: 100,
        pointerId: 5_000,
        captureTarget,
      }),
    ).toBe(true)

    const samples: number[] = []
    for (let index = 0; index < 48; index += 1) {
      const startedAt = performance.now()
      expect(session.move(5_000, captureTarget, 101 + (index % 7))).toBe(true)
      samples.push(performance.now() - startedAt)
    }
    const ordered = [...samples].sort((left, right) => left - right)
    const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]!
    const max = Math.max(...samples)
    expect(p95).toBeLessThan(16.667)
    expect(max).toBeLessThan(16.667)
    expect(drafts).toHaveLength(48)
    expect(drafts.at(-1)).toHaveLength(DENSITY_WORD_COUNT)
    expect([...drafts.at(-1)!.keys()].slice(0, 3)).toEqual([
      'one-track-density-0',
      'one-track-density-1',
      'one-track-density-2',
    ])

    const originalTracks = project.tracks
    Object.defineProperty(project, 'tracks', {
      configurable: true,
      get: () => {
        throw new Error('repeated move must not walk project words')
      },
    })
    expect(session.move(5_000, captureTarget, 108)).toBe(true)
    Object.defineProperty(project, 'tracks', { configurable: true, value: originalTracks })

    expect(session.finish(5_000, captureTarget)).toBe(true)
    expect(shifts).toEqual([8])
  })
})
