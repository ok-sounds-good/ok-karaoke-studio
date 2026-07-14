import { useMemo, useState } from 'react'
import { Button, Modal } from './ui'

const HEX_COLOR = /^#[0-9A-F]{6}$/u

export function SungColorDialog({
  initialColor,
  trackName,
  onApply,
  onCancel,
}: {
  initialColor: string
  trackName: string
  onApply: (color: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialColor.toUpperCase())
  const valid = useMemo(() => HEX_COLOR.test(draft), [draft])
  const colorValue = valid ? draft : initialColor

  return (
    <Modal
      title={`Sung color for ${trackName}`}
      eyebrow="Vocal style"
      onClose={onCancel}
      footer={(
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onApply(draft)}>Apply color</Button>
        </>
      )}
    >
      <p>Choose the progressive highlight used after each word is sung.</p>
      <div className="sung-color-editor">
        <label>
          <span>Color</span>
          <input
            aria-label="Sung color picker"
            type="color"
            value={colorValue}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          <span>Hex</span>
          <input
            aria-label="Sung color hex"
            value={draft}
            maxLength={7}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
          />
        </label>
        <span className="sung-color-editor__sample" style={{ background: colorValue }} />
      </div>
      {!valid && <p className="field-error" role="alert">Enter a color as #RRGGBB.</p>}
    </Modal>
  )
}
