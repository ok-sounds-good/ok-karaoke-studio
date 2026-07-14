import { useCallback, useEffect, useRef, useState } from 'react'

export type LinkedBackgroundStatus = 'none' | 'pending' | 'ready' | 'missing'

export interface LinkedBackgroundSnapshot {
  path: string | null
  url: string | null
  error: string | null
  status: LinkedBackgroundStatus
}

const EMPTY_BACKGROUND: LinkedBackgroundSnapshot = Object.freeze({
  path: null,
  url: null,
  error: null,
  status: 'none',
})

export function useLinkedBackground() {
  const [state, setState] = useState<LinkedBackgroundSnapshot>(EMPTY_BACKGROUND)
  const stateRef = useRef(state)
  const generationRef = useRef(0)
  const cacheRef = useRef(new Map<string, LinkedBackgroundSnapshot>())
  const blobUrlsRef = useRef(new Set<string>())
  stateRef.current = state

  useEffect(() => () => {
    blobUrlsRef.current.forEach((value) => URL.revokeObjectURL(value))
  }, [])

  const remember = useCallback((snapshot: LinkedBackgroundSnapshot) => {
    if (snapshot.url?.startsWith('blob:')) blobUrlsRef.current.add(snapshot.url)
    if (snapshot.path) cacheRef.current.set(snapshot.path, snapshot)
    stateRef.current = snapshot
    setState(snapshot)
  }, [])

  const beginOperation = useCallback(() => {
    generationRef.current += 1
    return generationRef.current
  }, [])
  const isCurrent = useCallback((generation: number) => (
    generation === generationRef.current
  ), [])
  const resolveOperation = useCallback((
    generation: number,
    snapshot: LinkedBackgroundSnapshot,
  ) => {
    if (!isCurrent(generation)) return false
    remember(snapshot)
    return true
  }, [isCurrent, remember])

  const associatePath = useCallback((path: string | null) => {
    const current = stateRef.current
    const next = { ...current, path }
    if (path) cacheRef.current.set(path, next)
    stateRef.current = next
    setState(next)
  }, [])
  const link = useCallback((path: string, url: string) => {
    beginOperation()
    remember({ path, url, error: null, status: 'ready' })
  }, [beginOperation, remember])
  const setUrl = useCallback((url: string | null) => {
    beginOperation()
    const current = stateRef.current
    remember({
      ...current,
      url,
      status: url ? 'ready' : current.path ? 'missing' : 'none',
    })
  }, [beginOperation, remember])
  const setError = useCallback((error: string | null) => {
    const current = stateRef.current
    remember({
      ...current,
      error,
      status: error ? 'missing' : current.url ? 'ready' : current.path ? 'pending' : 'none',
    })
  }, [remember])
  const snapshot = useCallback((): LinkedBackgroundSnapshot => ({
    ...stateRef.current,
  }), [])
  const restore = useCallback((value: LinkedBackgroundSnapshot) => {
    beginOperation()
    remember({ ...value })
  }, [beginOperation, remember])
  const clear = useCallback(() => {
    beginOperation()
    remember(EMPTY_BACKGROUND)
  }, [beginOperation, remember])
  const reset = useCallback(() => {
    beginOperation()
    cacheRef.current.clear()
    remember(EMPTY_BACKGROUND)
  }, [beginOperation, remember])

  const settle = useCallback(async (retainedUrl: string | null) => {
    const studio = window.studio
    if (!studio) return
    if (!studio.retainBackground) {
      throw new Error('Linked background activation is unavailable')
    }
    const retained = await studio.retainBackground(retainedUrl)
    if (!retained) throw new Error('The linked background authorization could not be retained')
  }, [])

  const synchronizeProject = useCallback(async (
    mode: 'solid' | 'gradient' | 'image',
    path: string | null,
  ) => {
    const generation = beginOperation()
    if (mode !== 'image' || !path) {
      try {
        await settle(null)
      } catch {
        // Browser previews and a closing renderer have no persistent capability.
      }
      if (isCurrent(generation)) remember(EMPTY_BACKGROUND)
      return
    }

    const cached = cacheRef.current.get(path)
    if (!cached?.url) {
      try {
        await settle(null)
      } catch {
        // The missing binding remains non-exportable even without desktop IPC.
      }
      if (isCurrent(generation)) {
        remember({
          path,
          url: null,
          error: cached?.error ?? `Linked image is missing or unreadable: ${path}`,
          status: 'missing',
        })
      }
      return
    }
    try {
      await settle(cached.url)
      if (isCurrent(generation)) remember({ ...cached, error: null, status: 'ready' })
    } catch (error) {
      if (isCurrent(generation)) {
        remember({
          path,
          url: null,
          error: error instanceof Error ? error.message : `Could not activate ${path}`,
          status: 'missing',
        })
      }
    }
  }, [beginOperation, isCurrent, remember, settle])

  const markInvalid = useCallback((path: string, error: string) => {
    if (stateRef.current.path !== path) return false
    beginOperation()
    remember({ path, url: null, error, status: 'missing' })
    return true
  }, [beginOperation, remember])

  const cancelPendingForEditing = useCallback((path: string | null) => {
    if (stateRef.current.status !== 'pending') return
    const generation = beginOperation()
    const error = path
      ? `Linked image restoration was canceled; relink this background: ${path}`
      : 'Linked image restoration was canceled; relink the background.'
    remember({ path, url: null, error, status: 'missing' })
    void settle(null).catch((cause) => {
      if (!isCurrent(generation)) return
      remember({
        path,
        url: null,
        error: cause instanceof Error ? cause.message : error,
        status: 'missing',
      })
    })
  }, [beginOperation, isCurrent, remember, settle])

  return {
    associatePath,
    beginOperation,
    cancelPendingForEditing,
    clear,
    error: state.error,
    isCurrent,
    link,
    markInvalid,
    path: state.path,
    reset,
    resolveOperation,
    restore,
    setError,
    setUrl,
    settle,
    snapshot,
    status: state.status,
    synchronizeProject,
    url: state.url,
  }
}
