import { useCallback, useEffect, useRef, useState } from 'react'

export function useWindowCloseCancellation({
  active,
  acknowledge,
  onAcknowledged,
}: {
  active: boolean
  acknowledge: () => Promise<unknown>
  onAcknowledged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (active) return
    busyRef.current = false
    setBusy(false)
    setError(null)
  }, [active])

  const cancelClose = useCallback(async () => {
    if (!active || busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const acknowledged = await acknowledge()
      if (acknowledged !== true) {
        throw new Error('The pending window close request was not canceled. Try again.')
      }
      onAcknowledged()
      return true
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : 'The close request could not be canceled. Try again.')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [acknowledge, active, onAcknowledged])

  return { busy, cancelClose, error }
}
