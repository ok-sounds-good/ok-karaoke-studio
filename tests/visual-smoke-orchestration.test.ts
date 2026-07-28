import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const orchestration = require('../electron/visual-smoke-orchestration.cjs')
const contracts = require('../electron/visual-smoke-renderer-contracts.cjs')
const layoutProfiles = require('../electron/visual-smoke-layout-profiles.cjs')

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
      sendInputEvent: vi.fn(),
      setZoomFactor: vi.fn((value: number) => {
        zoomFactor = value
      }),
    },
  }
}

function densityLayoutState() {
  return {
    valid: true,
    windowWidth: 1024,
    windowHeight: 576,
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
                  rect: { bottom: 54, left: 704, right: 1024, top: 0 },
                  scrollLeft: 0,
                  scrollTop: 0,
                },
                scrollportBefore: {
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  rect: { bottom: 54, left: 704, right: 1024, top: 0 },
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
        rootHeight: 800,
        stageHeight: 350,
        stageMinimum: 350,
        timingMinimum: 350,
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
  }
}

function densityReadinessState(overrides: Record<string, unknown> = {}) {
  return {
    aggregateVisible: true,
    bridgeFrozen: true,
    bridgeFunctions: true,
    bridgeKeys: contracts.STUDIO_BRIDGE_KEYS,
    devicePixelRatio: 1.25,
    dividerAtMinimum: true,
    finalScrollLeft: 4_100,
    finalScrollTop: 700,
    geometryStable: true,
    height: 576,
    href: contracts.PACKAGED_APP_URL,
    ipcReady: true,
    labelCount: 5_000,
    maxScrollLeft: 8_200,
    maxScrollTop: 1_400,
    nodeAccess: false,
    profileName: '125',
    readyState: 'complete',
    timelineClientHeight: 260,
    timelineClientWidth: 800,
    timelineScrollHeight: 1_660,
    timelineScrollWidth: 9_000,
    title: contracts.TIMELINE_DENSITY_TITLE,
    tracks: Array.from({ length: 8 }, (_, index) => ({
      id: `timeline-density-track-${String(index + 1).padStart(2, '0')}`,
      labelCount: 625,
      maxMountedLabels: 96,
      maxMountedWords: 96,
      name: `Density Vocal ${index + 1}`,
      wordCount: 625,
    })),
    width: 1024,
    wordCount: 5_000,
    ...overrides,
  }
}

function densityCaptureState(readiness = densityReadinessState()) {
  return {
    aggregateVisible: true,
    bridgeFrozen: true,
    bridgeFunctions: true,
    bridgeKeys: contracts.STUDIO_BRIDGE_KEYS,
    devicePixelRatio: 1.25,
    dividerAtMinimum: true,
    dirty: false,
    finalScrollLeft: readiness.finalScrollLeft,
    finalScrollTop: readiness.finalScrollTop,
    height: 576,
    href: contracts.PACKAGED_APP_URL,
    ipcReady: true,
    issue: false,
    labels: Array.from({ length: 8 }, (_, index) => `Density Vocal ${index + 1}`),
    lanes: Array.from({ length: 8 }, (_, index) => ({
      id: `timeline-density-track-${String(index + 1).padStart(2, '0')}`,
      mountedLabels: 64,
      mountedWords: 64,
    })),
    nodeAccess: false,
    profileName: '125',
    readyState: 'complete',
    stable: true,
    timelineClientHeight: readiness.timelineClientHeight,
    timelineClientWidth: readiness.timelineClientWidth,
    timelineScrollHeight: readiness.timelineScrollHeight,
    timelineScrollWidth: readiness.timelineScrollWidth,
    title: contracts.TIMELINE_DENSITY_TITLE,
    width: 1024,
  }
}

describe('visual-smoke orchestration', () => {
  it('preserves the selected profile through trusted Open, density capture, and manifest', async () => {
    const window = windowForOrchestration()
    const readiness = densityReadinessState()
    window.webContents.executeJavaScript
      .mockReset()
      .mockResolvedValueOnce(1)
      .mockImplementationOnce(async () => ({
        devicePixelRatio: window.webContents.getZoomFactor(),
        height: Math.floor(window.getContentSize()[1] / window.webContents.getZoomFactor()),
        width: Math.floor(window.getContentSize()[0] / window.webContents.getZoomFactor()),
      }))
      .mockResolvedValueOnce(densityLayoutState())
      .mockResolvedValueOnce({
        active: true,
        boundsHeight: 5,
        boundsWidth: 1_014,
        devicePixelRatio: 1.25,
        height: 576,
        href: contracts.PACKAGED_APP_URL,
        maximum: 58,
        minimum: 30,
        readyState: 'complete',
        value: 42,
        width: 1024,
      })
      .mockResolvedValueOnce({
        active: true,
        boundsHeight: 28,
        boundsWidth: 32,
        devicePixelRatio: 1.25,
        height: 576,
        href: contracts.PACKAGED_APP_URL,
        readyState: 'complete',
        trustedMarkerArmed: true,
        width: 1024,
      })
      .mockResolvedValueOnce(readiness)
      .mockResolvedValueOnce(densityCaptureState(readiness))
    const publish = vi.fn(async (_output, artifacts) => {
      expect(window.isDestroyed()).toBe(true)
      expect(artifacts.map(({ name }: { name: string }) => name)).toEqual([
        '01-timeline-density-5000.png',
        'result.json',
      ])
      expect(JSON.parse(artifacts[1].bytes.toString('utf8')).profile).toEqual({
        browserZoom: 1.25,
        contentHeight: 720,
        contentWidth: 1280,
        cssHeight: 576,
        cssWidth: 1024,
        devicePixelRatio: 1.25,
        deviceScale: 1,
        name: '125',
      })
    })

    await expect(
      orchestration.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            profile: layoutProfiles.layoutSmokeProfile('125'),
            scenario: 'timeline-density',
          },
          window,
        },
        {
          captureSettle: async () => undefined,
          focus: async () => true,
          publish,
          settle: async () => undefined,
        },
      ),
    ).resolves.toEqual({ ok: true })

    expect(window.webContents.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { keyCode: 'Home', type: 'keyDown' },
      { keyCode: 'Home', type: 'keyUp' },
      { keyCode: 'Enter', type: 'keyDown' },
      { keyCode: 'Enter', type: 'char' },
      { keyCode: 'Enter', type: 'keyUp' },
    ])
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(2)
    expect(window.webContents.setZoomFactor.mock.calls[0]).toEqual([1.25])
    expect(window.webContents.setZoomFactor).not.toHaveBeenCalledWith(0.5)
    expect(publish).toHaveBeenCalledOnce()
  })

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
