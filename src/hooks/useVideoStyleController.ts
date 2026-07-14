import { useCallback, useMemo, useRef, useState } from 'react'
import type { StyleLifecycleCommand } from '../components/StyleLifecycleDialog'
import type { KaraokeProject } from '../lib/karaoke'
import {
  createVideoStyleDraft,
  isVideoStyleDraftValid,
  projectWithVideoStyleDraft,
  videoStyleDraftEqualsProject,
} from '../lib/style-session'
import {
  backgroundReadiness,
  cloneVocalStyle,
  type BackgroundMode,
} from '../lib/video-style'
import { useLinkedBackground } from './useLinkedBackground'
import { useVideoStyleSession } from './useVideoStyleSession'

type Resolution = 'apply' | 'discard'

export function useVideoStyleController({
  project,
  commitProject,
}: {
  project: KaraokeProject
  commitProject: (project: KaraokeProject) => void
}) {
  const session = useVideoStyleSession()
  const background = useLinkedBackground()
  const [settling, setSettling] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [windowClosePending, setWindowClosePending] = useState(false)
  const settlingRef = useRef(false)
  const pendingCommandRef = useRef<StyleLifecycleCommand | null>(null)
  const commandSequenceRef = useRef(0)
  const windowClosePendingRef = useRef(false)
  const currentRef = useRef({ background, project, session })
  currentRef.current = { background, project, session }

  const draftValid = useMemo(
    () => Boolean(session.draft && isVideoStyleDraftValid(session.draft)),
    [session.draft],
  )

  const ownWindowClose = useCallback((owned: boolean) => {
    windowClosePendingRef.current = owned
    setWindowClosePending(owned)
  }, [])

  const open = useCallback((projectToStyle: KaraokeProject) => {
    pendingCommandRef.current = null
    commandSequenceRef.current += 1
    setLifecycleError(null)
    const backgroundPath = projectToStyle.stageStyle.background.mode === 'image'
      ? projectToStyle.stageStyle.background.imagePath
      : null
    currentRef.current.background.associatePath(backgroundPath)
    currentRef.current.background.cancelPendingForEditing(backgroundPath)
    currentRef.current.session.open(projectToStyle, currentRef.current.background.snapshot())
  }, [])

  const cancelSupersededWindowClose = useCallback(async () => {
    const closeIsStillSuperseded = () => pendingCommandRef.current !== 'close'
    while (
      windowClosePendingRef.current &&
      closeIsStillSuperseded()
    ) {
      const sequence = commandSequenceRef.current
      const resolveWindowClose = window.studio?.resolveWindowClose
      if (!resolveWindowClose) {
        throw new Error('The pending window close request could not be canceled.')
      }
      const acknowledged = await resolveWindowClose(false)
      if (acknowledged === false) {
        throw new Error('The pending window close request was not canceled.')
      }
      if (
        commandSequenceRef.current === sequence &&
        closeIsStillSuperseded()
      ) {
        ownWindowClose(false)
      }
    }
  }, [ownWindowClose])

  const resolveEditor = useCallback(async (resolution: Resolution): Promise<boolean> => {
    if (settlingRef.current) return false
    const initial = currentRef.current
    const draft = initial.session.draft
    if (!draft || (resolution === 'apply' && !isVideoStyleDraftValid(draft))) return false

    const baseline = initial.session.backgroundBaseline
    const baselineDraft = initial.session.baseline
    const appliedReadiness = backgroundReadiness(
      draft.stageStyle.background,
      initial.background.url,
      initial.background.error,
    )
    const baselineReadiness = baselineDraft
      ? backgroundReadiness(
          baselineDraft.stageStyle.background,
          baseline.url,
          baseline.error,
        )
      : { ready: true, reason: null }
    const retainedUrl = resolution === 'apply'
      ? draft.stageStyle.background.mode === 'image' && appliedReadiness.ready
        ? initial.background.url
        : null
      : baselineDraft?.stageStyle.background.mode === 'image' && baselineReadiness.ready
        ? baseline.url
        : null
    const preservedError = resolution === 'apply'
      ? draft.stageStyle.background.mode === 'image' && !appliedReadiness.ready
        ? appliedReadiness.reason
        : null
      : baseline.error

    settlingRef.current = true
    setSettling(true)
    setLifecycleError(null)
    try {
      try {
        await initial.background.settle(retainedUrl)
      } catch (error) {
        setLifecycleError(
          error instanceof Error ? error.message : 'The linked background could not be settled',
        )
        return false
      }

      try {
        await cancelSupersededWindowClose()
      } catch (error) {
        setLifecycleError(
          error instanceof Error ? error.message : 'The window close request could not be canceled.',
        )
        return false
      }

      const current = currentRef.current
      let nextProject = current.project
      if (resolution === 'apply') {
        if (!videoStyleDraftEqualsProject(draft, current.project)) {
          nextProject = {
            ...projectWithVideoStyleDraft(current.project, draft),
            updatedAt: new Date().toISOString(),
          }
          commitProject(nextProject)
        }
        if (draft.stageStyle.background.mode === 'image') {
          if (appliedReadiness.ready) {
            current.background.setError(null)
          } else {
            current.background.setUrl(null)
            current.background.setError(preservedError)
          }
        } else {
          current.background.clear()
        }
      } else {
        current.background.restore(baseline)
      }

      current.session.close()
      const command = pendingCommandRef.current
      pendingCommandRef.current = null
      if (command) {
        if (command === 'close') ownWindowClose(false)
        current.session.queueResolved(command, nextProject)
      }
      return true
    } finally {
      settlingRef.current = false
      setSettling(false)
    }
  }, [cancelSupersededWindowClose, commitProject, ownWindowClose])

  const cancel = useCallback(async () => {
    const current = currentRef.current
    if (!current.session.draft) return false
    if (current.session.lifecycleCommand) return false
    if (current.session.dirty) {
      current.session.requestCancel()
      return false
    }
    return resolveEditor('discard')
  }, [resolveEditor])

  const discardChanges = useCallback(() => resolveEditor('discard'), [resolveEditor])
  const commitDraft = useCallback(() => resolveEditor('apply'), [resolveEditor])
  const apply = commitDraft

  const requestCommand = useCallback((command: StyleLifecycleCommand) => {
    const current = currentRef.current
    commandSequenceRef.current += 1
    pendingCommandRef.current = command
    setLifecycleError(null)
    if (command === 'close') ownWindowClose(true)

    if (!current.session.draft) {
      pendingCommandRef.current = null
      if (command === 'close') ownWindowClose(false)
      current.session.queueResolved(command, current.project)
      return
    }

    if (!current.session.dirty) {
      if (!settlingRef.current) void resolveEditor('discard')
      return
    }
    current.session.showCommand(command)
  }, [ownWindowClose, resolveEditor])

  const resolveCommand = useCallback(async (applyDraft: boolean) => {
    const current = currentRef.current
    if (!current.session.lifecycleCommand || !current.session.draft) return false
    return resolveEditor(applyDraft ? 'apply' : 'discard')
  }, [resolveEditor])

  const keepEditing = useCallback(() => {
    pendingCommandRef.current = null
    commandSequenceRef.current += 1
    ownWindowClose(false)
    setLifecycleError(null)
    currentRef.current.session.keepEditing()
  }, [ownWindowClose])

  const resetSession = useCallback(() => {
    pendingCommandRef.current = null
    commandSequenceRef.current += 1
    ownWindowClose(false)
    setLifecycleError(null)
    currentRef.current.session.reset()
  }, [ownWindowClose])

  const updateSungColor = useCallback((trackId: string, color: string) => {
    const current = currentRef.current
    if (!current.session.draft) return false
    const next = createVideoStyleDraft(
      projectWithVideoStyleDraft(current.project, current.session.draft),
    )
    const vocal = cloneVocalStyle(next.vocalStyles[trackId])
    if (
      vocal.sungColor === color ||
      (vocal.sungColor === null && next.stageStyle.lyrics.sungColor === color)
    ) return true
    vocal.sungColor = color
    next.vocalStyles[trackId] = vocal
    current.session.setDraft(next)
    return true
  }, [])

  const applyBackgroundImage = useCallback((path: string, url: string) => {
    const current = currentRef.current
    if (!current.session.draft) return
    const next = createVideoStyleDraft(
      projectWithVideoStyleDraft(current.project, current.session.draft),
    )
    next.stageStyle.background.mode = 'image'
    next.stageStyle.background.imagePath = path
    current.session.setDraft(next)
    current.background.link(path, url)
  }, [])

  const clearBackgroundImage = useCallback(() => {
    const current = currentRef.current
    if (!current.session.draft) return
    const next = createVideoStyleDraft(
      projectWithVideoStyleDraft(current.project, current.session.draft),
    )
    next.stageStyle.background.imagePath = null
    next.stageStyle.background.mode = 'gradient'
    current.session.setDraft(next)
    current.background.clear()
  }, [])

  const setBackgroundMode = useCallback((mode: BackgroundMode) => {
    const current = currentRef.current
    if (!current.session.draft) return
    const next = createVideoStyleDraft(
      projectWithVideoStyleDraft(current.project, current.session.draft),
    )
    const previousMode = next.stageStyle.background.mode
    next.stageStyle.background.mode = mode
    if (mode !== 'image' || previousMode !== 'image') {
      next.stageStyle.background.imagePath = null
      current.background.clear()
    }
    current.session.setDraft(next)
  }, [])

  return {
    apply,
    applyBackgroundImage,
    background,
    cancel,
    cancelPending: session.cancelPending,
    clearBackgroundImage,
    clearResolvedCommand: session.clearResolvedCommand,
    close: discardChanges,
    commitDraft,
    dirty: session.dirty,
    draft: session.draft,
    draftValid,
    discardChanges,
    keepCancelEditing: session.keepCancelEditing,
    keepEditing,
    lifecycleCommand: session.lifecycleCommand,
    lifecycleError,
    open,
    requestCommand,
    resetSession,
    resolveCommand,
    resolvedCommand: session.resolvedCommand,
    settling,
    setBackgroundMode,
    setDraft: session.setDraft,
    updateSungColor,
    windowClosePending,
  }
}
