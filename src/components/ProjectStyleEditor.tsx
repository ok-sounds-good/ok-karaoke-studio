import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type {
  BackgroundImageStyleControls,
  StyleTemplateBackgroundPreparationResult,
} from '../hooks/useBackgroundImageStyleSession'
import type { BackgroundImagePreviewSource } from '../hooks/useProjectBackgroundImage'
import type {
  ProjectStyleDraft,
  ProjectStyleSession,
  StageStyleDraftChange,
} from '../hooks/useProjectStyleSession'
import { canonicalSingerStyle } from '../hooks/useProjectStyleSession'
import type { KaraokeProject } from '../lib/model'
import {
  FONT_SIZE_OPTIONS,
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  isFontSizePx,
  resolveFontFace,
  type BackgroundMode,
  type FontTypefaceDescriptor,
  type LyricTextStyle,
  type StageStyle,
} from '../lib/video-style'
import '../video-style.css'
import { KaraokePreview } from './KaraokePreview'
import { LeadVocalStylePanel } from './LeadVocalStylePanel'
import { StageFrameStylePanel, type StageFrameRole } from './StageFrameStylePanel'
import { StyleTemplatesPanel } from './StyleTemplatesPanel'
import { StyleDestinationTabs } from './StyleDestinationTabs'
import { TitleCardStylePanel, type TitleCardRole } from './TitleCardStylePanel'
import { TypefaceCombobox } from './TypefaceCombobox'
import { Button } from './ui'

export interface ProjectStyleEditorProps {
  project: KaraokeProject
  playbackMs: number
  draft: ProjectStyleDraft
  initialSingerTrackId: string | null
  fonts: InstalledFontState
  backgroundPreview?: BackgroundImagePreviewSource
  backgroundControls?: BackgroundImageStyleControls
  onDraftChange: ProjectStyleSession['change']
  onPrepareTemplateBackground?: (
    templateId: string | null,
  ) => Promise<StyleTemplateBackgroundPreparationResult>
  onRetryFonts: () => void
  onTogglePlayback: () => void
  onCancel: () => Promise<boolean> | boolean
  onApply: () => Promise<boolean> | boolean
  canApply: boolean
  applyBlockedReason: string | null
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input:not([type="radio"]):not([type="checkbox"]), textarea, select'))
  )
}

const STYLE_DESTINATIONS = [
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'background', label: 'Background' },
  { id: 'title-card', label: 'Title card' },
  { id: 'stage-frame', label: 'Stage frame' },
  { id: 'templates', label: 'Templates' },
] as const

type StyleDestination = (typeof STYLE_DESTINATIONS)[number]['id']

function StyleColorField({
  label,
  inputLabel,
  value,
  onChange,
}: {
  label: string
  inputLabel: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="style-color-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={inputLabel}
          type="color"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <output>{value.toUpperCase()}</output>
      </div>
    </label>
  )
}

