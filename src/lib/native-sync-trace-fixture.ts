import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  type KaraokeProject,
  type VocalTrack,
} from './model'
import { MAX_PROJECT_TRACKS, MAX_PROJECT_WORDS } from './project-validation'

export const NATIVE_SYNC_TRACE_WORDS = MAX_PROJECT_WORDS
export const NATIVE_SYNC_TRACE_DURATION_MS = NATIVE_SYNC_TRACE_WORDS
const NATIVE_SYNC_TRACE_TRACKS = MAX_PROJECT_TRACKS
const NATIVE_SYNC_TRACE_WORDS_PER_TRACK = NATIVE_SYNC_TRACE_WORDS / NATIVE_SYNC_TRACE_TRACKS
export const NATIVE_SYNC_TRACE_FIXTURES = ['eight-tracks', 'one-active-line'] as const
export type NativeSyncTraceFixture = (typeof NATIVE_SYNC_TRACE_FIXTURES)[number]

function words(count: number, prefix: string, startOrdinal = 0) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = startOrdinal + index
    return createLyricWord(`w${ordinal}`, {
      endMs: ordinal + 1,
      id: `${prefix}-word-${index}`,
      startMs: ordinal,
    })
  })
}

function traceVocalStyle(): VocalTrack['vocalStyle'] {
  return {
    alignment: 'center',
    position: { x: 960, y: 850 },
    previewMs: 3_000,
    sungColor: '#FF8A2B',
    syncAid: { enabled: false, maxLeadMs: 3_000, minLeadMs: 2_000 },
    unsungColor: '#72687D',
  }
}

function track(index: number, count: number, startOrdinal: number): VocalTrack {
  const id = `trace-track-${index}`
  const lineWords = count === 0 ? [] : words(count, id, startOrdinal)
  return createVocalTrack({
    id,
    name: `Trace Voice ${index + 1}`,
    defaultStyleIndex: index,
    vocalStyle: traceVocalStyle(),
    lines:
      lineWords.length === 0
        ? []
        : [
            createLyricLine(lineWords.map((word) => word.text).join(' '), {
              endMs: lineWords.at(-1)!.endMs,
              id: `${id}-line-0`,
              startMs: lineWords[0]!.startMs,
              words: lineWords,
            }),
          ],
  })
}

export function nativeSyncTraceProject(fixture: NativeSyncTraceFixture): KaraokeProject {
  if (!isNativeSyncTraceFixture(fixture)) throw new Error('NATIVE_SYNC_TRACE_FIXTURE_INVALID')
  const tracks =
    fixture === 'eight-tracks'
      ? Array.from({ length: NATIVE_SYNC_TRACE_TRACKS }, (_, index) =>
          track(
            index,
            NATIVE_SYNC_TRACE_WORDS_PER_TRACK,
            index * NATIVE_SYNC_TRACE_WORDS_PER_TRACK,
          ),
        )
      : Array.from({ length: NATIVE_SYNC_TRACE_TRACKS }, (_, index) =>
          track(index, index === 0 ? NATIVE_SYNC_TRACE_WORDS : 0, 0),
        )
  return createProject({
    id: `native-sync-trace-${fixture}`,
    title: 'Native sync trace tone',
    artist: 'Okay Karaoke Studio',
    audioPath: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    durationMs: NATIVE_SYNC_TRACE_DURATION_MS,
    lyricDisplay: { advanceMode: 'scroll', lineCount: 2 },
    tracks,
    updatedAt: '2026-07-27T00:00:00.000Z',
  })
}

export function isNativeSyncTraceFixture(value: string | null): value is NativeSyncTraceFixture {
  return (
    typeof value === 'string' && (NATIVE_SYNC_TRACE_FIXTURES as readonly string[]).includes(value)
  )
}
