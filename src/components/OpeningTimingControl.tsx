import { useEffect, useRef, useState } from 'react'
import type { OpeningTiming } from '../lib/model'
import { MAX_OPENING_LEAD_IN_MS } from '../lib/project-validation'

export const MAX_OPENING_MS = MAX_OPENING_LEAD_IN_MS

interface OpeningTimingControlProps {
  maximumMs: number
  opening: OpeningTiming
  onChange: (opening: OpeningTiming) => void
}

/** Shared by the Inspector (immediate project edit) and Style draft. */
export function OpeningTimingControl({ maximumMs, opening, onChange }: OpeningTimingControlProps) {
  const [draft, setDraft] = useState(String(opening.leadInMs / 1_000))
  const discardBlurRef = useRef(false)
  useEffect(() => setDraft(String(opening.leadInMs / 1_000)), [opening.leadInMs])
  const commit = () => {
    if (discardBlurRef.current) {
      discardBlurRef.current = false
      return
    }
    const restore = () => setDraft(String(opening.leadInMs / 1_000))
    if (!/^\d+(?:\.\d)?$/u.test(draft)) return restore()
    const leadInMs = Math.round(Number(draft) * 1_000)
    const acceptedMaximumMs = Number.isSafeInteger(maximumMs)
      ? Math.max(0, Math.min(MAX_OPENING_MS, maximumMs))
      : 0
    if (!Number.isSafeInteger(leadInMs) || leadInMs < 0 || leadInMs > acceptedMaximumMs)
      return restore()
    onChange({ leadInMs, titleTiming: { mode: 'until-lyrics' } })
    setDraft(String(leadInMs / 1_000))
  }
  return (
    <label className="field field--inline">
      <span>Opening lead-in</span>
      <div>
        <input
          aria-label="Opening lead-in seconds"
          inputMode="decimal"
          value={draft}
          onBlur={commit}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              discardBlurRef.current = true
              setDraft(String(opening.leadInMs / 1_000))
              event.currentTarget.blur()
            }
          }}
        />
        <em>s</em>
      </div>
    </label>
  )
}
