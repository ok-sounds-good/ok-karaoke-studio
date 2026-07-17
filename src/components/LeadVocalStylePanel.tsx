import { useId, type KeyboardEvent } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type { ProjectStyleDraft, ProjectStyleSession } from '../hooks/useProjectStyleSession'
import {
  FONT_SIZE_OPTIONS,
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  isFontSizePx,
  resolveFontFace,
  resolveVocalStyle,
  type FontTypefaceDescriptor,
  type VocalAlignment,
  type VocalStyle,
} from '../lib/video-style'
import {
  validateVocalStyleTiming,
  vocalStyleWithTiming,
  type VocalStyleTimingField,
} from '../lib/vocal-style-timing'
import { TypefaceCombobox } from './TypefaceCombobox'

interface LeadVocalStylePanelProps {
  active: boolean
  available: boolean
  draft: ProjectStyleDraft
  fonts: InstalledFontState
  id: string
  labelledBy: string
  onDraftChange: ProjectStyleSession['change']
  onRetryFonts: () => void
}

const TIMING_MIN_MS = 0
const TIMING_MAX_MS = 60_000
const TIMING_STEP_MS = 100

function handleTimingStep(
  event: KeyboardEvent<HTMLInputElement>,
  field: VocalStyleTimingField,
  onChange: (field: VocalStyleTimingField, value: string) => void,
) {
  const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : null
  if (direction === null) return
  event.preventDefault()
  const current = event.currentTarget.valueAsNumber
  const next = current + direction * TIMING_STEP_MS
  if (
    [current, next].some(
      (value) => !Number.isSafeInteger(value) || value < TIMING_MIN_MS || value > TIMING_MAX_MS,
    )
  )
    return
  onChange(field, String(next))
}

function OverrideToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="style-override-toggle">
      <strong>{label}</strong>
      <span>
        <span>Project</span>
        <input
          type="checkbox"
          aria-label={`Override Lead Vocal ${label}`}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>Override</span>
      </span>
    </label>
  )
}

function VocalColorField({
  field,
  label,
  resolvedValue,
  style,
  update,
}: {
  field: 'sungColor' | 'unsungColor'
  label: 'Sung' | 'Unsung'
  resolvedValue: string
  style: VocalStyle
  update: (patch: Partial<VocalStyle>) => void
}) {
  const overridden = style[field] !== null
  return (
    <section className="style-override-field style-override-color-field">
      <OverrideToggle
        checked={overridden}
        label={label}
        onChange={(checked) => update({ [field]: checked ? resolvedValue : null })}
      />
      <fieldset disabled={!overridden} aria-label={`Lead Vocal ${label} value`}>
        <div className="style-color-field">
          <div>
            <input
              aria-label={`Lead Vocal ${label.toLowerCase()} color`}
              type="color"
              value={style[field] ?? resolvedValue}
              onChange={(event) => update({ [field]: event.currentTarget.value })}
            />
            <output>{(style[field] ?? resolvedValue).toUpperCase()}</output>
          </div>
        </div>
      </fieldset>
    </section>
  )
}

