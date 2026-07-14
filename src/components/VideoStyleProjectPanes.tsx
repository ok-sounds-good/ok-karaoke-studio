import { AlertTriangle, ImagePlus, Palette, Type } from 'lucide-react'
import {
  normalizeStyleInteger,
  type BackgroundMode,
  type StageStyle,
  type VisibleTextStyle,
} from '../lib/video-style'
import { Button } from './ui'
import { ColorField, FontSummary, TextRoleEditor } from './VideoStyleFields'

export type ProjectStyleSection = 'background' | 'lyrics' | 'title' | 'frame'
export type ProjectFontTarget =
  | 'lyrics'
  | 'title-eyebrow'
  | 'title-title'
  | 'title-artist'
  | 'frame-brand'
  | 'frame-clock'
  | 'frame-footer'

interface ProjectPanesProps {
  section: ProjectStyleSection
  stageStyle: StageStyle
  backgroundError: string | null
  onStageChange: (change: (style: StageStyle) => void) => void
  onChooseBackground: () => void
  onClearBackground: () => void
  onSelectBackgroundMode: (mode: BackgroundMode) => void
  onChooseFont: (target: ProjectFontTarget) => void
}

function PaneTitle({
  kind,
  title,
  detail,
}: {
  kind: 'palette' | 'type'
  title: string
  detail: string
}) {
  const Icon = kind === 'palette' ? Palette : Type
  return (
    <div className="style-pane__title">
      <Icon size={16} />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function BackgroundPane({
  stageStyle,
  backgroundError,
  onStageChange,
  onChooseBackground,
  onClearBackground,
  onSelectBackgroundMode,
}: Omit<ProjectPanesProps, 'section' | 'onChooseFont'>) {
  const background = stageStyle.background
  const fileName = background.imagePath?.split(/[\\/]/u).pop()
  return (
    <div className="style-pane">
      <PaneTitle kind="palette" title="Background" detail="One project-wide stage background." />
      <fieldset className="segmented-field">
        <legend>Style</legend>
        {(['solid', 'gradient', 'image'] as const).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="background-mode"
              checked={background.mode === mode}
              onChange={() => onSelectBackgroundMode(mode)}
            />
            {mode[0].toUpperCase() + mode.slice(1)}
          </label>
        ))}
      </fieldset>
      {background.mode === 'solid' && (
        <ColorField
          label="Color"
          value={background.solidColor}
          onChange={(color) => onStageChange((style) => { style.background.solidColor = color })}
        />
      )}
      {background.mode === 'gradient' && (
        <>
          <ColorField
            label="Start color"
            value={background.gradientStartColor}
            onChange={(color) => onStageChange((style) => {
              style.background.gradientStartColor = color
            })}
          />
          <ColorField
            label="End color"
            value={background.gradientEndColor}
            onChange={(color) => onStageChange((style) => {
              style.background.gradientEndColor = color
            })}
          />
          <p className="field-help">Fixed 145° gradient for MVP.</p>
        </>
      )}
      {background.mode === 'image' && (
        <div className="image-source-card">
          <ImagePlus size={20} />
          <div>
            <strong>{fileName ?? 'No image selected'}</strong>
            <small>{background.imagePath ?? 'PNG, JPEG, or static WebP · linked file · Cover'}</small>
          </div>
          <Button size="sm" variant="secondary" onClick={onChooseBackground}>
            {background.imagePath ? 'Replace' : 'Choose image'}
          </Button>
          {background.imagePath && (
            <Button size="sm" variant="ghost" onClick={onClearBackground}>Clear</Button>
          )}
        </div>
      )}
      {backgroundError && background.mode === 'image' && (
        <p className="resource-status resource-status--warning" role="status">
          <AlertTriangle size={13} /> {backgroundError}
        </p>
      )}
    </div>
  )
}

