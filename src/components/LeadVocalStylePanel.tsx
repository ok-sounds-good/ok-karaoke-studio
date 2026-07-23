import { useId, type KeyboardEvent } from 'react'
import type { ProjectStyleDraft, ProjectStyleSession } from '../hooks/useProjectStyleSession'
import {
  type VocalAlignment,
  type VocalStyle,
} from '../lib/video-style'
import {
  validateVocalStyleTiming,
  vocalStyleWithTiming,
  type VocalStyleTimingField,
} from '../lib/vocal-style-timing'

interface LeadVocalStylePanelProps {
  draft: ProjectStyleDraft
  id: string
  labelledBy: string
  singerTrackId: string | null
  onDraftChange: ProjectStyleSession['change']
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
  ) {
    return
  }
  onChange(field, String(next))
}

function VocalColorField({
  field,
  label,
  style,
  update,
}: {
  field: 'sungColor' | 'unsungColor'
  label: 'Sung' | 'Unsung'
  style: VocalStyle
  update: (patch: Partial<VocalStyle>) => void
}) {
  return (
    <label className="style-color-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={`Selected singer ${label.toLowerCase()} color`}
          type="color"
          value={style[field]}
          onChange={(event) => update({ [field]: event.currentTarget.value })}
        />
        <output>{style[field].toUpperCase()}</output>
      </div>
    </label>
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
  draft,
  id,
  labelledBy,
  singerTrackId,
  onDraftChange,
}: LeadVocalStylePanelProps) {
  const alignmentName = useId()
  const singer = draft.singers.find(({ trackId }) => trackId === singerTrackId) ?? null
  const vocal = singer?.vocalStyle ?? null
  const timingValidation = singer ? validateVocalStyleTiming(singer.vocalTiming) : null
  const timingHelpId = `${id}-timing-help`
  const update = (patch: Partial<VocalStyle>) =>
    onDraftChange((current) => ({
      ...current,
      singers: current.singers.map((candidate) =>
        candidate.trackId === singerTrackId
          ? { ...candidate, vocalStyle: { ...candidate.vocalStyle, ...patch } }
          : candidate,
      ),
    }))
  const updateTiming = (field: VocalStyleTimingField, value: string) =>
    onDraftChange((current) => {
      return {
        ...current,
        singers: current.singers.map((candidate) => {
          if (candidate.trackId !== singerTrackId) return candidate
          const vocalTiming = { ...candidate.vocalTiming, [field]: value }
          return {
            ...candidate,
            vocalStyle:
              vocalStyleWithTiming(candidate.vocalStyle, vocalTiming) ?? candidate.vocalStyle,
            vocalTiming,
          }
        }),
      }
    })
  const updateSyncAidEnabled = (enabled: boolean) =>
    onDraftChange((current) => ({
      ...current,
      singers: current.singers.map((candidate) =>
        candidate.trackId === singerTrackId
          ? {
              ...candidate,
              vocalStyle: {
                ...candidate.vocalStyle,
                syncAid: { ...candidate.vocalStyle.syncAid, enabled },
              },
            }
          : candidate,
      ),
    }))

  return (
    <section id={id} aria-labelledby={labelledBy}>
      {!singer || !vocal || !timingValidation ? (
        <p className="style-unavailable" role="status">
          Singer styling is unavailable because this project has no vocal track.
        </p>
      ) : (
        <div className="lead-vocal-style-panel">
          <h3>{singer.name} appearance</h3>
          <p className="style-field-help">Color and placement belong only to this singer.</p>
          <div className="style-color-grid">
            <VocalColorField field="sungColor" label="Sung" style={vocal} update={update} />
            <VocalColorField field="unsungColor" label="Unsung" style={vocal} update={update} />
          </div>

          <fieldset className="lead-vocal-alignment">
            <legend>Alignment</legend>
            <div role="radiogroup" aria-label={`${singer.name} alignment`}>
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
              inputLabel={`${singer.name} Preview Time`}
              label="Preview Time"
              onChange={updateTiming}
              value={singer.vocalTiming.previewMs}
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
                aria-label={`Enable ${singer.name} Sync Aid`}
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
                inputLabel={`${singer.name} Sync Aid Minimum lead`}
                label="Minimum lead"
                onChange={updateTiming}
                value={singer.vocalTiming.minLeadMs}
              />
              <TimingField
                describedBy={`${id}-sync-aid-help`}
                error={timingValidation.errors.maxLeadMs}
                field="maxLeadMs"
                inputLabel={`${singer.name} Sync Aid Maximum lead`}
                label="Maximum lead"
                onChange={updateTiming}
                value={singer.vocalTiming.maxLeadMs}
              />
            </div>
            <p className="style-field-help" id={`${id}-sync-aid-help`}>
              A literal blank row starts a new lyric section. Sync Aid cues only that section&apos;s
              literal first line, including the first project section, when its literal first word
              itself has valid start and end timing. The cue is skipped when the minimum useful lead
              is unavailable, ends when that first word starts, and never transfers to another word
              or line. Enter any whole value from 0 to 60000 ms; Arrow Up or Arrow Down adjusts by
              100 ms.
            </p>
          </fieldset>
        </div>
      )}
    </section>
  )
}
