import type { KaraokeProject, VocalTrack } from '../lib/model'
import {
  MIN_EDITED_WORD_DURATION_MS,
  constrainWordResizeTiming,
  constrainWordShiftDelta,
  projectRawTimingCeiling,
  type ProjectTimingDraft,
} from '../utils'

type TimelineGestureSource = 'timing' | 'marquee'

export function createTimelineGestureActivity(
  getOnChange: () => ((active: boolean) => void) | undefined,
) {
  let activeSource: TimelineGestureSource | null = null

  return {
    begin(source: TimelineGestureSource) {
      if (activeSource !== null) return false
      activeSource = source
      getOnChange()?.(true)
      return true
    },
    end(source: TimelineGestureSource) {
      if (activeSource !== source) return false
      activeSource = null
      getOnChange()?.(false)
      return true
    },
    clear() {
      if (activeSource === null) return false
      activeSource = null
      getOnChange()?.(false)
      return true
    },
  }
}

export function timelineGestureScopeKey(
  projectId: string,
  activeTrackId: string,
  track: VocalTrack | undefined,
) {
  return JSON.stringify([
    projectId,
    activeTrackId,
    track?.lines.map((line) => [line.id, line.words.map((word) => word.id)]) ?? null,
  ])
}

export interface TimelineTimingGesture {
  wordId: string
  mode: 'move' | 'start' | 'end'
  originalStart: number
  originalEnd: number
  ids: Set<string>
  deltaMs: number
}

export interface TimelinePointerGesture extends TimelineTimingGesture {
  clientX: number
  pointerId: number
  captureTarget: EventTarget
}

export interface TimelineGestureContext {
  project: KaraokeProject
  pixelsPerSecond: number
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
}

export function timingDraftForGesture(
  project: KaraokeProject,
  gesture: TimelineTimingGesture,
): ProjectTimingDraft {
  const timingDraft = new Map<string, { startMs: number; endMs: number }>()

  if (gesture.mode === 'move') {
    const constrainedDeltaMs = constrainWordShiftDelta(project, gesture.ids, gesture.deltaMs)
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (!gesture.ids.has(word.id) || word.startMs === null) return
          const duration = Math.max(1, (word.endMs ?? word.startMs + 300) - word.startMs)
          const startMs = Math.max(0, Math.round(word.startMs + constrainedDeltaMs))
          timingDraft.set(word.id, { startMs, endMs: startMs + duration })
        })
      })
    })
    return timingDraft
  }

  const constrained = constrainWordResizeTiming(
    project,
    gesture.wordId,
    gesture.mode,
    gesture.mode === 'start' ? gesture.originalStart + gesture.deltaMs : gesture.originalStart,
    gesture.mode === 'end' ? gesture.originalEnd + gesture.deltaMs : gesture.originalEnd,
  )
  if (constrained) timingDraft.set(gesture.wordId, constrained)
  return timingDraft
}

interface GestureTimingBaseline {
  id: string
  startMs: number
  durationMs: number
}

interface MoveGesturePlan {
  mode: 'move'
  baselines: readonly GestureTimingBaseline[]
  minimumDeltaMs: number
  maximumDeltaMs: number
}

interface ResizeGesturePlan {
  mode: 'start' | 'end'
  wordId: string
  originalStartMs: number
  originalEndMs: number
  requestedEndBaselineMs: number
  minimumMs: number
  maximumMs: number
}

type GesturePlan = MoveGesturePlan | ResizeGesturePlan | null

function wordEndMs(startMs: number, endMs: number | null) {
  return Math.max(startMs + 1, endMs ?? startMs + 300)
}

function wordsInTrack(track: VocalTrack) {
  return track.lines.flatMap((line) => line.words)
}

/**
 * Captures every fact the repeated pointer path needs from the accepted project
 * revision. This keeps per-move work proportional only to the visible draft.
 */