function LyricsPane({
  stageStyle,
  onStageChange,
  onChooseFont,
}: Pick<ProjectPanesProps, 'stageStyle' | 'onStageChange' | 'onChooseFont'>) {
  return (
    <div className="style-pane">
      <PaneTitle kind="type" title="Project lyrics" detail="Defaults inherited independently by vocals." />
      <FontSummary
        style={stageStyle.lyrics}
        target="lyrics"
        onChoose={() => onChooseFont('lyrics')}
      />
      <ColorField
        label="Unsung color"
        value={stageStyle.lyrics.unsungColor}
        onChange={(color) => onStageChange((style) => { style.lyrics.unsungColor = color })}
      />
      <ColorField
        label="Sung color"
        value={stageStyle.lyrics.sungColor}
        onChange={(color) => onStageChange((style) => { style.lyrics.sungColor = color })}
      />
    </div>
  )
}

function TitlePane({
  stageStyle,
  onStageChange,
  onChooseFont,
}: Pick<ProjectPanesProps, 'stageStyle' | 'onStageChange' | 'onChooseFont'>) {
  const setRole = (role: 'eyebrow' | 'title' | 'artist', value: VisibleTextStyle) => {
    onStageChange((style) => { style.titleCard[role] = value })
  }
  return (
    <div className="style-pane">
      <PaneTitle kind="type" title="Title card" detail="Song text still comes from Song details." />
      <TextRoleEditor
        label="Eyebrow"
        style={stageStyle.titleCard.eyebrow}
        fontTarget="title-eyebrow"
        onChange={(value) => setRole('eyebrow', value)}
        onChooseFont={() => onChooseFont('title-eyebrow')}
      />
      <TextRoleEditor
        label="Title"
        style={stageStyle.titleCard.title}
        fontTarget="title-title"
        onChange={(value) => setRole('title', value)}
        onChooseFont={() => onChooseFont('title-title')}
      />
      <TextRoleEditor
        label="Artist"
        style={stageStyle.titleCard.artist}
        fontTarget="title-artist"
        onChange={(value) => setRole('artist', value)}
        onChooseFont={() => onChooseFont('title-artist')}
      />
    </div>
  )
}

function FramePane({
  stageStyle,
  onStageChange,
  onChooseFont,
}: Pick<ProjectPanesProps, 'stageStyle' | 'onStageChange' | 'onChooseFont'>) {
  const frame = stageStyle.stageFrame
  const setRole = (role: 'brand' | 'clock' | 'footer', value: VisibleTextStyle) => {
    onStageChange((style) => { style.stageFrame[role] = value })
  }
  return (
    <div className="style-pane">
      <PaneTitle kind="palette" title="Stage frame" detail="Frame line and built-in stage chrome." />
      <label className="style-switch style-switch--master">
        <input
          type="checkbox"
          checked={frame.enabled}
          onChange={(event) => onStageChange((style) => {
            style.stageFrame.enabled = event.target.checked
          })}
        />
        Show Stage frame
      </label>
      <fieldset disabled={!frame.enabled}>
        <ColorField
          label="Frame line"
          value={frame.lineColor}
          onChange={(color) => onStageChange((style) => { style.stageFrame.lineColor = color })}
        />
        <label className="style-number-field">
          <span>Line width</span>
          <input
            type="number"
            min={0}
            max={32}
            value={frame.lineWidthPx}
            onChange={(event) => onStageChange((style) => {
              style.stageFrame.lineWidthPx = normalizeStyleInteger(event.target.value, 0, 32)
            })}
          />
          <em>px</em>
        </label>
        <TextRoleEditor
          label="Brand"
          style={frame.brand}
          fontTarget="frame-brand"
          onChange={(value) => setRole('brand', value)}
          onChooseFont={() => onChooseFont('frame-brand')}
        />
        <TextRoleEditor
          label="Clock"
          style={frame.clock}
          fontTarget="frame-clock"
          onChange={(value) => setRole('clock', value)}
          onChooseFont={() => onChooseFont('frame-clock')}
        />
        <TextRoleEditor
          label="Song metadata footer"
          style={frame.footer}
          fontTarget="frame-footer"
          onChange={(value) => setRole('footer', value)}
          onChooseFont={() => onChooseFont('frame-footer')}
        />
      </fieldset>
    </div>
  )
}

export function VideoStyleProjectPane(props: ProjectPanesProps) {
  if (props.section === 'background') return <BackgroundPane {...props} />
  if (props.section === 'lyrics') return <LyricsPane {...props} />
  if (props.section === 'title') return <TitlePane {...props} />
  return <FramePane {...props} />
}
