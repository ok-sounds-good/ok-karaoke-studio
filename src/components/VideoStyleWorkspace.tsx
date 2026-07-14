import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { KaraokeProject, VocalTrack } from '../lib/model'
import {
  cloneFontFace,
  cloneTypeface,
  cloneVocalStyle,
  resolveVocalStyle,
  type BackgroundMode,
  type FontFaceDescriptor,
  type FontSizeStyle,
  type FontTypefaceDescriptor,
} from '../lib/video-style'
import {
  cloneVideoStyleDraft,
  validateVideoStyleDraft,
  type VideoStyleDraft,
} from '../lib/style-session'
import { useInstalledFonts } from '../hooks/useInstalledFonts'
import { FontSelector } from './FontSelector'
import { Button } from './ui'
import {
  VideoStyleProjectPane,
  type ProjectFontTarget,
  type ProjectStyleSection,
} from './VideoStyleProjectPanes'
import { VocalStylePane } from './VocalStylePane'
import {
  PublicFontSelector,
  usePublicFontCaptureRequest,
} from './PublicFontSelector'

type SectionId = ProjectStyleSection | 'vocal'
type FontTarget = ProjectFontTarget | 'vocal'

interface VideoStyleWorkspaceProps {
  project: KaraokeProject
  activeTrack: VocalTrack | undefined
  draft: VideoStyleDraft
  backgroundUrl: string | null
  backgroundError: string | null
  settlementError?: string | null
  settling: boolean
  onDraftChange: (draft: VideoStyleDraft) => void
  onChooseBackground: () => void
  onClearBackground: () => void
  onSelectBackgroundMode: (mode: BackgroundMode) => void
  onCancel: () => void
  onApply: () => void
}

const SECTION_LABELS: Array<[SectionId, string]> = [
  ['background', 'Background'],
  ['lyrics', 'Project lyrics'],
  ['title', 'Title card'],
  ['frame', 'Stage frame'],
  ['vocal', 'Vocal'],
]

