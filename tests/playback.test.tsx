/**
 * @vitest-environment happy-dom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayback } from '../src/hooks/usePlayback'

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []

  currentTime = 0
  duration = 30
  playbackRate = 1
  volume = 1
  preload = ''
  play = vi.fn(async () => undefined)
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()

  constructor(_url: string) {
    super()
    FakeAudio.instances.push(this)
  }
}

describe('authoritative playback clock', () => {
  let container: HTMLDivElement
  let root: Root
  let playback: ReturnType<typeof usePlayback>

  function Harness({ audioUrl = 'blob:synthetic-audio' }: { audioUrl?: string }) {
    playback = usePlayback({
      durationMs: 30_000,
      audioUrl,
      refreshIntervalMs: 50,
    })
    return <output data-testid="painted-clock">{playback.currentMs}</output>
  }

  beforeEach(async () => {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('samples audio.currentTime directly before the next React paint', async () => {
    await act(async () => playback.seek(500))
    await act(async () => playback.play())
    const audio = FakeAudio.instances[0]
    audio.currentTime = 1.234

    expect(container.querySelector('[data-testid="painted-clock"]')?.textContent).toBe('500')
    expect(playback.getCurrentMs()).toBe(1_234)
  })

  it('resets every playback clock when the audio source is replaced before consumers sample it', async () => {
    await act(async () => playback.seek(5_000))
    const previousAudio = FakeAudio.instances[0]
    expect(previousAudio.currentTime).toBe(5)
    expect(playback.currentMs).toBe(5_000)
    expect(playback.getCurrentMs()).toBe(5_000)

    await act(async () => root.render(<Harness audioUrl="blob:replacement-audio" />))

    const replacementAudio = FakeAudio.instances[1]
    expect(previousAudio.pause).toHaveBeenCalled()
    expect(replacementAudio.currentTime).toBe(0)
    expect(container.querySelector('[data-testid="painted-clock"]')?.textContent).toBe('0')
    expect(playback.currentMs).toBe(0)
    expect(playback.getCurrentMs()).toBe(0)

    await act(async () => playback.play())
    expect(replacementAudio.currentTime).toBe(0)
    expect(playback.getCurrentMs()).toBe(0)
  })
})
