import { Type } from 'lucide-react'
import type { VocalTrack } from '../lib/karaoke'
import {
  cloneFontFace,
  cloneTypeface,
  normalizeStyleInteger,
  type LyricTextStyle,
  type ResolvedVocalStyle,
  type VocalStyle,
} from '../lib/video-style'
import { ColorField, FontSummary } from './VideoStyleFields'

interface VocalStylePaneProps {
  track: VocalTrack
  style: VocalStyle
  resolved: ResolvedVocalStyle
  projectLyrics: LyricTextStyle
  syncValid: boolean
  onChange: (change: (style: VocalStyle) => void) => void
  onChooseFont: () => void
}

export function VocalStylePane({
  track,
  style,
  resolved,
  projectLyrics,
  syncValid,
  onChange,
  onChooseFont,
}: VocalStylePaneProps) {
  return (
    <div className="style-pane">
      <div className="style-pane__title">
        <Type size={16} />
        <div>
          <h3>{track.name}</h3>
          <p>Overrides only for this vocal.</p>
        </div>
      </div>

      <fieldset className="inherit-group">
        <legend>Typeface, style, and size</legend>
        <label className="style-switch">
          <input
            type="checkbox"
            checked={style.typeface === null}
            onChange={(event) => onChange((next) => {
              next.typeface = event.target.checked ? null : cloneTypeface(resolved.typeface)
            })}
          />
          Use project typeface
        </label>
        <label className="style-switch">
          <input
            type="checkbox"
            checked={style.fontStyle === null}
            onChange={(event) => onChange((next) => {
              next.fontStyle = event.target.checked ? null : cloneFontFace(resolved.fontStyle)
            })}
          />
          Use project style
        </label>
        <label className="style-switch">
          <input
            type="checkbox"
            checked={style.sizePx === null}
            onChange={(event) => onChange((next) => {
              next.sizePx = event.target.checked ? null : resolved.sizePx
            })}
          />
          Use project size
        </label>
        <FontSummary style={resolved} target="vocal" onChoose={onChooseFont} />
      </fieldset>

      {(['unsungColor', 'sungColor'] as const).map((key) => (
        <fieldset className="inherit-group" key={key}>
          <legend>{key === 'sungColor' ? 'Sung color' : 'Unsung color'}</legend>
          <label className="style-switch">
            <input
              type="checkbox"
              checked={style[key] === null}
              onChange={(event) => onChange((next) => {
                next[key] = event.target.checked ? null : projectLyrics[key]
              })}
            />
            Use project setting
          </label>
          <ColorField
            label={key === 'sungColor' ? 'Sung' : 'Unsung'}
            value={resolved[key]}
            onChange={(color) => onChange((next) => { next[key] = color })}
          />
        </fieldset>
      ))}

      <fieldset className="segmented-field">
        <legend>Alignment</legend>
        {(['left', 'center', 'right'] as const).map((alignment) => (
          <label key={alignment}>
            <input
              type="radio"
              name="vocal-alignment"
              checked={style.alignment === alignment}
              onChange={() => onChange((next) => { next.alignment = alignment })}
            />
            {alignment[0].toUpperCase() + alignment.slice(1)}
          </label>
        ))}
      </fieldset>

      <label className="style-number-field">
        <span>Preview time</span>
        <input
          type="number"
          min={0}
          max={60_000}
          step={100}
          value={style.previewMs}
          onChange={(event) => onChange((next) => {
            next.previewMs = normalizeStyleInteger(event.target.value, 0, 60_000)
          })}
        />
        <em>ms</em>
      </label>

      <fieldset className="sync-aid-fields">
        <legend>Sync aid</legend>
        <label className="style-switch">
          <input
            type="checkbox"
            checked={style.syncAid.enabled}
            onChange={(event) => onChange((next) => {
              next.syncAid.enabled = event.target.checked
            })}
          />
          Cue section starts
        </label>
        <label className="style-number-field">
          <span>Minimum lead</span>
          <input
            type="number"
            min={0}
            max={style.previewMs}
            step={100}
            value={style.syncAid.minLeadMs}
            onChange={(event) => onChange((next) => {
              next.syncAid.minLeadMs = normalizeStyleInteger(event.target.value, 0, 60_000)
            })}
          />
          <em>ms</em>
        </label>
        <label className="style-number-field">
          <span>Maximum lead</span>
          <input
            type="number"
            min={0}
            max={style.previewMs}
            step={100}
            value={style.syncAid.maxLeadMs}
            onChange={(event) => onChange((next) => {
              next.syncAid.maxLeadMs = normalizeStyleInteger(event.target.value, 0, 60_000)
            })}
          />
          <em>ms</em>
        </label>
        <p className="field-help">
          First line after a blank row only. Starts up to
          {' '}{(style.syncAid.maxLeadMs / 1000).toFixed(1)} s early; skipped when less than
          {' '}{(style.syncAid.minLeadMs / 1000).toFixed(1)} s is available.
        </p>
        {!syncValid && (
          <p className="field-error" role="alert">
            Use 0 ≤ Minimum ≤ Maximum ≤ Preview time.
          </p>
        )}
      </fieldset>
    </div>
  )
}
