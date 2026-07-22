import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const orchestration = require('../electron/visual-smoke-orchestration.cjs')
const contracts = require('../electron/visual-smoke-renderer-contracts.cjs')

function windowForOrchestration() {
  let destroyed = false
  let contentSize = [1280, 720]
  return {
    destroy: vi.fn(() => {
      destroyed = true
    }),
    getContentSize: () => contentSize,
    isDestroyed: () => destroyed,
    setContentSize: vi.fn((width: number, height: number) => {
      contentSize = [width, height]
    }),
    setMinimumSize: vi.fn(),
    webContents: {
      capturePage: vi.fn(async () => ({
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => validPng(1280, 720),
      })),
      executeJavaScript: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce({
        bridgeFrozen: true,
        bridgeFunctions: true,
        bridgeKeys: contracts.STUDIO_BRIDGE_KEYS,
        devicePixelRatio: 1,
        height: 720,
        href: contracts.PACKAGED_APP_URL,
        ipcReady: true,
        nodeAccess: false,
        readyState: 'complete',
        rootChildren: 1,
        stable: true,
        width: 1280,
      }),
      getURL: () => contracts.PACKAGED_APP_URL,
      isDestroyed: () => destroyed,
      setZoomFactor: vi.fn(),
    },
  }
}

describe('visual-smoke orchestration', () => {
  it('does not publish evidence when a fatal event arrives during the final grace period', async () => {
    const window = windowForOrchestration()
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    let fatal = false
    let settles = 0

    await expect(
      orchestration.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence' },
          fatalObserver: { disposeRenderers: vi.fn(), hasFatal: () => fatal },
          window,
        },
        {
          captureSettle: async () => undefined,
          focus: async () => true,
          publish,
          settle: async () => {
            settles += 1
            if (settles === 1) fatal = true
          },
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })

    expect(window.destroy).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
  })

  it('treats a failed atomic publication as a failed smoke result', async () => {
    const window = windowForOrchestration()
    const writeFailure = vi.fn(async () => undefined)

    await expect(
      orchestration.runVisualSmoke(
        { app: {}, config: { output: '/safe/evidence' }, window },
        {
          captureSettle: async () => undefined,
          focus: async () => true,
          publish: async () => {
            throw new Error('atomic publication failed')
          },
          settle: async () => undefined,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })

    expect(window.destroy).toHaveBeenCalledOnce()
    expect(writeFailure).toHaveBeenCalledOnce()
  })
})
