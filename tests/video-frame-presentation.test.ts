import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

type VideoSettings = {
  resolution: string
  width: number
  height: number
  fps: 30 | 60
}

type FakeWebContents = EventEmitter & {
  capturePage?: () => never
  executeJavaScript(source: string): Promise<unknown>
  invalidate?: () => never
  setFrameRate(fps: number): void
  startPainting(): void
  stopPainting(): void
}

type BrowserWindowOptions = {
  show: boolean
  webPreferences: { offscreen: boolean }
}

type FakeWindow = {
  webContents: FakeWebContents
  loadURL(url: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
}

type VideoExportModule = {
  MAX_VIDEO_FRAMES: number
  normalizeVideoSettings(value?: unknown): VideoSettings
  renderVideoFrames(
    BrowserWindow: new (options: BrowserWindowOptions) => FakeWindow,
    project: unknown,
    timeline: { times: number[] },
    stream: { destroyed: boolean; write(frame: Buffer): boolean },
    settings: VideoSettings,
    runtime: Record<string, unknown>,
    onProgress?: (progress: unknown) => void,
    signal?: AbortSignal,
    platform?: NodeJS.Platform,
  ): Promise<void>
}

const require = createRequire(import.meta.url)
const videoExport = require('../electron/video-export.cjs') as VideoExportModule
const { FRAME_MARKER_BITS } = require('../electron/video-style-document.cjs') as {
  FRAME_MARKER_BITS: number
}
const project = JSON.parse(
  readFileSync(new URL('./fixtures/current-project-v0.json', import.meta.url), 'utf8'),
) as unknown
const runtime = {}

function isAssetInvocation(source: string) {
  return source.includes('prepareKaraokeAssets')
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

function windowsMarkerImage(sequence: number, label: string) {
  const width = 426 + FRAME_MARKER_BITS
  const height = 240
  const bitmap = Buffer.alloc(width * height * 4)
  for (let bit = 0; bit < FRAME_MARKER_BITS; bit += 1) {
    if (!(sequence & (2 ** bit))) continue
    for (let y = 0; y < height; y += 1) {
      bitmap.fill(255, (y * width + 426 + bit) * 4, (y * width + 427 + bit) * 4)
    }
  }
  return {
    crop: () => ({
      getSize: () => ({ width: 426, height }),
      toJPEG: () => Buffer.from(label),
    }),
    getSize: () => ({ width, height }),
    isEmpty: () => false,
    toBitmap: () => bitmap,
  }
}

function emptyPaintImage(width = 0, height = 0) {
  return {
    getSize: () => ({ width, height }),
    isEmpty: () => true,
  }
}

describe('offscreen video frame presentation', () => {
  it('encodes only the committed paint while stopped between frames', async () => {
    const order: string[] = []
    const frames: Buffer[] = []
    let currentFrame = -1
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.capturePage = vi.fn(() => {
      throw new Error('capturePage returned stale data')
    })
    contents.invalidate = vi.fn(() => {
      throw new Error('invalidate requested stale data')
    })
    contents.executeJavaScript = vi.fn(async (source: string) => {
      if (isAssetInvocation(source)) {
        order.push('assets')
        return { fontFallbacks: [] }
      }
      expect(contents.listenerCount('paint')).toBe(0)
      expect(source).toContain('requestAnimationFrame(()=>requestAnimationFrame(resolve))')
      currentFrame = Number(source.match(/,(\d+)\);await/u)?.[1])
      order.push(`update:${currentFrame}`)
      await Promise.resolve()
      order.push(`commit:${currentFrame}`)
      return true
    })
    contents.setFrameRate = vi.fn((fps: number) => order.push(`capture-rate:${fps}`))
    contents.startPainting = vi.fn(() => {
      expect(contents.listenerCount('paint')).toBe(1)
      order.push(`listen/start:${currentFrame}`)
      const resized = {
        toJPEG: () => {
          order.push(`encode:${currentFrame}`)
          return Buffer.from(`current-${currentFrame}`)
        },
      }
      contents.emit(
        'paint',
        {},
        {},
        {
          getSize: () => ({ width: 852, height: 480 }),
          isEmpty: () => false,
          resize: (size: unknown) => {
            expect(size).toEqual({ width: 426, height: 240, quality: 'best' })
            order.push(`resize:${currentFrame}`)
            return resized
          },
          toJPEG: () => {
            throw new Error('unresized paint encoded')
          },
        },
      )
    })
    contents.stopPainting = vi.fn(() => order.push(`stop:${currentFrame}`))

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      constructor(options: BrowserWindowOptions) {
        order.push('construct')
        expect(options).toMatchObject({ show: false, webPreferences: { offscreen: true } })
      }
      loadURL = async () => {
        order.push('load')
      }
      isDestroyed = () => destroyed
      destroy = vi.fn(() => {
        destroyed = true
        order.push('destroy')
      })
    }

    await videoExport.renderVideoFrames(
      FakeBrowserWindow,
      project,
      { times: [0, 17] },
      {
        destroyed: false,
        write: (frame) => {
          frames.push(frame)
          order.push(`write:${frames.length - 1}`)
          return true
        },
      },
      videoExport.normalizeVideoSettings({ resolution: '240p', fps: 60 }),
      runtime,
    )

    expect(contents.capturePage).not.toHaveBeenCalled()
    expect(contents.invalidate).not.toHaveBeenCalled()
    expect(frames.map((frame) => frame.toString())).toEqual(['current-0', 'current-1'])
    expect(order).toEqual([
      'construct',
      'capture-rate:240',
      'load',
      'stop:-1',
      'assets',
      'update:0',
      'commit:0',
      'listen/start:0',
      'resize:0',
      'encode:0',
      'stop:0',
      'write:0',
      'update:1',
      'commit:1',
      'listen/start:1',
      'resize:1',
      'encode:1',
      'stop:1',
      'write:1',
      'destroy',
    ])
    expect(contents.listenerCount('paint')).toBe(0)
  })

  it('stops painting and destroys the export window when encoding fails', async () => {
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.executeJavaScript = vi.fn(async () => true)
    contents.setFrameRate = vi.fn()
    contents.startPainting = vi.fn(() => {
      contents.emit(
        'paint',
        {},
        {},
        {
          getSize: () => ({ width: 426, height: 240 }),
          isEmpty: () => false,
          toJPEG: () => {
            throw new Error('JPEG encoding failed')
          },
        },
      )
    })
    contents.stopPainting = vi.fn()

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      loadURL = async () => {}
      isDestroyed = () => destroyed
      destroy = vi.fn(() => {
        destroyed = true
      })
    }

    await expect(
      videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write: vi.fn(() => true) },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
      ),
    ).rejects.toThrow('JPEG encoding failed')

    expect(contents.stopPainting).toHaveBeenCalledTimes(2)
    expect(contents.listenerCount('paint')).toBe(0)
    expect(destroyed).toBe(true)
  })

  it('waits for the requested Windows paint token and crops it from the JPEG', async () => {
    expect(videoExport.MAX_VIDEO_FRAMES).toBeLessThan(2 ** FRAME_MARKER_BITS)
    const frames: Buffer[] = []
    const order: string[] = []
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    const image = (sequence: number, label: string) => {
      const width = 426 + 18
      const height = 240
      const bitmap = Buffer.alloc(width * height * 4)
      for (let bit = 0; bit < 18; bit += 1) {
        if (!(sequence & (2 ** bit))) continue
        for (let y = 0; y < height; y += 1) {
          bitmap.fill(255, (y * width + 426 + bit) * 4, (y * width + 427 + bit) * 4)
        }
      }
      return {
        crop: vi.fn((rect: unknown) => {
          expect(rect).toEqual({ x: 0, y: 0, width: 426, height: 240 })
          return {
            getSize: () => ({ width: 426, height: 240 }),
            toJPEG: () => Buffer.from(label),
          }
        }),
        getSize: () => ({ width, height }),
        isEmpty: () => false,
        toBitmap: () => bitmap,
      }
    }
    contents.executeJavaScript = vi.fn(async (source: string) => {
      if (isAssetInvocation(source)) return { fontFallbacks: [] }
      expect(contents.listenerCount('paint')).toBe(1)
      order.push('update')
      contents.emit('paint', {}, {}, image(1, 'current'))
      expect(frames).toEqual([])
      expect(contents.stopPainting).toHaveBeenCalledTimes(1)
      await Promise.resolve()
      order.push('update-complete')
      return true
    })
    contents.setFrameRate = vi.fn()
    contents.startPainting = vi.fn(() => {
      order.push('start')
      contents.emit('paint', {}, {}, image(0, 'cached'))
    })
    contents.stopPainting = vi.fn(() => order.push('stop'))

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      constructor(options: BrowserWindowOptions & { width?: number }) {
        expect(options.width).toBe(444)
      }
      loadURL = async () => {}
      isDestroyed = () => destroyed
      destroy = vi.fn(() => {
        destroyed = true
      })
    }

    await videoExport.renderVideoFrames(
      FakeBrowserWindow,
      project,
      { times: [0] },
      {
        destroyed: false,
        write: (frame) => {
          frames.push(frame)
          return true
        },
      },
      videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
      runtime,
      undefined,
      undefined,
      'win32',
    )

    expect(frames.map((frame) => frame.toString())).toEqual(['current'])
    expect(order).toEqual(['stop', 'start', 'update', 'update-complete', 'stop'])
    expect(contents.listenerCount('paint')).toBe(0)
    expect(destroyed).toBe(true)
  })

  it('does not publish a matching Windows paint before the renderer update succeeds', async () => {
    const currentImage = windowsMarkerImage(1, 'must-not-publish')
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.executeJavaScript = vi.fn(async (source: string) => {
      if (isAssetInvocation(source)) return { fontFallbacks: [] }
      contents.emit('paint', {}, {}, currentImage)
      throw new Error('renderer update failed')
    })
    contents.setFrameRate = vi.fn()
    contents.startPainting = vi.fn()
    contents.stopPainting = vi.fn()
    const write = vi.fn(() => true)

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      loadURL = async () => {}
      isDestroyed = () => destroyed
      destroy = vi.fn(() => {
        destroyed = true
      })
    }

    await expect(
      videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
        undefined,
        undefined,
        'win32',
      ),
    ).rejects.toThrow('renderer update failed')

    expect(write).not.toHaveBeenCalled()
    expect(contents.stopPainting).toHaveBeenCalledTimes(2)
    expect(contents.listenerCount('paint')).toBe(0)
    expect(destroyed).toBe(true)
  })

  it.each([
    { mode: 'abort', expectedError: { name: 'AbortError' } },
    {
      mode: 'timeout',
      expectedError: {
        message: expect.stringContaining('Timed out while rendering a video frame'),
      },
    },
  ])(
    'discards a buffered Windows paint on renderer $mode and ignores late completion',
    async ({ mode, expectedError }) => {
      if (mode === 'timeout') vi.useFakeTimers()
      try {
        const update = deferred<unknown>()
        const updateStarted = deferred<void>()
        const controller = new AbortController()
        let destroyed = false
        const currentImage = windowsMarkerImage(1, 'must-not-publish')
        const contents = new EventEmitter() as FakeWebContents
        contents.executeJavaScript = vi.fn((source: string) => {
          if (isAssetInvocation(source)) return Promise.resolve({ fontFallbacks: [] })
          contents.emit('paint', {}, {}, currentImage)
          updateStarted.resolve()
          return update.promise
        })
        contents.setFrameRate = vi.fn()
        contents.startPainting = vi.fn()
        contents.stopPainting = vi.fn()
        const write = vi.fn(() => true)
        const destroyWindow = vi.fn(() => {
          destroyed = true
        })

        class FakeBrowserWindow implements FakeWindow {
          webContents = contents
          loadURL = async () => {}
          isDestroyed = () => destroyed
          destroy = destroyWindow
        }

        const rendering = videoExport.renderVideoFrames(
          FakeBrowserWindow,
          project,
          { times: [0] },
          { destroyed: false, write },
          videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
          runtime,
          undefined,
          controller.signal,
          'win32',
        )
        await updateStarted.promise
        const rejection = expect(rendering).rejects.toMatchObject(expectedError)
        if (mode === 'abort') controller.abort()
        else await vi.advanceTimersByTimeAsync(10_000)
        await rejection

        expect(write).not.toHaveBeenCalled()
        expect(contents.startPainting).toHaveBeenCalledTimes(1)
        expect(contents.stopPainting).toHaveBeenCalledTimes(2)
        expect(contents.listenerCount('paint')).toBe(0)
        expect(destroyWindow).toHaveBeenCalledTimes(1)

        contents.emit('paint', {}, {}, currentImage)
        update.resolve(true)
        await Promise.resolve()
        await Promise.resolve()
        controller.abort()
        expect(write).not.toHaveBeenCalled()
        expect(contents.stopPainting).toHaveBeenCalledTimes(2)
        expect(destroyWindow).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('aborts a pending renderer update and ignores its late completion', async () => {
    const update = deferred<unknown>()
    const updateStarted = deferred<void>()
    const controller = new AbortController()
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.executeJavaScript = vi.fn((source: string) => {
      if (isAssetInvocation(source)) return Promise.resolve({ fontFallbacks: [] })
      updateStarted.resolve()
      return update.promise
    })
    contents.setFrameRate = vi.fn()
    contents.startPainting = vi.fn()
    contents.stopPainting = vi.fn()
    const destroyWindow = vi.fn(() => {
      destroyed = true
    })

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      loadURL = async () => {}
      isDestroyed = () => destroyed
      destroy = destroyWindow
    }

    const rendering = videoExport.renderVideoFrames(
      FakeBrowserWindow,
      project,
      { times: [0] },
      { destroyed: false, write: vi.fn(() => true) },
      videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
      runtime,
      undefined,
      controller.signal,
    )
    await updateStarted.promise
    controller.abort()

    await expect(rendering).rejects.toMatchObject({ name: 'AbortError' })
    expect(contents.startPainting).not.toHaveBeenCalled()
    expect(contents.stopPainting).toHaveBeenCalledTimes(1)
    expect(contents.listenerCount('paint')).toBe(0)
    expect(destroyWindow).toHaveBeenCalledTimes(1)

    update.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(contents.startPainting).not.toHaveBeenCalled()
  }, 500)

  it('times out a pending renderer update and cleans up before late completion', async () => {
    vi.useFakeTimers()
    try {
      const update = deferred<unknown>()
      const updateStarted = deferred<void>()
      const controller = new AbortController()
      let destroyed = false
      const contents = new EventEmitter() as FakeWebContents
      contents.executeJavaScript = vi.fn((source: string) => {
        if (isAssetInvocation(source)) return Promise.resolve({ fontFallbacks: [] })
        updateStarted.resolve()
        return update.promise
      })
      contents.setFrameRate = vi.fn()
      contents.startPainting = vi.fn()
      contents.stopPainting = vi.fn()
      const destroyWindow = vi.fn(() => {
        destroyed = true
      })

      class FakeBrowserWindow implements FakeWindow {
        webContents = contents
        loadURL = async () => {}
        isDestroyed = () => destroyed
        destroy = destroyWindow
      }

      const rendering = videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write: vi.fn(() => true) },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
        undefined,
        controller.signal,
      )
      await updateStarted.promise
      const rejection = expect(rendering).rejects.toMatchObject({
        message: 'Timed out while rendering a video frame',
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await rejection

      expect(contents.startPainting).not.toHaveBeenCalled()
      expect(contents.stopPainting).toHaveBeenCalledTimes(1)
      expect(contents.listenerCount('paint')).toBe(0)
      expect(destroyWindow).toHaveBeenCalledTimes(1)

      update.resolve(true)
      await Promise.resolve()
      await Promise.resolve()
      controller.abort()
      expect(contents.startPainting).not.toHaveBeenCalled()
      expect(destroyWindow).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports bounded Windows correlation state when no paint arrives during an update', async () => {
    vi.useFakeTimers()
    try {
      const update = deferred<unknown>()
      const updateStarted = deferred<void>()
      let destroyed = false
      const contents = new EventEmitter() as FakeWebContents
      contents.executeJavaScript = vi.fn((source: string) => {
        if (isAssetInvocation(source)) return Promise.resolve({ fontFallbacks: [] })
        updateStarted.resolve()
        return update.promise
      })
      contents.setFrameRate = vi.fn()
      contents.startPainting = vi.fn()
      contents.stopPainting = vi.fn()

      class FakeBrowserWindow implements FakeWindow {
        webContents = contents
        loadURL = async () => {}
        isDestroyed = () => destroyed
        destroy = vi.fn(() => {
          destroyed = true
        })
      }

      const rendering = videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write: vi.fn(() => true) },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
        undefined,
        undefined,
        'win32',
      )
      await updateStarted.promise
      const rejection = expect(rendering).rejects.toThrow(
        'Timed out while rendering a video frame (expected=1; update=pending; paints=0; empty=0; unreadable=0; last=none; size=none)',
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await rejection

      expect(contents.startPainting).toHaveBeenCalledTimes(1)
      expect(contents.stopPainting).toHaveBeenCalledTimes(2)
      expect(contents.listenerCount('paint')).toBe(0)
      expect(destroyed).toBe(true)
      update.resolve(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      name: 'empty-only',
      paints: () => [emptyPaintImage()],
      diagnostic:
        'Timed out while rendering a video frame (expected=1; update=complete; paints=1; empty=1; unreadable=0; last=none; size=0x0)',
    },
    {
      name: 'stale, unreadable, then empty',
      paints: () => [
        windowsMarkerImage(0, 'stale'),
        {
          getSize: () => ({ width: 444, height: 240 }),
          isEmpty: () => false,
          toBitmap: () => Buffer.alloc(3),
        },
        emptyPaintImage(),
      ],
      diagnostic:
        'Timed out while rendering a video frame (expected=1; update=complete; paints=3; empty=1; unreadable=1; last=0; size=0x0)',
    },
  ])('reports bounded Windows $name paint state', async ({ paints, diagnostic }) => {
    vi.useFakeTimers()
    try {
      expect(diagnostic.length).toBeLessThanOrEqual(400)
      let destroyed = false
      const contents = new EventEmitter() as FakeWebContents
      contents.executeJavaScript = vi.fn(async () => true)
      contents.setFrameRate = vi.fn()
      contents.startPainting = vi.fn(() => {
        paints().forEach((image) => contents.emit('paint', {}, {}, image))
      })
      contents.stopPainting = vi.fn()

      class FakeBrowserWindow implements FakeWindow {
        webContents = contents
        loadURL = async () => {}
        isDestroyed = () => destroyed
        destroy = vi.fn(() => {
          destroyed = true
        })
      }

      const rendering = videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write: vi.fn(() => true) },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
        undefined,
        undefined,
        'win32',
      )
      await Promise.resolve()
      await Promise.resolve()
      const rejection = expect(rendering).rejects.toThrow(diagnostic)
      await vi.advanceTimersByTimeAsync(10_000)
      await rejection

      expect(contents.stopPainting).toHaveBeenCalledTimes(2)
      expect(contents.listenerCount('paint')).toBe(0)
      expect(destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
