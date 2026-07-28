import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Edit3, MonitorPlay, ShieldCheck } from 'lucide-react'
import {
  designPreviewFonts,
  previewFontKey,
  projectPreviewFonts,
  titleCardDesignPreviewFonts,
  usePreviewFonts,
  vocalDesignPreviewFonts,
} from '../hooks/usePreviewFonts'
import type { KaraokeProject, LyricDisplaySettings, LyricWord, VocalTrack } from '../lib/model'
import { formatTime, planLyricDisplayLines } from '../lib/model'
import { fontFamilyFor } from '../lib/font-runtime'
import {
  clampDisplayPosition,
  logicalObjectSize,
  moveDisplayPosition,
  snapDisplayPositionToStageCenter,
  type CenterSnapAxes,
} from '../lib/display-placement'
import {
  logicalStagePx,
  lyricGapPx,
  lyricObjectHeightPx,
  normalizedLyricLineCount,
  previewStageLayoutVariables,
  STAGE_LAYOUT,
} from '../lib/stage-layout'
import { previewFrameStateAt, type StageFrameLine } from '../lib/stage-frame-state'
import { designLyricLines, leadVocalDesignFrame } from '../lib/lead-vocal-design-frame'
import { SYNC_AID_GEOMETRY, syncAidBrightness, syncAidPosition } from '../lib/sync-aid-geometry'
import {
  DEFAULT_VOCAL_STYLE,
  resolveFontFace,
  resolveVocalStyle,
  type DisplayPosition,
  type LyricTextStyle,
  type StageStyle,
  type TextStyle,
  type VocalStyle,
} from '../lib/video-style'
import type {
  BackgroundImageLoadStatus,
  BackgroundImagePreviewSource,
} from '../hooks/useProjectBackgroundImage'
import { Button } from './ui'
import type { PlaybackClock } from '../hooks/usePlayback'

export type KaraokePreviewDesignMode =
  | { target: 'project-lyrics' | 'background'; stageStyle: StageStyle }
  | {
      target: 'lead-vocal'
      stageStyle: StageStyle
      vocalStyle: VocalStyle
      timingValid: boolean
      onPositionChange?: (position: DisplayPosition) => void
    }
  | {
      target: 'title-card'
      role: keyof StageStyle['titleCard']
      stageStyle: StageStyle
      onPositionChange?: (position: DisplayPosition) => void
    }
  | {
      target: 'stage-frame'
      role: StageFrameTextRole
      stageStyle: StageStyle
    }

type StageFrameTextRole = 'brand' | 'clock' | 'footer'
type TitleCardRole = keyof StageStyle['titleCard']
type PreviewViewMode = 'auto' | 'title' | 'song'

const TITLE_CARD_ROLES = [
  { label: 'Eyebrow', value: 'eyebrow' },
  { label: 'Title', value: 'title' },
  { label: 'Artist', value: 'artist' },
] as const satisfies ReadonlyArray<{ label: string; value: TitleCardRole }>

const NO_CENTER_SNAP: CenterSnapAxes = { x: false, y: false }

interface KaraokePreviewProps {
  activeVocalTrackId?: string
  project: KaraokeProject
  clock?: PlaybackClock
  /** Static preview values are retained for deterministic design/test renders. */
  playbackMs?: number
  lyricMs?: number
  selectedWordIds: Set<string>
  onVocalPositionChange?: (trackId: string, position: DisplayPosition) => void
  onTitlePositionChange?: (role: TitleCardRole, position: DisplayPosition) => void
  onUpdateLyricDisplay?: (patch: Partial<LyricDisplaySettings>) => void
  onEditLyrics?: () => void
  designMode?: KaraokePreviewDesignMode
  backgroundImage?: BackgroundImagePreviewSource
}

function textStyle(style: TextStyle, aliases: Record<string, string | null>): CSSProperties {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return {
    color: style.color,
    fontFamily: fontFamilyFor(style.typeface, aliases[previewFontKey(style)] ?? null),
    fontSize: logicalStagePx(style.sizePx),
    fontStyle: face.slant,
    fontWeight: face.weight,
    fontSynthesis: 'none',
  }
}

function lineKey(trackId: string, lineId: string) {
  return JSON.stringify([trackId, lineId])
}

function groupLinesByTrack(lines: StageFrameLine[]): StageFrameLine[][] {
  const groups = new Map<string, StageFrameLine[]>()
  lines.forEach((line) => {
    const group = groups.get(line.trackId) ?? []
    group.push(line)
    groups.set(line.trackId, group)
  })
  return [...groups.values()]
}

function projectLyricsDesignLines(style: LyricTextStyle, lineCount: number): StageFrameLine[] {
  return designLyricLines(
    'project-lyrics-design-track',
    resolveVocalStyle(style, DEFAULT_VOCAL_STYLE),
    lineCount,
  )
}

function wordProgress(word: LyricWord, lyricMs: number) {
  if (word.startMs === null || word.endMs === null) return 0
  if (lyricMs <= word.startMs) return 0
  if (lyricMs >= word.endMs) return 1
  return Math.max(0, Math.min(1, (lyricMs - word.startMs) / (word.endMs - word.startMs)))
}

