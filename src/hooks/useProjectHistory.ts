import { useCallback, useRef, useState } from 'react'
import type { KaraokeProject } from '../lib/karaoke'

interface HistoryEntry {
  project: KaraokeProject
  revision: number
}

export function useProjectHistory(initialProject: KaraokeProject | (() => KaraokeProject)) {
  const sequenceRef = useRef(0)
  const pastRef = useRef<HistoryEntry[]>([])
  const futureRef = useRef<HistoryEntry[]>([])
  const [entry, setEntry] = useState<HistoryEntry>(() => ({
    project: typeof initialProject === 'function' ? initialProject() : initialProject,
    revision: 0,
  }))
  const [savedRevision, setSavedRevision] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)

  const commit = useCallback((
    updater: KaraokeProject | ((project: KaraokeProject) => KaraokeProject),
  ) => {
    setEntry((current) => {
      const nextProject = typeof updater === 'function' ? updater(current.project) : updater
      if (nextProject === current.project) return current
      pastRef.current.push(current)
      if (pastRef.current.length > 120) pastRef.current.shift()
      futureRef.current = []
      sequenceRef.current += 1
      setHistoryVersion((value) => value + 1)
      return { project: nextProject, revision: sequenceRef.current }
    })
  }, [])

  const replaceCurrent = useCallback((updater: (project: KaraokeProject) => KaraokeProject) => {
    setEntry((current) => {
      const nextProject = updater(current.project)
      if (nextProject === current.project) return current
      sequenceRef.current += 1
      return { project: nextProject, revision: sequenceRef.current }
    })
  }, [])

  const replaceHistoryBoundary = useCallback((
    updater: KaraokeProject | ((project: KaraokeProject) => KaraokeProject),
  ) => {
    setEntry((current) => {
      const nextProject = typeof updater === 'function' ? updater(current.project) : updater
      if (nextProject === current.project) return current
      sequenceRef.current += 1
      pastRef.current = []
      futureRef.current = []
      setHistoryVersion((value) => value + 1)
      return { project: nextProject, revision: sequenceRef.current }
    })
  }, [])

  const reset = useCallback((project: KaraokeProject, markClean = true) => {
    sequenceRef.current += 1
    const next = { project, revision: sequenceRef.current }
    pastRef.current = []
    futureRef.current = []
    setEntry(next)
    if (markClean) setSavedRevision(next.revision)
    setHistoryVersion((value) => value + 1)
  }, [])

  const undo = useCallback(() => {
    setEntry((current) => {
      const previous = pastRef.current.pop()
      if (!previous) return current
      futureRef.current.push(current)
      setHistoryVersion((value) => value + 1)
      return previous
    })
  }, [])

  const redo = useCallback(() => {
    setEntry((current) => {
      const next = futureRef.current.pop()
      if (!next) return current
      pastRef.current.push(current)
      setHistoryVersion((value) => value + 1)
      return next
    })
  }, [])

  const rollbackLatest = useCallback(() => {
    setEntry((current) => {
      const previous = pastRef.current.pop()
      if (!previous) return current
      futureRef.current = []
      setHistoryVersion((value) => value + 1)
      return previous
    })
  }, [])

  const markSaved = useCallback((revision: number) => setSavedRevision(revision), [])
  const markProjectSaved = useCallback((project: KaraokeProject) => {
    setEntry((current) => {
      if (current.project === project) setSavedRevision(current.revision)
      return current
    })
  }, [])

  return {
    project: entry.project,
    revision: entry.revision,
    dirty: entry.revision !== savedRevision,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    historyVersion,
    commit,
    peekRedoProject: () => futureRef.current.at(-1)?.project ?? null,
    peekUndoProject: () => pastRef.current.at(-1)?.project ?? null,
    replaceCurrent,
    replaceHistoryBoundary,
    reset,
    undo,
    redo,
    rollbackLatest,
    markSaved,
    markProjectSaved,
  }
}