export function ProjectStyleEditor({
  project,
  playbackMs,
  draft,
  initialSingerTrackId,
  fonts,
  backgroundPreview,
  backgroundControls,
  onDraftChange,
  onPrepareTemplateBackground,
  onRetryFonts,
  onTogglePlayback,
  onCancel,
  onApply,
  canApply,
  applyBlockedReason,
}: ProjectStyleEditorProps) {
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [destination, setDestination] = useState<StyleDestination>('lyrics')
  const [selectedSingerTrackId, setSelectedSingerTrackId] = useState(
    initialSingerTrackId ?? draft.singers[0]?.trackId ?? null,
  )
  const [titleCardPreviewRole, setTitleCardPreviewRole] = useState<TitleCardRole>('eyebrow')
  const [stageFramePreviewRole, setStageFramePreviewRole] = useState<StageFrameRole>('brand')
  const stageStyle = draft.stageStyle
  const previewProject = {
    ...project,
    lyricDisplay: { ...draft.lyricDisplay },
    stageStyle,
    tracks: project.tracks.map((track) => {
      const singer = draft.singers.find(({ trackId }) => trackId === track.id)
      return singer ? { ...track, vocalStyle: singer.vocalStyle } : track
    }),
  }
  const selectedSinger =
    draft.singers.find(({ trackId }) => trackId === selectedSingerTrackId) ??
    draft.singers[0] ??
    null
  const canonicalVocal = selectedSinger ? canonicalSingerStyle(selectedSinger) : null
  const lyrics = stageStyle.lyrics
  const background = stageStyle.background
  const changeStageStyle = (change: StageStyleDraftChange) =>
    onDraftChange((current) => ({
      ...current,
      stageStyle: typeof change === 'function' ? change(current.stageStyle) : change,
    }))
  const effectiveFaceKey = fontFaceKey(resolveFontFace(lyrics.typeface, lyrics.fontStyle))
  const update = (patch: Partial<LyricTextStyle>) =>
    changeStageStyle((current) => ({
      ...current,
      lyrics: { ...current.lyrics, ...patch },
    }))
  const chooseTypeface = (typeface: FontTypefaceDescriptor) =>
    changeStageStyle((current) => ({
      ...current,
      lyrics: { ...current.lyrics, typeface: cloneTypeface(typeface) },
    }))
  const updateBackground = (patch: Partial<StageStyle['background']>) =>
    changeStageStyle((current) => ({
      ...current,
      background: { ...current.background, ...patch },
    }))
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const exactShiftSpace =
      event.code === 'Space' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    const exactBareSpaceOnChoice =
      event.code === 'Space' &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.target instanceof HTMLInputElement &&
      (event.target.type === 'radio' || event.target.type === 'checkbox')
    if (exactShiftSpace) {
      if (event.repeat || isEditableTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      onTogglePlayback()
      return
    }
    if (exactBareSpaceOnChoice) event.stopPropagation()
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      void onCancel()
    }
  }

  useEffect(() => headingRef.current?.focus(), [])

  return (
    <main
      className="style-workspace"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
    >
      <section className="style-editor panel">
        <header className="panel-header panel-title">
          <div>
            <span className="eyebrow">
              {STYLE_DESTINATIONS.find(({ id }) => id === destination)?.label}
            </span>
            <h2 ref={headingRef} id={titleId} tabIndex={-1}>
              Style
            </h2>
          </div>
        </header>

        <StyleDestinationTabs
          destinations={STYLE_DESTINATIONS}
          idPrefix={titleId}
          selected={destination}
          onSelect={setDestination}
        />

        <div className="style-editor__body">
          <section
            id={`${titleId}-lyrics-panel`}
            role="tabpanel"
            aria-labelledby={`${titleId}-lyrics-tab`}
            hidden={destination !== 'lyrics'}
          >
            <p className="style-field-help">Typeface, face, and size apply to every singer.</p>
            <section className="style-control-group" aria-labelledby={`${titleId}-typeface`}>
              <h3 id={`${titleId}-typeface`}>Typeface</h3>
              <TypefaceCombobox
                {...fonts}
                ariaLabel="Global lyric typeface"
                value={lyrics.typeface}
                selectedFace={lyrics.fontStyle}
                onChange={chooseTypeface}
                onRetry={onRetryFonts}
              />
            </section>

            <section className="style-control-group" aria-labelledby={`${titleId}-face`}>
              <h3 id={`${titleId}-face`}>Available faces</h3>
              <div className="font-face-list">
                {lyrics.typeface.faces.map((face) => (
                  <button
                    key={fontFaceKey(face)}
                    type="button"
                    className="font-face-button"
                    aria-pressed={fontFaceKey(face) === effectiveFaceKey}
                    style={{
                      fontStyle: face.slant,
                      fontWeight: face.weight,
                      fontSynthesis: 'none',
                    }}
                    onClick={() => {
                      changeStageStyle((current) => ({
                        ...current,
                        lyrics: { ...current.lyrics, fontStyle: cloneFontFace(face) },
                      }))
                    }}
                  >
                    {face.style}
                  </button>
                ))}
              </div>
            </section>

            <section className="style-control-row">
              <label className="style-field">
                <span>Size</span>
                <select
                  aria-label="Global lyric font size"
                  value={lyrics.sizePx}
                  onChange={(event) => {
                    const sizePx = Number(event.currentTarget.value)
                    if (isFontSizePx(sizePx)) update({ sizePx })
                  }}
                >
                  {FONT_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} px
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {draft.singers.length > 1 && (
              <label className="style-field">
                <span>Singer</span>
                <select
                  aria-label="Singer to style"
                  value={selectedSinger?.trackId ?? ''}
                  onChange={(event) => setSelectedSingerTrackId(event.currentTarget.value)}
                >
                  {draft.singers.map((singer) => (
                    <option key={singer.trackId} value={singer.trackId}>
                      {singer.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <LeadVocalStylePanel
              draft={draft}
              id={`${titleId}-singer-style`}
              labelledBy={`${titleId}-lyrics-tab`}
              singerTrackId={selectedSinger?.trackId ?? null}
              onDraftChange={onDraftChange}
            />
          </section>

          <section
            id={`${titleId}-background-panel`}
            role="tabpanel"
            aria-labelledby={`${titleId}-background-tab`}
            hidden={destination !== 'background'}
          >
            <fieldset className="style-background-mode">
              <legend>Background mode</legend>
              <div>
                {(['solid', 'gradient', 'image'] as BackgroundMode[]).map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name={`${titleId}-background-mode`}
                      value={mode}
                      checked={background.mode === mode}
                      disabled={
                        mode === 'image' &&
                        (!backgroundControls ||
                          (!background.imagePath && !backgroundControls.available))
                      }
                      onChange={() => updateBackground({ mode })}
                    />
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </label>
                ))}
              </div>
            </fieldset>

            {background.mode === 'solid' && (
              <section className="style-color-grid style-color-grid--single">
                <StyleColorField
                  label="Solid color"
                  inputLabel="Background solid color"
                  value={background.solidColor}
                  onChange={(solidColor) => updateBackground({ solidColor })}
                />
              </section>
            )}
            {background.mode === 'gradient' && (
              <section className="style-color-grid" aria-label="Background gradient colors">
                <StyleColorField
                  label="Start color"
                  inputLabel="Background gradient start color"
                  value={background.gradientStartColor}
                  onChange={(gradientStartColor) => updateBackground({ gradientStartColor })}
                />
                <StyleColorField
                  label="End color"
                  inputLabel="Background gradient end color"
                  value={background.gradientEndColor}
                  onChange={(gradientEndColor) => updateBackground({ gradientEndColor })}
                />
              </section>
            )}
            {backgroundControls ? (
              <section className="style-background-image-controls" aria-label="Linked image">
                <div>
                  <Button
                    variant="secondary"
                    disabled={!backgroundControls.available || backgroundControls.busy}
                    onClick={() => void backgroundControls.choose()}
                  >
                    {background.imagePath ? 'Replace image' : 'Choose image'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!background.imagePath || backgroundControls.busy}
                    onClick={() => void backgroundControls.clear()}
                  >
                    Clear image
                  </Button>
                  {backgroundControls.canRetryPreview && (
                    <Button
                      variant="ghost"
                      disabled={backgroundControls.busy}
                      onClick={backgroundControls.retryPreview}
                    >
                      Retry image preview
                    </Button>
                  )}
                </div>
                <p className="style-field-help">
                  Images stay linked to their original file and are previewed from an immutable
                  snapshot before Apply.
                </p>
                {backgroundControls.message && (
                  <p className="style-background-image-message" role="alert">
                    {backgroundControls.message}
                  </p>
                )}
              </section>
            ) : (
              <p className="style-field-help">
                Existing linked images can be checked in Preview. Image authoring is available in
                the desktop app.
              </p>
            )}
          </section>

          <TitleCardStylePanel
            active={destination === 'title-card'}
            draft={stageStyle}
            fonts={fonts}
            id={`${titleId}-title-card-panel`}
            labelledBy={`${titleId}-title-card-tab`}
            onDraftChange={changeStageStyle}
            onRetryFonts={onRetryFonts}
            onSelectedRoleChange={setTitleCardPreviewRole}
          />

          <StageFrameStylePanel
            active={destination === 'stage-frame'}
            draft={stageStyle}
            fonts={fonts}
            id={`${titleId}-stage-frame-panel`}
            labelledBy={`${titleId}-stage-frame-tab`}
            onDraftChange={changeStageStyle}
            onRetryFonts={onRetryFonts}
            onSelectedRoleChange={setStageFramePreviewRole}
          />

          <StyleTemplatesPanel
            active={destination === 'templates'}
            id={`${titleId}-templates-panel`}
            labelledBy={`${titleId}-templates-tab`}
            draft={draft}
            selectedSingerTrackId={selectedSinger?.trackId ?? null}
            onDraftChange={onDraftChange}
            onPrepareTemplateBackground={onPrepareTemplateBackground}
          />
        </div>

        <footer className="style-editor__actions">
          {applyBlockedReason && (
            <p id={`${titleId}-apply-error`} role="alert">
              {applyBlockedReason}
            </p>
          )}
          <Button variant="ghost" data-style-action="cancel" onClick={() => void onCancel()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            aria-describedby={applyBlockedReason ? `${titleId}-apply-error` : undefined}
            data-style-action="apply"
            disabled={!canApply}
            onClick={() => void onApply()}
          >
            Apply &amp; close
          </Button>
        </footer>
      </section>

      <KaraokePreview
        project={previewProject}
        playbackMs={playbackMs}
        lyricMs={playbackMs - project.offsetMs}
        selectedWordIds={new Set()}
        backgroundImage={backgroundPreview}
        designMode={
          destination === 'title-card'
            ? {
                target: 'title-card',
                role: titleCardPreviewRole,
                stageStyle,
                onPositionChange: (position) =>
                  changeStageStyle((current) => ({
                    ...current,
                    titleCard: {
                      ...current.titleCard,
                      [titleCardPreviewRole]: {
                        ...current.titleCard[titleCardPreviewRole],
                        position,
                      },
                    },
                  })),
              }
            : destination === 'stage-frame'
              ? { target: 'stage-frame', role: stageFramePreviewRole, stageStyle }
              : selectedSinger
                ? {
                    target: 'lead-vocal',
                    stageStyle,
                    vocalStyle: canonicalVocal ?? selectedSinger.vocalStyle,
                    timingValid: Boolean(canonicalVocal),
                    onPositionChange:
                      destination === 'lyrics'
                        ? (position) =>
                            onDraftChange((current) => ({
                              ...current,
                              singers: current.singers.map((singer) =>
                                singer.trackId === selectedSinger.trackId
                                  ? {
                                      ...singer,
                                      vocalStyle: { ...singer.vocalStyle, position },
                                    }
                                  : singer,
                              ),
                            }))
                        : undefined,
                  }
                : { target: 'project-lyrics', stageStyle }
        }
      />
    </main>
  )
}
