import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const smoke = require('../electron/video-style-visual-smoke.cjs')
const contracts = require('../electron/visual-smoke-renderer-contracts.cjs')
const profiles = require('../electron/smoke-profile.cjs')
const roots: string[] = []

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  ),
)

async function configuredArguments() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-config-'))
  roots.push(root)
  const user = await profiles.createOwnedSmokeProfile('user-', { temporaryRoot: root })
  const session = await profiles.createOwnedSmokeProfile('session-', { temporaryRoot: root })
  const output = join(root, 'evidence')
  return {
    argv: [
      smoke.TRIGGER,
      `${smoke.OPTIONS.output}${output}`,
      `${smoke.OPTIONS.profile}100`,
      `${smoke.OPTIONS.scenario}${smoke.BASELINE_SCENARIO}`,
      `${smoke.OPTIONS.userData}${user.path}`,
      `${smoke.OPTIONS.userIdentity}${user.serializedIdentity}`,
      `${smoke.OPTIONS.sessionData}${session.path}`,
      `${smoke.OPTIONS.sessionIdentity}${session.serializedIdentity}`,
    ],
    output,
  }
}

async function settleCaptureImmediately() {}

function fakeWindow(
  capturePage = vi.fn(async () => ({
    getSize: () => ({ height: 720, width: 1280 }),
    isEmpty: () => false,
    toPNG: () => validPng(1280, 720),
  })),
  displayScale = 1,
  rendererOverrides = {},
) {
  let destroyed = false
  let contentSize = [1280, 720]
  let zoomFactor = 1
  const observation = () => ({
    devicePixelRatio: displayScale * zoomFactor,
    height: Math.floor(contentSize[1] / zoomFactor),
    width: Math.floor(contentSize[0] / zoomFactor),
  })
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
      capturePage,
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce(displayScale)
        .mockImplementationOnce(async () => observation())
        .mockResolvedValueOnce(layoutReachabilityState({ height: 720, width: 1280 }))
        .mockImplementationOnce(async () => observation())
        .mockResolvedValueOnce({
          bridgeFrozen: true,
          bridgeFunctions: true,
          bridgeKeys: smoke.STUDIO_BRIDGE_KEYS,
          devicePixelRatio: 1,
          height: 720,
          href: smoke.PACKAGED_APP_URL,
          ipcReady: true,
          nodeAccess: false,
          readyState: 'complete',
          rootChildren: 1,
          stable: true,
          width: 1280,
          ...rendererOverrides,
        }),
      getURL: () => smoke.PACKAGED_APP_URL,
      getZoomFactor: () => zoomFactor,
      isDestroyed: () => destroyed,
      sendInputEvent: vi.fn(),
      setZoomFactor: vi.fn((value: number) => {
        zoomFactor = value
      }),
    },
  }
}

function projectLyricsState(width: number, height: number) {
  return {
    fontFamily: '"System UI"',
    fontSize: '48px',
    fontStatus: 'loaded',
    height,
    href: smoke.PACKAGED_APP_URL,
    readyState: 'complete',
    resourcesReady: true,
    stageHeight: height / 2,
    stageWidth: width / 2,
    typeface: 'System UI',
    width,
  }
}

function styleActionTarget(action: string) {
  return {
    action,
    boundsHeight: 24,
    boundsWidth: 60,
    height: 720,
    href: smoke.PACKAGED_APP_URL,
    readyState: 'complete',
    width: 1280,
    x: 120,
    y: 20,
  }
}

function backgroundState(mode: 'gradient' | 'solid', applied = false) {
  return {
    applied,
    css:
      mode === 'solid'
        ? 'rgb(33, 24, 45)'
        : 'linear-gradient(145deg, rgb(50, 34, 66), rgb(30, 22, 41))',
    gradientEndColor: '#1E1629',
    gradientStartColor: '#322242',
    height: 720,
    mode,
    resourcesReady: true,
    solidColor: '#21182D',
    stageHeight: 480,
    stageWidth: 853.33,
    width: 1280,
  }
}

function titleCardState(
  role: 'eyebrow' | 'artist',
  applied = false,
  position = `${role} position 960, 550`,
) {
  return { applied, position, resourcesReady: true, role }
}

function stageFrameState(
  role: 'brand' | 'clock' | 'footer',
  options: { applied?: boolean; changedClock?: boolean } = {},
) {
  return {
    applied: options.applied === true,
    brandStyle: 'color: rgb(193, 187, 199); font-weight: 700;',
    clockStyle: options.changedClock
      ? 'color: rgb(187, 183, 192); font-weight: 700;'
      : 'color: rgb(187, 183, 192); font-weight: 600;',
    clockWeight: options.changedClock ? '700' : '600',
    height: 720,
    lineColor: '#473C54',
    lineWidth: '0.10416666666666667cqw',
    resourcesReady: true,
    role,
    stageHeight: 480,
    stageWidth: 853.33,
    width: 1280,
  }
}

