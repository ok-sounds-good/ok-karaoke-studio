import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const fontRender = require('../electron/font-render-smoke.cjs') as {
  runFontRenderSmoke(BrowserWindow: unknown, font: unknown): Promise<{
    devicePixelRatio: number
    frameCaptured: boolean
    localFontLoaded: boolean
    sandboxed: boolean
  }>
}

const font = {
  family: 'Test Family',
  face: {
    fullName: 'Test Family Regular',
    postscriptName: 'TestFamily-Regular',
    slant: 'normal',
    style: 'Regular',
    weight: 400,
  },
}

function browserWindowFixture({
  devicePixelRatio = 1,
  height = 240,
  width = 426,
} = {}) {
  let invocation = 0
  const window = {
    destroy: vi.fn(),
    isDestroyed: () => false,
    loadURL: vi.fn(async () => undefined),
    webContents: {
      capturePage: vi.fn(async () => ({
        getSize: () => ({ height, width }),
        isEmpty: () => false,
      })),
      executeJavaScript: vi.fn(async (source: string) => {
        if (source === 'window.devicePixelRatio') return devicePixelRatio
        invocation += 1
        return invocation === 1 ? { fontFallbacks: [] } : undefined
      }),
      getLastWebPreferences: () => ({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }),
    },
  }
  const BrowserWindow = vi.fn(function BrowserWindow() {
    return window
  })
  return { BrowserWindow, window }
}

describe('font render smoke', () => {
  it('records a one-to-one device pixel ratio and exact bitmap dimensions', async () => {
    const { BrowserWindow, window } = browserWindowFixture()

    await expect(fontRender.runFontRenderSmoke(BrowserWindow, font)).resolves.toEqual({
      devicePixelRatio: 1,
      frameCaptured: true,
      localFontLoaded: true,
      sandboxed: true,
    })
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      'window.devicePixelRatio',
    )
  })

  it('rejects a scaled renderer even when its bitmap has the requested dimensions', async () => {
    const { BrowserWindow } = browserWindowFixture({ devicePixelRatio: 2 })

    await expect(fontRender.runFontRenderSmoke(BrowserWindow, font)).rejects.toThrow(
      'FONT_RENDER_CAPTURE_INVALID',
    )
  })

  it('retains exact bitmap validation at a one-to-one scale', async () => {
    const { BrowserWindow } = browserWindowFixture({ height: 480, width: 852 })

    await expect(fontRender.runFontRenderSmoke(BrowserWindow, font)).rejects.toThrow(
      'FONT_RENDER_CAPTURE_INVALID',
    )
  })
})
