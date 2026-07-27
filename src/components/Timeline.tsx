import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  SkipBack,
  TimerReset,
  Zap,
  ZoomIn,
} from 'lucide-react'
import type { KaraokeProject, LyricWord } from '../lib/model'
import type { PlaybackClock } from '../hooks/usePlayback'
import type { SyncSession } from '../lib/sync-session'
import { formatTime } from '../lib/model'
import { resolveVocalSungColor } from '../lib/video-style'
import { flattenTrack, motionAwareScrollBehavior, type ProjectTimingDraft } from '../utils'
import {
  buildTimelineTrackLayout,
  TIMELINE_LABEL_TOP_PX,
  TIMELINE_MIN_TRACK_HEIGHT_PX,
  TIMELINE_WORD_HEIGHT_PX,
  TIMELINE_LABEL_DOM_CAP_PER_TRACK,
  timelineLineRegionsInRect,
  timelineMountedLabels,
  timelineMountedWords,
  timelineTime,
  timelineWordIdsInRect,
  timelineWordLabel,
  type TimelineLineLayout,
  type TimelineTrackLayout,
} from './timeline-geometry'
import {
  createTimelineGestureActivity,
  createTimelineGestureSession,
  safelyHasPointerCapture,
  safelyReleasePointerCapture,
  timelineGestureScopeKey,
  type TimelineGestureContext,
  type TimelinePointerGesture,
} from './timeline-gestures'
import { Button, IconButton } from './ui'

interface TimelineProps {
  project: KaraokeProject
  peaks: number[]
  isAnalyzing: boolean
  durationMs: number
  clock?: PlaybackClock
  /** Static time is retained for deterministic mounted timeline tests. */
  currentMs?: number
  zoom: number
  activeTrackId: string
  selectedWordIds: Set<string>
  syncWordId: string | null
  syncSession?: SyncSession | null
  syncOwnerScope?: string | null
  syncMode: boolean
  onSeek: (timeMs: number) => void
  onZoom: (zoom: number) => void
  onSelectWord: (wordId: string, add: boolean) => void
  onSelectWords: (wordIds: Set<string>) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
  onGestureActiveChange?: (active: boolean) => void
  onToggleSync: () => void
  onClearTiming: () => void
  onClearTimingAfterCursor: () => void
}

interface TimelineMarquee {
  trackId: string
  pointerId: number
  captureTarget: EventTarget
  scopeKey: string
  add: boolean
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export interface TimelineViewportSnapshot {
  left: number
  top: number
  width: number
  height: number
}

export function createTimelineViewportStore(
  initial: TimelineViewportSnapshot = {
    left: 0,
    top: 0,
    // Browsers replace this before paint. The fallback preserves deterministic
    // mounted tests where happy-dom intentionally has no layout engine.
    width: 10_000,
    height: 0,
  },
) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(next: TimelineViewportSnapshot) {
      if (
        next.left === snapshot.left &&
        next.top === snapshot.top &&
        next.width === snapshot.width &&
        next.height === snapshot.height
      )
        return
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}

type TimelineViewportStore = ReturnType<typeof createTimelineViewportStore>

export function timelineSyncRevealPosition(
  viewport: TimelineViewportSnapshot,
  target: { left: number; width: number; top: number; height: number },
  margin = 130,
) {
  const horizontalVisible =
    target.left >= viewport.left + margin &&
    target.left + target.width <= viewport.left + viewport.width - margin
  const verticalVisible =
    target.top >= viewport.top + margin &&
    target.top + target.height <= viewport.top + viewport.height - margin
  if (horizontalVisible && verticalVisible) return null
  return {
    left: horizontalVisible
      ? viewport.left
      : Math.max(0, target.left - Math.max(0, viewport.width * 0.32)),
    top: verticalVisible
      ? viewport.top
      : Math.max(0, target.top - Math.max(0, viewport.height * 0.32)),
  }
}

export function indexTimelineLinesBySourceIndex(layout: TimelineTrackLayout | null) {
  return new Map<number, TimelineLineLayout>(
    layout?.lines.map((line) => [line.lineIndex, line]) ?? [],
  )
}

export function pendingLineLayoutAt(
  lineLayoutsBySourceIndex: Pick<ReadonlyMap<number, TimelineLineLayout>, 'get'>,
  lineIndex: number,
) {
  return lineLayoutsBySourceIndex.get(lineIndex)
}

function hasTimingStartingAtOrAfter(starts: readonly number[], boundaryMs: number) {
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (starts[middle]! < boundaryMs) low = middle + 1
    else high = middle
  }
  return low < starts.length
}

function TimelineWaveformProgress({
  clock,
  pixelsPerSecond,
  waveformLeft,
}: {
  clock: PlaybackClock
  pixelsPerSecond: number
  waveformLeft: number
}) {
  const currentMs = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
  const playheadLeft = (currentMs / 1000) * pixelsPerSecond
  return (
    <div className="waveform-played" style={{ width: Math.max(0, playheadLeft - waveformLeft) }} />
  )
}

function TimelinePlayhead({
  clock,
  pixelsPerSecond,
  viewportRef,
}: {
  clock: PlaybackClock
  pixelsPerSecond: number
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const currentMs = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
  const followBucket = Math.floor(currentMs / 500)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const left = ((followBucket * 500) / 1000) * pixelsPerSecond
    const margin = 130
    if (
      left < viewport.scrollLeft + margin ||
      left > viewport.scrollLeft + viewport.clientWidth - margin
    ) {
      viewport.scrollTo({
        left: Math.max(0, left - viewport.clientWidth * 0.32),
        behavior: 'auto',
      })
    }
  }, [followBucket, pixelsPerSecond, viewportRef])

  const playheadLeft = (currentMs / 1000) * pixelsPerSecond
  return (
    <div className="timeline-playhead" style={{ left: playheadLeft }} aria-hidden="true">
      <span>{formatTime(currentMs, true)}</span>
      <i />
    </div>
  )
}