function createGesturePlan(project: KaraokeProject, gesture: TimelineTimingGesture): GesturePlan {
  if (gesture.mode === 'move') {
    const baselines: GestureTimingBaseline[] = []
    let minimumDeltaMs = Number.NEGATIVE_INFINITY
    let maximumDeltaMs = Number.POSITIVE_INFINITY
    const timingCeiling = projectRawTimingCeiling(project)

    project.tracks.forEach((track) => {
      const words = wordsInTrack(track)
      let previousUnselectedEndMs: number | null = null
      words.forEach((word) => {
        if (gesture.ids.has(word.id) && word.startMs !== null) {
          const endMs = wordEndMs(word.startMs, word.endMs)
          baselines.push({ id: word.id, startMs: word.startMs, durationMs: endMs - word.startMs })
          minimumDeltaMs = Math.max(minimumDeltaMs, -word.startMs)
          maximumDeltaMs = Math.min(maximumDeltaMs, timingCeiling - endMs)
          if (previousUnselectedEndMs !== null) {
            minimumDeltaMs = Math.max(minimumDeltaMs, previousUnselectedEndMs - word.startMs)
          }
        } else if (word.startMs !== null) {
          previousUnselectedEndMs = wordEndMs(word.startMs, word.endMs)
        }
      })

      let nextUnselectedStartMs: number | null = null
      for (let index = words.length - 1; index >= 0; index -= 1) {
        const word = words[index]!
        if (gesture.ids.has(word.id) && word.startMs !== null) {
          const endMs = wordEndMs(word.startMs, word.endMs)
          if (nextUnselectedStartMs !== null) {
            maximumDeltaMs = Math.min(maximumDeltaMs, nextUnselectedStartMs - endMs)
          }
        } else if (word.startMs !== null) {
          nextUnselectedStartMs = word.startMs
        }
      }
    })

    return { mode: 'move', baselines, minimumDeltaMs, maximumDeltaMs }
  }

  for (const track of project.tracks) {
    const words = wordsInTrack(track)
    const index = words.findIndex((word) => word.id === gesture.wordId)
    if (index < 0) continue
    const word = words[index]!
    if (word.startMs === null) return null

    const originalStartMs = word.startMs
    const originalEndMs = wordEndMs(originalStartMs, word.endMs)
    if (gesture.mode === 'start') {
      let previousEndMs: number | null = null
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        const previous = words[previousIndex]!
        if (previous.startMs !== null) {
          previousEndMs = wordEndMs(previous.startMs, previous.endMs)
          break
        }
      }
      return {
        mode: 'start',
        wordId: word.id,
        originalStartMs,
        originalEndMs,
        requestedEndBaselineMs: gesture.originalEnd,
        minimumMs: Math.max(0, previousEndMs ?? 0),
        maximumMs: originalEndMs - MIN_EDITED_WORD_DURATION_MS,
      }
    }

    let nextStartMs: number | null = null
    for (let nextIndex = index + 1; nextIndex < words.length; nextIndex += 1) {
      const next = words[nextIndex]!
      if (next.startMs !== null) {
        nextStartMs = next.startMs
        break
      }
    }
    return {
      mode: 'end',
      wordId: word.id,
      originalStartMs,
      originalEndMs,
      requestedEndBaselineMs: gesture.originalEnd,
      minimumMs: originalStartMs + MIN_EDITED_WORD_DURATION_MS,
      maximumMs: Math.min(
        projectRawTimingCeiling(project),
        nextStartMs ?? Number.POSITIVE_INFINITY,
      ),
    }
  }
  return null
}

function constrainedPlanDelta(plan: MoveGesturePlan, requestedDeltaMs: number) {
  const requested = Math.round(requestedDeltaMs)
  if (!Number.isFinite(requested) || plan.baselines.length === 0) return 0
  if (plan.minimumDeltaMs > plan.maximumDeltaMs) return 0
  if (plan.minimumDeltaMs > 0 && requested <= 0) return 0
  if (plan.maximumDeltaMs < 0 && requested >= 0) return 0
  return Math.max(plan.minimumDeltaMs, Math.min(plan.maximumDeltaMs, requested))
}

