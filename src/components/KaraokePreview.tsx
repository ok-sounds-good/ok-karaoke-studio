import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Edit3, MonitorPlay, ShieldCheck } from 'lucide-react'
import type { KaraokeProject, LyricDisplaySettings, LyricLine, LyricWord, VocalTrack } from '../lib/model'
import {
  formatTime,
  planLyricDisplay,
  planSyncAid,
  titleHandoffPlaybackMs,
} from '../lib/model'
import {
  backgroundReadiness,
  resolveFontFace,
  resolveVocalStyle,
  type FontSizeStyle,
  type FontTypefaceDescriptor,
  type TextStyle,
} from '../lib/video-style'
import { fontFamilyFor, loadLocalFont } from '../lib/font-runtime'
import {
  SYNC_AID_GEOMETRY,
  syncAidBrightness,
  syncAidPosition,
} from '../lib/sync-aid-geometry'
import {
  logicalStagePx,
  previewStageLayoutVariables,
} from '../lib/stage-layout'
import { Button } from './ui'

interface KaraokePreviewProps {
  project: KaraokeProject
  playbackMs: number
  lyricMs: number
  selectedWordIds: Set<string>
  backgroundUrl?: string | null
  backgroundError?: string | null
  compactHeader?: boolean
  onUpdateLyricDisplay?: (patch: Partial<LyricDisplaySettings>) => void
  onEditLyrics?: () => void
}

function wordProgress(word: LyricWord, currentMs: number) {
  if (word.startMs === null) return 0
  const endMs = word.endMs ?? word.startMs + 350
  if (currentMs <= word.startMs) return 0
  if (currentMs >= endMs) return 1
  return (currentMs - word.startMs) / Math.max(1, endMs - word.startMs)
}

function fontKey(style: FontSizeStyle) {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return face.postscriptName ?? `${style.typeface.kind}:${face.style}:${face.weight}:${face.slant}`
}

function syncLineKey(trackId: string, lineId: string) {
  return `${trackId}:${lineId}`
}

function useFontAliases(project: KaraokeProject) {
  const fonts = useMemo(() => {
    const stage = project.stageStyle
    const values: FontSizeStyle[] = [
      stage.lyrics,
      stage.titleCard.eyebrow,
      stage.titleCard.title,
      stage.titleCard.artist,
      stage.stageFrame.brand,
      stage.stageFrame.clock,
      stage.stageFrame.footer,
      ...project.tracks.map((track) => resolveVocalStyle(stage.lyrics, track.vocalStyle)),
    ]
    return [...new Map(values.map((style) => [fontKey(style), style])).values()]
  }, [project.stageStyle, project.tracks])
  const [aliases, setAliases] = useState<Record<string, string | null>>({})
  const [unavailableFonts, setUnavailableFonts] = useState<Array<{
    typeface: FontTypefaceDescriptor
    fullName: string
  }>>([])
  const [retryGeneration, setRetryGeneration] = useState(0)
  useEffect(() => {
    let active = true
    void Promise.all(fonts.map(async (style) => ({
      alias: await loadLocalFont(style.typeface, style.fontStyle, retryGeneration > 0),
      face: resolveFontFace(style.typeface, style.fontStyle),
      key: fontKey(style),
      typeface: style.typeface,
    }))).then((loaded) => {
      if (!active) return
      setAliases(Object.fromEntries(loaded.map(({ alias, key }) => [key, alias])))
      setUnavailableFonts(loaded
        .filter(({ alias, typeface }) => typeface.kind === 'local' && alias === null)
        .map(({ face, typeface }) => ({ fullName: face.fullName, typeface })))
    })
    return () => { active = false }
  }, [fonts, retryGeneration])
  return {
    aliases,
    retry: () => setRetryGeneration((value) => value + 1),
    unavailableFonts,
  }
}

function textStyle(style: TextStyle, aliases: Record<string, string | null>): CSSProperties {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return {
    color: style.color,
    fontFamily: fontFamilyFor(style.typeface, aliases[fontKey(style)] ?? null),
    fontSize: logicalStagePx(style.sizePx),
    fontStyle: face.slant,
    fontWeight: face.weight,
    fontSynthesis: 'none',
  }
}