function PendingSyncBlocks({
  session,
  lineLayoutsBySourceIndex,
  pixelsPerSecond,
  offsetMs,
  leadInMs,
  color,
  maxRecords = 64,
}: {
  session: SyncSession
  lineLayoutsBySourceIndex: ReadonlyMap<number, TimelineLineLayout>
  pixelsPerSecond: number
  offsetMs: number
  leadInMs: number
  color: string
  maxRecords?: number
}) {
  useSyncExternalStore(session.subscribe.bind(session), session.getSnapshot)
  return session
    .getPendingWords()
    .filter(
      (word) => word.startMs !== null && (!word.initiallyTimed || word.changedFromMaterialized),
    )
    .slice(0, maxRecords)
    .map((word) => {
      const line = pendingLineLayoutAt(lineLayoutsBySourceIndex, word.lineIndex)
      const wordLayout = line?.words[word.wordIndex]
      const start = Math.max(0, timelineTime(word.startMs!, offsetMs, leadInMs))
      const end = timelineTime(word.endMs ?? word.startMs! + 100, offsetMs, leadInMs)
      const timingLabel = `${word.text.replaceAll('/', '·')} timing block, ${formatTime(start, true)}–${formatTime(end, true)}`
      return (
        <span
          key={word.id}
          className="timeline-sync-pending"
          aria-hidden="true"
          data-sync-pending-word-id={word.id}
          data-timing-label={timingLabel}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
          style={
            {
              top: wordLayout?.top ?? 8,
              left: (start / 1000) * pixelsPerSecond,
              width: Math.max(2, ((end - start) / 1000) * pixelsPerSecond),
              height: TIMELINE_WORD_HEIGHT_PX,
              '--track-color': color,
              cursor: 'default',
            } as CSSProperties
          }
        />
      )
    })
}

function TimelineTrackLabels({
  project,
  activeTrackId,
  trackLayoutById,
  viewportStore,
  isAnalyzing,
}: {
  project: KaraokeProject
  activeTrackId: string
  trackLayoutById: ReadonlyMap<string, TimelineTrackLayout>
  viewportStore: TimelineViewportStore
  isAnalyzing: boolean
}) {
  const { top } = useSyncExternalStore(
    viewportStore.subscribe,
    viewportStore.getSnapshot,
    viewportStore.getSnapshot,
  )
  return (
    <div className="timeline-track-label-stack" style={{ transform: `translateY(${-top}px)` }}>
      <div className="timeline-label-spacer">
        <span>Waveform</span>
        {isAnalyzing && <i>Analyzing…</i>}
      </div>
      {project.tracks.map((track, index) => (
        <div
          key={track.id}
          className={`timeline-track-label ${track.id === activeTrackId ? 'is-active' : ''}`}
          style={{ height: trackLayoutById.get(track.id)?.height ?? TIMELINE_MIN_TRACK_HEIGHT_PX }}
        >
          <span style={{ background: resolveVocalSungColor(project.stageStyle, track.vocalStyle) }}>
            {index + 1}
          </span>
          <div>
            <strong>{track.name}</strong>
            <small>Voice {index + 1}</small>
          </div>
        </div>
      ))}
    </div>
  )
}