function songPreviewLines(
  track: VocalTrack,
  lyricMs: number,
  settings: LyricDisplaySettings,
  stageStyle: StageStyle,
  selectedWordIds: Set<string>,
): StageFrameLine[] {
  const focusLineId =
    track.lines.find((line) => line.words.some((word) => selectedWordIds.has(word.id)))?.id ?? null
  let planned = planLyricDisplayLines(track, lyricMs, settings, focusLineId)
  if (planned.length === 0) {
    const lastLine = [...track.lines].reverse().find((line) => line.words.some((word) => word.text))
    planned = lastLine ? planLyricDisplayLines(track, lyricMs, settings, lastLine.id) : []
  }
  const style = resolveVocalStyle(stageStyle.lyrics, track.vocalStyle)
  return planned.map((line) => ({
    id: line.id,
    trackId: track.id,
    text: line.text.replaceAll('/', '·'),
    style,
    words: line.words
      .filter((word) => word.text)
      .map((word) => ({
        id: word.id,
        text: word.text.replaceAll('/', '·'),
        progress: wordProgress(word, lyricMs),
      })),
  }))
}

function DisplayObject({
  children,
  className,
  label,
  objectStyle,
  onCenterSnapChange,
  onSelect,
  onPositionChange,
  position,
  selected = false,
  stageRef,
  ...data
}: {
  children: ReactNode
  className: string
  label: string
  objectStyle?: CSSProperties
  onCenterSnapChange?: (axes: CenterSnapAxes) => void
  onSelect?: () => void
  onPositionChange?: (position: DisplayPosition) => void
  position: DisplayPosition
  selected?: boolean
  stageRef: RefObject<HTMLDivElement | null>
} & Record<`data-${string}`, string | undefined>) {
  const objectRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    latestPosition: DisplayPosition | null
    position: DisplayPosition
  } | null>(null)
  const centerSnapChangeRef = useRef(onCenterSnapChange)
  centerSnapChangeRef.current = onCenterSnapChange
  const [renderedPosition, setRenderedPosition] = useState(position)
  const interactive = Boolean(onPositionChange)

  useEffect(
    () => () => {
      if (dragRef.current) centerSnapChangeRef.current?.(NO_CENTER_SNAP)
    },
    [],
  )

  const measuredSize = () => {
    const stage = stageRef.current?.getBoundingClientRect()
    const object = objectRef.current?.getBoundingClientRect()
    return stage && object ? logicalObjectSize(stage, object) : { width: 0, height: 0 }
  }

  useLayoutEffect(() => {
    if (dragRef.current) return
    const size = measuredSize()
    const clamped = clampDisplayPosition(position, size.width, size.height)
    setRenderedPosition((current) =>
      current.x === clamped.x && current.y === clamped.y ? current : clamped,
    )
  })

  const move = (
    deltaX: number,
    deltaY: number,
    origin = position,
    centerSnap = false,
    bypassCenterSnap = false,
  ) => {
    if (!onPositionChange) return null
    const size = measuredSize()
    const moved = moveDisplayPosition(
      origin,
      deltaX,
      deltaY,
      size.width,
      size.height,
    ) as DisplayPosition
    const result = centerSnap
      ? snapDisplayPositionToStageCenter(moved, bypassCenterSnap)
      : { axes: NO_CENTER_SNAP, position: moved }
    if (centerSnap) onCenterSnapChange?.(result.axes)
    const next = result.position
    setRenderedPosition(next)
    return next
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPositionChange || event.button !== 0) return
    event.preventDefault()
    onSelect?.()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onCenterSnapChange?.(NO_CENTER_SNAP)
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      latestPosition: null,
      position,
    }
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const stage = stageRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !stage || stage.width <= 0) return
    drag.latestPosition = move(
      ((event.clientX - drag.clientX) / stage.width) * STAGE_LAYOUT.stage.widthPx,
      ((event.clientY - drag.clientY) / stage.height) * STAGE_LAYOUT.stage.heightPx,
      drag.position,
      true,
      event.altKey,
    )
  }
  const finishPointer = (event: PointerEvent<HTMLDivElement>, commit = true) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    onCenterSnapChange?.(NO_CENTER_SNAP)
    if (!commit) setRenderedPosition(drag.position)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (
      commit &&
      drag.latestPosition &&
      (drag.latestPosition.x !== drag.position.x || drag.latestPosition.y !== drag.position.y)
    ) {
      onPositionChange?.(drag.latestPosition)
    }
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPositionChange) return
    const step = event.shiftKey
      ? STAGE_LAYOUT.placement.keyboardLargeStepPx
      : STAGE_LAYOUT.placement.keyboardStepPx
    const delta =
      event.key === 'ArrowLeft'
        ? [-step, 0]
        : event.key === 'ArrowRight'
          ? [step, 0]
          : event.key === 'ArrowUp'
            ? [0, -step]
            : event.key === 'ArrowDown'
              ? [0, step]
              : null
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const next = move(delta[0], delta[1])
    if (next) onPositionChange(next)
  }

  return (
    <div
      {...data}
      ref={objectRef}
      className={className}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        selected
          ? `${label} position ${position.x}, ${position.y}. Drag or use arrow keys to move; hold Shift for 10 pixels.`
          : interactive
            ? `${label}. Select to move.`
            : undefined
      }
      aria-keyshortcuts={interactive ? 'ArrowUp ArrowDown ArrowLeft ArrowRight' : undefined}
      data-display-object={label}
      data-display-object-interactive={interactive ? 'true' : undefined}
      data-display-object-selected={selected ? 'true' : undefined}
      data-display-position-x={renderedPosition.x}
      data-display-position-y={renderedPosition.y}
      title={
        interactive ? 'Hold Option or Alt while dragging to bypass center snapping.' : undefined
      }
      onFocus={onSelect}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={(event) => finishPointer(event, false)}
      onPointerCancel={(event) => finishPointer(event, false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      style={{
        ...objectStyle,
        left: logicalStagePx(renderedPosition.x),
        top: logicalStagePx(renderedPosition.y),
      }}
    >
      {children}
    </div>
  )
}

