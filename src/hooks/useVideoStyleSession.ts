import { useCallback, useMemo, useRef, useState } from 'react'
import type { StyleLifecycleCommand } from '../components/StyleLifecycleDialog'
import type { KaraokeProject } from '../lib/karaoke'
import {
  createVideoStyleDraft,
  type VideoStyleDraft,
} from '../lib/style-session'
import type { LinkedBackgroundSnapshot } from './useLinkedBackground'

export interface ResolvedStyleCommand {
  command: StyleLifecycleCommand
  project: KaraokeProject
}

export function useVideoStyleSession() {
  const [draft, setDraft] = useState<VideoStyleDraft | null>(null)
  const [baseline, setBaseline] = useState<VideoStyleDraft | null>(null)
  const [lifecycleCommand, setLifecycleCommand] = useState<StyleLifecycleCommand | null>(null)
  const [cancelPending, setCancelPending] = useState(false)
  const [resolvedCommand, setResolvedCommand] = useState<ResolvedStyleCommand | null>(null)
  const backgroundBaselineRef = useRef<LinkedBackgroundSnapshot>({
    path: null,
    url: null,
    error: null,
    status: 'none',
  })
  const dirty = useMemo(
    () => Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline)),
    [baseline, draft],
  )

  const open = useCallback((project: KaraokeProject, background: LinkedBackgroundSnapshot) => {
    const next = createVideoStyleDraft(project)
    backgroundBaselineRef.current = background
    setBaseline(createVideoStyleDraft(project))
    setDraft(next)
  }, [])

  const close = useCallback(() => {
    setDraft(null)
    setBaseline(null)
    setLifecycleCommand(null)
    setCancelPending(false)
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.project-style-button')?.focus()
    }, 0)
  }, [])

  const reset = useCallback(() => {
    setDraft(null)
    setBaseline(null)
    setLifecycleCommand(null)
    setCancelPending(false)
    setResolvedCommand(null)
    backgroundBaselineRef.current = { path: null, url: null, error: null, status: 'none' }
  }, [])

  const queueResolved = useCallback((
    command: StyleLifecycleCommand,
    project: KaraokeProject,
  ) => {
    setResolvedCommand({ command, project })
  }, [])

  const showCommand = useCallback((command: StyleLifecycleCommand) => {
    setCancelPending(false)
    setLifecycleCommand(command)
  }, [])

  const keepEditing = useCallback(() => setLifecycleCommand(null), [])
  const keepCancelEditing = useCallback(() => setCancelPending(false), [])
  const requestCancel = useCallback(() => {
    if (!draft) return false
    if (lifecycleCommand) return false
    if (dirty) {
      setCancelPending(true)
      return false
    }
    close()
    return true
  }, [close, dirty, draft, lifecycleCommand])
  const clearResolvedCommand = useCallback(() => setResolvedCommand(null), [])

  return {
    backgroundBaseline: backgroundBaselineRef.current,
    baseline,
    cancelPending,
    clearResolvedCommand,
    close,
    dirty,
    draft,
    lifecycleCommand,
    keepEditing,
    keepCancelEditing,
    open,
    queueResolved,
    requestCancel,
    reset,
    resolvedCommand,
    setDraft,
    showCommand,
  }
}