export function VideoStyleWorkspace({
  activeTrack,
  draft,
  backgroundUrl,
  backgroundError,
  settlementError = null,
  settling,
  onDraftChange,
  onChooseBackground,
  onClearBackground,
  onSelectBackgroundMode,
  onCancel,
  onApply,
}: VideoStyleWorkspaceProps) {
  const [section, setSection] = useState<SectionId>('background')
  const [fontTarget, setFontTarget] = useState<FontTarget | null>(null)
  const publicFontCapture = usePublicFontCaptureRequest()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sectionNavRef = useRef<HTMLElement>(null)
  const fontOriginRef = useRef<FontTarget | null>(null)
  const installedFonts = useInstalledFonts()
  const activeVocal = activeTrack
    ? draft.vocalStyles[activeTrack.id] ?? activeTrack.vocalStyle
    : null
  const resolvedVocal = useMemo(() => activeVocal
    ? resolveVocalStyle(draft.stageStyle.lyrics, activeVocal)
    : null, [activeVocal, draft.stageStyle.lyrics])
  const syncValid = !activeVocal || (
    activeVocal.syncAid.minLeadMs >= 0 &&
    activeVocal.syncAid.minLeadMs <= activeVocal.syncAid.maxLeadMs &&
    activeVocal.syncAid.maxLeadMs <= activeVocal.previewMs
  )
  const validationErrors = useMemo(() => validateVideoStyleDraft(draft), [draft])
  const canApply = validationErrors.length === 0

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const mutate = (change: (next: VideoStyleDraft) => void) => {
    const next = cloneVideoStyleDraft(draft)
    change(next)
    onDraftChange(next)
  }

  const updateStage = (change: (next: VideoStyleDraft['stageStyle']) => void) => {
    mutate((next) => change(next.stageStyle))
  }

  const updateVocal = (change: (next: NonNullable<typeof activeVocal>) => void) => {
    if (!activeTrack || !activeVocal) return
    mutate((next) => {
      const style = cloneVocalStyle(next.vocalStyles[activeTrack.id] ?? activeVocal)
      change(style)
      next.vocalStyles[activeTrack.id] = style
    })
  }

  const openFont = (target: FontTarget) => {
    fontOriginRef.current = target
    installedFonts.request()
    setFontTarget(target)
  }

  const closeFont = () => {
    const origin = fontOriginRef.current
    setFontTarget(null)
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`[data-font-target="${origin}"]`)?.focus()
    }, 0)
  }

  const navigateSections = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const buttons = [...(sectionNavRef.current?.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ) ?? [])]
    const current = buttons.indexOf(event.currentTarget)
    if (current < 0 || buttons.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)
          + buttons.length) % buttons.length
    const next = buttons[nextIndex]
    setSection(next.dataset.styleSection as SectionId)
    next.focus()
  }

  const fontSelection = useMemo(() => {
    if (!fontTarget) return null
    if (fontTarget === 'lyrics') return draft.stageStyle.lyrics
    if (fontTarget === 'title-eyebrow') return draft.stageStyle.titleCard.eyebrow
    if (fontTarget === 'title-title') return draft.stageStyle.titleCard.title
    if (fontTarget === 'title-artist') return draft.stageStyle.titleCard.artist
    if (fontTarget === 'frame-brand') return draft.stageStyle.stageFrame.brand
    if (fontTarget === 'frame-clock') return draft.stageStyle.stageFrame.clock
    if (fontTarget === 'frame-footer') return draft.stageStyle.stageFrame.footer
    if (fontTarget === 'vocal' && resolvedVocal) return resolvedVocal
    return null
  }, [draft, fontTarget, resolvedVocal])

  const updateProjectFont = (change: (target: FontSizeStyle) => void) => {
    if (!fontTarget || fontTarget === 'vocal') return
    updateStage((style) => {
      const target = fontTarget === 'lyrics'
        ? style.lyrics
        : fontTarget === 'title-eyebrow'
          ? style.titleCard.eyebrow
          : fontTarget === 'title-title'
            ? style.titleCard.title
            : fontTarget === 'title-artist'
              ? style.titleCard.artist
              : fontTarget === 'frame-brand'
                ? style.stageFrame.brand
                : fontTarget === 'frame-clock'
                  ? style.stageFrame.clock
                  : style.stageFrame.footer
      change(target)
    })
  }

  const applyTypeface = (typeface: FontTypefaceDescriptor) => {
    if (fontTarget === 'vocal') {
      updateVocal((style) => { style.typeface = cloneTypeface(typeface) })
    } else {
      updateProjectFont((target) => { target.typeface = cloneTypeface(typeface) })
    }
  }

  const applyFontStyle = (fontStyle: FontFaceDescriptor) => {
    if (fontTarget === 'vocal') {
      updateVocal((style) => { style.fontStyle = cloneFontFace(fontStyle) })
    } else {
      updateProjectFont((target) => { target.fontStyle = cloneFontFace(fontStyle) })
    }
  }

  const applyFontSize = (sizePx: number) => {
    if (fontTarget === 'vocal') {
      updateVocal((style) => { style.sizePx = sizePx })
    } else {
      updateProjectFont((target) => { target.sizePx = sizePx })
    }
  }

  if (fontTarget && fontSelection) {
    return (
      <section
        key={publicFontCapture ? 'public-font-capture' : 'private-font-editor'}
        id={publicFontCapture ? 'oks-public-font-capture' : undefined}
        data-oks-public-font-capture={publicFontCapture ? 'ready' : undefined}
        className="video-style-editor video-style-editor--font panel"
        aria-label={publicFontCapture
          ? 'Public font selector evidence'
          : 'Video style font selector'}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          closeFont()
        }}
      >
        {publicFontCapture ? (
          <PublicFontSelector />
        ) : (
          <FontSelector
            value={fontSelection}
            fonts={installedFonts.fonts}
            accessState={installedFonts.accessState}
            onTypefaceChange={applyTypeface}
            onFontStyleChange={applyFontStyle}
            onSizeChange={applyFontSize}
            onRetry={installedFonts.request}
            onBack={closeFont}
          />
        )}
        <EditorActions
          settlementError={settlementError}
          settling={settling}
          canApply={canApply}
          validationMessage={validationErrors[0]?.message}
          onCancel={onCancel}
          onApply={onApply}
        />
      </section>
    )
  }

  return (
    <section className="video-style-editor panel" aria-labelledby="video-style-heading">
      <header className="video-style-editor__header">
        <div>
          <span className="eyebrow">Project</span>
          <h2 ref={headingRef} id="video-style-heading" tabIndex={-1}>Video style</h2>
        </div>
        <button
          className="icon-button"
          title="Cancel video style editing"
          aria-label="Cancel video style editing"
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </header>

      <nav ref={sectionNavRef} className="style-sections" aria-label="Video style sections">
        {SECTION_LABELS.map(([id, label]) => (
          <button
            key={id}
            disabled={id === 'vocal' && !activeTrack}
            aria-current={section === id ? 'page' : undefined}
            className={section === id ? 'is-selected' : ''}
            data-style-section={id}
            onClick={() => setSection(id)}
            onKeyDown={navigateSections}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="video-style-editor__scroll">
        {section !== 'vocal' && (
          <VideoStyleProjectPane
            section={section}
            stageStyle={draft.stageStyle}
            backgroundError={backgroundError}
            onStageChange={updateStage}
            onChooseBackground={onChooseBackground}
            onClearBackground={onClearBackground}
            onSelectBackgroundMode={onSelectBackgroundMode}
            onChooseFont={openFont}
          />
        )}
        {section === 'vocal' && activeTrack && activeVocal && resolvedVocal && (
          <VocalStylePane
            track={activeTrack}
            style={activeVocal}
            resolved={resolvedVocal}
            projectLyrics={draft.stageStyle.lyrics}
            syncValid={syncValid}
            onChange={updateVocal}
            onChooseFont={() => openFont('vocal')}
          />
        )}
      </div>

      <EditorActions
        settlementError={settlementError}
        settling={settling}
        canApply={canApply}
        validationMessage={validationErrors[0]?.message}
        onCancel={onCancel}
        onApply={onApply}
      />
    </section>
  )
}

function EditorActions({
  canApply,
  settlementError,
  settling,
  validationMessage,
  onCancel,
  onApply,
}: {
  canApply: boolean
  settlementError?: string | null
  settling: boolean
  validationMessage?: string
  onCancel: () => void
  onApply: () => void
}) {
  return (
    <div className="video-style-editor__actions">
      {!canApply && validationMessage && (
        <p className="field-error" role="alert">{validationMessage}</p>
      )}
      {settlementError && <p className="field-error" role="alert">{settlementError}</p>}
      <Button variant="ghost" disabled={settling} onClick={onCancel}>Cancel</Button>
      <Button disabled={!canApply || settling} onClick={onApply}>
        {settling ? 'Applying…' : 'Apply & close'}
      </Button>
    </div>
  )
}
