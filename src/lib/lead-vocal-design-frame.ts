import type { KaraokeProject } from './model'
import { previewFrameStateAt, type StageFrameState } from './stage-frame-state'
import { cloneVocalStyle, type StageStyle, type VocalStyle } from './video-style'

export const DESIGN_LYRIC_WORDS = ['Sing', 'the', 'first', 'words', 'and', 'see', 'the', 'rest']

const FIRST_WORD_MS = 120_000
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
  const targetWords = timedDesignWords(FIRST_WORD_MS)
  return previewFrameStateAt(
    {
      ...project,
      id: 'lead-vocal-design-project',
      durationMs: FIRST_WORD_MS + 20_000,
      offsetMs: 0,
      lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
      stageStyle,
      tracks: [
        {
          id: 'lead-vocal-design-track',
          name: 'Lead Vocal design',
          vocalStyle: designVocal,
          muted: false,
          solo: false,
          lines: [
            {
              id: 'lead-vocal-design-line',
              text: DESIGN_LYRIC_WORDS.join(' '),
              startMs: FIRST_WORD_MS,
              endMs: targetWords.at(-1)!.endMs,
              words: targetWords,
            },
          ],
        },
      ],
    },
    FIRST_WORD_MS + 1_500,
  )
}