function PreviewTitleCard({
  artist,
  aliases,
  designRole,
  interactiveRole,
  onCenterSnapChange,
  onInteractiveRoleChange,
  onPositionChange,
  onRolePositionChange,
  stageRef,
  stageStyle,
  title,
}: {
  artist: string
  aliases: Record<string, string | null>
  designRole?: TitleCardRole
  interactiveRole?: TitleCardRole | null
  onCenterSnapChange?: (axes: CenterSnapAxes) => void
  onInteractiveRoleChange?: (role: TitleCardRole) => void
  onPositionChange?: (position: DisplayPosition) => void
  onRolePositionChange?: (role: TitleCardRole, position: DisplayPosition) => void
  stageRef: RefObject<HTMLDivElement | null>
  stageStyle: StageStyle
  title: string
}) {
  const { eyebrow, title: titleStyle, artist: artistStyle } = stageStyle.titleCard
  const selectedHidden = designRole ? !stageStyle.titleCard[designRole].visible : false
  const selectedRole = designRole ?? interactiveRole
  const roleProps = (role: TitleCardRole) => ({
    'data-hidden-output': selectedHidden && designRole === role ? 'true' : undefined,
    'data-title-card-design-role': designRole === role ? role : undefined,
    'data-title-card-role': role,
  })
  const roleInteractionProps = (role: TitleCardRole) => ({
    onCenterSnapChange,
    onSelect:
      interactiveRole && onInteractiveRoleChange ? () => onInteractiveRoleChange(role) : undefined,
    onPositionChange:
      designRole === role
        ? onPositionChange
        : interactiveRole && onRolePositionChange
          ? (position: DisplayPosition) => onRolePositionChange(role, position)
          : undefined,
    selected: selectedRole === role,
  })

  return (
    <div className="title-card" data-design-preview={designRole ? 'title-card' : undefined}>
      {(eyebrow.visible || designRole === 'eyebrow') && (
        <DisplayObject
          {...roleProps('eyebrow')}
          {...roleInteractionProps('eyebrow')}
          className="title-card__object title-card__eyebrow"
          label="Eyebrow"
          objectStyle={textStyle(eyebrow, aliases)}
          position={eyebrow.position}
          stageRef={stageRef}
        >
          <span style={textStyle(eyebrow, aliases)}>Tonight&apos;s performance</span>
        </DisplayObject>
      )}
      {(titleStyle.visible || designRole === 'title') && (
        <DisplayObject
          {...roleProps('title')}
          {...roleInteractionProps('title')}
          className="title-card__object title-card__title"
          label="Song title"
          objectStyle={textStyle(titleStyle, aliases)}
          position={titleStyle.position}
          stageRef={stageRef}
        >
          <h3 style={textStyle(titleStyle, aliases)}>{title}</h3>
        </DisplayObject>
      )}
      {(artistStyle.visible || designRole === 'artist') && (
        <DisplayObject
          {...roleProps('artist')}
          {...roleInteractionProps('artist')}
          className="title-card__object title-card__artist"
          label="Artist"
          objectStyle={textStyle(artistStyle, aliases)}
          position={artistStyle.position}
          stageRef={stageRef}
        >
          <p style={textStyle(artistStyle, aliases)}>{artist}</p>
        </DisplayObject>
      )}
      {selectedHidden && (
        <span className="title-card-design-status" role="status">
          Hidden in output
        </span>
      )}
    </div>
  )
}

