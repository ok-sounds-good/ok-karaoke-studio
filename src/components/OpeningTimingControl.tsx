import { useEffect, useRef, useState } from 'react'
import type { OpeningTiming } from '../lib/model'
import { MAX_OPENING_LEAD_IN_MS } from '../lib/project-validation'
import type { OpeningTimingFacts } from '../lib/stage-frame-state'

export const MAX_OPENING_MS = MAX_OPENING_LEAD_IN_MS

interface OpeningTimingControlProps {
  maximumMs: number
  opening: OpeningTiming
  facts: OpeningTimingFacts
  onChange: (opening: OpeningTiming) => void
}

/** Shared by the Inspector (immediate project edit) and Style draft. */
export function OpeningTimingControl({
  maximumMs,
  opening,
  facts,
  onChange,
}: OpeningTimingControlProps) {
  const [draft, setDraft] = useState(String(opening.leadInMs / 1_000))
  const [titleDraft, setTitleDraft] = useState(
    opening.titleTiming.mode === 'fixed' ? String(opening.titleTiming.durationMs / 1_000) : '0',
  )
  const discardBlurRef = useRef(false)
  useEffect(() => setDraft(String(opening.leadInMs / 1_000)), [opening.leadInMs])
  useEffect(
    () =>
      setTitleDraft(
        opening.titleTiming.mode === 'fixed' ? String(opening.titleTiming.durationMs / 1_000) : '0',
      ),
    [opening.titleTiming],
  )
  const acceptedMaximumMs = Number.isSafeInteger(maximumMs)
    ? Math.max(0, Math.min(MAX_OPENING_MS, maximumMs))
    : 0
  const parseSeconds = (value: string, maximum: number): number | null => {
    if (!/^\d+(?:\.\d)?$/u.test(value)) return null
    const milliseconds = Math.round(Number(value) * 1_000)
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= maximum
      ? milliseconds
      : null
  }
  const commit = () => {
    if (discardBlurRef.current) {
      discardBlurRef.current = false
      return
    }
    const leadInMs = parseSeconds(draft, acceptedMaximumMs)
    if (leadInMs === null) return setDraft(String(opening.leadInMs / 1_000))
    const durationMs =
      opening.titleTiming.mode === 'fixed' ? parseSeconds(titleDraft, MAX_OPENING_MS) : null
    if (opening.titleTiming.mode === 'fixed' && durationMs === null) {
      return setTitleDraft(String(opening.titleTiming.durationMs / 1_000))
    }
    onChange({
      leadInMs,
      titleTiming: durationMs === null ? { mode: 'until-lyrics' } : { mode: 'fixed', durationMs },
    })
    setDraft(String(leadInMs / 1_000))
  }
  const setTitleMode = (mode: 'until-lyrics' | 'fixed') => {
    const leadInMs = parseSeconds(draft, acceptedMaximumMs) ?? opening.leadInMs
    const durationMs = parseSeconds(titleDraft, MAX_OPENING_MS) ?? 0
    onChange({ leadInMs, titleTiming: mode === 'fixed' ? { mode, durationMs } : { mode } })
  }
  return (
    <div className="opening-timing-control">
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
      <div className="opening-timing-control__mode">
        <label>
          <span>Title timing</span>
          <select
            aria-label="Title timing mode"
            value={opening.titleTiming.mode}
            onChange={(event) =>
              setTitleMode(event.currentTarget.value as 'until-lyrics' | 'fixed')
            }
          >
            <option value="until-lyrics">Until lyrics</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>
        {opening.titleTiming.mode === 'fixed' && (
          <label className="field field--inline">
            <span>Title duration</span>
            <div>
              <input
                aria-label="Fixed title duration seconds"
                inputMode="decimal"
                value={titleDraft}
                onBlur={commit}
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit()
                  }
                }}
              />
              <em>s</em>
            </div>
          </label>
        )}
      </div>
      <p className="opening-timing-control__summary">
        {facts.titleEndMs === 0
          ? 'Title is not visible in output.'
          : opening.titleTiming.mode === 'fixed'
            ? Math.max(opening.leadInMs, opening.titleTiming.durationMs) === 0
              ? `Title is not visible in output; music starts at ${(opening.leadInMs / 1_000).toFixed(1)}.`
              : `Title 0:00–${(facts.titleEndMs / 1_000).toFixed(1)}; music starts at ${(opening.leadInMs / 1_000).toFixed(1)}; ${facts.lyricStartMs === null ? 'no eligible visible lyric.' : `lyrics start at ${(facts.lyricStartMs / 1_000).toFixed(1)}.`}`
            : Number.isFinite(facts.titleEndMs)
              ? `Title 0:00–${(facts.titleEndMs / 1_000).toFixed(1)}; music starts at ${(opening.leadInMs / 1_000).toFixed(1)}; lyrics start at ${((facts.lyricStartMs ?? facts.titleEndMs) / 1_000).toFixed(1)}.`
              : `Title remains for the full video; music starts at ${(opening.leadInMs / 1_000).toFixed(1)}; no eligible visible lyric.`}
      </p>
    </div>
  )
}
