import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const focus = require('../electron/smoke-window-focus.cjs') as {
  focusSmokeWindow(options: Record<string, unknown>): Promise<boolean>
}

describe('font smoke focus acquisition', () => {
  it('activates the app and waits for both native and renderer focus', async () => {
    const app = { focus: vi.fn() }
    let attempts = 0
    const window = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isFocused: () => attempts >= 2,
      show: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn(async () => {
          attempts += 1
          return attempts >= 2
        }),
        focus: vi.fn(),
      },
    }

    await expect(focus.focusSmokeWindow({
      app,
      delay: async () => undefined,
      now: () => attempts * 10,
      timeoutMs: 100,
      window,
    })).resolves.toBe(true)
    expect(app.focus).toHaveBeenCalledWith({ steal: true })
    expect(window.show).toHaveBeenCalledTimes(2)
    expect(window.focus).toHaveBeenCalledTimes(2)
    expect(window.webContents.focus).toHaveBeenCalledTimes(2)
  })

  it('fails without weakening the focus assertion when activation never succeeds', async () => {
    let current = 0
    const window = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isFocused: () => false,
      show: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn(async () => false),
        focus: vi.fn(),
      },
    }

    await expect(focus.focusSmokeWindow({
      app: { focus: vi.fn() },
      delay: async () => { current += 10 },
      now: () => current,
      timeoutMs: 20,
      window,
    })).rejects.toThrow('FONT_ACCESS_SMOKE_FOCUS_FAILED')
  })

  it('uses the caller fixed code without including environment details', async () => {
    let current = 0
    await expect(focus.focusSmokeWindow({
      app: { focus: vi.fn() },
      delay: async () => { current += 10 },
      errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
      now: () => current,
      timeoutMs: 10,
      window: {
        focus: vi.fn(),
        isDestroyed: () => false,
        isFocused: () => false,
        show: vi.fn(),
        webContents: { executeJavaScript: async () => false, focus: vi.fn() },
      },
    })).rejects.toThrow('VISUAL_SMOKE_FOCUS_FAILED')
  })
})
