import type { KaraokeProject } from './karaoke'
import {
  cloneStageStyle,
  cloneVocalStyle,
  type StageStyle,
  type VocalStyle,
} from './video-style'
import { videoStyleValidationErrors } from './video-style-codec'

export interface VideoStyleDraft {
  stageStyle: StageStyle
  vocalStyles: Record<string, VocalStyle>
}

export function createVideoStyleDraft(project: KaraokeProject): VideoStyleDraft {
  return {
    stageStyle: cloneStageStyle(project.stageStyle),
    vocalStyles: Object.fromEntries(
      project.tracks.map((track) => [track.id, cloneVocalStyle(track.vocalStyle)]),
    ),
  }
}

export function cloneVideoStyleDraft(draft: VideoStyleDraft): VideoStyleDraft {
  return {
    stageStyle: cloneStageStyle(draft.stageStyle),
    vocalStyles: Object.fromEntries(
      Object.entries(draft.vocalStyles).map(([id, style]) => [id, cloneVocalStyle(style)]),
    ),
  }
}

export function projectWithVideoStyleDraft(
  project: KaraokeProject,
  draft: VideoStyleDraft,
): KaraokeProject {
  return {
    ...project,
    stageStyle: cloneStageStyle(draft.stageStyle),
    tracks: project.tracks.map((track) => ({
      ...track,
      vocalStyle: cloneVocalStyle(draft.vocalStyles[track.id] ?? track.vocalStyle),
    })),
  }
}

export function videoStyleDraftEqualsProject(
  draft: VideoStyleDraft,
  project: KaraokeProject,
): boolean {
  const current = createVideoStyleDraft(project)
  return JSON.stringify(draft) === JSON.stringify(current)
}

export function validateVideoStyleDraft(draft: VideoStyleDraft) {
  return videoStyleValidationErrors(
    draft.stageStyle,
    Object.entries(draft.vocalStyles).map(([trackId, style]) => ({
      path: `project.tracks[${trackId}].vocalStyle`,
      style,
    })),
  )
}

export function isVideoStyleDraftValid(draft: VideoStyleDraft): boolean {
  return validateVideoStyleDraft(draft).length === 0
}
