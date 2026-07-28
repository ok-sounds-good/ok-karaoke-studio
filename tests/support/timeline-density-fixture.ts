import {
  createProject,
  createVocalTrack,
  type KaraokeProject,
  type LyricLine,
} from '../../src/lib/model'

export const DENSITY_TRACK_COUNT = 8
export const DENSITY_WORD_COUNT = 5_000
export const DENSITY_WORDS_PER_TRACK = DENSITY_WORD_COUNT / DENSITY_TRACK_COUNT
export const DENSITY_LINE_COUNT = 1_000
export const DENSITY_LINES_PER_TRACK = DENSITY_LINE_COUNT / DENSITY_TRACK_COUNT
export const DENSITY_WORDS_PER_LINE = 5

/**
 * Synthetic current-v0 data only: named tracks, unique identities, and valid
 * sequential word timing. It contains no media or lyrics that need licensing.
 */
export function createMaximumDensityProject(): KaraokeProject {
  const tracks = Array.from({ length: DENSITY_TRACK_COUNT }, (_, trackIndex) => {
    const lines: LyricLine[] = Array.from({ length: DENSITY_LINES_PER_TRACK }, (_, lineIndex) => {
      const firstOrdinal = lineIndex * DENSITY_WORDS_PER_LINE
      const words = Array.from({ length: DENSITY_WORDS_PER_LINE }, (_, offset) => {
        const ordinal = firstOrdinal + offset
        const startMs = ordinal * 120
        return {
          id: `density-${trackIndex}-${ordinal}`,
          text: `W${ordinal}`,
          startMs,
          endMs: startMs + 120,
        }
      })
      const startMs = words[0]!.startMs
      const endMs = words.at(-1)!.endMs
      return {
        id: `density-line-${trackIndex}-${lineIndex}`,
        text: words.map((word) => word.text).join(' '),
        startMs,
        endMs,
        words,
      }
    })
    return createVocalTrack({
      id: `density-track-${trackIndex}`,
      name: `Density Track ${trackIndex + 1}`,
      defaultStyleIndex: trackIndex,
      lines,
    })
  })
  return createProject({
    id: 'current-v0-density-5k',
    durationMs: DENSITY_WORDS_PER_TRACK * 120,
    tracks,
  })
}