function TimingField({
  describedBy,
  error,
  field,
  inputLabel,
  label,
  onChange,
  value,
}: {
  describedBy: string
  error: string | null
  field: VocalStyleTimingField
  inputLabel: string
  label: string
  onChange: (field: VocalStyleTimingField, value: string) => void
  value: string
}) {
  const errorId = `${describedBy}-${field}-error`
  return (
    <label className="vocal-timing-field">
      <span>{label}</span>
      <span className="vocal-timing-input">
        <input
          aria-describedby={`${describedBy}${error ? ` ${errorId}` : ''}`}
          aria-invalid={Boolean(error)}
          aria-label={inputLabel}
          data-step-ms={TIMING_STEP_MS}
          max={TIMING_MAX_MS}
          min={TIMING_MIN_MS}
          step="any"
          type="number"
          value={value}
          onChange={(event) => onChange(field, event.currentTarget.value)}
          onKeyDown={(event) => handleTimingStep(event, field, onChange)}
        />
        <span aria-hidden="true">ms</span>
      </span>
      {error && (
        <span className="vocal-timing-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

export function LeadVocalStylePanel({
  active,
  available,
  draft,
  fonts,
  id,
  labelledBy,
  onDraftChange,
  onRetryFonts,
}: LeadVocalStylePanelProps) {
  const alignmentName = useId()
  const stageLyrics = draft.stageStyle.lyrics
  const vocal = draft.vocalStyle
  const timingValidation = validateVocalStyleTiming(draft.vocalTiming)
  const timingHelpId = `${id}-timing-help`
  const resolved = resolveVocalStyle(stageLyrics, vocal)
  const effectiveFace = resolveFontFace(resolved.typeface, vocal.fontStyle ?? resolved.fontStyle)
  const update = (patch: Partial<VocalStyle>) =>
    onDraftChange((current) => ({
      ...current,
      vocalStyle: { ...current.vocalStyle, ...patch },
    }))
  const chooseTypeface = (typeface: FontTypefaceDescriptor) =>
    update({ typeface: cloneTypeface(typeface) })
  const updateTiming = (field: VocalStyleTimingField, value: string) =>
    onDraftChange((current) => {
      const vocalTiming = { ...current.vocalTiming, [field]: value }
      return {
        ...current,
        vocalStyle: vocalStyleWithTiming(current.vocalStyle, vocalTiming) ?? current.vocalStyle,
        vocalTiming,
      }
    })
  const updateSyncAidEnabled = (enabled: boolean) =>
    onDraftChange((current) => ({
      ...current,
      vocalStyle: {
        ...current.vocalStyle,
        syncAid: { ...current.vocalStyle.syncAid, enabled },
      },
    }))

  return (
    <section id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!active}>
      {!available ? (
        <p className="style-unavailable" role="status">
          Lead Vocal is unavailable because this project has no vocal track.
        </p>
      ) : (
        <div className="lead-vocal-style-panel">
          <section className="style-override-field">
            <OverrideToggle
              checked={vocal.typeface !== null}
              label="Typeface"
              onChange={(checked) =>
                update({ typeface: checked ? cloneTypeface(resolved.typeface) : null })
              }
            />
            <fieldset disabled={vocal.typeface === null} aria-label="Lead Vocal Typeface value">
              <TypefaceCombobox
                {...fonts}
                ariaLabel="Lead Vocal typeface"
                value={resolved.typeface}
                selectedFace={vocal.fontStyle ?? resolved.fontStyle}
                onChange={chooseTypeface}
                onRetry={onRetryFonts}
              />
            </fieldset>
          </section>

          <section className="style-override-field">
            <OverrideToggle
              checked={vocal.fontStyle !== null}
              label="Face"
              onChange={(checked) =>
                update({ fontStyle: checked ? cloneFontFace(resolved.fontStyle) : null })
              }
            />
            <fieldset disabled={vocal.fontStyle === null} aria-label="Lead Vocal Face value">
              <div className="font-face-list">
                {resolved.typeface.faces.map((face) => (
                  <button
                    key={fontFaceKey(face)}
                    type="button"
                    className="font-face-button"
                    aria-label={`Lead Vocal face ${face.style}`}
                    aria-pressed={fontFaceKey(face) === fontFaceKey(effectiveFace)}
                    style={{
                      fontStyle: face.slant,
                      fontWeight: face.weight,
                      fontSynthesis: 'none',
                    }}
                    onClick={() => update({ fontStyle: cloneFontFace(face) })}
                  >
                    {face.style}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="style-override-field">
            <OverrideToggle
              checked={vocal.sizePx !== null}
              label="Size"
              onChange={(checked) => update({ sizePx: checked ? resolved.sizePx : null })}
            />
            <fieldset disabled={vocal.sizePx === null} aria-label="Lead Vocal Size value">
              <label className="style-field">
                <select
                  aria-label="Lead Vocal font size"
                  value={vocal.sizePx ?? resolved.sizePx}
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
            </fieldset>
          </section>

          <div className="lead-vocal-color-grid">
            <VocalColorField
              field="sungColor"
              label="Sung"
              resolvedValue={resolved.sungColor}
              style={vocal}
              update={update}
            />
            <VocalColorField
              field="unsungColor"
              label="Unsung"
              resolvedValue={resolved.unsungColor}
              style={vocal}
              update={update}
            />
          </div>

          <fieldset className="lead-vocal-alignment">
            <legend>Alignment</legend>
            <div role="radiogroup" aria-label="Lead Vocal alignment">
              {(['left', 'center', 'right'] as VocalAlignment[]).map((alignment) => (
                <label key={alignment}>
                  <input
                    type="radio"
                    name={alignmentName}
                    value={alignment}
                    checked={vocal.alignment === alignment}
                    onChange={() => update({ alignment })}
                  />
                  {alignment[0].toUpperCase() + alignment.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>

          <section className="vocal-timing-controls" aria-labelledby={`${id}-preview-time-title`}>
            <h3 id={`${id}-preview-time-title`}>Preview Time</h3>
            <TimingField
              describedBy={timingHelpId}
              error={timingValidation.errors.previewMs}
              field="previewMs"
              inputLabel="Lead Vocal Preview Time"
              label="Preview Time"
              onChange={updateTiming}
              value={draft.vocalTiming.previewMs}
            />
            <p className="style-field-help" id={timingHelpId}>
              Preview Time controls when a line becomes eligible before its first sung word, subject
              to the current line count and Clear or Scroll advance behavior. Enter any whole value
              from 0 to 60000 ms; Arrow Up or Arrow Down adjusts by 100 ms.
            </p>
          </section>

          <fieldset className="vocal-sync-aid-controls">
            <legend>Sync Aid</legend>
            <label className="vocal-sync-aid-enabled">
              <input
                aria-label="Enable Lead Vocal Sync Aid"
                checked={vocal.syncAid.enabled}
                type="checkbox"
                onChange={(event) => updateSyncAidEnabled(event.currentTarget.checked)}
              />
              Enabled
            </label>
            <div className="vocal-sync-aid-values">
              <TimingField
                describedBy={`${id}-sync-aid-help`}
                error={timingValidation.errors.minLeadMs}
                field="minLeadMs"
                inputLabel="Lead Vocal Sync Aid Minimum lead"
                label="Minimum lead"
                onChange={updateTiming}
                value={draft.vocalTiming.minLeadMs}
              />
              <TimingField
                describedBy={`${id}-sync-aid-help`}
                error={timingValidation.errors.maxLeadMs}
                field="maxLeadMs"
                inputLabel="Lead Vocal Sync Aid Maximum lead"
                label="Maximum lead"
                onChange={updateTiming}
                value={draft.vocalTiming.maxLeadMs}
              />
            </div>
            <p className="style-field-help" id={`${id}-sync-aid-help`}>
              Sync Aid cues only the literal first line after a blank row, including the first
              project section, when its literal first word has valid start and end timing. The cue
              is skipped when the minimum useful lead is unavailable, ends at that first word, and
              never transfers to another word or line. Enter any whole value from 0 to 60000 ms;
              Arrow Up or Arrow Down adjusts by 100 ms.
            </p>
          </fieldset>
        </div>
      )}
    </section>
  )
}
