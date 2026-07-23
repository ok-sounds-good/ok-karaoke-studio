import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import type { KaraokeProject, LyricDisplaySettings } from '../lib/model'
import { formatTime } from '../lib/model'
import { fontFamilyFor } from '../lib/font-runtime'
import {
  clampDisplayPosition,
  logicalObjectSize,
  moveDisplayPosition,
} from '../lib/display-placement'
import { logicalStagePx, previewStageLayoutVariables, STAGE_LAYOUT } from '../lib/stage-layout'
import { previewFrameStateAt, type StageFrameLine } from '../lib/stage-frame-state'
import { DESIGN_LYRIC_WORDS, leadVocalDesignFrame } from '../lib/lead-vocal-design-frame'
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

interface KaraokePreviewProps {
  project: KaraokeProject
  playbackMs: number
  lyricMs: number
  selectedWordIds: Set<string>
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

function projectLyricsDesignLine(style: LyricTextStyle): StageFrameLine {
  return {
    id: 'project-lyrics-design-line',
    trackId: 'project-lyrics-design-track',
    text: DESIGN_LYRIC_WORDS.join(' '),
    style: resolveVocalStyle(style, DEFAULT_VOCAL_STYLE),
    words: DESIGN_LYRIC_WORDS.map((text, index) => ({
      id: `project-lyrics-design-word-${index}`,
      text,
      progress: index === 0 ? 1 : index === 1 ? 0.5 : 0,
    })),
  }
}

function DisplayObject({
  children,
  className,
  label,
  objectStyle,
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
    position: DisplayPosition
  } | null>(null)
  const [renderedPosition, setRenderedPosition] = useState(position)

  const measuredSize = () => {
    const stage = stageRef.current?.getBoundingClientRect()
    const object = objectRef.current?.getBoundingClientRect()
    return stage && object ? logicalObjectSize(stage, object) : { width: 0, height: 0 }
  }

  useLayoutEffect(() => {
    const size = measuredSize()
    const clamped = clampDisplayPosition(position, size.width, size.height)
    setRenderedPosition((current) =>
      current.x === clamped.x && current.y === clamped.y ? current : clamped,
    )
  })

  const move = (deltaX: number, deltaY: number, origin = position) => {
    if (!selected || !onPositionChange) return
    const size = measuredSize()
    onPositionChange(
      moveDisplayPosition(origin, deltaX, deltaY, size.width, size.height) as DisplayPosition,
    )
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!selected || !onPositionChange || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      position,
    }
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const stage = stageRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !stage || stage.width <= 0) return
    move(
      ((event.clientX - drag.clientX) / stage.width) * STAGE_LAYOUT.stage.widthPx,
      ((event.clientY - drag.clientY) / stage.height) * STAGE_LAYOUT.stage.heightPx,
      drag.position,
    )
  }
  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selected || !onPositionChange) return
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
    move(delta[0], delta[1])
  }

  return (
    <div
      {...data}
      ref={objectRef}
      className={className}
      tabIndex={selected ? 0 : undefined}
      aria-label={
        selected
          ? `${label} position ${position.x}, ${position.y}. Drag or use arrow keys to move; hold Shift for 10 pixels.`
          : undefined
      }
      aria-keyshortcuts={selected ? 'ArrowUp ArrowDown ArrowLeft ArrowRight' : undefined}
      data-display-object={label}
      data-display-object-selected={selected ? 'true' : undefined}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
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
  onPositionChange,
  stageRef,
  stageStyle,
  title,
}: {
  artist: string
  aliases: Record<string, string | null>
  designRole?: keyof StageStyle['titleCard']
  onPositionChange?: (position: DisplayPosition) => void
  stageRef: RefObject<HTMLDivElement | null>
  stageStyle: StageStyle
  title: string
}) {
  const { eyebrow, title: titleStyle, artist: artistStyle } = stageStyle.titleCard
  const selectedHidden = designRole ? !stageStyle.titleCard[designRole].visible : false
  const roleProps = (role: keyof StageStyle['titleCard']) => ({
    'data-hidden-output': selectedHidden && designRole === role ? 'true' : undefined,
    'data-title-card-design-role': designRole === role ? role : undefined,
    'data-title-card-role': role,
  })

  return (
    <div className="title-card" data-design-preview={designRole ? 'title-card' : undefined}>
      {(eyebrow.visible || designRole === 'eyebrow') && (
        <DisplayObject
          {...roleProps('eyebrow')}
          className="title-card__object title-card__eyebrow"
          label="Eyebrow"
          objectStyle={textStyle(eyebrow, aliases)}
          position={eyebrow.position}
          selected={designRole === 'eyebrow'}
          stageRef={stageRef}
          onPositionChange={designRole === 'eyebrow' ? onPositionChange : undefined}
        >
          <span style={textStyle(eyebrow, aliases)}>Tonight&apos;s performance</span>
        </DisplayObject>
      )}
      {(titleStyle.visible || designRole === 'title') && (
        <DisplayObject
          {...roleProps('title')}
          className="title-card__object title-card__title"
          label="Song title"
          objectStyle={textStyle(titleStyle, aliases)}
          position={titleStyle.position}
          selected={designRole === 'title'}
          stageRef={stageRef}
          onPositionChange={designRole === 'title' ? onPositionChange : undefined}
        >
          <h3 style={textStyle(titleStyle, aliases)}>{title}</h3>
        </DisplayObject>
      )}
      {(artistStyle.visible || designRole === 'artist') && (
        <DisplayObject
          {...roleProps('artist')}
          className="title-card__object title-card__artist"
          label="Artist"
          objectStyle={textStyle(artistStyle, aliases)}
          position={artistStyle.position}
          selected={designRole === 'artist'}
          stageRef={stageRef}
          onPositionChange={designRole === 'artist' ? onPositionChange : undefined}
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
}: {
  line: StageFrameLine
  selectedWordIds: Set<string>
  aliases: Record<string, string | null>
}) {
  const face = resolveFontFace(line.style.typeface, line.style.fontStyle)
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
  project,
  playbackMs,
  selectedWordIds,
  onUpdateLyricDisplay,
  onEditLyrics,
  designMode,
  backgroundImage,
}: KaraokePreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
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
  const projectDesignLine = useMemo(() => {
    if (designMode?.target === 'project-lyrics') {
      return projectLyricsDesignLine(designMode.stageStyle.lyrics)
    }
    return null
  }, [designMode])
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
  const designLines = projectDesignLine ? [projectDesignLine] : (vocalDesignFrame?.lines ?? null)
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
    ...previewStageLayoutVariables(
      designLines ? designLines.length : isTitleCardDesign ? 1 : frame.lines.length,
    ),
    '--stage-frame-color': stageFrame.lineColor,
    '--stage-frame-width': logicalStagePx(stageFrame.lineWidthPx),
  } as CSSProperties
  const cueFrame = vocalDesignFrame ?? frame
  const lines = new Map(cueFrame.lines.map((line) => [lineKey(line.trackId, line.id), line]))
  const isDesigning = Boolean(designMode)
  const stageClassName = designLines
    ? `karaoke-stage karaoke-stage--lines-${designLines.length} is-designing`
    : isTitleCardDesign
      ? 'karaoke-stage karaoke-stage--lines-1 is-designing is-designing-title-card'
      : stageFrameDesign
        ? `karaoke-stage karaoke-stage--lines-${project.lyricDisplay.lineCount} is-designing is-designing-stage-frame`
        : `karaoke-stage karaoke-stage--lines-${project.lyricDisplay.lineCount}${isDesigning ? ' is-designing' : ''}`
  const designLabel =
    designMode?.target === 'background'
      ? 'Background'
      : designMode?.target === 'lead-vocal'
        ? 'Lead Vocal'
        : isTitleCardDesign
          ? 'Title card'
          : stageFrameDesign
            ? 'Stage frame'
            : 'Project lyrics'
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

  return (
    <section
      className="preview-panel panel"
      aria-label={isDesigning ? `${designLabel} design preview` : 'Karaoke preview'}
    >
      <header className="panel-header preview-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <MonitorPlay size={16} />
          </span>
          <div>
            <span className="eyebrow">{isDesigning ? designLabel : 'Stage monitor'}</span>
            <h2>{isDesigning ? 'Design preview' : 'Live preview'}</h2>
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
              <span className="status-pill status-pill--live">
                <i /> Live
              </span>
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
        style={stageVars}
      >
        <div className="karaoke-stage__grain" />
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
            <DisplayObject
              className="active-lines"
              data-design-preview={designMode?.target}
              label={
                designMode?.target === 'lead-vocal' ? 'Active vocal lyric block' : 'Project lyrics'
              }
              position={designLines[0]?.style.position ?? DEFAULT_VOCAL_STYLE.position}
              selected={designMode?.target === 'lead-vocal'}
              stageRef={stageRef}
              onPositionChange={
                designMode?.target === 'lead-vocal' ? designMode.onPositionChange : undefined
              }
            >
              {designLines.map((line) => (
                <PreviewLine
                  key={lineKey(line.trackId, line.id)}
                  line={line}
                  selectedWordIds={selectedWordIds}
                  aliases={fontRuntime.aliases}
                />
              ))}
            </DisplayObject>
          ) : isTitleCardDesign || frame.showTitle ? (
            <PreviewTitleCard
              artist={frame.artist}
              aliases={fontRuntime.aliases}
              designRole={isTitleCardDesign ? designMode.role : undefined}
              onPositionChange={isTitleCardDesign ? designMode.onPositionChange : undefined}
              stageRef={stageRef}
              stageStyle={stageStyle}
              title={frame.title}
            />
          ) : frame.lines.length ? (
            groupLinesByTrack(frame.lines).map((group) => (
              <DisplayObject
                key={group[0]!.trackId}
                className="active-lines"
                label={`${group[0]!.trackId} lyric block`}
                position={group[0]!.style.position}
                stageRef={stageRef}
              >
                {group.map((line) => (
                  <PreviewLine
                    key={lineKey(line.trackId, line.id)}
                    line={line}
                    selectedWordIds={selectedWordIds}
                    aliases={fontRuntime.aliases}
                  />
                ))}
              </DisplayObject>
            ))
          ) : null}
        </div>
        {!projectDesignLine &&
          !isTitleCardDesign &&
          cueFrame.syncAids.map((aid) => {
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