function timingDraftForPlan(plan: GesturePlan, deltaMs: number): ProjectTimingDraft {
  const timingDraft = new Map<string, { startMs: number; endMs: number }>()
  if (!plan) return timingDraft

  if (plan.mode === 'move') {
    const constrainedDeltaMs = constrainedPlanDelta(plan, deltaMs)
    plan.baselines.forEach(({ id, startMs: baselineStartMs, durationMs }) => {
      const startMs = Math.max(0, Math.round(baselineStartMs + constrainedDeltaMs))
      timingDraft.set(id, { startMs, endMs: startMs + durationMs })
    })
    return timingDraft
  }

  const requested = Math.round(
    plan.mode === 'start' ? plan.originalStartMs + deltaMs : plan.requestedEndBaselineMs + deltaMs,
  )
  if (!Number.isFinite(requested) || plan.minimumMs > plan.maximumMs) {
    timingDraft.set(plan.wordId, { startMs: plan.originalStartMs, endMs: plan.originalEndMs })
    return timingDraft
  }
  if (
    (plan.mode === 'start' &&
      ((plan.originalStartMs < plan.minimumMs && requested <= plan.originalStartMs) ||
        (plan.originalStartMs > plan.maximumMs && requested >= plan.originalStartMs))) ||
    (plan.mode === 'end' &&
      ((plan.originalEndMs < plan.minimumMs && requested <= plan.originalEndMs) ||
        (plan.originalEndMs > plan.maximumMs && requested >= plan.originalEndMs)))
  ) {
    timingDraft.set(plan.wordId, { startMs: plan.originalStartMs, endMs: plan.originalEndMs })
    return timingDraft
  }

  const constrained = Math.max(plan.minimumMs, Math.min(plan.maximumMs, requested))
  timingDraft.set(
    plan.wordId,
    plan.mode === 'start'
      ? { startMs: constrained, endMs: plan.originalEndMs }
      : { startMs: plan.originalStartMs, endMs: constrained },
  )
  return timingDraft
}

