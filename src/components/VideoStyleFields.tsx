import { Type } from 'lucide-react'
import {
  resolveFontFace,
  type FontSizeStyle,
  type VisibleTextStyle,
} from '../lib/video-style'

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="style-color-field">
      <span>{label}</span>
      <span className="style-color-field__control">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <code>{value.toUpperCase()}</code>
      </span>
    </label>
  )
}

export function FontSummary({
  style,
  target,
  onChoose,
}: {
  style: FontSizeStyle
  target: string
  onChoose: () => void
}) {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return (
    <button className="font-summary" data-font-target={target} onClick={onChoose}>
      <Type size={15} />
      <span>
        <strong>{style.typeface.family}</strong>
        <small>{face.style} · {style.sizePx} px</small>
      </span>
      <span>Choose</span>
    </button>
  )
}

export function TextRoleEditor({
  label,
  style,
  fontTarget,
  onChange,
  onChooseFont,
}: {
  label: string
  style: VisibleTextStyle
  fontTarget: string
  onChange: (style: VisibleTextStyle) => void
  onChooseFont: () => void
}) {
  return (
    <fieldset className="style-role">
      <legend>{label}</legend>
      <label className="style-switch">
        <input
          type="checkbox"
          checked={style.visible}
          onChange={(event) => onChange({ ...style, visible: event.target.checked })}
        />
        Show {label.toLowerCase()}
      </label>
      <FontSummary style={style} target={fontTarget} onChoose={onChooseFont} />
      <ColorField
        label="Color"
        value={style.color}
        onChange={(color) => onChange({ ...style, color })}
      />
    </fieldset>
  )
}
