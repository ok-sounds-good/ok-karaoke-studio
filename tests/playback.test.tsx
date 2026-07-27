/**
 * @vitest-environment happy-dom
 */

import { act, StrictMode, useSyncExternalStore } from 'react'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('authoritative playback clock', () => {
  let container: HTMLDivElement
  let root: Root
  let playback: ReturnType<typeof usePlayback>

  function Harness({
    audioUrl = 'blob:synthetic-audio',
    leadInMs = 0,
  }: {
    audioUrl?: string | null
    leadInMs?: number
  }) {
    playback = usePlayback({
      durationMs: 30_000,
      audioUrl,
      leadInMs,
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

  it('keeps the video clock synthetic through the opening and maps source audio after it', async () => {
    await act(async () => root.render(<Harness leadInMs={1_000} />))
    const audio = FakeAudio.instances[0]

    await act(async () => playback.seek(999))
    expect(audio.currentTime).toBe(0)
    expect(playback.getCurrentMs()).toBe(999)

    await act(async () => playback.seek(1_000))
    expect(audio.currentTime).toBe(0)
    expect(playback.getCurrentMs()).toBe(1_000)

    // A startup-lagging media element remains at the video boundary.
    expect(playback.getCurrentMs()).toBe(1_000)
    audio.currentTime = 0.001
    expect(playback.getCurrentMs()).toBe(1_001)
  })

  it('starts media exactly once when a controllable animation frame reaches the opening boundary', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    await act(async () => root.render(<Harness leadInMs={100} />))
    const audio = FakeAudio.instances[0]!
    await act(async () => playback.play())
    await act(async () => frames.shift()!(0))
    await act(async () => frames.shift()!(100))

    expect(playback.getCurrentMs()).toBe(100)
    expect(audio.play).toHaveBeenCalledOnce()
    expect(audio.currentTime).toBe(0)

    await act(async () => frames.shift()!(116))
    expect(playback.getCurrentMs()).toBe(100)
    expect(audio.play).toHaveBeenCalledOnce()
    await act(async () => playback.seek(99))
    expect(audio.pause).toHaveBeenCalled()
  })

  it('pauses and re-arms around lead changes, rejected media starts, end, and no-audio fallback', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    await act(async () => root.render(<Harness leadInMs={100} />))
    const audio = FakeAudio.instances[0]!
    await act(async () => playback.seek(120))
    audio.play.mockRejectedValueOnce(new Error('blocked'))
    await act(async () => playback.play())
    await act(async () => Promise.resolve())
    expect(playback.isPlaying).toBe(false)

    await act(async () => root.render(<Harness leadInMs={200} />))
    expect(audio.pause).toHaveBeenCalled()
    await act(async () => playback.seek(200))
    await act(async () => playback.play())
    await act(async () => audio.dispatchEvent(new Event('ended')))
    expect(playback.isPlaying).toBe(false)

    await act(async () => root.render(<Harness audioUrl={null} leadInMs={100} />))
    await act(async () => playback.play())
    await act(async () => frames.shift()!(0))
    await act(async () => frames.shift()!(100))
    expect(playback.getCurrentMs()).toBe(100)
  })

  it('restarts source media after pause and after an ended seek at or beyond the opening', async () => {
    await act(async () => root.render(<Harness leadInMs={100} />))
    const audio = FakeAudio.instances[0]!

    await act(async () => playback.seek(120))
    await act(async () => playback.play())
    expect(audio.play).toHaveBeenCalledOnce()

    await act(async () => playback.pause())
    expect(audio.pause).toHaveBeenCalled()
    await act(async () => playback.play())
    expect(audio.play).toHaveBeenCalledTimes(2)
    audio.currentTime = 0.05
    expect(playback.getCurrentMs()).toBe(150)

    await act(async () => audio.dispatchEvent(new Event('ended')))
    expect(playback.isPlaying).toBe(false)
    await act(async () => playback.seek(125))
    expect(playback.currentMs).toBe(125)
    expect(playback.getCurrentMs()).toBe(125)
    await act(async () => playback.play())
    expect(audio.play).toHaveBeenCalledTimes(3)
  })

  it('remaps a paused or playing clock immediately when the opening moves across it', async () => {
    await act(async () => root.render(<Harness leadInMs={100} />))
    const audio = FakeAudio.instances[0]!

    await act(async () => playback.seek(150))
    expect(audio.currentTime).toBe(0.05)
    await act(async () => root.render(<Harness leadInMs={200} />))
    expect(audio.currentTime).toBe(0)
    expect(playback.currentMs).toBe(150)
    expect(playback.getCurrentMs()).toBe(150)
    expect(audio.pause).toHaveBeenCalled()

    await act(async () => root.render(<Harness leadInMs={120} />))
    expect(audio.currentTime).toBe(0.03)
    expect(playback.getCurrentMs()).toBe(150)

    await act(async () => playback.play())
    expect(audio.play).toHaveBeenCalledOnce()
    await act(async () => root.render(<Harness leadInMs={200} />))
    expect(playback.getCurrentMs()).toBe(150)
    expect(audio.currentTime).toBe(0)
    expect(audio.pause).toHaveBeenCalled()

    await act(async () => root.render(<Harness leadInMs={120} />))
    expect(playback.getCurrentMs()).toBe(150)
    expect(audio.currentTime).toBe(0.03)
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('ignores stale same-element play rejections after seek, pause/replay, and a newer play attempt', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const third = deferred<void>()
    await act(async () => root.render(<Harness leadInMs={100} />))
    const audio = FakeAudio.instances[0]!
    audio.play
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise)

    await act(async () => playback.seek(150))
    await act(async () => playback.play())
    expect(audio.play).toHaveBeenCalledOnce()

    await act(async () => playback.seek(160))
    expect(audio.play).toHaveBeenCalledTimes(2)
    await act(async () => first.reject(new Error('stale seek rejection')))
    expect(playback.isPlaying).toBe(true)
    expect(playback.getCurrentMs()).toBe(160)

    await act(async () => playback.pause())
    await act(async () => playback.play())
    expect(audio.play).toHaveBeenCalledTimes(3)
    await act(async () => second.reject(new Error('stale pause rejection')))
    expect(playback.isPlaying).toBe(true)

    await act(async () => third.reject(new Error('current rejection')))
    expect(playback.isPlaying).toBe(false)
  })

  it('keeps one clock capability through StrictMode and cleans isolated subscribers on unmount', async () => {
    let firstClock: typeof playback.clock | null = null
    let subscribeCount = 0
    let unsubscribeCount = 0

    function ClockProbe() {
      const clock = playback.clock
      useSyncExternalStore((listener) => {
        subscribeCount += 1
        const unsubscribe = clock.subscribe(listener)
        return () => {
          unsubscribeCount += 1
          unsubscribe()
        }
      }, clock.getSnapshot)
      return null
    }

    function StrictHarness() {
      playback = usePlayback({ durationMs: 30_000, audioUrl: null, refreshIntervalMs: 50 })
      firstClock ??= playback.clock
      return <ClockProbe />
    }

    await act(async () =>
      root.render(
        <StrictMode>
          <StrictHarness />
        </StrictMode>,
      ),
    )
    expect(playback.clock).toBe(firstClock)
    expect(subscribeCount).toBeGreaterThan(0)

    await act(async () => root.render(<></>))
    expect(unsubscribeCount).toBe(subscribeCount)
  })

  it('keeps sub-threshold fallback samples live but unpublished until one clock notification', async () => {
    const frames: FrameRequestCallback[] = []
    let parentRenders = 0
    let clockConsumerRenders = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })

    function ClockConsumer({ clock }: { clock: typeof playback.clock }) {
      const currentMs = useSyncExternalStore(clock.subscribe, clock.getSnapshot)
      clockConsumerRenders += 1
      return <output data-testid="isolated-clock">{currentMs}</output>
    }

    function IsolatedHarness() {
      playback = usePlayback({ durationMs: 30_000, audioUrl: null, refreshIntervalMs: 50 })
      parentRenders += 1
      return <ClockConsumer clock={playback.clock} />
    }

    await act(async () => root.render(<IsolatedHarness />))
    await act(async () => playback.play())
    const parentRendersAfterPlay = parentRenders
    const clockConsumerRendersAfterPlay = clockConsumerRenders
    let notifications = 0
    const unsubscribe = playback.clock.subscribe(() => {
      notifications += 1
    })

    await act(async () => frames.shift()!(0))
    notifications = 0
    for (const timestamp of [10, 20, 30, 40]) {
      await act(async () => frames.shift()!(timestamp))
    }

    expect(playback.getCurrentMs()).toBe(40)
    expect(playback.clock.getSnapshot()).toBe(0)
    expect(container.querySelector('[data-testid="isolated-clock"]')?.textContent).toBe('0')
    expect(notifications).toBe(0)
    expect(parentRenders).toBe(parentRendersAfterPlay)
    expect(clockConsumerRenders).toBe(clockConsumerRendersAfterPlay)

    await act(async () => frames.shift()!(50))

    expect(container.querySelector('[data-testid="isolated-clock"]')?.textContent).toBe('50')
    expect(playback.clock.getSnapshot()).toBe(50)
    expect(notifications).toBe(1)
    expect(parentRenders).toBe(parentRendersAfterPlay)
    expect(clockConsumerRenders).toBe(clockConsumerRendersAfterPlay + 1)
    unsubscribe()
  })
})
