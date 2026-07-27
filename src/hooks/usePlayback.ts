import { useCallback, useEffect, useRef, useState } from 'react'

interface PlaybackOptions {
  durationMs: number
  leadInMs?: number
  audioUrl?: string | null
  onDuration?: (durationMs: number) => void
  refreshIntervalMs?: number
}

export function usePlayback({
  durationMs,
  leadInMs = 0,
  audioUrl,
  onDuration,
  refreshIntervalMs = 16,
}: PlaybackOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const currentMsRef = useRef(0)
  const lastPublishedMsRef = useRef(0)
  const audioStartedRef = useRef(false)
  const playAttemptRef = useRef(0)
  const startAudioRef = useRef<() => void>(() => undefined)
  const [currentMs, setCurrentMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRateState] = useState(1)
  const [volume, setVolumeState] = useState(0.86)
  const [audioDurationMs, setAudioDurationMs] = useState<number | null>(null)
  const playableDurationMs = audioDurationMs === null ? durationMs : audioDurationMs + leadInMs

  useEffect(() => {
    // A media source owns its own clock. Reset the rendered and synchronous
    // clocks together before exposing a replacement Audio element so a sync
    // action cannot briefly sample 0 from the new element while the UI still
    // points at the previous source's playhead.
    currentMsRef.current = 0
    lastPublishedMsRef.current = 0
    lastFrameRef.current = null
    audioStartedRef.current = false
    playAttemptRef.current += 1
    setCurrentMs(0)
    setIsPlaying(false)

    if (!audioUrl) {
      audioRef.current?.pause()
      audioRef.current = null
      setAudioDurationMs(null)
      return
    }

    const audio = new Audio(audioUrl)
    audio.preload = 'metadata'
    audio.playbackRate = rate
    audio.volume = volume
    const handleLoadedMetadata = () => {
      if (!Number.isFinite(audio.duration)) return
      const nextDurationMs = Math.round(audio.duration * 1000)
      setAudioDurationMs(nextDurationMs)
      onDuration?.(nextDurationMs)
    }
    const handleEnded = () => {
      audioStartedRef.current = false
      playAttemptRef.current += 1
      setIsPlaying(false)
    }
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audioRef.current = audio

    return () => {
      playAttemptRef.current += 1
      audio.pause()
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeAttribute('src')
      audio.load()
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [audioUrl, onDuration])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = rate
  }, [rate])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume
  }, [volume])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, currentMsRef.current - leadInMs) / 1000
    playAttemptRef.current += 1
    audioStartedRef.current = false
    if (currentMsRef.current < leadInMs || !isPlaying) {
      audio.pause()
    }
  }, [isPlaying, leadInMs])

  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = null
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      audioRef.current?.pause()
      audioStartedRef.current = false
      playAttemptRef.current += 1
      startAudioRef.current = () => undefined
      return
    }

    const audio = audioRef.current
    const startAudio = () => {
      const activeAudio = audioRef.current
      if (!activeAudio || audioStartedRef.current) return
      activeAudio.currentTime = Math.max(0, (currentMsRef.current - leadInMs) / 1000)
      audioStartedRef.current = true
      const attempt = playAttemptRef.current + 1
      playAttemptRef.current = attempt
      void activeAudio.play().catch(() => {
        if (audioRef.current === activeAudio && playAttemptRef.current === attempt) {
          audioStartedRef.current = false
          setIsPlaying(false)
        }
      })
    }
    startAudioRef.current = startAudio
    if (audio && currentMsRef.current >= leadInMs) {
      audio.currentTime = Math.max(0, (currentMsRef.current - leadInMs) / 1000)
      startAudio()
    } else if (audio) {
      audio.pause()
      audioStartedRef.current = false
    }

    const tick = (timestamp: number) => {
      const activeAudio = audioRef.current
      let nextMs: number
      if (
        activeAudio &&
        currentMsRef.current >= leadInMs &&
        Number.isFinite(activeAudio.currentTime)
      ) {
        // Once the synthetic opening reaches its boundary, source-audio progress
        // is authoritative. Holding at the boundary avoids stale success while a
        // media element is still starting.
        nextMs = Math.max(leadInMs, Math.round(activeAudio.currentTime * 1000) + leadInMs)
      } else {
        const previous = lastFrameRef.current ?? timestamp
        const elapsed = (timestamp - previous) * rate
        nextMs = Math.min(activeAudio ? leadInMs : durationMs, currentMsRef.current + elapsed)
        if (nextMs >= durationMs) setIsPlaying(false)
        lastFrameRef.current = timestamp
      }
      if (activeAudio && nextMs >= leadInMs && currentMsRef.current < leadInMs) {
        currentMsRef.current = leadInMs
        startAudio()
        nextMs = leadInMs
      }
      currentMsRef.current = nextMs
      if (
        Math.abs(nextMs - lastPublishedMsRef.current) >= refreshIntervalMs ||
        nextMs === 0 ||
        nextMs >= durationMs
      ) {
        lastPublishedMsRef.current = nextMs
        setCurrentMs(nextMs)
      }
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      startAudioRef.current = () => undefined
    }
  }, [isPlaying, leadInMs, rate, durationMs, refreshIntervalMs])

  const seek = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(playableDurationMs, value))
      currentMsRef.current = next
      lastPublishedMsRef.current = next
      setCurrentMs(next)
      const audio = audioRef.current
      if (audio) {
        audio.currentTime = Math.max(0, next - leadInMs) / 1000
        playAttemptRef.current += 1
        audioStartedRef.current = false
        if (next < leadInMs) {
          audio.pause()
        } else if (isPlaying) {
          startAudioRef.current()
        }
      }
    },
    [isPlaying, leadInMs, playableDurationMs],
  )

  const getCurrentMs = useCallback(() => {
    const audio = audioRef.current
    const liveMs =
      currentMsRef.current >= leadInMs && audio && Number.isFinite(audio.currentTime)
        ? Math.round(audio.currentTime * 1000) + leadInMs
        : currentMsRef.current
    return Math.max(0, Math.min(playableDurationMs, liveMs))
  }, [leadInMs, playableDurationMs])

  const play = useCallback(() => setIsPlaying(true), [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const toggle = useCallback(() => setIsPlaying((value) => !value), [])
  const setRate = useCallback(
    (value: number) => setRateState(Math.max(0.5, Math.min(1.5, value))),
    [],
  )
  const setVolume = useCallback(
    (value: number) => setVolumeState(Math.max(0, Math.min(1, value))),
    [],
  )

  return {
    currentMs,
    isPlaying,
    rate,
    volume,
    durationMs: playableDurationMs,
    hasAudio: Boolean(audioUrl),
    play,
    pause,
    toggle,
    seek,
    getCurrentMs,
    setRate,
    setVolume,
  }
}