function styleKeyboardState() {
  return {
    changes: ['footer', 'clock', 'footer', 'brand', 'footer', 'brand'].map((role) => ({
      active: true,
      checked: true,
      checkedCount: 1,
      role,
    })),
    closed: false,
    clean: true,
    focus: [
      'master',
      'role:brand',
      'master',
      'role:brand',
      'role:footer',
      'master',
      'role:footer',
      'role:clock',
      'master',
      'role:clock',
      'role:footer',
      'role:brand',
      'role:footer',
      'role:brand',
      'visibility',
      'typeface',
      'face:Regular',
      'face:Italic',
      'face:Semi Bold',
      'face:Bold',
      'face:Extra Bold',
      'size',
      'color',
    ],
    redoDisabled: true,
    undoDisabled: true,
  }
}

function styleTarget(target: unknown = undefined) {
  return target === undefined
    ? {
        boundsHeight: 24,
        boundsWidth: 60,
        height: 720,
        href: smoke.PACKAGED_APP_URL,
        readyState: 'complete',
        width: 1280,
        x: 120,
        y: 20,
      }
    : target
}

function layoutReachabilityState(
  viewport: { height: number; width: number } = { height: 720, width: 1280 },
  includeStyleTargets = false,
) {
  const targets = includeStyleTargets
    ? contracts.LAYOUT_REACHABILITY_SELECTORS.style
    : contracts.LAYOUT_REACHABILITY_SELECTORS.base
  const controls = Object.fromEntries(
    targets.map((target: { focusScroll?: boolean; name: string; optional?: boolean }) => [
      target.name,
      {
        clippedByOverflow: false,
        clippedByOverflowAfterFocus: false,
        exists: true,
        focusScroll: target.focusScroll === true,
        focused: target.focusScroll === true,
        focusedInScrollport: true,
        focusedInViewport: true,
        focusedInitially: true,
        hasScrollAncestor: false,
        inViewport: true,
        name: target.name,
        optional: target.optional === true,
        scrollers: [],
        visible: true,
      },
    ]),
  )
  for (const name of ['newProject', 'openProject', 'saveProject']) {
    controls[name] = {
      ...controls[name],
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
  }
  return {
    controlNames: targets.map((target: { name: string }) => target.name),
    controls,
    valid: true,
    windowHeight: viewport.height,
    windowWidth: viewport.width,
  }
}

function fakeStyleSessionWindow(
  options: {
    clockPending?: boolean
    displayScale?: number
    leadState?: unknown
    lyricsTarget?: unknown
    readiness?: Promise<never>
    templateFormState?: unknown
    templateState?: unknown
    target?: unknown
  } = {},
  capturePng = validPng,
) {
  const window = fakeWindow()
  const captures = [
    { height: 720, width: 1280 },
    { height: 900, width: 1440 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
  ]
  let candidateIndex = 0
  window.webContents.capturePage.mockImplementation(async () => {
    const captureIndex = Math.floor(candidateIndex / 2)
    const viewport = captures[captureIndex]
    const pixelValue = captures.length - captureIndex
    candidateIndex += 1
    return {
      getSize: () => viewport,
      isEmpty: () => false,
      toPNG: () => capturePng(viewport.width, viewport.height, pixelValue),
    }
  })
  window.webContents.executeJavaScript
    .mockReset()
    .mockResolvedValueOnce(options.displayScale ?? 1)
    .mockImplementationOnce(async () => ({
      devicePixelRatio: (options.displayScale ?? 1) * window.webContents.getZoomFactor(),
      height: Math.floor(window.getContentSize()[1] / window.webContents.getZoomFactor()),
      width: Math.floor(window.getContentSize()[0] / window.webContents.getZoomFactor()),
    }))
    .mockResolvedValueOnce(layoutReachabilityState({ height: 720, width: 1280 }))
    .mockImplementationOnce(async () => ({
      devicePixelRatio: (options.displayScale ?? 1) * window.webContents.getZoomFactor(),
      height: Math.floor(window.getContentSize()[1] / window.webContents.getZoomFactor()),
      width: Math.floor(window.getContentSize()[0] / window.webContents.getZoomFactor()),
    }))
    .mockResolvedValueOnce(styleTarget(options.target))
    .mockImplementationOnce(async () => ({
      devicePixelRatio: (options.displayScale ?? 1) * window.webContents.getZoomFactor(),
      height: Math.floor(window.getContentSize()[1] / window.webContents.getZoomFactor()),
      width: Math.floor(window.getContentSize()[0] / window.webContents.getZoomFactor()),
    }))
    .mockResolvedValueOnce(layoutReachabilityState({ height: 720, width: 1280 }, true))
  if (options.readiness) {
    window.webContents.executeJavaScript.mockReturnValueOnce(options.readiness)
  } else {
    const script = window.webContents.executeJavaScript
    script
      .mockResolvedValueOnce(projectLyricsState(1280, 720))
      .mockResolvedValueOnce(projectLyricsState(1440, 900))
      .mockResolvedValueOnce(options.lyricsTarget ?? styleActionTarget('lyrics'))
      .mockResolvedValueOnce('lyrics')
      .mockResolvedValueOnce(projectLyricsState(1280, 720))
      .mockResolvedValueOnce(styleActionTarget('stage'))
      .mockResolvedValueOnce(stageFrameState('brand'))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(styleKeyboardState())
      .mockResolvedValueOnce(styleActionTarget('cancel'))
      .mockResolvedValueOnce(styleTarget())
      .mockResolvedValueOnce(styleActionTarget('background'))
      .mockResolvedValueOnce(backgroundState('gradient'))
      .mockResolvedValueOnce(styleActionTarget('solid'))
      .mockResolvedValueOnce(backgroundState('solid'))
      .mockResolvedValueOnce(styleActionTarget('apply'))
      .mockResolvedValueOnce(backgroundState('solid', true))
      .mockResolvedValueOnce(styleTarget())
      .mockResolvedValueOnce(styleActionTarget('title'))
      .mockResolvedValueOnce(titleCardState('eyebrow'))
      .mockResolvedValueOnce(styleActionTarget('eyebrow-visibility'))
      .mockResolvedValueOnce(titleCardState('eyebrow'))
      .mockResolvedValueOnce(styleActionTarget('artist'))
      .mockResolvedValueOnce(styleActionTarget('artist-visibility'))
      .mockResolvedValueOnce(titleCardState('artist', false, 'artist position 960, 650'))
      .mockResolvedValueOnce(styleActionTarget('move-selected'))
      .mockResolvedValueOnce(titleCardState('artist', false, 'artist position 961, 650'))
      .mockResolvedValueOnce(styleActionTarget('apply-title'))
      .mockResolvedValueOnce(titleCardState('artist', true))
      .mockResolvedValueOnce(styleTarget())
      .mockResolvedValueOnce(styleActionTarget('stage'))
      .mockResolvedValueOnce(stageFrameState('brand'))
      .mockResolvedValueOnce(styleActionTarget('stage-off'))
      .mockResolvedValueOnce(stageFrameState('brand'))
      .mockResolvedValueOnce(styleActionTarget('stage-on'))
    if (options.clockPending) script.mockResolvedValueOnce(null)
    script
      .mockResolvedValueOnce(styleActionTarget('clock'))
      .mockResolvedValueOnce(styleActionTarget('clock-face'))
      .mockResolvedValueOnce(stageFrameState('clock', { changedClock: true }))
      .mockResolvedValueOnce(styleActionTarget('footer'))
      .mockResolvedValueOnce(styleActionTarget('footer-visibility'))
      .mockResolvedValueOnce(stageFrameState('footer', { changedClock: true }))
      .mockResolvedValueOnce(styleActionTarget('apply-stage'))
      .mockResolvedValueOnce(stageFrameState('footer', { applied: true, changedClock: true }))
      .mockResolvedValueOnce(styleTarget())
      .mockResolvedValueOnce(styleActionTarget('lead'))
      .mockResolvedValueOnce(styleActionTarget('sync-aid'))
      .mockResolvedValueOnce(
        options.leadState ?? {
          controls: 4,
          height: 720,
          resourcesReady: true,
          stageHeight: 540,
          stageWidth: 960,
          width: 1280,
          wordProgress: ['100%', '50%', '0%', '0%', '0%', '0%', '0%', '0%'],
        },
      )
      .mockResolvedValueOnce(styleActionTarget('templates'))
      .mockResolvedValueOnce(
        options.templateFormState ?? {
          controls: 2,
          height: 720,
          nameReady: true,
          resourcesReady: true,
          stageHeight: 540,
          stageWidth: 960,
          width: 1280,
        },
      )
      .mockResolvedValueOnce(styleActionTarget('template-name'))
      .mockResolvedValueOnce(styleActionTarget('save-template'))
      .mockResolvedValueOnce(
        options.templateState ?? {
          controls: 5,
          height: 720,
          name: smoke.STYLE_TEMPLATE_NAME,
          resourcesReady: true,
          stageHeight: 540,
          stageWidth: 960,
          status: `Saved “${smoke.STYLE_TEMPLATE_NAME}”.`,
          width: 1280,
        },
      )
  }
  return window
}

function fakeRendererContents() {
  let destroyed = false
  return Object.assign(new EventEmitter(), {
    destroy() {
      destroyed = true
      this.emit('destroyed')
    },
    isDestroyed: () => destroyed,
  })
}

describe('production-window visual smoke', () => {
  it('defines exact CSS viewport contracts for every requested layout profile', () => {
    expect(
      ['100', '125', '150', 'dpr2'].map((name) => {
        const profile = smoke.layoutSmokeProfile(name)
        return { name, viewport: profile.cssViewport }
      }),
    ).toEqual([
      { name: '100', viewport: { height: 720, width: 1280 } },
      { name: '125', viewport: { height: 576, width: 1024 } },
      { name: '150', viewport: { height: 480, width: 853 } },
      { name: 'dpr2', viewport: { height: 720, width: 1280 } },
    ])
  })

  it('accepts one complete flag set and configures isolated paths before readiness', async () => {
    const { argv, output } = await configuredArguments()
    const config = smoke.parseVisualSmokeArguments(argv)
    const setPath = vi.fn()
    const appendSwitch = vi.fn()
    expect(
      smoke.configureVisualSmokeBeforeReady(
        {
          commandLine: { appendSwitch },
          getPath: (name: string) => join(tmpdir(), `default-${name}`),
          isReady: () => false,
          setPath,
        },
        config,
      ),
    ).toMatchObject({ output, scenario: smoke.BASELINE_SCENARIO })
    expect(setPath.mock.calls.map(([name]) => name)).toEqual(['userData', 'sessionData'])
    expect(appendSwitch).toHaveBeenCalledWith('force-device-scale-factor', '1')
    expect(() => smoke.parseVisualSmokeArguments([...argv, argv[1]])).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
    expect(() =>
      smoke.parseVisualSmokeArguments([...argv, '--oks-video-style-visual-unknown=x']),
    ).toThrow('VISUAL_SMOKE_FLAG_INVALID')
    const scenarioIndex = argv.findIndex((argument) => argument.startsWith(smoke.OPTIONS.scenario))
    expect(() =>
      smoke.parseVisualSmokeArguments(argv.filter((_, index) => index !== scenarioIndex)),
    ).toThrow('VISUAL_SMOKE_FLAG_INVALID')
    const styleSessionScenario = [...argv]
    styleSessionScenario[scenarioIndex] = `${smoke.OPTIONS.scenario}${smoke.STYLE_SESSION_SCENARIO}`
    expect(smoke.parseVisualSmokeArguments(styleSessionScenario)).toMatchObject({
      scenario: smoke.STYLE_SESSION_SCENARIO,
    })
    const retiredScenario = [...argv]
    retiredScenario[scenarioIndex] = `${smoke.OPTIONS.scenario}project-typography`
    expect(() => smoke.parseVisualSmokeArguments(retiredScenario)).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
    const unknownScenario = [...argv]
    unknownScenario[scenarioIndex] = `${smoke.OPTIONS.scenario}unknown`
    expect(() => smoke.parseVisualSmokeArguments(unknownScenario)).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
  })

  it('publishes a baseline after immediate consecutive-frame stability', async () => {
    const window = fakeWindow(undefined, 2)
    const captureSettle = vi.fn(settleCaptureImmediately)
    const publish = vi.fn(async (_output, artifacts) => {
      expect(window.isDestroyed()).toBe(true)
      expect(artifacts.map(({ name }: { name: string }) => name)).toEqual([
        '01-baseline.png',
        'result.json',
      ])
      expect(JSON.parse(artifacts[1].bytes.toString('utf8')).profile).toEqual({
        browserZoom: 0.5,
        contentHeight: 360,
        contentWidth: 640,
        cssHeight: 720,
        cssWidth: 1280,
        devicePixelRatio: 1,
        deviceScale: 2,
        name: 'dpr2',
      })
    })
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence' },
          window,
        },
        { captureSettle, focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })
    expect(window.setContentSize).toHaveBeenCalledWith(1280, 720, false)
    expect(window.setContentSize).toHaveBeenCalledWith(640, 360, false)
    expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(window.setMinimumSize).toHaveBeenCalledWith(1, 1)
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(2)
    expect(captureSettle).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('fails closed when requested browser zoom is not applied', async () => {
    const window = fakeWindow()
    window.webContents.setZoomFactor.mockImplementation(() => undefined)
    const publish = vi.fn()

    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', profile: smoke.layoutSmokeProfile('125') },
          window,
        },
        { focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: false })

    expect(publish).not.toHaveBeenCalled()
  })

  it('fails closed when the requested device scale is not observed', async () => {
    const window = fakeWindow(undefined, 1)
    const publish = vi.fn()

    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', profile: smoke.layoutSmokeProfile('dpr2') },
          window,
        },
        { focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: false })

    expect(publish).not.toHaveBeenCalled()
  })

  it('slides the comparison window until a mismatched frame stabilizes', async () => {
    const first = validPng(1280, 720, 1)
    const stable = validPng(1280, 720, 2)
    const candidates = [first, stable, stable]
    const capturePage = vi.fn(async () => {
      const bytes = candidates.shift()!
      return {
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => bytes,
      }
    })
    const window = fakeWindow(capturePage)
    const captureSettle = vi.fn(settleCaptureImmediately)
    const publish = vi.fn(async (_output, artifacts) => {
      expect(artifacts[0].bytes).toEqual(stable)
    })

    await expect(
      smoke.runVisualSmoke(
        { app: {}, config: { output: '/safe/evidence' }, window },
        { captureSettle, focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })

    expect(capturePage).toHaveBeenCalledTimes(3)
    expect(captureSettle).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it.each([
    ['extra window', undefined, (window: any) => [window, fakeWindow()], 0],
    [
      'window destroyed during grace',
      undefined,
      (() => {
        let calls = 0
        return (window: any) => (++calls === 2 && window.destroy(), [window])
      })(),
      2,
    ],
    ['unfrozen bridge', { bridgeFrozen: false }, undefined, 0],
    ['non-function bridge entry', { bridgeFunctions: false }, undefined, 0],
    ['wrong bridge keys', { bridgeKeys: [] }, undefined, 0],
    ['failed IPC round trip', { ipcReady: false }, undefined, 0],
    ['renderer Node access', { nodeAccess: true }, undefined, 0],
  ])('publishes no success for %s', async (_name, rendererOverrides, getWindows, captures) => {
    const window = fakeWindow(undefined, 1, rendererOverrides || {})
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence' },
          getWindows: getWindows ? () => getWindows(window) : undefined,
          window,
        },
        { focus: vi.fn(async () => true), publish, writeFailure },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(captures)
    expect(window.destroy).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
  })

  it('fails closed when no consecutive frame stabilizes within the candidate cap', async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => validPng(1280, 720, index + 1))
    const capturePage = vi.fn(async () => {
      const bytes = candidates.shift()!
      return {
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => bytes,
      }
    })
    const window = fakeWindow(capturePage)
    const captureSettle = vi.fn(settleCaptureImmediately)
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => {
      expect(window.isDestroyed()).toBe(true)
    })

    await expect(
      smoke.runVisualSmoke(
        { app: {}, config: { output: '/safe/evidence' }, window },
        { captureSettle, focus: vi.fn(async () => true), publish, writeFailure },
      ),
    ).resolves.toEqual({ ok: false })

    expect(capturePage).toHaveBeenCalledTimes(5)
    expect(captureSettle).toHaveBeenCalledTimes(4)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('uses trusted input and publishes exact Style-session captures in viewport order', async () => {
    const window = fakeStyleSessionWindow()
    const publish = vi.fn(async (_output, artifacts) => {
      expect(window.isDestroyed()).toBe(true)
      expect(artifacts.map(({ name }: { name: string }) => name)).toEqual([
        '01-project-lyrics-1280x720.png',
        '02-project-lyrics-1440x900.png',
        '03-background-gradient-draft-1280x720.png',
        '04-background-solid-draft-1280x720.png',
        '05-background-solid-applied-1280x720.png',
        '06-title-card-destination-1280x720.png',
        '07-title-card-eyebrow-draft-1280x720.png',
        '08-title-card-artist-draft-1280x720.png',
        '09-title-card-applied-1280x720.png',
        '10-stage-frame-destination-1280x720.png',
        '11-stage-frame-master-off-draft-1280x720.png',
        '12-stage-frame-clock-draft-1280x720.png',
        '13-stage-frame-footer-hidden-draft-1280x720.png',
        '14-stage-frame-applied-1280x720.png',
        '15-lead-vocal-destination-1280x720.png',
        '16-templates-saved-1280x720.png',
        'result.json',
      ])
    })
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        { captureSettle: settleCaptureImmediately, focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })
    const inputEvents = window.webContents.sendInputEvent.mock.calls.map(([event]) => event)
    expect(inputEvents).toHaveLength(167)
    expect(inputEvents.filter(({ type }) => type === 'mouseDown')).toHaveLength(30)
    const expectedKeys = [
      'Tab',
      'Tab',
      'Shift+Tab',
      'Tab',
      'Left',
      'Shift+Tab',
      'Tab',
      'Up',
      'Shift+Tab',
      'Tab',
      'Right',
      'Right',
      'Up',
      'Down',
      'Tab',
      'Tab',
      'Escape',
      'Tab',
      'Tab',
      'Tab',
      'Tab',
      'Tab',
      'Tab',
      'Tab',
      'Right',
    ]
    const expectedKeyboardEvents = expectedKeys.flatMap((key) => [
      `keyDown:${key}`,
      ...(key === 'Enter' ? [`char:${key}`] : []),
      `keyUp:${key}`,
    ])
    const expectedTemplateEvents = [...smoke.STYLE_TEMPLATE_NAME].flatMap((key) => [
      `keyDown:${key}`,
      `char:${key}`,
      `keyUp:${key}`,
    ])
    expect(
      inputEvents
        .filter(({ type }) => ['keyDown', 'char', 'keyUp'].includes(type))
        .map(
          ({ keyCode, modifiers, type }) =>
            `${type}:${modifiers?.includes('shift') ? 'Shift+' : ''}${keyCode}`,
        ),
    ).toEqual([...expectedKeyboardEvents, ...expectedTemplateEvents])
    const scripts = window.webContents.executeJavaScript.mock.calls.map(([script]) => script)
    const recorderScripts = scripts.filter((script) =>
      script.includes('__oksStyleKeyboardRecorder'),
    )
    expect(recorderScripts).toHaveLength(2)
    expect(recorderScripts[0]).toContain("addEventListener('focusin'")
    expect(recorderScripts[1]).toContain('delete globalThis[storage]')
    expect(
      scripts.flatMap((script) => script.match(/const action = "([^"]+)"/u)?.[1] ?? []),
    ).toEqual([
      'lyrics',
      'stage',
      'cancel',
      'background',
      'solid',
      'apply',
      'title',
      'eyebrow-visibility',
      'artist',
      'artist-visibility',
      'move-selected',
      'apply-title',
      'stage',
      'stage-off',
      'stage-on',
      'clock',
      'clock-face',
      'footer',
      'footer-visibility',
      'apply-stage',
      'lead',
      'sync-aid',
      'templates',
      'template-name',
      'save-template',
    ])
    const lyricsReset = scripts.findIndex((script) => script.includes('const action = "lyrics"'))
    const resizedLyricsReadiness = scripts.findIndex(
      (script, index) =>
        index > lyricsReset && script.includes('const expected = {"height":720,"width":1280}'),
    )
    expect(lyricsReset).toBeGreaterThan(-1)
    expect(resizedLyricsReadiness).toBeGreaterThan(lyricsReset)
    expect(scripts[resizedLyricsReadiness]).toContain('"project-lyrics"')
    expect(scripts.filter((script) => script === smoke.STYLE_TARGET_SCRIPT)).toHaveLength(5)
    expect(window.setContentSize.mock.calls).toContainEqual([1280, 720, false])
    expect(window.setContentSize.mock.calls).toContainEqual([1440, 900, false])
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(32)
    expect(smoke.STYLE_TARGET_SCRIPT).not.toContain('.click(')
    expect(smoke.STYLE_TARGET_SCRIPT).not.toContain('setTimeout')
    const readinessScript = smoke.projectLyricsReadinessScript({ height: 720, width: 1280 })
    for (const contract of [
      '.style-workspace[role="dialog"]',
      'Global lyric typeface',
      'Lyrics design preview',
      'data-logical-stage',
      'document.fonts',
      'document.images',
      'MutationObserver',
      'ResizeObserver',
    ])
      expect(readinessScript).toContain(contract)
    expect(readinessScript).not.toContain('setTimeout')
  })

  it('returns to the canonical viewport before finding the trusted Lyrics action target', async () => {
    const lyricsTarget = { ...styleActionTarget('lyrics'), height: 900, width: 1440 }
    const window = fakeStyleSessionWindow({ lyricsTarget })
    const setContentSize = window.setContentSize.getMockImplementation()
    let resized = false
    window.setContentSize.mockImplementation((width: number, height: number, animate: boolean) => {
      setContentSize(width, height, animate)
      if (width === 1440 && height === 900) resized = true
      if (resized && width === 1280 && height === 720) {
        lyricsTarget.height = 720
        lyricsTarget.width = 1280
      }
    })

    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish: vi.fn(),
        },
      ),
    ).resolves.toEqual({ ok: true })
    expect(lyricsTarget).toMatchObject({ height: 720, width: 1280 })
  })

  it('waits for an action target whose semantic state follows a trusted input event', async () => {
    const window = fakeStyleSessionWindow({ clockPending: true })

    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', scenario: smoke.STYLE_SESSION_SCENARIO },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish: vi.fn(),
        },
      ),
    ).resolves.toEqual({ ok: true })
    const scripts = window.webContents.executeJavaScript.mock.calls.map(([script]) => script)
    expect(scripts.filter((script) => script.includes('const action = "clock"'))).toHaveLength(2)
  })

  it('uses browser-zoomed Style target coordinates for trusted input', async () => {
    const window = fakeStyleSessionWindow({
      displayScale: 2,
      target: {
        boundsHeight: 24,
        boundsWidth: 60,
        height: 720,
        href: smoke.PACKAGED_APP_URL,
        readyState: 'complete',
        width: 1280,
        x: 121,
        y: 21,
      },
    })
    const publish = vi.fn(async () => undefined)

    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        { captureSettle: settleCaptureImmediately, focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })

    expect(window.webContents.sendInputEvent).toHaveBeenCalledTimes(167)
    expect(window.webContents.sendInputEvent.mock.calls[0][0]).toEqual({
      type: 'mouseMove',
      x: 61,
      y: 11,
    })
    expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(window.setContentSize.mock.calls).toContainEqual([640, 360, false])
    expect(window.setContentSize.mock.calls).toContainEqual([720, 450, false])
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(32)
    expect(publish).toHaveBeenCalledOnce()
  })

  it('rejects unsupported display scales and out-of-bounds trusted input coordinates', () => {
    const contents = { sendInputEvent: vi.fn() }
    const target = {
      boundsHeight: 24,
      boundsWidth: 60,
      height: 720,
      href: smoke.PACKAGED_APP_URL,
      readyState: 'complete',
      width: 1280,
      x: 120,
      y: 20,
    }

    expect(() => smoke.sendTrustedStyleActivation(contents, target, 0)).toThrow(
      'VISUAL_SMOKE_ACTIVATION_INVALID',
    )
    expect(() => smoke.sendTrustedStyleActivation(contents, { ...target, x: 1279 }, 2)).toThrow(
      'VISUAL_SMOKE_ACTIVATION_INVALID',
    )
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
  })

  it('fails closed without capture when the trusted Style target is missing', async () => {
    const window = fakeStyleSessionWindow({ target: null })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.sendInputEvent).not.toHaveBeenCalled()
    expect(window.webContents.capturePage).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('uses a deadline only to fail closed when semantic readiness never arrives', async () => {
    const window = fakeStyleSessionWindow({ readiness: new Promise(() => undefined) })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          readinessTimeoutMs: 5,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.sendInputEvent).toHaveBeenCalledTimes(3)
    expect(window.webContents.capturePage).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('publishes no partial scenario evidence when the second capture is invalid', async () => {
    const window = fakeStyleSessionWindow()
    window.webContents.capturePage
      .mockReset()
      .mockResolvedValueOnce({
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => validPng(1280, 720),
      })
      .mockResolvedValueOnce({
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => validPng(1280, 720),
      })
      .mockResolvedValueOnce({
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => validPng(1280, 720),
      })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(3)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('rejects an incomplete Lead Vocal readiness result before its capture', async () => {
    const window = fakeStyleSessionWindow({
      leadState: { height: 720, resourcesReady: true, width: 1280 },
    })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', scenario: smoke.STYLE_SESSION_SCENARIO },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(28)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
  })

  it('rejects an incomplete saved-template readiness result before its capture', async () => {
    const window = fakeStyleSessionWindow({
      templateState: {
        height: 720,
        name: smoke.STYLE_TEMPLATE_NAME,
        resourcesReady: true,
        width: 1280,
      },
    })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', scenario: smoke.STYLE_SESSION_SCENARIO },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(30)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
  })

  it('waits for the settled template form before focusing or typing its name', async () => {
    const window = fakeStyleSessionWindow({
      templateFormState: { height: 720, resourcesReady: true, width: 1280 },
    })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', scenario: smoke.STYLE_SESSION_SCENARIO },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    const scripts = window.webContents.executeJavaScript.mock.calls.map(([script]) => script)
    expect(
      scripts.flatMap((script) => script.match(/const action = "([^"]+)"/u)?.[1] ?? []),
    ).toEqual(expect.arrayContaining(['templates']))
    expect(scripts).not.toContainEqual(expect.stringContaining('const action = "template-name"'))
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(30)
    expect(window.webContents.sendInputEvent).toHaveBeenCalledTimes(134)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
  })

  it('types only the fixed template name through trusted input events', () => {
    const contents = { sendInputEvent: vi.fn() }
    smoke.sendTrustedStyleText(contents, smoke.STYLE_TEMPLATE_NAME)
    expect(contents.sendInputEvent).toHaveBeenCalledTimes(smoke.STYLE_TEMPLATE_NAME.length * 3)
    expect(() => smoke.sendTrustedStyleText(contents, 'other template')).toThrow(
      'VISUAL_SMOKE_ACTIVATION_INVALID',
    )
  })

  it('requires native-valid spinner-free timing with an explicit 100 ms Arrow contract', async () => {
    const readiness = smoke.projectLyricsReadinessScript(
      { height: 720, width: 1280 },
      { kind: 'lead-vocal' },
    )
    const styles = await readFile(new URL('../src/video-style.css', import.meta.url), 'utf8')
    expect(readiness).toContain("input.step !== 'any'")
    expect(readiness).toContain("input.dataset.stepMs !== '100'")
    expect(readiness).toContain("input.min !== '0' || input.max !== '60000'")
    expect(readiness).toContain("getComputedStyle(input).appearance !== 'textfield'")
    expect(readiness).toContain('input.validity.stepMismatch || !input.checkValidity()')
    expect(readiness).toContain('Arrow Up or Arrow Down')
    expect(styles).toContain(`.vocal-timing-input input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}`)
    expect(styles).toContain(`.vocal-timing-input input[type='number']::-webkit-inner-spin-button,
.vocal-timing-input input[type='number']::-webkit-outer-spin-button {
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
}`)
  })

  it('publishes no authoritative evidence for duplicate same-size Style captures', async () => {
    const window = fakeStyleSessionWindow({}, (width, height) => validPng(width, height))
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence', scenario: smoke.STYLE_SESSION_SCENARIO },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(32)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
  })

  it('publishes only a fixed failure and tears down when capture throws secret data', async () => {
    const window = fakeWindow(
      vi.fn(async () => {
        throw new Error('/private/song.mp3')
      }),
    )
    const writeFailure = vi.fn(async () => {
      expect(window.isDestroyed()).toBe(true)
    })
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence' },
          window,
        },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
    expect(JSON.stringify(writeFailure.mock.calls)).not.toContain('/private/song.mp3')
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('cannot publish or report success when window teardown throws', async () => {
    const window = fakeWindow()
    window.destroy.mockImplementation(() => {
      throw new Error('destroyed BrowserWindow access')
    })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)

    await expect(
      smoke.runVisualSmoke(
        { app: {}, config: { output: '/safe/evidence' }, window },
        {
          captureSettle: settleCaptureImmediately,
          focus: vi.fn(async () => true),
          publish,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
  })

  it.each(['uncaughtException', 'unhandledRejection'])(
    'consumes a teardown %s without a default throw or success publication',
    async (fatalEvent) => {
      const stderr = { write: vi.fn(() => true) }
      const processLike = Object.assign(new EventEmitter(), { stderr })
      const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
      const window = fakeWindow()
      const publish = vi.fn()
      const writeFailure = vi.fn(async () => undefined)
      const secret = '/private/teardown-stack'

      await expect(
        smoke.runVisualSmoke(
          { app: {}, config: { output: '/safe/evidence' }, fatalObserver, window },
          {
            captureSettle: settleCaptureImmediately,
            focus: vi.fn(async () => true),
            publish,
            settle: vi.fn(async () => {
              expect(() => processLike.emit(fatalEvent, new Error(secret))).not.toThrow()
            }),
            writeFailure,
          },
        ),
      ).resolves.toEqual({ ok: false })
      expect(publish).not.toHaveBeenCalled()
      expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
        code: 'VISUAL_SMOKE_FAILED',
        ok: false,
      })
      expect(stderr.write).toHaveBeenCalledWith(smoke.FATAL_DIAGNOSTIC)
      expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(secret)
      fatalObserver.dispose()
      expect(processLike.listenerCount('uncaughtException')).toBe(0)
      expect(processLike.listenerCount('unhandledRejection')).toBe(0)
    },
  )

  it.each([
    'Uncaught TypeError: renderer probe',
    'Uncaught (in promise) TypeError: renderer probe',
  ])('fails closed on a sanitized renderer console error: %s', (message) => {
    const stderr = { write: vi.fn(() => true) }
    const processLike = Object.assign(new EventEmitter(), { stderr })
    const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
    const contents = fakeRendererContents()
    fatalObserver.observeRenderer(contents)

    contents.emit('console-message', {
      level: 'error',
      message,
      sourceId: '/private/renderer-source.js',
    })

    expect(fatalObserver.hasFatal()).toBe(true)
    expect(stderr.write).toHaveBeenCalledWith(smoke.FATAL_DIAGNOSTIC)
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(message)
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain('/private/renderer-source.js')
    fatalObserver.dispose()
    expect(contents.listenerCount('console-message')).toBe(0)
    expect(processLike.listenerCount('uncaughtException')).toBe(0)
    expect(processLike.listenerCount('unhandledRejection')).toBe(0)
  })

  it.each([
    ['console-message', { level: 'error' }],
    ['render-process-gone', { reason: 'crashed' }],
    ['unresponsive', undefined],
    ['preload-error', undefined],
    ['did-fail-load', undefined],
  ])('fails closed on renderer %s', (event, details) => {
    const stderr = { write: vi.fn(() => true) }
    const processLike = Object.assign(new EventEmitter(), { stderr })
    const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
    const contents = fakeRendererContents()
    fatalObserver.observeRenderer(contents)

    contents.emit(event, {}, details)

    expect(fatalObserver.hasFatal()).toBe(true)
    fatalObserver.dispose()
    expect(contents.listenerCount(event)).toBe(0)
  })

  it('ignores clean renderer console traffic and disposes safely after WebContents destruction', () => {
    const stderr = { write: vi.fn(() => true) }
    const processLike = Object.assign(new EventEmitter(), { stderr })
    const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
    const contents = fakeRendererContents()
    fatalObserver.observeRenderer(contents)

    contents.emit('console-message', {
      level: 'info',
      message: 'Uncaught TypeError appears only as quoted informational text',
    })
    contents.emit('console-message', {}, 2, 'Uncaught (in promise) appears only in a warning')
    contents.emit('render-process-gone', {}, { reason: 'clean-exit' })

    expect(fatalObserver.hasFatal()).toBe(false)
    expect(stderr.write).not.toHaveBeenCalled()
    contents.destroy()
    expect(() => fatalObserver.dispose()).not.toThrow()
    expect(fatalObserver.hasFatal()).toBe(false)
  })

  it('routes smoke mode through the built protocol without weakening window security', async () => {
    const source = await readFile(join(process.cwd(), 'electron/main.cjs'), 'utf8')
    const startup = await readFile(join(process.cwd(), 'electron/visual-smoke-startup.cjs'), 'utf8')
    const windowSecurity = await readFile(
      join(process.cwd(), 'electron/window-security.cjs'),
      'utf8',
    )
    expect(source.indexOf('prepareVisualSmokeStartup({')).toBeLessThan(
      source.indexOf('requestSingleInstanceLock'),
    )
    expect(source.indexOf('prepareVisualSmokeStartup({')).toBeLessThan(
      source.indexOf('const styleTemplateStore = createStyleTemplateStore'),
    )
    expect(source).toContain('app.isPackaged || visualSmokeConfig !== null')
    expect(startup).toMatch(
      /module\.configureVisualSmokeBeforeReady\(\s*app,\s*module\.parseVisualSmokeArguments\(argv\),\s*\)/,
    )
    expect(source).toContain('await window.loadURL(PACKAGED_APP_URL)')
    expect(source).toContain('getWindows: () => BrowserWindow.getAllWindows()')
    expect(startup).toContain('module.installVisualSmokeFatalObserver(processHandle)')
    expect(
      source.indexOf('visualSmokeFatalObserver.observeRenderer(window.webContents)'),
    ).toBeLessThan(source.indexOf('await window.loadURL(PACKAGED_APP_URL)'))
    expect(source).toContain('createNativeCloseOwnershipCleanup(')
    expect(source).toContain('clearNativeCloseOwnershipAfterWindowClosed()')
    for (const invariant of [
      'contextIsolation: true',
      'nodeIntegration: false',
      'sandbox: true',
      'webSecurity: true',
      'allowRunningInsecureContent: false',
      'enableLargerThanScreen: visualSmokeConfig !== null',
    ])
      expect(windowSecurity).toContain(invariant)
  })
})
