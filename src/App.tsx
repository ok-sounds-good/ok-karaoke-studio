import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KaraokeProject, LyricDisplaySettings, LyricWord, ValidationIssue, VocalTrack } from './lib/model'
import {
  createProject,
  exportAss,
  exportLrc,
  importLrc,
  parseLyrics,
  serializeProject,
  validateProject,
} from './lib/model'
import { TopBar } from './components/TopBar'
import { InspectorPanel } from './components/InspectorPanel'
import { KaraokePreview } from './components/KaraokePreview'
import { SyncCueStrip } from './components/SyncCueStrip'
import { Timeline } from './components/Timeline'
import { VideoStyleWorkspace } from './components/VideoStyleWorkspace'
import {
  StyleDiscardDialog,
  StyleLifecycleDialog,
} from './components/StyleLifecycleDialog'
import { ProjectCloseDialog } from './components/ProjectCloseDialog'
import { SungColorDialog } from './components/SungColorDialog'
import { TransportBar } from './components/TransportBar'
import { ExportDialog, LyricsEditorDialog, ValidationDialog, WorkflowGuideDialog } from './components/Dialogs'
import { usePlayback } from './hooks/usePlayback'
import { useWaveform } from './hooks/useWaveform'
import { useProjectHistory } from './hooks/useProjectHistory'
import { useProjectLifecycle } from './hooks/useProjectLifecycle'
import { useVideoStyleController } from './hooks/useVideoStyleController'
import { useVideoStyleLifecycle } from './hooks/useVideoStyleLifecycle'
import {
  downloadText,
  effectiveDuration,
  flattenProject,
  flattenTrack,
  applyTimingDraft,
  clearTrackTimingFrom,
  patchWord,
  patchWords,
  recalculateLine,
  shiftWords,
  slugify,
  type ProjectTimingDraft,
} from './utils'
import {
  projectWithVideoStyleDraft,
} from './lib/style-session'
import {
  backgroundReadiness,
  cloneVocalStyle,
  resolveVocalStyle,
} from './lib/video-style'

interface ToastState {
  message: string
  tone: 'success' | 'warning' | 'neutral'
}

interface WorkflowGuideActionDependencies {
  canStartSync: boolean
  close: () => void
  startNew: () => void
  open: () => void
  attachAudio: () => void
  editLyrics: () => void
  importLrc: () => void
  startSync: () => void
  save: () => void
  exportProject: () => void
}

export const EDITABLE_PROJECT_EXPORT_FORMAT: StudioExportFormat = 'oks'

export function createWorkflowGuideActions({
  canStartSync,
  close,
  startNew,
  open,
  attachAudio,
  editLyrics,
  importLrc,
  startSync,
  save,
  exportProject,
}: WorkflowGuideActionDependencies) {
  const closeThen = (action: () => void) => () => {
    close()
    action()
  }

  return {
    canStartSync,
    onClose: close,
    onNew: closeThen(startNew),
    onOpen: closeThen(open),
    onAttachAudio: closeThen(attachAudio),
    onEditLyrics: closeThen(editLyrics),
    onImportLrc: closeThen(importLrc),
    onStartSync: () => {
      if (!canStartSync) return
      close()
      startSync()
    },
    onSave: closeThen(save),
    onExport: closeThen(exportProject),
  }
}

export interface ActiveTimingDraft {
  revision: number
  timings: ProjectTimingDraft
}

export function projectForTimingPreview(
  project: KaraokeProject,
  revision: number,
  timingDraft: ActiveTimingDraft | null,
) {
  return timingDraft?.revision === revision
    ? applyTimingDraft(project, timingDraft.timings)
    : project
}

function inputHasTypingFocus() {
  const element = document.activeElement
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable)
}

function eventTargetsSpaceActivatableControl(event: KeyboardEvent) {
  const target = event.target
  return target instanceof Element && Boolean(target.closest('button, a[href], summary, [role="button"], [role="menuitem"]'))
}

function selectAllInFocusedEditor() {
  const element = document.activeElement
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    try {
      element.select()
    } catch {
      // Non-text input types do not expose a selectable text range.
    }
    return true
  }
  if (element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLElement && element.isContentEditable) {
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(element.closest('[contenteditable]') ?? element)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    return true
  }
  return false
}

export function lyricTimeAtPlayback(playbackMs: number, offsetMs: number) {
  return playbackMs - offsetMs
}

export function syncWordIndexFromLyricTime(words: LyricWord[], lyricTimeMs: number) {
  const boundaryMs = lyricTimeMs - 80
  const untimedIsEligible = new Set<number>()
  let nextTimedStartMs: number | null = null
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index]
    if (word.startMs !== null) {
      nextTimedStartMs = word.startMs
    } else if (nextTimedStartMs === null || nextTimedStartMs >= boundaryMs) {
      untimedIsEligible.add(index)
    }
  }
  return words.findIndex((word, index) => (
    word.startMs === null
      ? untimedIsEligible.has(index)
      : word.startMs >= boundaryMs
  ))
}

const DEFAULT_SYNC_WORD_DURATION_MS = 100

function syncWordEnd(word: LyricWord): number | null {
  if (word.startMs === null) return null
  return Math.max(word.startMs + 1, word.endMs ?? word.startMs + DEFAULT_SYNC_WORD_DURATION_MS)
}

