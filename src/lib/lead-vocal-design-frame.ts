import type { KaraokeProject } from './model'
import { previewFrameStateAt, type StageFrameState } from './stage-frame-state'
import { cloneVocalStyle, type StageStyle, type VocalStyle } from './video-style'

export const DESIGN_LYRIC_WORDS = ['Sing', 'the', 'first', 'words', 'and', 'see', 'the', 'rest']

const FIRST_WORD_MS = 120_000
const AVAILABLE_LEAD_MS = 4_000

function timedDesignWords(startMs: number, durationMs = 1_000) {
  return DESIGN_LYRIC_WORDS.map((text, index) => ({
    id: `lead-vocal-design-word-${index}`,
    text,
    startMs: startMs + index * durationMs,
    endMs: startMs + (index + 1) * durationMs,
  }))
}

export function leadVocalDesignFrame(
  project: KaraokeProject,
  stageStyle: StageStyle,
  vocalStyle: VocalStyle,
  timingValid: boolean,
): StageFrameState {
  const designVocal = cloneVocalStyle(vocalStyle)
  if (!timingValid) designVocal.syncAid.enabled = false
  const previousEndMs = FIRST_WORD_MS - AVAILABLE_LEAD_MS
  const targetWords = timedDesignWords(FIRST_WORD_MS)
  const targetTrack = {
    id: 'lead-vocal-design-track',
    name: 'Lead Vocal design',
    vocalStyle: designVocal,
    muted: false,
    solo: false,
    lines: [
      {
        id: 'lead-vocal-design-prior-line',
        text: 'Prior section',
        startMs: previousEndMs - 1_000,
        endMs: previousEndMs,
        words: [
          {
            id: 'lead-vocal-design-prior-word',
            text: 'Prior',
            startMs: previousEndMs - 1_000,
            endMs: previousEndMs,
          },
        ],
      },
      {
        id: 'lead-vocal-design-blank-row',
        text: '',
        startMs: null,
        endMs: null,
        words: [],
      },
      {
        id: 'lead-vocal-design-line',
        text: DESIGN_LYRIC_WORDS.join(' '),
        startMs: FIRST_WORD_MS,
        endMs: targetWords.at(-1)!.endMs,
        words: targetWords,
      },
    ],
  }
  const baseProject: KaraokeProject = {
    ...project,
    id: 'lead-vocal-design-project',
    durationMs: FIRST_WORD_MS + 20_000,
    offsetMs: 0,
    lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
    stageStyle,
    tracks: [targetTrack],
  }
  const probe = previewFrameStateAt(baseProject, FIRST_WORD_MS - 1)
  const plannedAid = probe.syncAids[0]
  const playbackMs = plannedAid ? plannedAid.startMs + plannedAid.durationMs / 2 : FIRST_WORD_MS
  const contextWords = [
    {
      id: 'lead-vocal-design-context-sung',
      text: 'Sung',
      startMs: playbackMs - 3_000,
      endMs: playbackMs - 2_000,
    },
    {
      id: 'lead-vocal-design-context-active',
      text: 'singing',
      startMs: playbackMs - 1_000,
      endMs: playbackMs + 1_000,
    },
    {
      id: 'lead-vocal-design-context-unsung',
      text: 'waiting',
      startMs: playbackMs + 1_000,
      endMs: playbackMs + 2_000,
    },
  ]
  const contextVocal = cloneVocalStyle(vocalStyle)
  contextVocal.syncAid.enabled = false
  return previewFrameStateAt(
    {
      ...baseProject,
      lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
      tracks: [
        targetTrack,
        {
          id: 'lead-vocal-design-context-track',
          name: 'Lead Vocal design context',
          vocalStyle: contextVocal,
          muted: false,
          solo: false,
          lines: [
            {
              id: 'lead-vocal-design-context-line',
              text: contextWords.map(({ text }) => text).join(' '),
              startMs: contextWords[0]!.startMs,
              endMs: contextWords.at(-1)!.endMs,
              words: contextWords,
            },
          ],
        },
      ],
    },
    playbackMs,
  )
}
