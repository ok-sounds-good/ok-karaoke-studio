import { useEffect, useMemo, useState } from 'react'
import type { OpeningTimingAdvisoryInterval } from '../lib/stage-frame-state'
import { formatTime } from '../lib/model'

interface OpeningTimingAdvisoryProps {
  deferred: boolean
  intervals: OpeningTimingAdvisoryInterval[]
  onReview: () => void
  sessionKey: string
}

/** A session-only, polite timing notice; it intentionally does no geometry analysis. */
export function OpeningTimingAdvisory({
  deferred,
  intervals,
  onReview,
  sessionKey,
}: OpeningTimingAdvisoryProps) {
  const candidateFingerprint = useMemo(() => JSON.stringify(intervals), [intervals])
  const [settledIntervals, setSettledIntervals] = useState(intervals)
  const settledFingerprint = useMemo(() => JSON.stringify(settledIntervals), [settledIntervals])
  const [dismissedFingerprint, setDismissedFingerprint] = useState<string | null>(null)
  useEffect(() => {
    if (!deferred) setSettledIntervals(intervals)
  }, [candidateFingerprint, deferred, intervals])
  useEffect(() => setDismissedFingerprint(null), [sessionKey, settledFingerprint])
  if (!settledIntervals.length || dismissedFingerprint === settledFingerprint) return null
  return (
    <section className="opening-timing-advisory" aria-live="polite" role="status">
      <p>
        Title overlaps {settledIntervals.map(({ types }) => types.join(' and ')).join('; ')} at{' '}
        {settledIntervals
          .map(({ startMs, endMs }) => `${formatTime(startMs)}–${formatTime(endMs)}`)
          .join(', ')}
        .
      </p>
      <div>
        <button type="button" onClick={onReview}>
          Review timing
        </button>
        <button type="button" onClick={() => setDismissedFingerprint(settledFingerprint)}>
          Dismiss
        </button>
      </div>
    </section>
  )
}
