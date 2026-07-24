import type { KaraokeProject } from './model'
import type { StageFrameLine, StageFrameState } from './stage-frame-state'
import { lyricSampleLines, normalizedLyricLineCount } from './stage-layout'
import {
  resolveVocalStyle,
  type ResolvedVocalStyle,
  type StageStyle,
  type VocalStyle,
} from './video-style'

export const DESIGN_LYRIC_WORDS = lyricSampleLines(1)[0]!.split(' ')

const FIRST_WORD_MS = 120_000

export function designLyricLines(
  trackId: string,
  style: ResolvedVocalStyle,
  lineCount: number,
): StageFrameLine[] {
  return lyricSampleLines(lineCount).map((text, lineIndex) => ({
    id: `${trackId}-design-line-${lineIndex + 1}`,
    trackId,
    text,
    style,
    words: text.split(' ').map((word, wordIndex) => ({
      id: `${trackId}-design-word-${lineIndex + 1}-${wordIndex + 1}`,
      text: word,
      progress:
        lineIndex === 0 && wordIndex === 0 ? 1 : lineIndex === 0 && wordIndex === 1 ? 0.5 : 0,
    })),
  }))
}

export function leadVocalDesignFrame(
  project: KaraokeProject,
  stageStyle: StageStyle,
  vocalStyle: VocalStyle,
  _timingValid: boolean,
): StageFrameState {
  const lyricLineCount = normalizedLyricLineCount(project.lyricDisplay.lineCount)
  const style = resolveVocalStyle(stageStyle.lyrics, vocalStyle)
  return {
    title: project.title || 'Untitled song',
    artist: project.artist || 'Unknown artist',
    playbackMs: FIRST_WORD_MS + 1_500,
    showTitle: false,
    lyricLineCount,
    stageStyle,
    lines: designLyricLines('lead-vocal-design-track', style, lyricLineCount),
    syncAids: [],
  }
}
