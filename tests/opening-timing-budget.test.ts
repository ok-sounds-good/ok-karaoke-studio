import { describe, expect, it } from 'vitest'

import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import {
  MAX_PROJECT_DURATION_MS,
  hasValidationErrors,
  openingLeadInMaximum,
  validateProject,
} from '../src/lib/project-validation'

function projectWithTiming(offsetMs: number) {
  const endMs = MAX_PROJECT_DURATION_MS - 5_000
  return createProject({
    durationMs: null,
    offsetMs,
    tracks: [
      createVocalTrack({
        id: `lead-${offsetMs}`,
        lines: [
          createLyricLine('Bounded timing', {
            id: `line-${offsetMs}`,
            startMs: endMs - 1_000,
            endMs,
            words: [
              createLyricWord('Bounded', {
                id: `word-${offsetMs}`,
                startMs: endMs - 1_000,
                endMs,
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

describe('opening lead-in combined duration budget', () => {
  it('uses the later of source duration and every offset-adjusted timed end', () => {
    expect(openingLeadInMaximum(createProject({ durationMs: null }))).toBe(MAX_PROJECT_DURATION_MS)
    expect(
      openingLeadInMaximum(createProject({ durationMs: MAX_PROJECT_DURATION_MS - 1_000 })),
    ).toBe(1_000)
    expect(openingLeadInMaximum(projectWithTiming(1_000))).toBe(4_000)
    expect(openingLeadInMaximum(projectWithTiming(-1_000))).toBe(6_000)
  })

  it('accepts equality and rejects the next tenth of a second', () => {
    const project = projectWithTiming(1_000)
    const maximumMs = openingLeadInMaximum(project)
    const withMaximum = {
      ...project,
      opening: { ...project.opening, leadInMs: maximumMs },
    }
    const aboveMaximum = {
      ...project,
      opening: { ...project.opening, leadInMs: maximumMs + 100 },
    }

    expect(hasValidationErrors(validateProject(withMaximum))).toBe(false)
    expect(validateProject(aboveMaximum)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'timing-after-limit', severity: 'error' }),
      ]),
    )
  })

  it('fails closed when a validation-checked line or word range is malformed', () => {
    const project = projectWithTiming(0)
    project.tracks[0]!.lines[0]!.words[0]!.endMs = null
    expect(openingLeadInMaximum(project)).toBe(0)
  })
})