function TimelineDensityLanes({
  project,
  activeTrackId,
  trackLayoutById,
  viewportStore,
  viewportRef,
  selectedWordIds,
  syncSession,
  activeLineLayoutsBySourceIndex,
  pixelsPerSecond,
  timingDraft,
  marquee,
  onMarqueePointerDown,
  onMarqueePointerMove,
  onMarqueePointerUp,
  onMarqueePointerCancel,
  onMarqueeCaptureLost,
  onWordPointerDown,
  onWordPointerMove,
  onWordPointerUp,
  onWordPointerCancel,
  onWordCaptureLost,
  onWordKeyDown,
  onSeek,
  registerSyncTargetNode,
  pinnedWordIds,
  dragPinnedWordId,
  onFocusWord,
  onBlurWord,
}: {
  project: KaraokeProject
  activeTrackId: string
  trackLayoutById: ReadonlyMap<string, TimelineTrackLayout>
  viewportStore: TimelineViewportStore
  viewportRef: RefObject<HTMLDivElement | null>
  selectedWordIds: Set<string>
  syncSession?: SyncSession | null
  activeLineLayoutsBySourceIndex: ReadonlyMap<number, TimelineLineLayout>
  pixelsPerSecond: number
  timingDraft: ProjectTimingDraft | null
  marquee: TimelineMarquee | null
  onMarqueePointerDown: (event: ReactPointerEvent<HTMLDivElement>, trackId: string) => void
  onMarqueePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMarqueePointerUp: (
    event: ReactPointerEvent<HTMLDivElement>,
    layout: TimelineTrackLayout,
  ) => void
  onMarqueePointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMarqueeCaptureLost: (event: ReactPointerEvent<HTMLDivElement>) => void
  onWordPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, word: LyricWord) => void
  onWordPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onWordPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onWordPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onWordCaptureLost: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onWordKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    word: LyricWord,
    selected: boolean,
  ) => void
  onSeek: (timeMs: number) => void
  registerSyncTargetNode: (surface: string, wordId: string) => (node: HTMLElement | null) => void
  pinnedWordIds: ReadonlySet<string>
  dragPinnedWordId: string | null
  onFocusWord: (wordId: string, node: HTMLButtonElement) => void
  onBlurWord: (wordId: string, node: HTMLButtonElement) => void
}) {
  const viewport = useSyncExternalStore(
    viewportStore.subscribe,
    viewportStore.getSnapshot,
    viewportStore.getSnapshot,
  )
  const syncPresentation = useSyncExternalStore(
    (listener) => syncSession?.subscribe(listener) ?? (() => undefined),
    () => syncSession?.getSnapshot() ?? null,
    () => null,
  )
  const syncTargetId = syncPresentation?.targetWordId ?? null
  const windowLeft = Math.max(0, viewport.left - 180)
  const windowRight = viewport.left + Math.max(viewport.width, 1040) + 180
  const trackCanvasTopById = useMemo(() => {
    let top = 104
    const positions = new Map<string, number>()
    for (const track of project.tracks) {
      positions.set(track.id, top)
      top += trackLayoutById.get(track.id)?.height ?? TIMELINE_MIN_TRACK_HEIGHT_PX
    }
    return positions
  }, [project.tracks, trackLayoutById])

  useEffect(() => {
    if (!syncTargetId) return
    const layout = trackLayoutById.get(activeTrackId)
    const word = layout?.wordById.get(syncTargetId)
    const element = viewportRef.current
    if (!word || !element) return
    const snapshot = viewportStore.getSnapshot()
    const reveal = timelineSyncRevealPosition(snapshot, {
      left: word.left,
      width: word.width,
      top: (trackCanvasTopById.get(activeTrackId) ?? 104) + word.top,
      height: TIMELINE_WORD_HEIGHT_PX,
    })
    if (!reveal) return
    element.scrollTo({ ...reveal, behavior: 'auto' })
    viewportStore.update({ ...snapshot, ...reveal })
  }, [activeTrackId, syncTargetId, trackCanvasTopById, trackLayoutById, viewportRef, viewportStore])

  return (
    <div className="timeline-lanes">
      {(() => {
        let laneTop = 104
        return project.tracks.map((track) => {
          const layout = trackLayoutById.get(track.id)
          if (!layout) return null
          const currentLaneTop = laneTop
          laneTop += layout.height
          const forced = new Set(pinnedWordIds)
          if (dragPinnedWordId) forced.add(dragPinnedWordId)
          if (track.id === activeTrackId && syncTargetId) forced.add(syncTargetId)
          const pendingWords =
            syncSession && track.id === activeTrackId && syncSession.trackId === track.id
              ? syncSession
                  .getPendingWords()
                  .filter(
                    (word) =>
                      word.startMs !== null &&
                      (!word.initiallyTimed || word.changedFromMaterialized),
                  )
                  .slice(0, 64)
              : []
          const pendingIds = new Set(pendingWords.map((word) => word.id))
          const laneViewportTop = viewport.height
            ? Math.max(0, viewport.top - currentLaneTop)
            : Number.NaN
          const laneViewportBottom = viewport.height
            ? Math.max(0, viewport.top + viewport.height - currentLaneTop)
            : Number.NaN
          const mounted = timelineMountedWords(
            layout,
            windowLeft,
            windowRight,
            forced,
            Math.max(0, 96 - pendingWords.length),
            laneViewportTop,
            laneViewportBottom,
          )
          const mountedWords = mounted.words.filter((word) => !pendingIds.has(word.word.id))
          const labelForced = new Set<string>()
          if (track.id === activeTrackId && syncTargetId) labelForced.add(syncTargetId)
          const labels = timelineMountedLabels(
            layout,
            windowLeft,
            windowRight,
            laneViewportTop,
            laneViewportBottom,
            labelForced,
            TIMELINE_LABEL_DOM_CAP_PER_TRACK,
          )
          const lineRegions = timelineLineRegionsInRect(
            layout,
            windowLeft,
            windowRight,
            laneViewportTop,
            laneViewportBottom,
            TIMELINE_LABEL_DOM_CAP_PER_TRACK,
          ).values
          const aggregateTop = Number.isFinite(laneViewportTop)
            ? Math.max(
                3,
                Math.min(
                  Math.max(3, layout.height - 19),
                  Math.min(layout.height, laneViewportTop + 3),
                ),
              )
            : 3
          const activeMarquee = marquee?.trackId === track.id ? marquee : null
          const trackColor = resolveVocalSungColor(project.stageStyle, track.vocalStyle)
          return (
            <div
              key={track.id}
              data-track-id={track.id}
              className={`timeline-lane ${track.id === activeTrackId ? 'is-active' : ''}`}
              style={{ height: layout.height }}
              onPointerDown={(event) => onMarqueePointerDown(event, track.id)}
              onPointerMove={onMarqueePointerMove}
              onPointerUp={(event) => onMarqueePointerUp(event, layout)}
              onPointerCancel={onMarqueePointerCancel}
              onLostPointerCapture={onMarqueeCaptureLost}
            >
              {syncSession && track.id === activeTrackId && syncSession.trackId === track.id && (
                <PendingSyncBlocks
                  session={syncSession}
                  lineLayoutsBySourceIndex={activeLineLayoutsBySourceIndex}
                  pixelsPerSecond={pixelsPerSecond}
                  offsetMs={project.offsetMs}
                  leadInMs={project.opening.leadInMs}
                  color={trackColor}
                  maxRecords={pendingWords.length || 64}
                />
              )}
              {lineRegions.map((line) => (
                <span
                  key={line.line.id}
                  className="line-region"
                  style={
                    {
                      top: line.top,
                      left: line.intervalStart,
                      width: Math.max(1, line.intervalEnd - line.intervalStart),
                      height: line.height - 2,
                      '--track-color': trackColor,
                    } as CSSProperties
                  }
                />
              ))}
              {labels.map((label) => {
                const { word } = label.word
                const selected = selectedWordIds.has(word.id)
                const syncTarget = word.id === syncTargetId
                return (
                  <span
                    key={word.id}
                    ref={syncTarget ? registerSyncTargetNode('line-label', word.id) : undefined}
                    className={`timeline-line-label timeline-line-label__word ${selected ? 'is-selected' : ''}`}
                    style={
                      {
                        top: label.top + TIMELINE_LABEL_TOP_PX,
                        left: label.left,
                        width: label.width,
                        '--track-color': trackColor,
                      } as CSSProperties
                    }
                    aria-hidden="true"
                  >
                    {label.word.labelText}
                  </span>
                )
              })}
              {mountedWords.map((wordLayout) => {
                const { word } = wordLayout
                const draftTiming = timingDraft?.get(word.id)
                const rawStart = draftTiming?.startMs ?? word.startMs ?? 0
                const rawEnd = draftTiming?.endMs ?? word.endMs ?? rawStart + 360
                const adjustedStart = Math.max(
                  0,
                  timelineTime(rawStart, project.offsetMs, project.opening.leadInMs),
                )
                const adjustedEnd = timelineTime(rawEnd, project.offsetMs, project.opening.leadInMs)
                const timingLabel = `${formatTime(adjustedStart, true)}–${formatTime(adjustedEnd, true)}`
                const selected = selectedWordIds.has(word.id)
                return (
                  <button
                    ref={registerSyncTargetNode('timing-word', word.id)}
                    className={`timeline-word ${wordLayout.width < 14 ? 'is-compact' : ''} ${selected ? 'is-selected' : ''}`}
                    style={
                      {
                        top: wordLayout.top,
                        left: wordLayout.left,
                        width: wordLayout.width,
                        height: TIMELINE_WORD_HEIGHT_PX,
                        '--track-color': trackColor,
                      } as CSSProperties
                    }
                    aria-label={`${timelineWordLabel(word)} timing block, ${timingLabel}`}
                    aria-pressed={selected}
                    title={`${timelineWordLabel(word)} · ${timingLabel}`}
                    onFocus={(event) => onFocusWord(word.id, event.currentTarget)}
                    onBlur={(event) => onBlurWord(word.id, event.currentTarget)}
                    onKeyDown={(event) => onWordKeyDown(event, word, selected)}
                    onPointerDown={(event) => onWordPointerDown(event, word)}
                    onPointerMove={onWordPointerMove}
                    onPointerUp={onWordPointerUp}
                    onPointerCancel={onWordPointerCancel}
                    onLostPointerCapture={onWordCaptureLost}
                    onDoubleClick={() =>
                      onSeek(
                        Math.max(
                          0,
                          timelineTime(
                            word.startMs ?? 0,
                            project.offsetMs,
                            project.opening.leadInMs,
                          ),
                        ),
                      )
                    }
                  >
                    <i
                      data-resize="start"
                      className="timeline-word__handle timeline-word__handle--start"
                    />
                    <i
                      data-resize="end"
                      className="timeline-word__handle timeline-word__handle--end"
                    />
                  </button>
                )
              })}
              {mounted.omittedCount > 0 && (
                <span
                  className="timeline-density-aggregate"
                  role="status"
                  aria-label="Additional timing records in this view"
                  style={{ left: viewport.left + 8, top: aggregateTop }}
                >
                  Additional timing records in this view
                </span>
              )}
              {activeMarquee && (
                <span
                  className="timeline-marquee"
                  style={{
                    left: Math.min(activeMarquee.startX, activeMarquee.currentX),
                    top: Math.min(activeMarquee.startY, activeMarquee.currentY),
                    width: Math.abs(activeMarquee.currentX - activeMarquee.startX),
                    height: Math.abs(activeMarquee.currentY - activeMarquee.startY),
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          )
        })
      })()}
    </div>
  )
}

export function Timeline({
  project,
  peaks,
  isAnalyzing,
  durationMs,
  clock,
  currentMs = 0,
  zoom,
  activeTrackId,
  selectedWordIds,
  syncWordId,
  syncSession,
  syncOwnerScope,
  syncMode,
  onSeek,
  onZoom,
  onSelectWord,
  onSelectWords,
  onShiftWords,
  onResizeWord,
  onTimingDraftChange,
  onGestureActiveChange,
  onToggleSync,
  onClearTiming,
  onClearTimingAfterCursor,
}: TimelineProps) {
  const staticCurrentMsRef = useRef(currentMs)
  staticCurrentMsRef.current = currentMs
  const staticClockRef = useRef<PlaybackClock | null>(null)
  if (!staticClockRef.current) {
    staticClockRef.current = {
      subscribe: () => () => undefined,
      getSnapshot: () => staticCurrentMsRef.current,
      getCurrentMs: () => staticCurrentMsRef.current,
    }
  }
  const playbackClock = clock ?? staticClockRef.current
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportStoreRef = useRef<TimelineViewportStore | null>(null)
  if (!viewportStoreRef.current) viewportStoreRef.current = createTimelineViewportStore()
  const viewportStore = viewportStoreRef.current
  const syncTargetNodesRef = useRef(new Map<string, Map<HTMLElement, string>>())
  const syncTargetCallbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>())
  const activeSyncTargetRef = useRef<{ scope: string; wordId: string } | null>(null)
  const syncTargetScope =
    syncSession && syncSession.trackId === activeTrackId
      ? (syncOwnerScope ?? `${project.id}\0${activeTrackId}\0${syncSession.epoch}`)
      : null
  const syncTargetScopeRef = useRef(syncTargetScope)
  const [timingDraft, setTimingDraft] = useState<ProjectTimingDraft | null>(null)
  const [marquee, setMarquee] = useState<TimelineMarquee | null>(null)
  const marqueeRef = useRef<TimelineMarquee | null>(null)
  const mountedRef = useRef(true)
  const [pinnedWordIds, setPinnedWordIds] = useState<Set<string>>(() => new Set())
  const focusPinsRef = useRef(new Map<string, { node: HTMLButtonElement; scopeKey: string }>())
  const dragPinRef = useRef<{
    wordId: string
    pointerId: number
    captureTarget: EventTarget
    scopeKey: string
  } | null>(null)
  const [dragPinnedWordId, setDragPinnedWordId] = useState<string | null>(null)

  const clearSyncTargetNodes = useCallback((scope?: string) => {
    for (const [wordId, nodes] of syncTargetNodesRef.current) {
      for (const [node, nodeScope] of nodes) {
        if (scope !== undefined && nodeScope !== scope) continue
        node.classList.remove('is-sync-target')
        nodes.delete(node)
      }
      if (!nodes.size) syncTargetNodesRef.current.delete(wordId)
    }
  }, [])

  syncTargetScopeRef.current = syncTargetScope
  const registerSyncTargetNode = useCallback((surface: string, wordId: string) => {
    const scope = syncTargetScopeRef.current
    const callbackKey = `${scope ?? 'inactive'}\0${surface}\0${wordId}`
    const existing = syncTargetCallbacksRef.current.get(callbackKey)
    if (existing) return existing

    let attached: HTMLElement | null = null
    const callback = (node: HTMLElement | null) => {
      if (attached === node) return
      if (attached) {
        const nodes = syncTargetNodesRef.current.get(wordId)
        nodes?.delete(attached)
        attached.classList.remove('is-sync-target')
        if (nodes && !nodes.size) syncTargetNodesRef.current.delete(wordId)
      }
      attached = node
      if (!node) {
        if (syncTargetCallbacksRef.current.get(callbackKey) === callback) {
          syncTargetCallbacksRef.current.delete(callbackKey)
        }
        return
      }
      syncTargetCallbacksRef.current.set(callbackKey, callback)
      if (!scope) return
      const nodes = syncTargetNodesRef.current.get(wordId) ?? new Map<HTMLElement, string>()
      nodes.set(node, scope)
      syncTargetNodesRef.current.set(wordId, nodes)
      const activeTarget = activeSyncTargetRef.current
      if (activeTarget?.scope === scope && activeTarget.wordId === wordId) {
        node.classList.add('is-sync-target')
      }
    }

    syncTargetCallbacksRef.current.set(callbackKey, callback)
    return callback
  }, [])

  useEffect(() => {
    if (!syncSession || !syncTargetScope) {
      activeSyncTargetRef.current = null
      clearSyncTargetNodes()
      return
    }
    const apply = () => {
      const next = syncSession.getSnapshot().targetWordId
      const nextTarget = next ? { scope: syncTargetScope, wordId: next } : null
      const previous = activeSyncTargetRef.current
      if (previous?.scope === nextTarget?.scope && previous?.wordId === nextTarget?.wordId) {
        return
      }
      if (previous)
        syncTargetNodesRef.current.get(previous.wordId)?.forEach((scope, node) => {
          if (scope === previous.scope) node.classList.remove('is-sync-target')
        })
      if (nextTarget)
        syncTargetNodesRef.current.get(nextTarget.wordId)?.forEach((scope, node) => {
          if (scope === nextTarget.scope) node.classList.add('is-sync-target')
        })
      activeSyncTargetRef.current = nextTarget
    }
    apply()
    const unsubscribe = syncSession.subscribe(apply)
    return () => {
      unsubscribe()
      clearSyncTargetNodes(syncTargetScope)
      if (activeSyncTargetRef.current?.scope === syncTargetScope) {
        activeSyncTargetRef.current = null
      }
    }
  }, [clearSyncTargetNodes, syncSession, syncTargetScope])
  useEffect(
    () => () => {
      activeSyncTargetRef.current = null
      clearSyncTargetNodes()
      syncTargetCallbacksRef.current.clear()
    },
    [clearSyncTargetNodes],
  )
  const pixelsPerSecond = 72 * zoom
  const trackLayouts = useMemo(
    () =>
      project.tracks.map((track) =>
        buildTimelineTrackLayout(
          track,
          project.offsetMs,
          pixelsPerSecond,
          null,
          project.opening.leadInMs,
        ),
      ),
    [pixelsPerSecond, project.offsetMs, project.opening.leadInMs, project.tracks],
  )
  const trackLayoutById = useMemo(
    () => new Map(trackLayouts.map((layout) => [layout.trackId, layout])),
    [trackLayouts],
  )
  const activeLayout = trackLayoutById.get(activeTrackId) ?? null
  const activeLineLayoutsBySourceIndex = useMemo(
    () => activeLayout?.lineBySourceIndex ?? indexTimelineLinesBySourceIndex(activeLayout),
    [activeLayout],
  )
  const width = Math.max(
    1040,
    (durationMs / 1000) * pixelsPerSecond,
    ...trackLayouts.map((layout) => layout.maxRight + 24),
  )
  const waveformLeft = (project.opening.leadInMs / 1000) * pixelsPerSecond
  const waveformWidth =
    ((project.durationMs ?? Math.max(0, durationMs - project.opening.leadInMs)) / 1000) *
    pixelsPerSecond
  const tickStepSeconds = zoom < 0.8 ? 5 : zoom < 1.7 ? 2 : 1
  const labelStepSeconds = zoom < 0.8 ? 10 : zoom < 1.7 ? 5 : 2
  const activeTrack = project.tracks.find((track) => track.id === activeTrackId)
  const activeGestureScopeKey = useMemo(
    () => timelineGestureScopeKey(project.id, activeTrackId, activeTrack),
    [activeTrack, activeTrackId, project.id],
  )
  const activeTrackWords = useMemo(
    () => (activeTrack ? flattenTrack(activeTrack) : []),
    [activeTrack],
  )
  const activeTrackWordIds = useMemo(
    () => new Set(activeTrackWords.map(({ word }) => word.id)),
    [activeTrackWords],
  )
  const projectWordCount = useMemo(
    () => project.tracks.reduce((count, track) => count + flattenTrack(track).length, 0),
    [project.tracks],
  )
  const untimedWords = useMemo(
    () =>
      project.tracks.flatMap((track) =>
        flattenTrack(track)
          .filter(({ word }) => word.startMs === null)
          .map(({ word }) => ({ word, track })),
      ),
    [project.tracks],
  )
  const activeHasMaterializedTiming = Boolean(
    activeTrack?.lines.some(
      (line) =>
        line.startMs !== null ||
        line.endMs !== null ||
        line.words.some((word) => word.startMs !== null || word.endMs !== null),
    ),
  )
  const clearableTimingStarts = useMemo(
    () =>
      (
        activeTrack?.lines.flatMap((line) => {
          const wordStarts = line.words.flatMap((word) =>
            word.startMs === null ? [] : [word.startMs],
          )
          return wordStarts.length || line.startMs === null ? wordStarts : [line.startMs]
        }) ?? []
      ).sort((left, right) => left - right),
    [activeTrack],
  )
  const gestureContextRef = useRef<TimelineGestureContext | null>(null)
  const gestureActiveCallbackRef = useRef(onGestureActiveChange)
  gestureActiveCallbackRef.current = onGestureActiveChange
  const gestureActivityRef = useRef<ReturnType<typeof createTimelineGestureActivity> | null>(null)
  if (!gestureActivityRef.current) {
    gestureActivityRef.current = createTimelineGestureActivity(
      () => gestureActiveCallbackRef.current,
    )
  }
  const timingGestureScopeRef = useRef<string | null>(null)
  gestureContextRef.current = {
    project,
    pixelsPerSecond,
    onTimingDraftChange: (nextDraft) => {
      setTimingDraft(nextDraft)
      onTimingDraftChange(nextDraft)
    },
    onShiftWords,
    onResizeWord,
  }
  const gestureSessionRef = useRef<ReturnType<typeof createTimelineGestureSession> | null>(null)
  if (!gestureSessionRef.current) {
    gestureSessionRef.current = createTimelineGestureSession(() => gestureContextRef.current!)
  }
  const parentDraftCallbackRef = useRef(onTimingDraftChange)
  parentDraftCallbackRef.current = onTimingDraftChange

  useEffect(() => {
    // A compatible project revision retains the same structural scope and its
    // pins. A changed project, track, or word identity invalidates ownership.
    focusPinsRef.current.clear()
    dragPinRef.current = null
    setPinnedWordIds(new Set())
    setDragPinnedWordId(null)
  }, [activeGestureScopeKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () =>
      viewportStore.update({
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        width: viewport.clientWidth || viewportStore.getSnapshot().width,
        height: viewport.clientHeight || viewportStore.getSnapshot().height,
      })
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(viewport)
    return () => observer?.disconnect()
  }, [viewportStore])

  const finishTimingActivity = (finished: boolean) => {
    if (!finished) return false
    timingGestureScopeRef.current = null
    gestureActivityRef.current!.end('timing')
    return true
  }

  const clearDragPin = (pointerId?: number, captureTarget?: EventTarget | null) => {
    const pin = dragPinRef.current
    if (!pin || (pointerId !== undefined && pin.pointerId !== pointerId)) return false
    if (captureTarget !== undefined && captureTarget !== pin.captureTarget) return false
    dragPinRef.current = null
    setDragPinnedWordId(null)
    return true
  }

  const updateMarquee = (next: TimelineMarquee | null) => {
    marqueeRef.current = next
    if (mountedRef.current) setMarquee(next)
  }

  const clearMarquee = (pointerId?: number, eventTarget?: EventTarget | null) => {
    const activeMarquee = marqueeRef.current
    if (!activeMarquee || (pointerId !== undefined && activeMarquee.pointerId !== pointerId)) {
      return false
    }
    const targetDisconnected =
      activeMarquee.captureTarget instanceof Node && !activeMarquee.captureTarget.isConnected
    if (
      eventTarget !== undefined &&
      eventTarget !== activeMarquee.captureTarget &&
      !targetDisconnected
    ) {
      return false
    }
    updateMarquee(null)
    gestureActivityRef.current!.end('marquee')
    return true
  }
  const ticks = useMemo(
    () =>
      Array.from(
        { length: Math.ceil(durationMs / 1000 / tickStepSeconds) + 1 },
        (_, index) => index * tickStepSeconds,
      ),
    [durationMs, tickStepSeconds],
  )
  const waveformPath = useMemo(() => {
    const mid = 38
    const top = peaks.map((peak, index) => `${index},${mid - peak * 31}`).join(' L ')
    const bottom = [...peaks]
      .reverse()
      .map((peak, reverseIndex) => `${peaks.length - 1 - reverseIndex},${mid + peak * 31}`)
      .join(' L ')
    return `M 0,${mid} L ${top} L ${bottom} Z`
  }, [peaks])

  useLayoutEffect(() => {
    if (
      timingGestureScopeRef.current !== null &&
      timingGestureScopeRef.current !== activeGestureScopeKey
    ) {
      const abandoned = gestureSessionRef.current!.abandon()
      if (abandoned) gestureContextRef.current!.onTimingDraftChange(null)
      finishTimingActivity(abandoned)
      if (abandoned) clearDragPin()
    } else {
      const invalidated = gestureSessionRef.current!.invalidateProject(project)
      finishTimingActivity(invalidated)
      if (invalidated) clearDragPin()
    }
    if (marqueeRef.current && marqueeRef.current.scopeKey !== activeGestureScopeKey) {
      clearMarquee()
    }
  }, [activeGestureScopeKey, project])

  useEffect(() => {
    mountedRef.current = true
    const captureEnded = (event: Event) => {
      const pointerId = (event as PointerEvent).pointerId
      if (typeof pointerId !== 'number') return
      const finished = finishTimingActivity(
        gestureSessionRef.current!.captureLost(pointerId, event.target),
      )
      if (finished) clearDragPin(pointerId)
      clearMarquee(pointerId, event.target)
    }
    document.addEventListener('lostpointercapture', captureEnded, true)
    document.addEventListener('pointercancel', captureEnded, true)
    return () => {
      mountedRef.current = false
      document.removeEventListener('lostpointercapture', captureEnded, true)
      document.removeEventListener('pointercancel', captureEnded, true)
      if (gestureSessionRef.current!.abandon()) parentDraftCallbackRef.current(null)
      timingGestureScopeRef.current = null
      marqueeRef.current = null
      gestureActivityRef.current!.clear()
    }
  }, [])

  const seekFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x =
      event.clientX -
      bounds.left +
      (event.currentTarget.classList.contains('timeline-waveform') ? waveformLeft : 0)
    onSeek(Math.round((x / pixelsPerSecond) * 1000))
  }

  const lanePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  const marqueePointerDown = (event: ReactPointerEvent<HTMLDivElement>, trackId: string) => {
    if (
      trackId !== activeTrackId ||
      event.button !== 0 ||
      marqueeRef.current ||
      timingGestureScopeRef.current
    )
      return
    event.preventDefault()
    const point = lanePoint(event)
    const nextMarquee: TimelineMarquee = {
      trackId,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      scopeKey: activeGestureScopeKey,
      add: event.shiftKey || event.metaKey || event.ctrlKey,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    if (!safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    marqueeRef.current = nextMarquee
    if (!gestureActivityRef.current!.begin('marquee')) {
      marqueeRef.current = null
      safelyReleasePointerCapture(event.currentTarget, event.pointerId)
      return
    }
    if (mountedRef.current && marqueeRef.current === nextMarquee) setMarquee(nextMarquee)
  }

  const marqueePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeMarquee = marqueeRef.current
    if (
      !activeMarquee ||
      activeMarquee.pointerId !== event.pointerId ||
      activeMarquee.trackId !== activeTrackId
    )
      return
    event.preventDefault()
    const point = lanePoint(event)
    updateMarquee({ ...activeMarquee, currentX: point.x, currentY: point.y })
  }

  const marqueePointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
    layout: TimelineTrackLayout,
  ) => {
    const activeMarquee = marqueeRef.current
    if (
      !activeMarquee ||
      activeMarquee.pointerId !== event.pointerId ||
      activeMarquee.trackId !== layout.trackId
    )
      return
    const point = lanePoint(event)
    const selected = timelineWordIdsInRect(layout, {
      left: activeMarquee.startX,
      top: activeMarquee.startY,
      right: point.x,
      bottom: point.y,
    })
    const next = activeMarquee.add
      ? new Set([...selectedWordIds].filter((wordId) => activeTrackWordIds.has(wordId)))
      : new Set<string>()
    selected.forEach((wordId) => next.add(wordId))
    onSelectWords(next)
    clearMarquee(event.pointerId, event.currentTarget)
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const marqueePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!clearMarquee(event.pointerId, event.currentTarget)) return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const marqueeCaptureLost = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeRef.current?.pointerId !== event.pointerId) return
    if (safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    clearMarquee(event.pointerId, event.currentTarget)
  }

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, word: LyricWord) => {
    if (word.startMs === null || marqueeRef.current) return
    event.stopPropagation()
    const mode = (event.target as HTMLElement).dataset.resize as
      TimelinePointerGesture['mode'] | undefined
    const activeIds =
      selectedWordIds.has(word.id) && !mode ? new Set(selectedWordIds) : new Set([word.id])
    const drag: TimelinePointerGesture = {
      wordId: word.id,
      mode: mode ?? 'move',
      clientX: event.clientX,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      originalStart: word.startMs,
      originalEnd: word.endMs ?? word.startMs + 360,
      ids: activeIds,
      deltaMs: 0,
    }
    if (!gestureSessionRef.current!.begin(drag)) return
    dragPinRef.current = {
      wordId: word.id,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      scopeKey: activeGestureScopeKey,
    }
    setDragPinnedWordId(word.id)
    timingGestureScopeRef.current = activeGestureScopeKey
    if (!selectedWordIds.has(word.id))
      onSelectWord(word.id, event.shiftKey || event.metaKey || event.ctrlKey)
    if (!gestureSessionRef.current!.owns(event.pointerId, event.currentTarget)) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      gestureSessionRef.current!.abandon()
      timingGestureScopeRef.current = null
      clearDragPin(event.pointerId, event.currentTarget)
      return
    }
    if (!safelyHasPointerCapture(event.currentTarget, event.pointerId)) {
      gestureSessionRef.current!.abandon()
      timingGestureScopeRef.current = null
      clearDragPin(event.pointerId, event.currentTarget)
      return
    }
    if (!gestureActivityRef.current!.begin('timing')) {
      gestureSessionRef.current!.abandon()
      timingGestureScopeRef.current = null
      clearDragPin(event.pointerId, event.currentTarget)
      safelyReleasePointerCapture(event.currentTarget, event.pointerId)
      return
    }
  }

  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    gestureSessionRef.current!.move(event.pointerId, event.currentTarget, event.clientX)
  }

  const pointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !finishTimingActivity(gestureSessionRef.current!.finish(event.pointerId, event.currentTarget))
    )
      return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
    clearDragPin(event.pointerId, event.currentTarget)
  }

  const pointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !finishTimingActivity(gestureSessionRef.current!.cancel(event.pointerId, event.currentTarget))
    )
      return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
    clearDragPin(event.pointerId, event.currentTarget)
  }

  const lostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    const finished = finishTimingActivity(
      gestureSessionRef.current!.captureLost(event.pointerId, event.currentTarget),
    )
    if (finished) clearDragPin(event.pointerId, event.currentTarget)
  }

  const wordKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    word: LyricWord,
    selected: boolean,
  ) => {
    const isEnter = event.key === 'Enter'
    const isSpace = event.key === ' ' || event.code === 'Space'
    const isBareSpace =
      isSpace && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if ((!isEnter && !isBareSpace) || event.repeat) return
    // Bare Space owns tap-sync while synchronization is active. Enter remains
    // available for changing the editor selection without moving a timing block.
    // Modified Space chords bubble to the app-level shortcut handler.
    if (isBareSpace && syncMode) return
    event.preventDefault()
    event.stopPropagation()
    onSelectWord(word.id, selected || event.shiftKey || event.metaKey || event.ctrlKey)
  }

  const totalWordCount = projectWordCount

  return (
    <section className="timeline-panel panel" aria-label="Lyric Timing">
      <header className="panel-header timeline-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <AudioWaveform size={16} />
          </span>
          <div>
            <span className="eyebrow">Precision editor</span>
            <h2>Lyric Timing</h2>
          </div>
        </div>
        <div className="timeline-tools">
          <div className="timeline-sync-tools" aria-label="Timing controls">
            <Button
              size="sm"
              variant={syncMode ? 'primary' : 'secondary'}
              title={
                syncMode
                  ? 'Exit lyric synchronization (Escape)'
                  : 'Start lyric synchronization from the playhead'
              }
              disabled={!activeTrackWords.length}
              onClick={onToggleSync}
            >
              <Zap size={13} fill="currentColor" /> {syncMode ? 'Exit sync' : 'Start sync'}
            </Button>
            <SyncClearButtons
              clock={playbackClock}
              syncSession={syncSession ?? null}
              activeHasMaterializedTiming={activeHasMaterializedTiming}
              clearableTimingStarts={clearableTimingStarts}
              leadInMs={project.opening.leadInMs}
              offsetMs={project.offsetMs}
              onClearTiming={onClearTiming}
              onClearTimingAfterCursor={onClearTimingAfterCursor}
            />
          </div>
          <span className="timeline-hint">
            Drag words · drag empty space to select · click ruler to seek
          </span>
          <div className="timeline-navigation" aria-label="Timeline navigation">
            <IconButton
              aria-label="Jump timeline view to start"
              onClick={() =>
                viewportRef.current?.scrollTo({ left: 0, behavior: motionAwareScrollBehavior() })
              }
            >
              <SkipBack size={15} />
            </IconButton>
            <IconButton
              aria-label="Scroll timeline backward"
              onClick={() =>
                viewportRef.current?.scrollBy({ left: -420, behavior: motionAwareScrollBehavior() })
              }
            >
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton
              aria-label="Scroll timeline forward"
              onClick={() =>
                viewportRef.current?.scrollBy({ left: 420, behavior: motionAwareScrollBehavior() })
              }
            >
              <ChevronRight size={15} />
            </IconButton>
          </div>
          <div className="zoom-control">
            <Minus size={12} />
            <input
              aria-label="Timeline zoom"
              title="Zoom Lyric Timing horizontally"
              type="range"
              min="0.45"
              max="3.5"
              step="0.05"
              value={zoom}
              onChange={(event) => onZoom(Number(event.target.value))}
            />
            <Plus size={12} />
          </div>
          <span className="zoom-value">
            <ZoomIn size={12} />
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </header>

      <div className="timeline-workspace">
        <div
          className="timeline-track-labels"
          style={{ '--track-count': project.tracks.length } as CSSProperties}
        >
          <TimelineTrackLabels
            project={project}
            activeTrackId={activeTrackId}
            trackLayoutById={trackLayoutById}
            viewportStore={viewportStore}
            isAnalyzing={isAnalyzing}
          />
        </div>

        <div
          className="timeline-viewport"
          ref={viewportRef}
          onScroll={(event) =>
            viewportStore.update({
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
              width: event.currentTarget.clientWidth || viewportStore.getSnapshot().width,
              height: event.currentTarget.clientHeight || viewportStore.getSnapshot().height,
            })
          }
        >
          <div className="timeline-canvas" style={{ width }}>
            {project.opening.leadInMs > 0 && (
              <div
                className="timeline-lead-in"
                aria-label={`Opening lead-in, 0:00 to ${formatTime(project.opening.leadInMs)}`}
                style={{ width: waveformLeft }}
              />
            )}
            <div className="timeline-ruler" onPointerDown={seekFromPointer}>
              {ticks.map((second) => (
                <span
                  key={second}
                  className={`timeline-tick ${second % labelStepSeconds === 0 ? 'is-major' : ''}`}
                  style={{ left: second * pixelsPerSecond }}
                >
                  {second % labelStepSeconds === 0 && <b>{formatTime(second * 1000)}</b>}
                </span>
              ))}
            </div>

            <div
              className="timeline-waveform"
              style={{ marginLeft: waveformLeft, width: Math.max(0, waveformWidth) }}
              onPointerDown={seekFromPointer}
            >
              <svg
                viewBox={`0 0 ${Math.max(1, peaks.length - 1)} 76`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d={waveformPath} />
              </svg>
              <TimelineWaveformProgress
                clock={playbackClock}
                pixelsPerSecond={pixelsPerSecond}
                waveformLeft={waveformLeft}
              />
            </div>

            <TimelineDensityLanes
              project={project}
              activeTrackId={activeTrackId}
              trackLayoutById={trackLayoutById}
              viewportStore={viewportStore}
              viewportRef={viewportRef}
              selectedWordIds={selectedWordIds}
              syncSession={syncSession}
              activeLineLayoutsBySourceIndex={activeLineLayoutsBySourceIndex}
              pixelsPerSecond={pixelsPerSecond}
              timingDraft={timingDraft}
              marquee={marquee}
              onMarqueePointerDown={marqueePointerDown}
              onMarqueePointerMove={marqueePointerMove}
              onMarqueePointerUp={marqueePointerUp}
              onMarqueePointerCancel={marqueePointerCancel}
              onMarqueeCaptureLost={marqueeCaptureLost}
              onWordPointerDown={pointerDown}
              onWordPointerMove={pointerMove}
              onWordPointerUp={pointerUp}
              onWordPointerCancel={pointerCancel}
              onWordCaptureLost={lostPointerCapture}
              onWordKeyDown={wordKeyDown}
              onSeek={onSeek}
              registerSyncTargetNode={registerSyncTargetNode}
              pinnedWordIds={pinnedWordIds}
              dragPinnedWordId={dragPinnedWordId}
              onFocusWord={(wordId, node) => {
                focusPinsRef.current.set(wordId, { node, scopeKey: activeGestureScopeKey })
                setPinnedWordIds((current) => new Set(current).add(wordId))
              }}
              onBlurWord={(wordId, node) => {
                const pin = focusPinsRef.current.get(wordId)
                if (pin?.node !== node || pin.scopeKey !== activeGestureScopeKey) return
                focusPinsRef.current.delete(wordId)
                setPinnedWordIds((current) => {
                  const next = new Set(current)
                  next.delete(wordId)
                  return next
                })
              }}
            />
            <TimelinePlayhead
              clock={playbackClock}
              pixelsPerSecond={pixelsPerSecond}
              viewportRef={viewportRef}
            />
          </div>
        </div>
      </div>

      <div className={`untimed-tray ${untimedWords.length ? '' : 'untimed-tray--empty'}`}>
        <span className="untimed-tray__label">Untimed</span>
        <div>
          {untimedWords.length ? (
            untimedWords.slice(0, 28).map(({ word, track }) => (
              <button
                key={word.id}
                ref={registerSyncTargetNode('untimed-tray', word.id)}
                className={selectedWordIds.has(word.id) ? 'is-selected' : ''}
                style={
                  {
                    '--track-color': resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                  } as CSSProperties
                }
                title={`Select untimed word: ${timelineWordLabel(word)}`}
                onClick={(event) =>
                  onSelectWord(word.id, event.shiftKey || event.metaKey || event.ctrlKey)
                }
              >
                {word.text.replaceAll('/', '·')}
              </button>
            ))
          ) : (
            <span>{totalWordCount ? 'All words are timed.' : 'Add lyrics to start timing.'}</span>
          )}
          {untimedWords.length > 28 && <em>+{untimedWords.length - 28}</em>}
        </div>
      </div>
    </section>
  )
}

