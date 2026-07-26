import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const orchestration = require('../electron/visual-smoke-orchestration.cjs')
const contracts = require('../electron/visual-smoke-renderer-contracts.cjs')

function windowForOrchestration() {
  let destroyed = false
  let contentSize = [1280, 720]
  let zoomFactor = 1
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
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce(1)
        .mockImplementationOnce(async () => ({
          devicePixelRatio: zoomFactor,
          height: Math.floor(contentSize[1] / zoomFactor),
          width: Math.floor(contentSize[0] / zoomFactor),
        }))
        .mockResolvedValueOnce({
          valid: true,
          windowWidth: 1280,
          windowHeight: 720,
          controlNames: contracts.LAYOUT_REACHABILITY_SELECTORS.base.map(({ name }) => name),
          controls: Object.fromEntries(
            contracts.LAYOUT_REACHABILITY_SELECTORS.base.map((target) => [
              target.name,
              {
                clippedByOverflow: false,
                clippedByOverflowAfterFocus: false,
                exists: true,
                focusScroll: target.focusScroll === true,
                focused: target.focusScroll === true,
                focusedInScrollport: true,
                visible: true,
                inViewport: true,
                focusedInViewport: true,
                ...(['newProject', 'openProject', 'saveProject'].includes(target.name)
                  ? {
                      scrollportAfter: {
                        overflowX: 'auto',
                        overflowY: 'hidden',
                        rect: { bottom: 54, left: 960, right: 1280, top: 0 },
                        scrollLeft: 0,
                        scrollTop: 0,
                      },
                      scrollportBefore: {
                        overflowX: 'auto',
                        overflowY: 'hidden',
                        rect: { bottom: 54, left: 960, right: 1280, top: 0 },
                        scrollLeft: 0,
                        scrollTop: 0,
                      },
                    }
                  : {}),
                optional: target.optional,
              },
            ]),
          ),
          workspace: {
            dividerValue: 44,
            dividerValueRaw: '44',
            geometry: {
              dividerSize: 0,
              paddingBottom: 0,
              paddingTop: 0,
              rootHeight: 1000,
              stageHeight: 440,
              stageMinimum: 440,
              timingMinimum: 440,
            },
            maximum: 56,
            maximumRaw: '56',
            minimum: 44,
            minimumRaw: '44',
            ordered: true,
            orientation: true,
            present: true,
            timingBounded: true,
            timingViewportScrolls: true,
            unclipped: true,
            valueText: '44% Stage Monitor height; 56% Lyric Timing height',
          },
        })
        .mockImplementationOnce(async () => ({
          devicePixelRatio: zoomFactor,
          height: Math.floor(contentSize[1] / zoomFactor),
          width: Math.floor(contentSize[0] / zoomFactor),
        }))
        .mockResolvedValueOnce({
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
      getZoomFactor: () => zoomFactor,
      isDestroyed: () => destroyed,
      setZoomFactor: vi.fn((value: number) => {
        zoomFactor = value
      }),
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
