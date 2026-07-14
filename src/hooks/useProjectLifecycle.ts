import { useCallback, useRef, useState } from 'react'
import {
  createProject,
  parseProject,
  serializeProject,
  type KaraokeProject,
} from '../lib/karaoke'
import type { LinkedBackgroundSnapshot } from './useLinkedBackground'
import { downloadText, slugify } from '../utils'
import { useProjectCloseGuard } from './useProjectCloseGuard'

type ToastTone = 'success' | 'warning' | 'neutral'
type AudioRestoreOutcome = 'none' | 'success' | 'missing' | 'stale'
type BackgroundRestoreOutcome = 'none' | 'success' | 'missing' | 'stale'

export function useProjectLifecycle({
  project,
  revision,
  dirty,
  markSaved,
  resetProject,
  resetVideoStyle,
  pausePlayback,
  seekPlayback,
  setAudioUrl,
  setActiveAudioPath,
  beginBackgroundRestore,
  resolveBackgroundRestore,
  resetBackground,
  resetEditorState,
  confirmDiscard,
  openBrowserProject,
  showSaveFailure,
  showToast,
}: {
  project: KaraokeProject
  revision: number
  dirty: boolean
  markSaved: (revision: number) => void
  resetProject: (project: KaraokeProject, saved?: boolean) => void
  resetVideoStyle: () => void
  pausePlayback: () => void
  seekPlayback: (positionMs: number) => void
  setAudioUrl: (url: string | null) => void
  setActiveAudioPath: (path: string | null) => void
  beginBackgroundRestore: () => number
  resolveBackgroundRestore: (
    generation: number,
    snapshot: LinkedBackgroundSnapshot,
  ) => boolean
  resetBackground: () => void
  resetEditorState: (project: KaraokeProject) => void
  confirmDiscard: (message: string) => boolean
  openBrowserProject: () => void
  showSaveFailure: () => void
  showToast: (message: string, tone?: ToastTone) => void
}) {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const audioRestoreGenerationRef = useRef(0)
  const projectLifecycleSequenceRef = useRef(0)
  const saveRequestSequenceRef = useRef(0)
  const currentProjectRef = useRef(project)
  const currentRevisionRef = useRef(revision)
  currentProjectRef.current = project
  currentRevisionRef.current = revision

  const invalidateAudioRestore = useCallback(() => {
    audioRestoreGenerationRef.current += 1
  }, [])

  const openProjectContents = useCallback(async (
    contents: string,
    path: string | null,
    pendingRequestId: string | null = null,
  ) => {
    const settlePendingOpen = async (accepted: boolean) => {
      if (!pendingRequestId) return true
      if (!window.studio?.settleProjectOpen) return false
      return window.studio.settleProjectOpen(pendingRequestId, accepted)
    }
    let next: KaraokeProject
    try {
      next = parseProject(contents)
    } catch (error) {
      await settlePendingOpen(false).catch(() => false)
      showToast(error instanceof Error ? error.message : 'Could not open that project.', 'warning')
      return false
    }
    if (!confirmDiscard('Discard the unsaved changes and open another project?')) {
      await settlePendingOpen(false).catch(() => false)
      return false
    }
    try {
      if (!await settlePendingOpen(true)) {
        showToast('The selected project is no longer pending. Open it again.', 'warning')
        return false
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'The selected project could not be activated.',
        'warning',
      )
      return false
    }

    projectLifecycleSequenceRef.current += 1
    const lifecycleSequence = projectLifecycleSequenceRef.current
    const lifecycleIsCurrent = () => (
      lifecycleSequence === projectLifecycleSequenceRef.current
    )
    invalidateAudioRestore()
    resetBackground()
    const audioGeneration = audioRestoreGenerationRef.current
    const backgroundGeneration = beginBackgroundRestore()

    resetProject(next, true)
    setProjectPath(path)
    resetEditorState(next)
    pausePlayback()
    seekPlayback(0)
    setAudioUrl(null)
    setActiveAudioPath(null)
    resetVideoStyle()

    const restoreBackground = async (): Promise<BackgroundRestoreOutcome> => {
      const background = next.stageStyle.background
      if (background.mode !== 'image' || !background.imagePath) return 'none'
      const missing = (detail = `Linked image is missing or unreadable: ${background.imagePath}`) => (
        resolveBackgroundRestore(backgroundGeneration, {
          path: background.imagePath,
          url: null,
          error: detail,
          status: 'missing',
        }) ? 'missing' as const : 'stale' as const
      )
      resolveBackgroundRestore(backgroundGeneration, {
        path: background.imagePath,
        url: null,
        error: null,
        status: 'pending',
      })
      if (!window.studio?.resolveProjectBackground || !path) {
        return missing(`Relink this background image: ${background.imagePath}`)
      }
      try {
        const result = await window.studio.resolveProjectBackground(path)
        if (result.status === 'stale') return 'stale'
        if (result.status === 'missing') return missing()
        return resolveBackgroundRestore(backgroundGeneration, {
          path: result.media.path,
          url: result.media.url,
          error: null,
          status: 'ready',
        }) ? 'success' : 'stale'
      } catch (error) {
        return missing(error instanceof Error ? error.message : undefined)
      }
    }

    const restoreAudio = async (): Promise<AudioRestoreOutcome> => {
      if (!next.audioPath) return 'none'
      if (!window.studio?.resolveProjectAudio || !path) return 'missing'
      try {
        const result = await window.studio.resolveProjectAudio(path)
        if (
          lifecycleIsCurrent() &&
          audioGeneration === audioRestoreGenerationRef.current &&
          result.status === 'success'
        ) {
          setAudioUrl(result.media.url)
          setActiveAudioPath(result.media.path)
          return 'success'
        }
        if (result.status === 'stale') return 'stale'
        return audioGeneration === audioRestoreGenerationRef.current ? 'missing' : 'stale'
      } catch {
        return audioGeneration === audioRestoreGenerationRef.current ? 'missing' : 'stale'
      }
    }

    const [backgroundOutcome, audioOutcome] = await Promise.all([
      restoreBackground(),
      restoreAudio(),
    ])
    if (!lifecycleIsCurrent()) return false
    if (audioOutcome === 'missing') {
      showToast('Project opened; relink the missing audio file.', 'warning')
    } else if (backgroundOutcome === 'missing') {
      showToast('Project opened; relink the missing background image.', 'warning')
    } else if (audioOutcome !== 'stale' && backgroundOutcome !== 'stale') {
      showToast(`Opened ${next.title}`, 'success')
    }
    return true
  }, [
    beginBackgroundRestore,
    confirmDiscard,
    invalidateAudioRestore,
    pausePlayback,
    resetBackground,
    resetEditorState,
    resetProject,
    resetVideoStyle,
    resolveBackgroundRestore,
    seekPlayback,
    setActiveAudioPath,
    setAudioUrl,
    showToast,
  ])

  const newProject = useCallback(async () => {
    if (!confirmDiscard('Discard the unsaved changes and start a new project?')) return false
    if (window.studio) {
      try {
        if (!window.studio.resetProjectScope || !(await window.studio.resetProjectScope())) {
          showToast('The current project could not be cleared. Keep editing and try again.', 'warning')
          return false
        }
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'The current project could not be cleared.',
          'warning',
        )
        return false
      }
    }
    projectLifecycleSequenceRef.current += 1
    invalidateAudioRestore()
    resetBackground()
    const next = createProject({ title: 'Untitled Song', artist: 'Unknown Artist' })
    resetProject(next, true)
    setProjectPath(null)
    setAudioUrl(null)
    setActiveAudioPath(null)
    resetVideoStyle()
    resetEditorState(next)
    pausePlayback()
    seekPlayback(0)
    showToast('New project ready', 'neutral')
    return true
  }, [
    confirmDiscard,
    invalidateAudioRestore,
    pausePlayback,
    resetBackground,
    resetEditorState,
    resetProject,
    resetVideoStyle,
    seekPlayback,
    setActiveAudioPath,
    setAudioUrl,
    showToast,
  ])

  const openProject = useCallback(async () => {
    if (!window.studio) {
      openBrowserProject()
      return false
    }
    try {
      const result = await window.studio.openProject()
      return result ? openProjectContents(result.contents, result.path, result.requestId) : false
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not open that project.', 'warning')
      return false
    }
  }, [openBrowserProject, openProjectContents, showToast])

  const saveProject = useCallback(async (
    saveAs = false,
    projectToSave: KaraokeProject = project,
    showFailureDialog = true,
  ): Promise<boolean> => {
    const saveRequestSequence = saveRequestSequenceRef.current + 1
    saveRequestSequenceRef.current = saveRequestSequence
    const projectLifecycleSequence = projectLifecycleSequenceRef.current
    const savedRevision = projectToSave === currentProjectRef.current
      ? currentRevisionRef.current
      : null
    const saveIsCurrent = () => (
      saveRequestSequence === saveRequestSequenceRef.current &&
      projectLifecycleSequence === projectLifecycleSequenceRef.current
    )

    try {
      const contentsToSave = serializeProject(projectToSave)
      const suggestedName = `${slugify(projectToSave.title)}.oks`
      if (window.studio) {
        const result = await window.studio.saveProject({
          path: saveAs ? undefined : projectPath ?? undefined,
          suggestedName,
          contents: contentsToSave,
        })
        if (!result || !saveIsCurrent()) return false
        setProjectPath(result.path)
      } else {
        downloadText(suggestedName, contentsToSave, 'application/json')
      }
      if (!saveIsCurrent()) return false
      if (
        savedRevision === null ||
        currentProjectRef.current !== projectToSave ||
        currentRevisionRef.current !== savedRevision
      ) return false
      markSaved(savedRevision)
      showToast('Project saved', 'success')
      return true
    } catch (error) {
      if (!saveIsCurrent()) return false
      if (showFailureDialog) showSaveFailure()
      showToast(error instanceof Error ? error.message : 'Project could not be saved.', 'warning')
      return false
    }
  }, [markSaved, project, projectPath, showSaveFailure, showToast])

  const resolveWindowClose = useCallback(async (proceed: boolean) => {
    if (!window.studio?.resolveWindowClose) return false
    return window.studio.resolveWindowClose(proceed)
  }, [])
  const close = useProjectCloseGuard({
    dirty,
    save: () => saveProject(false, currentProjectRef.current, false),
    resolveWindowClose,
    onError: (error) => showToast(
      error instanceof Error ? error.message : 'The close request could not be resolved.',
      'warning',
    ),
  })

  return {
    close,
    invalidateAudioRestore,
    newProject,
    openProject,
    openProjectContents,
    resolveWindowClose,
    saveProject,
  }
}