function PreviewLine({
  line,
  track,
  project,
  lyricMs,
  selectedWordIds,
  aliases,
}: {
  line: LyricLine
  track: VocalTrack
  project: KaraokeProject
  lyricMs: number
  selectedWordIds: Set<string>
  aliases: Record<string, string | null>
}) {
  const style = resolveVocalStyle(project.stageStyle.lyrics, track.vocalStyle)
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return (
    <div className={`stage-line stage-line--${style.alignment}`} style={{
      '--track-color': style.sungColor,
      '--unsung-color': style.unsungColor,
      '--lyric-font-size': logicalStagePx(style.sizePx),
      fontFamily: fontFamilyFor(style.typeface, aliases[fontKey(style)] ?? null),
      fontSize: logicalStagePx(style.sizePx),
      fontStyle: face.slant,
      fontWeight: face.weight,
      fontSynthesis: 'none',
    } as CSSProperties}>
      <p>
        <span className="stage-line__text" data-sync-line={syncLineKey(track.id, line.id)}>
          {line.words.map((word) => {
            const progress = wordProgress(word, lyricMs)
            return (
              <span
                key={word.id}
                className={`stage-word ${progress >= 1 ? 'is-done' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
                style={{ '--word-progress': `${progress * 100}%` } as CSSProperties}
              >
                {word.text.replaceAll('/', '·')}{' '}
              </span>
            )
          })}
        </span>
      </p>
    </div>
  )
}

export function SyncAidCue({
  alignment,
  color,
  lineKey,
  progress,
}: {
  alignment: 'left' | 'center' | 'right'
  color: string
  lineKey: string
  progress: number
}) {
  const cueRef = useRef<HTMLDivElement>(null)
  const fallbackLeading = alignment === 'left' ? 128 : alignment === 'center' ? 960 : 1_792
  const [leadingEdgePx, setLeadingEdgePx] = useState(fallbackLeading)

  useLayoutEffect(() => {
    const cue = cueRef.current
    const stage = cue?.closest<HTMLElement>('.karaoke-stage')
    if (!cue || !stage) return
    const text = [...stage.querySelectorAll<HTMLElement>('.stage-line__text[data-sync-line]')]
      .find((element) => element.dataset.syncLine === lineKey)
    const measure = () => {
      if (!text) return
      const stageRect = stage.getBoundingClientRect()
      const textRect = text.getBoundingClientRect()
      if (stageRect.width <= 0) return
      setLeadingEdgePx(
        (textRect.left - stageRect.left) * SYNC_AID_GEOMETRY.stageWidth / stageRect.width,
      )
    }
    setLeadingEdgePx(fallbackLeading)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(stage)
    if (text) observer?.observe(text)
    void document.fonts?.ready.then(measure)
    document.fonts?.addEventListener('loadingdone', measure)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      document.fonts?.removeEventListener('loadingdone', measure)
      window.removeEventListener('resize', measure)
    }
  }, [fallbackLeading, lineKey])

  const position = syncAidPosition(leadingEdgePx)
  return (
    <div
      ref={cueRef}
      className={`sync-aid sync-aid--${alignment}`}
      data-sync-line={lineKey}
      style={{
        '--sync-brightness': syncAidBrightness(progress),
        '--sync-color': color,
        '--sync-end': logicalStagePx(position.endLeftPx),
        '--sync-progress': progress,
        '--sync-start': logicalStagePx(position.startLeftPx),
        '--sync-travel': logicalStagePx(position.travelPx),
        '--sync-width': logicalStagePx(SYNC_AID_GEOMETRY.cueWidthPx),
      } as CSSProperties}
    >
      <i />
    </div>
  )
}

export function KaraokePreview({
  project,
  playbackMs,
  lyricMs,
  selectedWordIds,
  backgroundUrl = null,
  backgroundError = null,
  compactHeader = false,
  onUpdateLyricDisplay,
  onEditLyrics,
}: KaraokePreviewProps) {
  const fontRuntime = useFontAliases(project)
  const { aliases } = fontRuntime
  const unmutedTracks = useMemo(
    () => project.tracks.filter((track) => !track.muted),
    [project.tracks],
  )
  const visibleTracks = useMemo(() => {
    const hasSolo = unmutedTracks.some((track) => track.solo)
    return hasSolo ? unmutedTracks.filter((track) => track.solo) : unmutedTracks
  }, [unmutedTracks])
  const trackWindows = visibleTracks.map((track) => ({
    track,
    planned: planLyricDisplay(track, lyricMs, project.lyricDisplay),
  }))
  const displayLines: Array<{ track: VocalTrack; line: LyricLine }> = []
  for (
    let lineIndex = 0;
    lineIndex < project.lyricDisplay.lineCount && displayLines.length < project.lyricDisplay.lineCount;
    lineIndex += 1
  ) {
    trackWindows.forEach(({ track, planned }) => {
      const line = planned[lineIndex]?.line
      if (line && displayLines.length < project.lyricDisplay.lineCount) displayLines.push({ track, line })
    })
  }
  const admittedLineKeys = new Set(
    displayLines.map(({ track, line }) => `${track.id}:${line.id}`),
  )
  const syncAids = trackWindows.flatMap(({ track, planned }) => {
    const aid = planSyncAid(track, planned, lyricMs)
    return aid && admittedLineKeys.has(`${track.id}:${aid.lineId}`) ? [{ track, aid }] : []
  })
  const showTitle = playbackMs < titleHandoffPlaybackMs(project)
  const background = project.stageStyle.background
  const imageReadiness = backgroundReadiness(background, backgroundUrl, backgroundError)
  const backgroundStyle: CSSProperties = background.mode === 'solid'
    ? { background: background.solidColor }
    : background.mode === 'image' && backgroundUrl
      ? { backgroundColor: background.gradientEndColor, backgroundImage: `url("${backgroundUrl}")`, backgroundPosition: 'center', backgroundSize: 'cover' }
      : { background: `linear-gradient(145deg, ${background.gradientStartColor}, ${background.gradientEndColor})` }
  const frame = project.stageStyle.stageFrame
  const stageVars = {
    ...backgroundStyle,
    ...previewStageLayoutVariables(displayLines.length),
    '--stage-frame-color': frame.lineColor,
    '--stage-frame-width': logicalStagePx(frame.lineWidthPx),
  } as CSSProperties

  return (
    <section className={`preview-panel panel ${compactHeader ? 'preview-panel--compact' : ''}`} aria-label="Karaoke preview">
      <header className="panel-header preview-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon"><MonitorPlay size={16} /></span>
          <div><span className="eyebrow">Stage monitor</span><h2>Live preview</h2></div>
        </div>
        {!compactHeader && <div className="preview-toolbar">
          <label className="preview-setting"><span>Lines</span><select aria-label="Visible lyric lines" value={project.lyricDisplay.lineCount} onChange={(event) => onUpdateLyricDisplay?.({ lineCount: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label className="preview-setting"><span>Advance</span><select aria-label="Lyric line advance mode" value={project.lyricDisplay.advanceMode} onChange={(event) => onUpdateLyricDisplay?.({ advanceMode: event.target.value as LyricDisplaySettings['advanceMode'] })}><option value="clear">Clear</option><option value="scroll">Scroll</option></select></label>
          {onEditLyrics && <Button size="sm" variant="ghost" title="Open the lyric text editor" onClick={onEditLyrics}><Edit3 size={13} /> Edit text</Button>}
          <div className="preview-badges"><span className="status-pill status-pill--live"><i /> Live</span><span className="status-pill"><ShieldCheck size={12} /> Title safe</span></div>
        </div>}
      </header>

      <div className={`karaoke-stage karaoke-stage--lines-${project.lyricDisplay.lineCount}`} style={stageVars}>
        <div className="karaoke-stage__grain" />
        {!imageReadiness.ready ? (
          <div className="stage-resource-warning" role="status">
            {imageReadiness.reason}
          </div>
        ) : fontRuntime.unavailableFonts.length > 0 && (
          <div className="stage-resource-warning" role="status">
            Requested font {fontRuntime.unavailableFonts[0].fullName} is unavailable;
            {' '}previewing with System UI.
            <button onClick={fontRuntime.retry}>Retry</button>
          </div>
        )}
        {frame.enabled && (
          <div
            className="karaoke-stage__safe-area"
            aria-hidden="true"
            style={{ borderColor: frame.lineColor, borderWidth: logicalStagePx(frame.lineWidthPx) }}
          />
        )}
        {frame.enabled && frame.brand.visible && <div className="karaoke-stage__brand" style={textStyle(frame.brand, aliases)}>OKAY / STUDIO</div>}
        {frame.enabled && frame.clock.visible && <div className="karaoke-stage__time" style={textStyle(frame.clock, aliases)}>{formatTime(playbackMs)}</div>}
        <div className="karaoke-stage__content">
          {showTitle ? (
            <div className="title-card">
              {project.stageStyle.titleCard.eyebrow.visible && <span style={textStyle(project.stageStyle.titleCard.eyebrow, aliases)}>Tonight&apos;s performance</span>}
              {project.stageStyle.titleCard.title.visible && <h3 style={textStyle(project.stageStyle.titleCard.title, aliases)}>{project.title || 'Untitled song'}</h3>}
              {project.stageStyle.titleCard.artist.visible && <p style={textStyle(project.stageStyle.titleCard.artist, aliases)}>{project.artist || 'Unknown artist'}</p>}
            </div>
          ) : displayLines.length ? (
            <div className="active-lines">
              {displayLines.map(({ line, track }) => <PreviewLine key={`${track.id}-${line.id}`} line={line} track={track} project={project} lyricMs={lyricMs} selectedWordIds={selectedWordIds} aliases={aliases} />)}
            </div>
          ) : null}
        </div>
        {syncAids.map(({ track, aid }) => {
          const style = resolveVocalStyle(project.stageStyle.lyrics, track.vocalStyle)
          return (
            <SyncAidCue
              key={`${track.id}-${aid.lineId}`}
              alignment={style.alignment}
              color={style.sungColor}
              lineKey={syncLineKey(track.id, aid.lineId)}
              progress={aid.progress}
            />
          )
        })}
        {frame.enabled && frame.footer.visible && (
          <div className="karaoke-stage__footer" style={textStyle(frame.footer, aliases)}>
            <span>{project.artist || 'Unknown artist'} · {project.title || 'Untitled song'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
