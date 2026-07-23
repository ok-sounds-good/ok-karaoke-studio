import type { ProjectStyleDraft } from '../hooks/useProjectStyleSession'
import type { StyleTemplate, StyleTemplatePreferences } from './style-template-codec'
import { cloneStageStyle, cloneVocalStyle } from './video-style'
import {
  VOCAL_STYLE_TIMING_ERROR,
  vocalStyleTimingDraft,
  vocalStyleWithTiming,
} from './vocal-style-timing'

export function captureStyleTemplatePreferences(
  draft: ProjectStyleDraft,
  selectedSingerTrackId: string,
): StyleTemplatePreferences {
  const singer = draft.singers.find(({ trackId }) => trackId === selectedSingerTrackId)
  if (!singer) throw new Error('Select a singer before saving a style template.')
  const vocalStyle = vocalStyleWithTiming(singer.vocalStyle, singer.vocalTiming)
  if (!vocalStyle) throw new Error(VOCAL_STYLE_TIMING_ERROR)

  return {
    stageStyle: cloneStageStyle(draft.stageStyle),
    lyricDisplay: { ...draft.lyricDisplay },
    vocalStyle,
    videoExportDefaults: { ...draft.videoExportDefaults },
  }
}

export function loadStyleTemplateIntoDraft(
  draft: ProjectStyleDraft,
  template: Pick<StyleTemplate, 'preferences'>,
  selectedSingerTrackId: string,
): ProjectStyleDraft {
  const preferences = template.preferences
  const vocalStyle = cloneVocalStyle(preferences.vocalStyle)
  return {
    ...draft,
    stageStyle: cloneStageStyle(preferences.stageStyle),
    lyricDisplay: { ...preferences.lyricDisplay },
    singers: draft.singers.map((singer) =>
      singer.trackId === selectedSingerTrackId
        ? {
            ...singer,
            vocalStyle,
            vocalTiming: vocalStyleTimingDraft(vocalStyle),
          }
        : singer,
    ),
    videoExportDefaults: { ...preferences.videoExportDefaults },
  }
}