function PreviewLine({
  line,
  selectedWordIds,
  aliases,
  slot,
  lineCount,
}: {
  line: StageFrameLine
  selectedWordIds: Set<string>
  aliases: Record<string, string | null>
  slot?: number
  lineCount?: number
}) {
  const face = resolveFontFace(line.style.typeface, line.style.fontStyle)
  const translatedSlot = slot ?? line.slot
  const translateY =
    translatedSlot === undefined || lineCount === undefined
      ? undefined
      : logicalStagePx(
          translatedSlot *
            (line.style.sizePx * STAGE_LAYOUT.lyric.lineBoxEm + lyricGapPx(lineCount)),
        )
  return (
    <div
      className={`stage-line stage-line--${line.style.alignment}`}
      data-stage-font-size={line.style.sizePx}
      style={
        {
          '--track-color': line.style.sungColor,
          '--unsung-color': line.style.unsungColor,
          fontFamily: fontFamilyFor(
            line.style.typeface,
            aliases[previewFontKey(line.style)] ?? null,
          ),
          fontSize: logicalStagePx(line.style.sizePx),
          fontStyle: face.slant,
          fontWeight: face.weight,
          fontSynthesis: 'none',
          transform: translateY ? `translateY(${translateY})` : undefined,
        } as CSSProperties
      }
    >
      <p>
        <span className="stage-line__text" data-sync-line={lineKey(line.trackId, line.id)}>
          {line.words.map((word, index) => (
            <span
              key={word.id}
              className={`stage-word ${word.progress >= 1 ? 'is-done' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
              style={{ '--word-progress': `${word.progress * 100}%` } as CSSProperties}
            >
              {index ? ' ' : ''}
              {word.text}
            </span>
          ))}
        </span>
      </p>
    </div>
  )
}

function LyricDisplayObject({
  aliases,
  dataDesignPreview,
  label,
  lineCount,
  lines,
  onCenterSnapChange,
  onPositionChange,
  selected,
  selectedWordIds,
  stageRef,
  style,
  trackId,
}: {
  aliases: Record<string, string | null>
  dataDesignPreview?: string
  label: string
  lineCount: number
  lines: StageFrameLine[]
  onCenterSnapChange?: (axes: CenterSnapAxes) => void
  onPositionChange?: (position: DisplayPosition) => void
  selected: boolean
  selectedWordIds: Set<string>
  stageRef: RefObject<HTMLDivElement | null>
  style: StageFrameLine['style']
  trackId: string
}) {
  const footprintLines = designLyricLines(`${trackId}-footprint`, style, lineCount).map((line) => ({
    ...line,
    words: line.words.map((word) => ({ ...word, progress: 0 })),
  }))
  return (
    <DisplayObject
      className="active-lines"
      data-design-preview={dataDesignPreview}
      data-lyric-object-line-count={String(lineCount)}
      label={label}
      objectStyle={
        {
          '--stage-lyric-object-height': logicalStagePx(
            lyricObjectHeightPx(lineCount, style.sizePx),
          ),
        } as CSSProperties
      }
      position={style.position}
      selected={selected}
      stageRef={stageRef}
      onCenterSnapChange={onCenterSnapChange}
      onPositionChange={onPositionChange}
    >
      <div className="active-lines__footprint" aria-hidden="true">
        {footprintLines.map((line) => (
          <PreviewLine
            key={lineKey(line.trackId, line.id)}
            line={line}
            selectedWordIds={new Set()}
            aliases={aliases}
          />
        ))}
      </div>
      <div className="active-lines__content" data-lyric-object-content>
        {lines.map((line, index) => (
          <PreviewLine
            key={lineKey(line.trackId, line.id)}
            line={line}
            selectedWordIds={selectedWordIds}
            aliases={aliases}
            slot={line.slot ?? index}
            lineCount={lineCount}
          />
        ))}
      </div>
    </DisplayObject>
  )
}

function SyncAidCue({ line, progress }: { line: StageFrameLine; progress: number }) {
  const cueRef = useRef<HTMLDivElement>(null)
  const fallback =
    line.style.alignment === 'left' ? 128 : line.style.alignment === 'center' ? 960 : 1_792
  const [leadingEdgePx, setLeadingEdgePx] = useState(fallback)
  const key = lineKey(line.trackId, line.id)

  useLayoutEffect(() => {
    const cue = cueRef.current
    const stage = cue?.closest<HTMLElement>('.karaoke-stage')
    const text = [...(stage?.querySelectorAll<HTMLElement>('.stage-line__text') ?? [])].find(
      (element) => element.dataset.syncLine === key,
    )
    if (!stage || !text) return
    const measure = () => {
      const stageRect = stage.getBoundingClientRect()
      const textRect = text.getBoundingClientRect()
      if (stageRect.width > 0) {
        setLeadingEdgePx(((textRect.left - stageRect.left) * 1_920) / stageRect.width)
      }
    }
    setLeadingEdgePx(fallback)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(stage)
    observer?.observe(text)
    document.fonts?.addEventListener?.('loadingdone', measure)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      document.fonts?.removeEventListener?.('loadingdone', measure)
      window.removeEventListener('resize', measure)
    }
  }, [fallback, key])

  const position = syncAidPosition(leadingEdgePx)
  return (
    <div
      ref={cueRef}
      className="sync-aid"
      style={
        {
          '--sync-brightness': syncAidBrightness(progress),
          '--sync-color': line.style.sungColor,
          '--sync-end': logicalStagePx(position.endLeftPx),
          '--sync-progress': progress,
          '--sync-start': logicalStagePx(position.startLeftPx),
          '--sync-travel': logicalStagePx(position.travelPx),
          '--sync-width': logicalStagePx(SYNC_AID_GEOMETRY.cueWidthPx),
        } as CSSProperties
      }
    >
      <i />
    </div>
  )
}

export function KaraokePreview({
  activeVocalTrackId,
  project,
  clock,
  playbackMs: staticPlaybackMs,
  lyricMs: staticLyricMs,
  selectedWordIds,
  onVocalPositionChange,
  onTitlePositionChange,
  onUpdateLyricDisplay,
  onEditLyrics,
  designMode,
  backgroundImage,
}: KaraokePreviewProps) {
  const staticPlaybackMsRef = useRef(staticPlaybackMs ?? 0)
  staticPlaybackMsRef.current = staticPlaybackMs ?? 0
  const staticClockRef = useRef<PlaybackClock | null>(null)
  if (!staticClockRef.current) {
    staticClockRef.current = {
      subscribe: () => () => undefined,
      getSnapshot: () => staticPlaybackMsRef.current,
      getCurrentMs: () => staticPlaybackMsRef.current,
    }
  }
  const playbackClock = clock ?? staticClockRef.current
  const playbackSnapshot = useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  )
  const playbackMs = clock ? playbackSnapshot : (staticPlaybackMs ?? 0)
  const lyricMs = clock
    ? playbackMs - project.opening.leadInMs - project.offsetMs
    : (staticLyricMs ?? playbackMs - project.opening.leadInMs - project.offsetMs)
  const stageRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<PreviewViewMode>('auto')
  const [selectedTitleRole, setSelectedTitleRole] = useState<TitleCardRole>('title')
  const [centerSnapAxes, setCenterSnapAxes] = useState<CenterSnapAxes>(NO_CENTER_SNAP)
  const updateCenterSnapAxes = (axes: CenterSnapAxes) => {
    setCenterSnapAxes((current) => (current.x === axes.x && current.y === axes.y ? current : axes))
  }
  const designStyle = designMode?.stageStyle ?? null
  const previewProject = useMemo(
    () =>
      designMode?.target === 'background' || designMode?.target === 'stage-frame'
        ? { ...project, stageStyle: designMode.stageStyle }
        : project,
    [designMode, project],
  )
  const frame = useMemo(
    () => previewFrameStateAt(previewProject, playbackMs),
    [playbackMs, previewProject],
  )
  useEffect(() => {
    setViewMode('auto')
    setSelectedTitleRole('title')
  }, [project.id])
  const lyricLineCount = normalizedLyricLineCount(project.lyricDisplay.lineCount)
  const projectDesignLines = useMemo(() => {
    if (designMode?.target === 'project-lyrics') {
      return projectLyricsDesignLines(designMode.stageStyle.lyrics, lyricLineCount)
    }
    return null
  }, [designMode, lyricLineCount])
  const vocalDesignFrame = useMemo(
    () =>
      designMode?.target === 'lead-vocal'
        ? leadVocalDesignFrame(
            project,
            designMode.stageStyle,
            designMode.vocalStyle,
            designMode.timingValid,
          )
        : null,
    [designMode, project],
  )
  const designLines = projectDesignLines ?? vocalDesignFrame?.lines ?? null
  const isTitleCardDesign = designMode?.target === 'title-card'
  const stageFrameDesign = designMode?.target === 'stage-frame' ? designMode : null
  const selectedFonts =
    designMode?.target === 'project-lyrics'
      ? designPreviewFonts(designMode.stageStyle)
      : designMode?.target === 'lead-vocal'
        ? vocalDesignPreviewFonts(designMode.stageStyle, designMode.vocalStyle)
        : isTitleCardDesign
          ? titleCardDesignPreviewFonts(designMode.stageStyle, designMode.role)
          : projectPreviewFonts(previewProject)
  const fontRuntime = usePreviewFonts(selectedFonts)
  const stageStyle = designStyle ?? frame.stageStyle
  const background = stageStyle.background
  const [localImageReload, setLocalImageReload] = useState(0)
  const [imageLoad, setImageLoad] = useState<{
    status: BackgroundImageLoadStatus
    url: string | null
  }>({ status: 'idle', url: null })
  const imageUrl = backgroundImage?.url ?? null
  const imageResolutionStatus = backgroundImage?.resolutionStatus ?? 'missing'
  const imageReloadKey = backgroundImage?.reloadKey ?? 0
  const imageLoadStatusChangeRef = useRef(backgroundImage?.onLoadStatusChange)
  imageLoadStatusChangeRef.current = backgroundImage?.onLoadStatusChange

  useEffect(() => {
    setLocalImageReload(0)
  }, [imageUrl])

  useEffect(() => {
    if (!imageUrl || imageResolutionStatus !== 'available') {
      setImageLoad((current) =>
        current.status === 'idle' && current.url === imageUrl
          ? current
          : { status: 'idle', url: imageUrl },
      )
      return
    }

    let current = true
    const publish = (status: Exclude<BackgroundImageLoadStatus, 'idle'>) => {
      if (!current) return
      setImageLoad({ status, url: imageUrl })
      imageLoadStatusChangeRef.current?.(imageUrl, status)
    }
    publish('loading')
    const image = new Image()
    image.onload = () => publish('ready')
    image.onerror = () => publish('error')
    image.src = imageUrl
    return () => {
      current = false
      image.onload = null
      image.onerror = null
    }
  }, [imageReloadKey, imageResolutionStatus, imageUrl, localImageReload])

  const imageReady =
    background.mode === 'image' &&
    imageResolutionStatus === 'available' &&
    imageLoad.url === imageUrl &&
    imageLoad.status === 'ready'
  const backgroundStyle: CSSProperties =
    background.mode === 'solid'
      ? { background: background.solidColor }
      : background.mode === 'gradient'
        ? {
            background: `linear-gradient(145deg, ${background.gradientStartColor}, ${background.gradientEndColor})`,
          }
        : {
            backgroundColor: background.gradientEndColor,
            backgroundImage: imageReady
              ? `url(${JSON.stringify(imageUrl)})`
              : `linear-gradient(145deg, ${background.gradientStartColor}, ${background.gradientEndColor})`,
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
          }
  const retryImageLoad = () => {
    if (backgroundImage?.onRetryLoad) backgroundImage.onRetryLoad()
    else setLocalImageReload((current) => current + 1)
  }
  const imageWarning =
    background.mode !== 'image'
      ? null
      : imageResolutionStatus === 'loading'
        ? 'Loading linked background; using the gradient fallback.'
        : imageResolutionStatus === 'missing'
          ? 'Linked background is missing; using the gradient fallback.'
          : imageResolutionStatus === 'error'
            ? 'Linked background could not be restored; using the gradient fallback.'
            : imageLoad.url !== imageUrl ||
                imageLoad.status === 'loading' ||
                imageLoad.status === 'idle'
              ? 'Loading linked background; using the gradient fallback.'
              : imageLoad.status === 'error'
                ? 'Linked background could not be displayed; using the gradient fallback.'
                : null
  const stageFrame = stageStyle.stageFrame
  const stageVars = {
    ...backgroundStyle,
    ...previewStageLayoutVariables(lyricLineCount),
    '--stage-frame-color': stageFrame.lineColor,
    '--stage-frame-width': logicalStagePx(stageFrame.lineWidthPx),
  } as CSSProperties
  const cueFrame = vocalDesignFrame ?? frame
  const lines = new Map(cueFrame.lines.map((line) => [lineKey(line.trackId, line.id), line]))
  const isDesigning = Boolean(designMode)
  const stageClassName = designLines
    ? `karaoke-stage karaoke-stage--lines-${lyricLineCount} is-designing`
    : isTitleCardDesign
      ? 'karaoke-stage karaoke-stage--lines-1 is-designing is-designing-title-card'
      : stageFrameDesign
        ? `karaoke-stage karaoke-stage--lines-${lyricLineCount} is-designing is-designing-stage-frame`
        : `karaoke-stage karaoke-stage--lines-${lyricLineCount}${isDesigning ? ' is-designing' : ''}`
  const designLabel =
    designMode?.target === 'background'
      ? 'Background'
      : designMode?.target === 'lead-vocal'
        ? 'Lyrics'
        : isTitleCardDesign
          ? 'Title card'
          : stageFrameDesign
            ? 'Stage frame'
            : 'Lyrics'
  const rolePresentation = (role: StageFrameTextRole) => {
    const selected = stageFrameDesign?.role === role
    const outputVisible = stageFrame.enabled && stageFrame[role].visible
    const rendered =
      outputVisible || Boolean(stageFrameDesign && (selected || stageFrame[role].visible))
    const designOnly = Boolean(
      stageFrameDesign && (!stageFrame.enabled || !stageFrame[role].visible),
    )
    return {
      className:
        stageFrameDesign && !stageFrame.enabled && !selected ? ' stage-frame-design-context' : '',
      data: {
        'data-design-only': designOnly ? 'true' : undefined,
        'data-stage-frame-design-role': selected ? role : undefined,
        'data-stage-frame-role': role,
      },
      rendered,
    }
  }
  const brandPresentation = rolePresentation('brand')
  const clockPresentation = rolePresentation('clock')
  const footerPresentation = rolePresentation('footer')
  const renderStageFrameLine =
    stageFrame.lineWidthPx > 0 && (stageFrame.enabled || Boolean(stageFrameDesign))
  const stageFrameStatus = !stageFrameDesign
    ? null
    : !stageFrame.enabled
      ? { accessibleName: 'Stage frame off in output', text: 'Stage frame off in output' }
      : !stageFrame[stageFrameDesign.role].visible
        ? {
            accessibleName: `${stageFrameDesign.role[0].toUpperCase()}${stageFrameDesign.role.slice(1)} hidden in output`,
            text: 'Hidden in output',
          }
        : null
  const activeVocalTrack = project.tracks.find((track) => track.id === activeVocalTrackId) ?? null
  const previewContent =
    viewMode === 'auto'
      ? frame.showTitle && frame.lines.length
        ? 'title + song'
        : frame.showTitle
          ? 'title'
          : frame.lines.length
            ? 'song'
            : 'blank'
      : viewMode
  const visibleTitleRoles = TITLE_CARD_ROLES.filter(
    ({ value }) => stageStyle.titleCard[value].visible,
  )
  const effectiveTitleRole =
    visibleTitleRoles.find(({ value }) => value === selectedTitleRole)?.value ??
    visibleTitleRoles[0]?.value ??
    null
  const activeTrackHasLyrics = Boolean(
    activeVocalTrack?.lines.some((line) => line.words.some((word) => word.text)),
  )
  const pinnedSongLines = useMemo(
    () =>
      activeVocalTrack && activeTrackHasLyrics
        ? songPreviewLines(
            activeVocalTrack,
            lyricMs,
            project.lyricDisplay,
            stageStyle,
            selectedWordIds,
          )
        : [],
    [
      activeTrackHasLyrics,
      activeVocalTrack,
      lyricMs,
      project.lyricDisplay,
      selectedWordIds,
      stageStyle,
    ],
  )
  const liveLyricGroups = groupLinesByTrack(frame.lines).map((group) => ({
    lines: group,
    style: group[0]!.style,
    trackId: group[0]!.trackId,
  }))
  const previewLyricGroups =
    viewMode === 'song' && activeVocalTrack && activeTrackHasLyrics
      ? [
          {
            lines: pinnedSongLines,
            style: resolveVocalStyle(stageStyle.lyrics, activeVocalTrack.vocalStyle),
            trackId: activeVocalTrack.id,
          },
        ]
      : liveLyricGroups
  const selectedOutputTrackId =
    liveLyricGroups.find(({ trackId }) => trackId === activeVocalTrackId)?.trackId ??
    liveLyricGroups[0]?.trackId
  const selectedLyricTrackId = isDesigning
    ? activeVocalTrackId
    : viewMode === 'song'
      ? activeVocalTrackId
      : selectedOutputTrackId
  const trackNames = new Map(project.tracks.map((track) => [track.id, track.name]))
  const showTitleCard =
    isTitleCardDesign ||
    (isDesigning
      ? frame.showTitle
      : viewMode === 'title' || (viewMode === 'auto' && frame.showTitle))
  const showOutputLyrics =
    !isTitleCardDesign &&
    (isDesigning
      ? frame.lines.length > 0
      : viewMode === 'song' || (viewMode === 'auto' && frame.lines.length > 0))
  const syncAids = isDesigning ? cueFrame.syncAids : viewMode === 'auto' ? frame.syncAids : []

  return (
    <section
      className="preview-panel panel"
      aria-label={isDesigning ? `${designLabel} design preview` : 'Karaoke preview'}
      data-preview-content={isDesigning ? undefined : previewContent}
      data-preview-view-mode={isDesigning ? undefined : viewMode}
    >
      <header className="panel-header preview-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <MonitorPlay size={16} />
          </span>
          <div>
            <span className="eyebrow">{isDesigning ? designLabel : 'Stage monitor'}</span>
            <h2>
              {isDesigning
                ? 'Design preview'
                : viewMode === 'auto'
                  ? 'Live preview'
                  : `${viewMode === 'title' ? 'Title' : 'Song'} preview`}
            </h2>
          </div>
        </div>
        {isDesigning ? (
          <div className="preview-badges">
            {stageFrameStatus && (
              <span
                className="status-pill"
                role="status"
                aria-label={stageFrameStatus.accessibleName}
                data-stage-frame-output-status
              >
                {stageFrameStatus.text}
              </span>
            )}
            <span className="status-pill">Fixed 1920 × 1080 stage</span>
            <span className="status-pill">
              <ShieldCheck size={12} /> Title safe
            </span>
          </div>
        ) : (
          <div className="preview-toolbar">
            <label className="preview-setting preview-setting--view">
              <span>View</span>
              <select
                aria-label="Preview content"
                title="Auto follows the playhead; Title and Song pin an editor view"
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value as PreviewViewMode)}
              >
                <option value="auto">Auto</option>
                <option value="title">Title</option>
                <option value="song">Song</option>
              </select>
            </label>
            {showTitleCard ? (
              <label className="preview-setting">
                <span>Element</span>
                <select
                  aria-label="Movable title element"
                  disabled={!effectiveTitleRole}
                  title="Choose the visible title element to move"
                  value={effectiveTitleRole ?? ''}
                  onChange={(event) => setSelectedTitleRole(event.target.value as TitleCardRole)}
                >
                  {visibleTitleRoles.length ? (
                    visibleTitleRoles.map(({ label, value }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))
                  ) : (
                    <option value="">None visible</option>
                  )}
                </select>
              </label>
            ) : (
              <>
                <label className="preview-setting">
                  <span>Lines</span>
                  <select
                    aria-label="Visible lyric lines"
                    title="Choose how many lyric lines appear in the preview and exported video"
                    value={project.lyricDisplay.lineCount}
                    onChange={(event) =>
                      onUpdateLyricDisplay?.({ lineCount: Number(event.target.value) })
                    }
                  >
                    {[1, 2, 3, 4, 5].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="preview-setting">
                  <span>Advance</span>
                  <select
                    aria-label="Lyric line advance mode"
                    title="Clear replaces a page; Scroll advances one line at a time within a section"
                    value={project.lyricDisplay.advanceMode}
                    onChange={(event) =>
                      onUpdateLyricDisplay?.({
                        advanceMode: event.target.value as LyricDisplaySettings['advanceMode'],
                      })
                    }
                  >
                    <option value="clear">Clear</option>
                    <option value="scroll">Scroll</option>
                  </select>
                </label>
              </>
            )}
            {onEditLyrics && (
              <Button
                size="sm"
                variant="ghost"
                title="Open the lyric text editor"
                onClick={onEditLyrics}
              >
                <Edit3 size={13} /> Edit text
              </Button>
            )}
            <div className="preview-badges">
              {viewMode === 'auto' && (
                <span className="status-pill status-pill--live">
                  <i /> Live
                </span>
              )}
              <span className="status-pill">
                <ShieldCheck size={12} /> Title safe
              </span>
            </div>
          </div>
        )}
      </header>

      <div
        ref={stageRef}
        className={stageClassName}
        data-stage-canvas
        data-background-gradient-end-color={background.gradientEndColor}
        data-background-gradient-start-color={background.gradientStartColor}
        data-background-image-ready={imageReady ? 'true' : 'false'}
        data-background-mode={background.mode}
        data-background-solid-color={background.solidColor}
        data-logical-stage={isDesigning ? '1920x1080' : undefined}
        data-preview-content={isDesigning ? undefined : previewContent}
        style={stageVars}
      >
        <div className="karaoke-stage__grain" />
        {(centerSnapAxes.x || centerSnapAxes.y) && (
          <div className="karaoke-stage__center-guides" aria-hidden="true">
            {centerSnapAxes.x && (
              <i className="karaoke-stage__center-guide karaoke-stage__center-guide--x" />
            )}
            {centerSnapAxes.y && (
              <i className="karaoke-stage__center-guide karaoke-stage__center-guide--y" />
            )}
          </div>
        )}
        {imageWarning ? (
          <div className="stage-resource-warning" role="status">
            {imageWarning}{' '}
            {(imageResolutionStatus === 'missing' || imageResolutionStatus === 'error') &&
            backgroundImage?.onRetryResolution ? (
              <button onClick={backgroundImage.onRetryResolution}>Retry</button>
            ) : imageResolutionStatus === 'available' && imageLoad.status === 'error' ? (
              <button onClick={retryImageLoad}>Retry</button>
            ) : null}
          </div>
        ) : fontRuntime.loading ? (
          <div className="stage-resource-warning" role="status">
            Loading requested local font; previewing with System UI.
          </div>
        ) : (
          fontRuntime.failures[0] &&
          (isDesigning ? (
            <div className="stage-resource-warning" role="status">
              Requested font {fontRuntime.failures[0]} is unavailable; Preview and MP4 use System
              UI. <button onClick={fontRuntime.retry}>Retry</button>
            </div>
          ) : (
            <div className="stage-resource-warning" role="status">
              Requested font {fontRuntime.failures[0]} is unavailable; previewing with System UI.{' '}
              <button onClick={fontRuntime.retry}>Retry</button>
            </div>
          ))
        )}
        {renderStageFrameLine && (
          <div
            className={`karaoke-stage__safe-area${stageFrameDesign && !stageFrame.enabled ? ' stage-frame-design-context' : ''}`}
            aria-hidden="true"
            data-stage-frame-line
          />
        )}
        {brandPresentation.rendered && (
          <div
            className={`karaoke-stage__brand${brandPresentation.className}`}
            {...brandPresentation.data}
            style={textStyle(stageFrame.brand, fontRuntime.aliases)}
          >
            OKAY / STUDIO
          </div>
        )}
        {clockPresentation.rendered && (
          <div
            className={`karaoke-stage__time${clockPresentation.className}`}
            {...clockPresentation.data}
            style={textStyle(stageFrame.clock, fontRuntime.aliases)}
          >
            {formatTime(vocalDesignFrame?.playbackMs ?? playbackMs)}
          </div>
        )}
        <div className="karaoke-stage__content">
          {designLines ? (
            <LyricDisplayObject
              aliases={fontRuntime.aliases}
              dataDesignPreview={designMode?.target}
              label="Lyrics"
              lineCount={lyricLineCount}
              lines={designLines}
              onCenterSnapChange={updateCenterSnapAxes}
              selected={designMode?.target === 'lead-vocal'}
              selectedWordIds={selectedWordIds}
              stageRef={stageRef}
              style={
                designLines[0]?.style ?? resolveVocalStyle(stageStyle.lyrics, DEFAULT_VOCAL_STYLE)
              }
              trackId={designLines[0]?.trackId ?? 'design-lyrics'}
              onPositionChange={
                designMode?.target === 'lead-vocal' ? designMode.onPositionChange : undefined
              }
            />
          ) : null}
          {!designLines && showTitleCard && (
            <PreviewTitleCard
              artist={frame.artist}
              aliases={fontRuntime.aliases}
              designRole={isTitleCardDesign ? designMode.role : undefined}
              interactiveRole={
                !isDesigning && onTitlePositionChange ? effectiveTitleRole : undefined
              }
              onCenterSnapChange={updateCenterSnapAxes}
              onInteractiveRoleChange={
                !isDesigning && onTitlePositionChange ? setSelectedTitleRole : undefined
              }
              onPositionChange={isTitleCardDesign ? designMode.onPositionChange : undefined}
              onRolePositionChange={!isDesigning ? onTitlePositionChange : undefined}
              stageRef={stageRef}
              stageStyle={stageStyle}
              title={frame.title}
            />
          )}
          {!designLines &&
            showOutputLyrics &&
            previewLyricGroups.map(({ lines: trackLines, style, trackId }) => (
              <LyricDisplayObject
                key={trackId}
                aliases={fontRuntime.aliases}
                label={`${trackNames.get(trackId) ?? 'Singer'} lyric block`}
                lineCount={lyricLineCount}
                lines={trackLines}
                onCenterSnapChange={updateCenterSnapAxes}
                selected={
                  trackId === selectedLyricTrackId &&
                  Boolean(onVocalPositionChange) &&
                  !showTitleCard
                }
                selectedWordIds={selectedWordIds}
                stageRef={stageRef}
                style={style}
                trackId={trackId}
                onPositionChange={
                  trackId === selectedLyricTrackId && onVocalPositionChange
                    ? (position) => onVocalPositionChange(trackId, position)
                    : undefined
                }
              />
            ))}
          {!designLines &&
            !isDesigning &&
            viewMode === 'song' &&
            previewLyricGroups.length === 0 && (
              <p className="preview-stage-empty" role="status">
                Add lyrics to preview the Song view.
              </p>
            )}
        </div>
        {!projectDesignLines &&
          !isTitleCardDesign &&
          syncAids.map((aid) => {
            const line = lines.get(lineKey(aid.trackId, aid.lineId))
            return line ? (
              <SyncAidCue
                key={lineKey(aid.trackId, aid.lineId)}
                line={line}
                progress={aid.progress}
              />
            ) : null
          })}
        {footerPresentation.rendered && (
          <div
            className={`karaoke-stage__footer${footerPresentation.className}`}
            style={textStyle(stageFrame.footer, fontRuntime.aliases)}
          >
            <span {...footerPresentation.data}>
              {frame.artist} · {frame.title}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