function adjacentTimedWord(
  words: LyricWord[],
  index: number,
  direction: -1 | 1,
): LyricWord | null {
  for (
    let candidateIndex = index + direction;
    candidateIndex >= 0 && candidateIndex < words.length;
    candidateIndex += direction
  ) {
    if (words[candidateIndex].startMs !== null) return words[candidateIndex]
  }
  return null
}

export default function App() {
  const history = useProjectHistory(createProject)
  const {
    project,
    commit: commitHistory,
    replaceCurrent,
    replaceHistoryBoundary,
  } = history
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [activeAudioPath, setActiveAudioPath] = useState<string | null>(null)
  const [activeTrackId, setActiveTrackId] = useState(project.tracks[0]?.id ?? '')
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [syncMode, setSyncMode] = useState(false)
  const [syncCursor, setSyncCursor] = useState(0)
  const [lyricsDialogOpen, setLyricsDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [videoExportProgress, setVideoExportProgress] = useState<StudioVideoExportProgress | null>(null)
  const [validationDialogOpen, setValidationDialogOpen] = useState(false)
  const [workflowGuideOpen, setWorkflowGuideOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [timingDraft, setTimingDraft] = useState<ActiveTimingDraft | null>(null)
  const [sungColorEditorTrackId, setSungColorEditorTrackId] = useState<string | null>(null)
  const videoStyle = useVideoStyleController({
    project,
    commitProject: commitHistory,
  })
  const {
    draft: styleDraft,
    setDraft: setStyleDraft,
  } = videoStyle
  const {
    error: backgroundError,
    setError: setBackgroundError,
    setUrl: setBackgroundUrl,
    url: backgroundUrl,
  } = videoStyle.background
  const [timelineGestureActive, setTimelineGestureActive] = useState(false)
  const canonicalBackgroundReadiness = backgroundReadiness(
    project.stageStyle.background,
    backgroundUrl,
    backgroundError,
  )
  const projectInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const lrcInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const syncHeldRef = useRef<{
    wordId: string
    startMs: number
    isLineFinal: boolean
    nextTimedStartMs: number | null
    projectBefore: KaraokeProject
    createdSessionHistory: boolean
  } | null>(null)
  const syncSessionHasCommitRef = useRef(false)
  const videoExportActiveRef = useRef(false)
  const lastReviewIssuesRef = useRef<ValidationIssue[]>([])

  // Any ordinary edit ends an armed synchronization transaction before it
  // creates its own history entry. Sync timing uses commitHistory directly so
  // its first real mutation can remain the session's single undo baseline.
  const commit = useCallback((
    updater: KaraokeProject | ((project: KaraokeProject) => KaraokeProject),
  ) => {
    syncHeldRef.current = null
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    commitHistory(updater)
  }, [commitHistory])

  const persistAudioDuration = useCallback((nextDurationMs: number) => {
    replaceCurrent((current) => current.durationMs === nextDurationMs
      ? current
      : { ...current, durationMs: nextDurationMs })
  }, [replaceCurrent])

  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0]
  const syncItems = useMemo(() => (activeTrack ? flattenTrack(activeTrack) : []), [activeTrack])
  const syncWords = useMemo(() => syncItems.map(({ word }) => word), [syncItems])
  const projectHasLyrics = useMemo(
    () => project.tracks.some((track) => track.lines.some((line) => line.words.length > 0)),
    [project.tracks],
  )
  const durationMs = useMemo(() => effectiveDuration(project), [project])
  const playback = usePlayback({
    durationMs,
    audioUrl,
    onDuration: persistAudioDuration,
    refreshIntervalMs: syncMode ? 50 : 16,
  })
  const videoUnavailableReason = !window.studio?.exportVideo
    ? 'Video export is available in the desktop app.'
    : !activeAudioPath || !playback.hasAudio
      ? 'Attach a readable audio track before exporting video.'
      : canonicalBackgroundReadiness.reason
  const waveform = useWaveform(audioUrl)
  const lyricTimeMs = lyricTimeAtPlayback(playback.currentMs, project.offsetMs)
  const previewProject = useMemo(
    () => projectForTimingPreview(project, history.revision, timingDraft),
    [history.revision, project, timingDraft],
  )
  const styledPreviewProject = useMemo(
    () => styleDraft ? projectWithVideoStyleDraft(previewProject, styleDraft) : previewProject,
    [previewProject, styleDraft],
  )
  const inspectorProject = styleDraft
    ? projectWithVideoStyleDraft(project, styleDraft)
    : project

  const updateTimingDraft = useCallback((timings: ProjectTimingDraft | null) => {
    setTimingDraft(timings ? { revision: history.revision, timings } : null)
  }, [history.revision])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!window.studio?.onVideoExportProgress) return
    return window.studio.onVideoExportProgress(setVideoExportProgress)
  }, [])

  useEffect(() => window.studio?.onLinkedAssetInvalidated?.((invalidation) => {
    if (invalidation.kind !== 'background') return
    videoStyle.background.markInvalid(invalidation.path, invalidation.message)
  }), [videoStyle.background.markInvalid])

  useEffect(() => {
    videoExportActiveRef.current = videoExportProgress !== null
  }, [videoExportProgress])

  useEffect(() => {
    if (!activeTrack && project.tracks[0]) setActiveTrackId(project.tracks[0].id)
  }, [activeTrack, project.tracks])

  const reviewProject = syncMode ? null : project
  const reviewIssues = useMemo<ValidationIssue[]>(() => {
    if (!reviewProject) return lastReviewIssuesRef.current
    const issues = validateProject(reviewProject)
    reviewProject.tracks.forEach((track, trackIndex) => {
      const untimed = flattenTrack(track).filter(({ word }) => word.startMs === null).length
      if (untimed) {
        issues.push({
          severity: 'warning',
          code: 'words-untimed',
          message: `${track.name} has ${untimed} untimed ${untimed === 1 ? 'word' : 'words'}.`,
          path: `tracks[${trackIndex}]`,
          trackId: track.id,
        })
      }
    })
    lastReviewIssuesRef.current = issues
    return issues
  }, [reviewProject])

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral') => setToast({ message, tone }), [])

  const confirmDiscardChanges = useCallback((message: string) => (
    !history.dirty || window.confirm(message)
  ), [history.dirty])

  const replaceTrack = useCallback((trackId: string, nextTrack: VocalTrack) => {
    commit((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      tracks: current.tracks.map((track) => (track.id === trackId ? nextTrack : track)),
    }))
  }, [commit])

  const updateProject = useCallback((patch: Partial<Pick<KaraokeProject, 'title' | 'artist' | 'offsetMs'>>) => {
    commit((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }, [commit])

  const updateLyricDisplay = useCallback((patch: Partial<LyricDisplaySettings>) => {
    commit((current) => ({
      ...current,
      lyricDisplay: { ...current.lyricDisplay, ...patch },
      updatedAt: new Date().toISOString(),
    }))
  }, [commit])

  const updateTrack = useCallback((trackId: string, patch: Partial<Pick<VocalTrack, 'name' | 'muted' | 'solo'>>) => {
    commit((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      tracks: current.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
    }))
  }, [commit])

  const updateSungColor = useCallback((trackId: string, color: string) => {
    if (videoStyle.updateSungColor(trackId, color)) return
    commit((current) => {
      const track = current.tracks.find((candidate) => candidate.id === trackId)
      if (
        !track ||
        track.vocalStyle.sungColor === color ||
        (track.vocalStyle.sungColor === null && current.stageStyle.lyrics.sungColor === color)
      ) return current
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        tracks: current.tracks.map((candidate) => candidate.id === trackId
          ? {
              ...candidate,
              vocalStyle: { ...cloneVocalStyle(candidate.vocalStyle), sungColor: color },
            }
          : candidate),
      }
    })
  }, [commit, videoStyle])

  const sungColorEditorTrack = sungColorEditorTrackId
    ? inspectorProject.tracks.find((track) => track.id === sungColorEditorTrackId) ?? null
    : null

  const resetEditorForProject = useCallback((next: KaraokeProject) => {
    setActiveTrackId(next.tracks[0]?.id ?? '')
    setSelectedWordIds(new Set())
    setSyncMode(false)
    syncHeldRef.current = null
    syncSessionHasCommitRef.current = false
  }, [])
  const projectLifecycle = useProjectLifecycle({
    project,
    revision: history.revision,
    dirty: history.dirty,
    markSaved: history.markSaved,
    resetProject: history.reset,
    resetVideoStyle: videoStyle.resetSession,
    pausePlayback: playback.pause,
    seekPlayback: playback.seek,
    setAudioUrl,
    setActiveAudioPath,
    beginBackgroundRestore: videoStyle.background.beginOperation,
    resolveBackgroundRestore: videoStyle.background.resolveOperation,
    resetBackground: videoStyle.background.reset,
    resetEditorState: resetEditorForProject,
    confirmDiscard: confirmDiscardChanges,
    openBrowserProject: () => projectInputRef.current?.click(),
    showSaveFailure: () => setValidationDialogOpen(true),
    showToast,
  })
  const handleNew = projectLifecycle.newProject
  const handleOpen = projectLifecycle.openProject
  const openProjectContents = projectLifecycle.openProjectContents
  const handleSave = projectLifecycle.saveProject
  const projectClose = projectLifecycle.close
  const styleLifecycle = useVideoStyleLifecycle({
    controller: videoStyle,
    newProject: handleNew,
    openProject: handleOpen,
    saveProject: handleSave,
    openExport: () => setExportDialogOpen(true),
    requestProjectClose: projectClose.requestClose,
    acknowledgeCloseCancellation: () => projectLifecycle.resolveWindowClose(false),
    showWarning: (message) => showToast(message, 'warning'),
  })

  const applyAudio = useCallback((path: string, url: string, name?: string) => {
    projectLifecycle.invalidateAudioRestore()
    playback.pause()
    playback.seek(0)
    setAudioUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return url
    })
    setActiveAudioPath(path)
    replaceHistoryBoundary((current) => ({
      ...current,
      audioPath: path,
      updatedAt: new Date().toISOString(),
    }))
    showToast(`${name ?? path.split('/').pop() ?? 'Audio'} linked`, 'success')
  }, [
    playback.pause,
    playback.seek,
    projectLifecycle.invalidateAudioRestore,
    replaceHistoryBoundary,
    showToast,
  ])

  const handleImportAudio = useCallback(async () => {
    if (window.studio) {
      const result = await window.studio.importAudio()
      if (result) applyAudio(result.path, result.url, result.name)
    } else {
      audioInputRef.current?.click()
    }
  }, [applyAudio])

  const handleChooseBackground = useCallback(async () => {
    if (window.studio?.chooseBackgroundImage) {
      try {
        const result = await window.studio.chooseBackgroundImage()
        if (result) videoStyle.applyBackgroundImage(result.path, result.url)
      } catch (error) {
        setBackgroundError(error instanceof Error ? error.message : 'The selected image could not be linked.')
      }
    } else {
      backgroundInputRef.current?.click()
    }
  }, [setBackgroundError, videoStyle])

  const applyLrc = useCallback((contents: string) => {
    if (!activeTrack) return
    try {
      const imported = importLrc(contents, activeTrack.id, project.offsetMs)
      replaceTrack(activeTrack.id, { ...imported, name: activeTrack.name, vocalStyle: cloneVocalStyle(activeTrack.vocalStyle) })
      setSelectedWordIds(new Set())
      syncHeldRef.current = null
      syncSessionHasCommitRef.current = false
      setSyncMode(false)
      showToast(`Imported LRC into ${activeTrack.name}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import that LRC file.', 'warning')
    }
  }, [activeTrack, project.offsetMs, replaceTrack, showToast])

  const handleImportLrc = useCallback(async () => {
    if (window.studio) {
      const result = await window.studio.importLrc()
      if (result) applyLrc(result.contents)
    } else {
      lrcInputRef.current?.click()
    }
  }, [applyLrc])

  const exportText = useCallback(async (format: StudioExportFormat) => {
    if (!activeTrack) return
    try {
      const base = slugify(`${project.artist}-${project.title}`)
      const contents = format === 'lrc'
        ? exportLrc(project, activeTrack.id)
        : format === 'ass'
          ? exportAss(project)
          : serializeProject(project)
      const suggestedName = `${base}.${format}`
      if (window.studio) {
        const result = await window.studio.exportText({ suggestedName, contents, format })
        if (!result) return
      } else {
        downloadText(suggestedName, contents, format === 'oks' ? 'application/json' : 'text/plain')
      }
      setExportDialogOpen(false)
      showToast(`${format.toUpperCase()} export created`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Export failed.', 'warning')
    }
  }, [activeTrack, project, showToast])

  const exportVideo = useCallback(async ({
    resolution,
    fps,
  }: Pick<StudioVideoExportOptions, 'resolution' | 'fps'>) => {
    if (!window.studio?.exportVideo) {
      showToast('Video export is available in the desktop app.', 'warning')
      return
    }
    if (!activeAudioPath || !playback.hasAudio) {
      showToast('Attach a readable audio track before exporting video.', 'warning')
      return
    }
    if (!canonicalBackgroundReadiness.ready) {
      showToast(canonicalBackgroundReadiness.reason ?? 'Resolve the linked background image.', 'warning')
      return
    }

    try {
      playback.pause()
      videoExportActiveRef.current = true
      setVideoExportProgress({ phase: 'preparing', completed: 0, total: 1 })
      const result = await window.studio.exportVideo({
        suggestedName: `${slugify(`${project.artist}-${project.title}`)}.mp4`,
        projectJson: serializeProject(project),
        audioPath: activeAudioPath,
        durationMs: Math.max(1_000, Math.round(playback.durationMs)),
        resolution,
        fps,
      })
      if (!result) return
      setExportDialogOpen(false)
      if (result.fontFallbacks.length > 0) {
        const fallback = result.fontFallbacks[0]
        showToast(
          `Video exported; requested ${fallback.requested}, rendered with ${fallback.effective}.`,
          'warning',
        )
      } else {
        showToast(`Video export created with ${result.frameCount} lyric frames`, 'success')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Video export failed.'
      const canceled = /cancel(?:led|ed|ing)/iu.test(detail)
      showToast(
        canceled ? 'Video export cancelled; any partial MP4 was kept beside the destination' : detail,
        canceled ? 'neutral' : 'warning',
      )
    } finally {
      videoExportActiveRef.current = false
      setVideoExportProgress(null)
    }
  }, [
    canonicalBackgroundReadiness.ready,
    canonicalBackgroundReadiness.reason,
    activeAudioPath,
    playback.durationMs,
    playback.hasAudio,
    playback.pause,
    project,
    showToast,
  ])

  const cancelVideoExport = useCallback(async () => {
    if (!window.studio?.cancelVideoExport) return false
    return window.studio.cancelVideoExport()
  }, [])

  const handleSelectWord = useCallback((word: LyricWord, add: boolean) => {
    setSelectedWordIds((current) => {
      const next = add ? new Set(current) : new Set<string>()
      if (add && next.has(word.id)) next.delete(word.id)
      else next.add(word.id)
      return next
    })
    if (word.startMs !== null) playback.seek(Math.max(0, word.startMs + project.offsetMs))
    const index = syncWords.findIndex((candidate) => candidate.id === word.id)
    if (index >= 0 && syncMode) setSyncCursor(index)
  }, [playback.seek, project.offsetMs, syncMode, syncWords])

  const cancelHeldSync = useCallback(() => {
    syncHeldRef.current = null
  }, [])

  const rollbackHeldSync = useCallback(() => {
    const held = syncHeldRef.current
    if (!held) return project
    if (held.createdSessionHistory) history.rollbackLatest()
    else replaceCurrent(() => held.projectBefore)
    syncHeldRef.current = null
    return held.projectBefore
  }, [history.rollbackLatest, project, replaceCurrent])

  const openVideoStyle = useCallback(() => {
    if (timelineGestureActive || styleDraft) return
    const styleProject = rollbackHeldSync()
    setSyncMode(false)
    syncSessionHasCommitRef.current = false
    videoStyle.open(styleProject)
  }, [
    rollbackHeldSync,
    styleDraft,
    timelineGestureActive,
    videoStyle,
  ])

  const requestStyleCommand = videoStyle.requestCommand
  const cancelVideoStyle = videoStyle.cancel
  const applyVideoStyle = videoStyle.apply
  const handleClearBackground = videoStyle.clearBackgroundImage

  const applySyncMutation = useCallback((
    updater: (current: KaraokeProject) => KaraokeProject,
  ) => {
    if (syncSessionHasCommitRef.current) {
      replaceCurrent(updater)
      return
    }
    commitHistory((current) => {
      const next = updater(current)
      if (next === current) return current
      syncSessionHasCommitRef.current = true
      return next
    })
  }, [commitHistory, replaceCurrent])

  const handleUndo = useCallback(() => {
    if (styleDraft) return
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    const next = history.peekUndoProject()
    history.undo()
    if (next) {
      void videoStyle.background.synchronizeProject(
        next.stageStyle.background.mode,
        next.stageStyle.background.imagePath,
      )
    }
  }, [cancelHeldSync, history, styleDraft, videoStyle.background])

  const handleRedo = useCallback(() => {
    if (styleDraft) return
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    const next = history.peekRedoProject()
    history.redo()
    if (next) {
      void videoStyle.background.synchronizeProject(
        next.stageStyle.background.mode,
        next.stageStyle.background.imagePath,
      )
    }
  }, [cancelHeldSync, history, styleDraft, videoStyle.background])

  const selectAllActiveTrackWords = useCallback(() => {
    setSelectedWordIds(new Set(activeTrack ? flattenTrack(activeTrack).map(({ word }) => word.id) : []))
  }, [activeTrack])

  const handleSelectWordId = useCallback((wordId: string, add: boolean) => {
    const item = flattenProject(project).find(({ word }) => word.id === wordId)
    if (item) {
      const changingTrack = item.track.id !== activeTrackId
      if (changingTrack) {
        cancelHeldSync()
        syncSessionHasCommitRef.current = false
        setSyncMode(false)
        setActiveTrackId(item.track.id)
      }
      handleSelectWord(item.word, changingTrack ? false : add)
    }
  }, [activeTrackId, cancelHeldSync, handleSelectWord, project])

  const clearActiveTrackTimingFrom = useCallback((fromMs: number, successMessage: string, emptyMessage: string) => {
    if (!activeTrack) return
    const nextTrack = clearTrackTimingFrom(activeTrack, fromMs)
    if (nextTrack === activeTrack) {
      showToast(emptyMessage, 'neutral')
      return
    }
    playback.pause()
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    setSelectedWordIds(new Set())
    replaceTrack(activeTrack.id, nextTrack)
    showToast(successMessage, 'success')
  }, [activeTrack, cancelHeldSync, playback.pause, replaceTrack, showToast])

  const handleClearTiming = useCallback(() => {
    clearActiveTrackTimingFrom(0, 'Cleared active-track timing', 'The active track has no timing to clear')
  }, [clearActiveTrackTimingFrom])

  const handleClearTimingAfterCursor = useCallback(() => {
    clearActiveTrackTimingFrom(
      lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs),
      'Cleared active-track timing from the playhead',
      'No active-track timing starts at or after the playhead',
    )
  }, [clearActiveTrackTimingFrom, playback.getCurrentMs, project.offsetMs])

  const handleStop = useCallback(() => {
    cancelHeldSync()
    setSyncMode(false)
    syncSessionHasCommitRef.current = false
    playback.pause()
    playback.seek(0)
  }, [cancelHeldSync, playback.pause, playback.seek])

  const toggleSyncMode = useCallback(() => {
    if (styleDraft) {
      showToast('Close Video style to start lyric sync', 'neutral')
      return
    }
    if (syncMode) {
      cancelHeldSync()
      setSyncMode(false)
      syncSessionHasCommitRef.current = false
      return
    }
    if (!syncWords.length) {
      showToast('Add lyrics before starting sync', 'warning')
      return
    }
    const lyricTimeMs = lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs)
    const fromPlayhead = syncWordIndexFromLyricTime(syncWords, lyricTimeMs)
    if (fromPlayhead < 0) {
      showToast('No words remain at or after the playhead', 'neutral')
      return
    }
    syncSessionHasCommitRef.current = false
    setSyncCursor(fromPlayhead)
    setSyncMode(true)
    playback.play()
    showToast('Tap sync armed — press each word onset; hold the final word of a line', 'neutral')
  }, [cancelHeldSync, playback.getCurrentMs, playback.play, project.offsetMs, showToast, styleDraft, syncMode, syncWords])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (document.querySelector('[role="dialog"]')) return
      if (event.code === 'Escape' && styleDraft) {
        event.preventDefault()
        cancelVideoStyle()
        return
      }
      if (inputHasTypingFocus()) return
      if (event.code === 'Escape' && syncMode) {
        event.preventDefault()
        setSyncMode(false)
        cancelHeldSync()
        syncSessionHasCommitRef.current = false
        return
      }
      if (
        event.code === 'KeyA' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (styleDraft) return
        event.preventDefault()
        selectAllActiveTrackWords()
        return
      }
      if ((event.code === 'Backspace' || event.code === 'Delete') && selectedWordIds.size) {
        if (styleDraft) return
        event.preventDefault()
        const patches = new Map([...selectedWordIds].map((id) => [
          id,
          { startMs: null, endMs: null },
        ]))
        commit((current) => patchWords(current, patches))
        return
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        playback.seek(playback.getCurrentMs() - (event.shiftKey ? 1000 : 250))
        return
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        playback.seek(playback.getCurrentMs() + (event.shiftKey ? 1000 : 250))
        return
      }
      if (event.code !== 'Space') return
      const exactShiftSpace = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      const exactBareSpace = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      if (!exactShiftSpace && !exactBareSpace) return
      if (exactBareSpace && !syncMode && eventTargetsSpaceActivatableControl(event)) return
      event.preventDefault()
      if (exactShiftSpace) {
        if (!event.repeat) playback.toggle()
        return
      }
      if (!syncMode) return
      if (event.repeat || syncHeldRef.current) return
      const item = syncItems[syncCursor]
      if (!item) {
        setSyncMode(false)
        syncSessionHasCommitRef.current = false
        showToast('All words are timed', 'success')
        return
      }

      const sampledLyricMs = lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs)
      if (sampledLyricMs < 0) {
        showToast('The lyric clock has not reached 0:00 yet', 'neutral')
        return
      }
      const previous = syncItems[syncCursor - 1]
      const sameLine = previous?.line.id === item.line.id
      const previousTimed = adjacentTimedWord(syncWords, syncCursor, -1)
      const nextTimed = adjacentTimedWord(syncWords, syncCursor, 1)
      const previousEndMs = previousTimed ? syncWordEnd(previousTimed) : null
      const nextTimedStartMs = nextTimed?.startMs ?? null
      const startMs = Math.max(Math.round(sampledLyricMs), previousEndMs ?? 0)

      if (nextTimedStartMs !== null && startMs >= nextTimedStartMs) {
        showToast('No timing space remains before the next timed word', 'warning')
        return
      }

      const patches = new Map<
        string,
        Partial<Pick<LyricWord, 'startMs' | 'endMs'>>
      >()
      const projectBefore = project
      const createdSessionHistory = !syncSessionHasCommitRef.current
      if (previous && sameLine && previous.word.startMs !== null) {
        patches.set(previous.word.id, { endMs: startMs })
      }
      patches.set(item.word.id, {
        startMs,
        endMs: Math.min(
          startMs + DEFAULT_SYNC_WORD_DURATION_MS,
          nextTimedStartMs ?? Number.POSITIVE_INFINITY,
        ),
      })
      applySyncMutation((current) => patchWords(current, patches))
      syncHeldRef.current = {
        wordId: item.word.id,
        startMs,
        isLineFinal: item.wordIndex === item.line.words.length - 1,
        nextTimedStartMs,
        projectBefore,
        createdSessionHistory,
      }
      playback.play()
    }

    const keyUp = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) {
        if (event.code === 'Space') {
          cancelHeldSync()
        }
        return
      }
      if (event.code !== 'Space' || !syncMode) return
      const held = syncHeldRef.current
      if (!held) return
      event.preventDefault()
      if (held.isLineFinal) {
        const sampledLyricMs = lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs)
        const endMs = Math.min(
          Math.max(held.startMs + DEFAULT_SYNC_WORD_DURATION_MS, Math.round(sampledLyricMs)),
          held.nextTimedStartMs ?? Number.POSITIVE_INFINITY,
        )
        applySyncMutation((current) => patchWord(current, held.wordId, {
          startMs: held.startMs,
          endMs,
        }))
      }
      cancelHeldSync()
      setSyncCursor((index) => {
        const next = index + 1
        if (next >= syncItems.length) {
          setSyncMode(false)
          syncSessionHasCommitRef.current = false
          showToast('Track timing complete', 'success')
        }
        return next
      })
    }

    const windowBlur = () => cancelHeldSync()

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', windowBlur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', windowBlur)
    }
  }, [applySyncMutation, cancelHeldSync, cancelVideoStyle, commit, playback.getCurrentMs, playback.play, playback.seek, playback.toggle, project, project.offsetMs, selectAllActiveTrackWords, selectedWordIds, showToast, styleDraft, syncCursor, syncItems, syncMode, syncWords])

  useEffect(() => {
    if (!window.studio) return
    return window.studio.onMenuAction((action) => {
      if (
        videoExportActiveRef.current &&
        ['new', 'open', 'import-audio', 'import-lrc'].includes(action)
      ) {
        showToast('Cancel the video export before changing projects or media.', 'warning')
        return
      }
      if (action === 'new') requestStyleCommand('new')
      else if (action === 'open') requestStyleCommand('open')
      else if (action === 'save') requestStyleCommand('save')
      else if (action === 'save-as') requestStyleCommand('save-as')
      else if (action === 'import-audio') void handleImportAudio()
      else if (action === 'import-lrc') void handleImportLrc()
      else if (action === 'export') requestStyleCommand('export')
      else if (action === 'play-toggle') playback.toggle()
      else if (action === 'select-all') {
        const editorHandledSelection = selectAllInFocusedEditor()
        if (
          !styleDraft &&
          !editorHandledSelection &&
          !document.querySelector('[role="dialog"]')
        ) {
          selectAllActiveTrackWords()
        }
      }
      else if (action === 'undo') handleUndo()
      else if (action === 'redo') handleRedo()
    })
  }, [
    handleImportAudio,
    handleImportLrc,
    handleRedo,
    handleUndo,
    playback.toggle,
    requestStyleCommand,
    selectAllActiveTrackWords,
    showToast,
    styleDraft,
  ])

  const handleSelectTrack = useCallback((trackId: string) => {
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    setActiveTrackId(trackId)
    setSelectedWordIds(new Set())
  }, [cancelHeldSync])

  const workflowGuideActions = createWorkflowGuideActions({
    canStartSync: syncWords.length > 0,
    close: () => setWorkflowGuideOpen(false),
    startNew: () => requestStyleCommand('new'),
    open: () => requestStyleCommand('open'),
    attachAudio: () => void handleImportAudio(),
    editLyrics: () => setLyricsDialogOpen(true),
    importLrc: () => void handleImportLrc(),
    startSync: toggleSyncMode,
    save: () => requestStyleCommand('save'),
    exportProject: () => requestStyleCommand('export'),
  })

  const syncWordId = syncMode ? syncWords[syncCursor]?.id ?? null : null

  return (
    <div className="app-shell">
      <TopBar
        title={project.title}
        dirty={history.dirty}
        canUndo={!styleDraft && history.canUndo}
        canRedo={!styleDraft && history.canRedo}
        issueCount={reviewIssues.length}
        hasLyrics={projectHasLyrics}
        onNew={() => requestStyleCommand('new')}
        onOpen={() => requestStyleCommand('open')}
        onSave={() => requestStyleCommand('save')}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onShowWorkflow={() => setWorkflowGuideOpen(true)}
        onValidate={() => setValidationDialogOpen(true)}
        onExport={() => requestStyleCommand('export')}
      />

      <main className="studio-main">
        <InspectorPanel
          project={inspectorProject}
          activeTrackId={activeTrackId}
          onSelectTrack={handleSelectTrack}
          onUpdateProject={updateProject}
          styleOpen={Boolean(styleDraft)}
          styleDisabled={timelineGestureActive}
          onOpenStyle={openVideoStyle}
          onUpdateTrack={updateTrack}
          onEditSungColor={setSungColorEditorTrackId}
          onImportAudio={handleImportAudio}
          onImportLrc={handleImportLrc}
        />

        <div className={`unified-workspace ${syncMode ? 'is-syncing' : ''} ${styleDraft ? 'is-style-editing' : ''}`}>
          <div className="workspace-top">
            {syncMode && activeTrack ? (
              <SyncCueStrip
                track={activeTrack}
                syncCursor={syncCursor}
                onEditLyrics={() => setLyricsDialogOpen(true)}
              />
            ) : (
              <KaraokePreview
                project={styledPreviewProject}
                playbackMs={playback.currentMs}
                lyricMs={lyricTimeMs}
                selectedWordIds={selectedWordIds}
                backgroundUrl={backgroundUrl}
                backgroundError={backgroundError}
                onUpdateLyricDisplay={updateLyricDisplay}
                onEditLyrics={() => setLyricsDialogOpen(true)}
              />
            )}
          </div>

          <div className="timeline-slot" aria-hidden={styleDraft ? true : undefined} inert={styleDraft ? true : undefined}>
          <Timeline
            project={project}
            peaks={waveform.peaks}
            isAnalyzing={waveform.isAnalyzing}
            durationMs={playback.durationMs}
            currentMs={playback.currentMs}
            zoom={zoom}
            activeTrackId={activeTrackId}
            selectedWordIds={selectedWordIds}
            syncWordId={syncWordId}
            syncMode={syncMode}
            onSeek={playback.seek}
            onZoom={setZoom}
            onSelectWord={handleSelectWordId}
            onSelectWords={setSelectedWordIds}
            onShiftWords={(ids, deltaMs) => commit((current) => shiftWords(current, ids, deltaMs))}
            onResizeWord={(wordId, startMs, endMs) => commit((current) => patchWord(current, wordId, { startMs, endMs }))}
            onTimingDraftChange={updateTimingDraft}
            onToggleSync={toggleSyncMode}
            onClearTiming={handleClearTiming}
            onClearTimingAfterCursor={handleClearTimingAfterCursor}
            onGestureActiveChange={setTimelineGestureActive}
          />
          </div>

          {styleDraft && (
            <div className="style-workspace">
              <VideoStyleWorkspace
                project={project}
                activeTrack={activeTrack}
                draft={styleDraft}
                backgroundUrl={backgroundUrl}
                backgroundError={backgroundError}
                settlementError={videoStyle.lifecycleError}
                settling={videoStyle.settling}
                onDraftChange={setStyleDraft}
                onChooseBackground={() => void handleChooseBackground()}
                onClearBackground={handleClearBackground}
                onSelectBackgroundMode={videoStyle.setBackgroundMode}
                onCancel={cancelVideoStyle}
                onApply={() => { void applyVideoStyle() }}
              />
              <KaraokePreview
                project={styledPreviewProject}
                playbackMs={playback.currentMs}
                lyricMs={lyricTimeMs}
                selectedWordIds={selectedWordIds}
                backgroundUrl={backgroundUrl}
                backgroundError={backgroundError}
                compactHeader
              />
            </div>
          )}
        </div>
      </main>

      <TransportBar
        currentMs={playback.currentMs}
        durationMs={playback.durationMs}
        isPlaying={playback.isPlaying}
        rate={playback.rate}
        volume={playback.volume}
        syncMode={syncMode}
        syncPosition={syncCursor}
        syncTotal={syncWords.length}
        hasAudio={playback.hasAudio}
        syncDisabled={Boolean(styleDraft)}
        onToggle={playback.toggle}
        onStop={handleStop}
        onSeek={playback.seek}
        onRate={playback.setRate}
        onVolume={playback.setVolume}
        onToggleSync={toggleSyncMode}
      />

      <input
        ref={projectInputRef}
        hidden
        type="file"
        accept=".oks,.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then((contents) => openProjectContents(contents, null))
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={audioInputRef}
        hidden
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.flac,.aac,.ogg"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) applyAudio(file.name, URL.createObjectURL(file), file.name)
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={lrcInputRef}
        hidden
        type="file"
        accept=".lrc,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then(applyLrc)
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={backgroundInputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            videoStyle.applyBackgroundImage(file.name, URL.createObjectURL(file))
            setBackgroundError('Open the desktop app to link this image with a persistent absolute path.')
          }
          event.currentTarget.value = ''
        }}
      />

      {lyricsDialogOpen && activeTrack && (
        <LyricsEditorDialog
          track={activeTrack}
          onClose={() => setLyricsDialogOpen(false)}
          onSave={(text) => {
            replaceTrack(activeTrack.id, parseLyrics(text, activeTrack.id, activeTrack))
            cancelHeldSync()
            syncSessionHasCommitRef.current = false
            setSyncMode(false)
            setSelectedWordIds(new Set())
            setLyricsDialogOpen(false)
            showToast('Lyrics updated', 'success')
          }}
        />
      )}
      {workflowGuideOpen && activeTrack && (
        <WorkflowGuideDialog {...workflowGuideActions} />
      )}
      {exportDialogOpen && activeTrack && (
        <ExportDialog
          projectTitle={project.title}
          activeTrackName={activeTrack.name}
          issueCount={reviewIssues.length}
          hasLyrics={projectHasLyrics}
          activeTrackHasLyrics={syncWords.length > 0}
          onClose={() => setExportDialogOpen(false)}
          onExportLrc={() => void exportText('lrc')}
          onExportAss={() => void exportText('ass')}
          onExportVideo={(settings) => void exportVideo(settings)}
          onCancelVideo={cancelVideoExport}
          onExportProject={() => void exportText(EDITABLE_PROJECT_EXPORT_FORMAT)}
          videoAvailable={videoUnavailableReason === null}
          videoUnavailableReason={videoUnavailableReason}
          videoProgress={videoExportProgress}
        />
      )}
      {styleLifecycle.command && (
        <StyleLifecycleDialog
          command={styleLifecycle.command}
          applyDisabled={!videoStyle.draftValid}
          busy={styleLifecycle.busy}
          error={styleLifecycle.error}
          onApply={styleLifecycle.apply}
          onDiscard={styleLifecycle.discard}
          onKeep={styleLifecycle.keepEditing}
        />
      )}
      {projectClose.pending && (
        <ProjectCloseDialog
          busy={projectClose.busy}
          saving={projectClose.saving}
          onSave={() => void projectClose.saveAndClose()}
          onDiscard={() => void projectClose.discardAndClose()}
          onKeep={() => void projectClose.keepEditing()}
        />
      )}
      {sungColorEditorTrack && (
        <SungColorDialog
          key={sungColorEditorTrack.id}
          trackName={sungColorEditorTrack.name}
          initialColor={resolveVocalStyle(
            inspectorProject.stageStyle.lyrics,
            sungColorEditorTrack.vocalStyle,
          ).sungColor}
          onApply={(color) => {
            updateSungColor(sungColorEditorTrack.id, color)
            setSungColorEditorTrackId(null)
          }}
          onCancel={() => setSungColorEditorTrackId(null)}
        />
      )}
      {videoStyle.cancelPending && (
        <StyleDiscardDialog
          busy={videoStyle.settling}
          error={videoStyle.lifecycleError}
          onDiscard={() => {
            void videoStyle.discardChanges().then((discarded) => {
              if (!discarded) {
                showToast('The original linked background could not be restored. Try again.', 'warning')
              }
            })
          }}
          onKeep={videoStyle.keepCancelEditing}
        />
      )}
      {validationDialogOpen && <ValidationDialog issues={reviewIssues} onClose={() => setValidationDialogOpen(false)} />}
      {toast && <div className={`toast toast--${toast.tone}`} role="status"><span />{toast.message}</div>}
    </div>
  )
}