export function createTimelineGestureSession(getContext: () => TimelineGestureContext) {
  let active: TimelinePointerGesture | null = null
  let activeProject: KaraokeProject | null = null
  let affectedTimingSnapshot = new Map<string, { startMs: number; endMs: number | null }>()
  let gesturePlan: GesturePlan = null
  let draftPublished = false

  const snapshotAffectedTimings = (project: KaraokeProject, gesture: TimelinePointerGesture) => {
    const affectedIds = gesture.mode === 'move' ? gesture.ids : new Set([gesture.wordId])
    const snapshot = new Map<string, { startMs: number; endMs: number | null }>()
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (affectedIds.has(word.id) && word.startMs !== null) {
            snapshot.set(word.id, { startMs: word.startMs, endMs: word.endMs })
          }
        })
      })
    })
    return snapshot
  }

  const affectedTimingsUnchanged = (project: KaraokeProject) => {
    if (!activeProject || project.id !== activeProject.id || affectedTimingSnapshot.size === 0)
      return false
    const remaining = new Map(affectedTimingSnapshot)
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          const timing = remaining.get(word.id)
          if (timing && word.startMs === timing.startMs && word.endMs === timing.endMs)
            remaining.delete(word.id)
        })
      })
    })
    return remaining.size === 0
  }

  const clear = (pointerId: number, captureTarget: EventTarget) => {
    if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return null
    const gesture = active
    active = null
    activeProject = null
    affectedTimingSnapshot = new Map()
    gesturePlan = null
    draftPublished = false
    getContext().onTimingDraftChange(null)
    return gesture
  }

  return {
    begin(gesture: TimelinePointerGesture) {
      if (active) return false
      active = gesture
      activeProject = getContext().project
      affectedTimingSnapshot = snapshotAffectedTimings(activeProject, gesture)
      gesturePlan = createGesturePlan(activeProject, gesture)
      draftPublished = false
      return true
    },
    move(pointerId: number, captureTarget: EventTarget, clientX: number) {
      if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return false
      const context = getContext()
      if (context.project !== activeProject) {
        if (!affectedTimingsUnchanged(context.project)) {
          clear(pointerId, captureTarget)
          return false
        }
        activeProject = context.project
        gesturePlan = createGesturePlan(activeProject, active)
      }
      const deltaMs = Math.round(((clientX - active.clientX) / context.pixelsPerSecond) * 1000)
      active = { ...active, deltaMs }
      context.onTimingDraftChange(timingDraftForPlan(gesturePlan, deltaMs))
      draftPublished = true
      return true
    },
    finish(pointerId: number, captureTarget: EventTarget) {
      const currentProject = getContext().project
      if (
        active?.pointerId === pointerId &&
        active.captureTarget === captureTarget &&
        currentProject !== activeProject
      ) {
        if (!affectedTimingsUnchanged(currentProject)) {
          clear(pointerId, captureTarget)
          return false
        }
        activeProject = currentProject
      }
      const gesture = clear(pointerId, captureTarget)
      if (!gesture) return false

      const context = getContext()
      if (gesture.mode === 'move') {
        const constrainedDeltaMs = constrainWordShiftDelta(
          context.project,
          gesture.ids,
          gesture.deltaMs,
        )
        if (constrainedDeltaMs !== 0) context.onShiftWords(gesture.ids, constrainedDeltaMs)
        return true
      }

      if (gesture.deltaMs === 0) return true

      const constrained = constrainWordResizeTiming(
        context.project,
        gesture.wordId,
        gesture.mode,
        gesture.mode === 'start' ? gesture.originalStart + gesture.deltaMs : gesture.originalStart,
        gesture.mode === 'end' ? gesture.originalEnd + gesture.deltaMs : gesture.originalEnd,
      )
      if (!constrained) return true
      const { startMs, endMs } = constrained
      if (startMs !== gesture.originalStart || endMs !== gesture.originalEnd) {
        context.onResizeWord(gesture.wordId, startMs, endMs)
      }
      return true
    },
    cancel(pointerId: number, captureTarget: EventTarget) {
      return clear(pointerId, captureTarget) !== null
    },
    owns(pointerId: number, captureTarget: EventTarget) {
      return active?.pointerId === pointerId && active.captureTarget === captureTarget
    },
    captureLost(pointerId: number, eventTarget: EventTarget | null) {
      if (active?.pointerId !== pointerId) return false
      const targetDisconnected =
        active.captureTarget instanceof Node && !active.captureTarget.isConnected
      if (eventTarget !== active.captureTarget && !targetDisconnected) return false
      return clear(pointerId, active.captureTarget) !== null
    },
    invalidateProject(project: KaraokeProject) {
      if (!active) return false
      if (project === activeProject) return false
      if (!affectedTimingsUnchanged(project)) {
        return clear(active.pointerId, active.captureTarget) !== null
      }
      activeProject = project
      gesturePlan = createGesturePlan(project, active)
      if (draftPublished) {
        getContext().onTimingDraftChange(timingDraftForPlan(gesturePlan, active.deltaMs))
      }
      return false
    },
    abandon() {
      const hadActiveGesture = active !== null
      active = null
      activeProject = null
      affectedTimingSnapshot = new Map()
      gesturePlan = null
      draftPublished = false
      return hadActiveGesture
    },
  }
}

export function safelyHasPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    return element.hasPointerCapture(pointerId)
  } catch {
    return false
  }
}

export function safelyReleasePointerCapture(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Capture may already have been released by the browser during cancellation.
  }
}
