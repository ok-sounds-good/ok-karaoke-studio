import type { KaraokeProject } from './karaoke'
import type { ResolvedVocalStyle, StageStyle } from './video-style'
import '../../electron/stage-frame-state.cjs'

export interface StageFrameWord {
  id: string
  text: string
  progress: number
}

export interface StageFrameLine {
  id: string
  trackId: string
  text: string
  style: ResolvedVocalStyle
  words: StageFrameWord[]
}

export interface StageFrameSyncAid {
  lineId: string
  trackId: string
  startMs: number
  endMs: number
  durationMs: number
  progress: number
  style: ResolvedVocalStyle
}

export interface StageFrameState {
  title: string
  artist: string
  playbackMs: number
  showTitle: boolean
  lyricLineCount: number
  stageStyle: StageStyle
  lines: StageFrameLine[]
  syncAids: StageFrameSyncAid[]
}

export interface OpeningTimingAdvisoryInterval {
  startMs: number
  endMs: number
  types: Array<'lyrics' | 'sync aids'>
}

export interface OpeningTimingFacts {
  lyricStartMs: number | null
  titleEndMs: number
}

const planner = Reflect.get(globalThis, Symbol.for('studio.okay-karaoke.stage-frame-state')) as
  | undefined
  | {
      frameStateAt(project: KaraokeProject, playbackMs: number): StageFrameState
      titleEndForProject(project: KaraokeProject): number
      openingTimingAdvisoryForProject(project: KaraokeProject): OpeningTimingAdvisoryInterval[]
      openingTimingFactsForProject(project: KaraokeProject): OpeningTimingFacts
    }
if (!planner || !Object.isFrozen(planner))
  throw new Error('Shared stage planner was not installed.')

export function previewFrameStateAt(project: KaraokeProject, playbackMs: number): StageFrameState {
  return planner!.frameStateAt(project, playbackMs)
}

/** Static title interval end on the output video clock. Infinity means video end. */
export function previewTitleEndMs(project: KaraokeProject): number {
  return planner!.titleEndForProject(project)
}

export function openingTimingAdvisoryForProject(
  project: KaraokeProject,
): OpeningTimingAdvisoryInterval[] {
  return planner!.openingTimingAdvisoryForProject(project)
}

export function openingTimingFactsForProject(project: KaraokeProject): OpeningTimingFacts {
  return planner!.openingTimingFactsForProject(project)
}
