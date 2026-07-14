import { useCallback, useEffect, useRef, useState } from 'react'

export function useProjectCloseGuard({
  dirty,
  save,
  resolveWindowClose,
  onError,
}: {
  dirty: boolean
  save: () => Promise<boolean>
  resolveWindowClose: (proceed: boolean) => Promise<boolean>
  onError: (error: unknown) => void
}) {
  const [pending, setPending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resolving, setResolving] = useState(false)
  const approvedUnloadRef = useRef(false)
  const busy = saving || resolving

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (approvedUnloadRef.current) {
        approvedUnloadRef.current = false
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const approvePendingClose = useCallback(async () => {
    approvedUnloadRef.current = true
    setResolving(true)
    try {
      const accepted = await resolveWindowClose(true)
      if (!accepted) approvedUnloadRef.current = false
      else setPending(false)
      return accepted
    } catch (error) {
      approvedUnloadRef.current = false
      onError(error)
      return false
    } finally {
      setResolving(false)
    }
  }, [onError, resolveWindowClose])

  const requestClose = useCallback(() => {
    if (dirty) {
      setPending(true)
      return
    }
    void approvePendingClose()
  }, [approvePendingClose, dirty])

  const saveAndClose = useCallback(async () => {
    if (!pending || busy) return false
    setSaving(true)
    let saved = false
    try {
      saved = await save()
    } catch (error) {
      onError(error)
    } finally {
      setSaving(false)
    }
    if (!saved) return false
    return approvePendingClose()
  }, [approvePendingClose, busy, onError, pending, save])

  const discardAndClose = useCallback(async () => {
    if (!pending || busy) return false
    return approvePendingClose()
  }, [approvePendingClose, busy, pending])

  const keepEditing = useCallback(async () => {
    if (!pending || busy) return false
    approvedUnloadRef.current = false
    setResolving(true)
    try {
      const canceled = await resolveWindowClose(false)
      if (canceled !== true) {
        onError(new Error(
          'The pending window close request was not canceled. Keep editing and try again.',
        ))
        return false
      }
      setPending(false)
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      setResolving(false)
    }
  }, [busy, onError, pending, resolveWindowClose])

  return {
    busy,
    discardAndClose,
    keepEditing,
    pending,
    requestClose,
    saveAndClose,
    saving,
  }
}