function SyncClearButtons({
  clock,
  syncSession,
  activeHasMaterializedTiming,
  clearableTimingStarts,
  leadInMs,
  offsetMs,
  onClearTiming,
  onClearTimingAfterCursor,
}: {
  clock: PlaybackClock
  syncSession: SyncSession | null
  activeHasMaterializedTiming: boolean
  clearableTimingStarts: readonly number[]
  leadInMs: number
  offsetMs: number
  onClearTiming: () => void
  onClearTimingAfterCursor: () => void
}) {
  const currentMs = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot)
  const snapshot = useSyncExternalStore(
    syncSession ? syncSession.subscribe.bind(syncSession) : () => () => undefined,
    syncSession ? syncSession.getSnapshot : () => null,
    () => null,
  )
  const clearBoundaryMs = Math.max(0, currentMs - leadInMs - offsetMs)
  const hasTiming = activeHasMaterializedTiming || Boolean(snapshot?.hasPending)
  const canClearPendingAfterCursor = Boolean(snapshot?.hasPending) && clearBoundaryMs === 0
  const canClearAfterCursor =
    clearBoundaryMs === 0
      ? activeHasMaterializedTiming
      : hasTimingStartingAtOrAfter(clearableTimingStarts, clearBoundaryMs)
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        title="Clear every timing in the active track; lyric text is preserved"
        disabled={!hasTiming}
        onClick={onClearTiming}
      >
        <RotateCcw size={13} /> Clear timing
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Clear active-track timings that begin at or after the playhead"
        disabled={!canClearAfterCursor && !canClearPendingAfterCursor}
        onClick={onClearTimingAfterCursor}
      >
        <TimerReset size={13} /> Clear from cursor
      </Button>
    </>
  )
}
