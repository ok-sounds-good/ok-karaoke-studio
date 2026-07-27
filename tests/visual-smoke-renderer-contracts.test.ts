import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const contracts = require('../electron/visual-smoke-renderer-contracts.cjs')
const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

afterEach(() => vi.useRealTimers())

function rendererState(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function styleTarget(overrides: Record<string, unknown> = {}) {
  return {
    boundsHeight: 24,
    boundsWidth: 60,
    height: 720,
    href: contracts.PACKAGED_APP_URL,
    readyState: 'complete',
    width: 1280,
    x: 100,
    y: 100,
    ...overrides,
  }
}

function openingTimingStyleTarget(overrides: Record<string, unknown> = {}) {
  return {
    ...styleTarget({
      boundsHeight: 24,
      boundsWidth: 80,
      x: 200,
      y: 200,
    }),
    action: 'opening-timing',
    openingTimingBelowFooterBoundary: true,
    openingTimingCenterInViewport: true,
    openingTimingInDestinationPanel: true,
    openingTimingPanelTopBoundary: 60,
    openingTimingPanelTop: 60,
    openingTimingPanelLeft: 20,
    openingTimingPanelRight: 900,
    openingTimingPanelBottom: 500,
    openingTimingPanelId: 'project-style-title-card-panel',
    openingTimingCenterX: 200,
    openingTimingCenterY: 200,
    openingTimingTitleTabSelected: true,
    ...overrides,
  }
}

function layoutReachabilityState(
  viewport: { height: number; width: number } = { height: 720, width: 1280 },
  includeStyleTargets = false,
) {
  const targets = includeStyleTargets
    ? contracts.LAYOUT_REACHABILITY_SELECTORS.style
    : contracts.LAYOUT_REACHABILITY_SELECTORS.base
  const controls = Object.fromEntries(
    targets.map((target) => [
      target.name,
      {
        clippedByOverflow: false,
        clippedByOverflowAfterFocus: false,
        exists: true,
        focusScroll: target.focusScroll === true,
        focused: target.focusScroll === true,
        focusedInScrollport: true,
        focusedInViewport: true,
        inViewport: true,
        optional: target.optional,
        required: target.required,
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
    controlNames: targets.map(({ name }) => name),
    controls,
    valid: true,
    windowHeight: viewport.height,
    windowWidth: viewport.width,
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
  }
}

function preloadBridgeKeys() {
  const exposed: { api?: Record<string, unknown>; name?: string } = {}
  runInNewContext(source('electron/preload.cjs'), {
    require: (specifier: string) => {
      if (specifier !== 'electron') throw new Error(`Unexpected require: ${specifier}`)
      return {
        contextBridge: {
          exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
            exposed.name = name
            exposed.api = api
          },
        },
        ipcRenderer: {
          invoke: async () => undefined,
          on: () => {},
          removeListener: () => {},
        },
      }
    },
  })
  expect(exposed.name).toBe('studio')
  expect(exposed.api).toBeDefined()
  return Object.keys(exposed.api ?? {}).sort()
}

describe('visual smoke renderer contracts', () => {
  it('requires a lead-in region to fill the responsive waveform below the ruler', () => {
    for (const leadHeight of [76, 62, 48]) {
      const valid = {
        leadHeight,
        leadTop: 128,
        rulerBottom: 128,
        valid: true,
        waveformBottom: 128 + leadHeight,
        waveformTop: 128,
      }
      expect(contracts.validTimelineLeadInGeometryState(valid)).toBe(true)
      expect(
        contracts.validTimelineLeadInGeometryState({ ...valid, leadHeight: leadHeight - 2 }),
      ).toBe(false)
    }
    expect(contracts.timelineLeadInGeometryScript()).toContain('timeline-lead-in')
    const timelineCss = source('src/timeline.css')
    expect(timelineCss).toContain('--timeline-waveform-height: 76px')
    expect(timelineCss).toContain('--timeline-waveform-height: 62px')
    expect(timelineCss).toContain('--timeline-waveform-height: 48px')
    expect(timelineCss).toContain('height: var(--timeline-waveform-height)')
  })

  it('matches the bridge contract to the real preload API', () => {
    expect(preloadBridgeKeys()).toEqual(contracts.STUDIO_BRIDGE_KEYS)
  })

  it('accepts only the deterministic renderer state at the packaged origin', () => {
    expect(contracts.validRendererState(rendererState())).toBe(true)
    expect(contracts.validRendererState(rendererState({ nodeAccess: true }))).toBe(false)
    expect(contracts.validRendererState(rendererState({ bridgeKeys: ['exportVideo'] }))).toBe(false)
    expect(
      contracts.validRendererState(rendererState({ href: 'https://untrusted.invalid/' })),
    ).toBe(false)
  })

  it('rejects malformed or out-of-bounds trusted interaction targets', () => {
    expect(contracts.validStyleTarget(styleTarget())).toBe(true)
    expect(contracts.validStyleActionTarget({ ...styleTarget(), action: 'stage' }, 'stage')).toBe(
      true,
    )
    expect(
      contracts.validStyleActionTarget({ ...styleTarget(), action: 'background' }, 'stage'),
    ).toBe(false)
    expect(contracts.validStyleTarget(styleTarget({ x: 1280 }))).toBe(false)
    expect(contracts.validStyleTarget(styleTarget({ boundsWidth: 0 }))).toBe(false)
    expect(contracts.validStyleTarget(null)).toBe(false)
  })

  it('fails closed when a readiness result is incomplete or has unexpected media state', () => {
    const projectLyrics = {
      fontFamily: 'System UI',
      fontSize: '48px',
      fontStatus: 'loaded',
      height: 720,
      href: contracts.PACKAGED_APP_URL,
      readyState: 'complete',
      resourcesReady: true,
      stageHeight: 360,
      stageWidth: 640,
      typeface: 'System UI',
      width: 1280,
    }
    const background = {
      applied: false,
      css: 'linear-gradient(145deg, rgb(50, 34, 66), rgb(30, 22, 41))',
      gradientEndColor: '#1e1629',
      gradientStartColor: '#322242',
      height: 720,
      mode: 'gradient',
      resourcesReady: true,
      solidColor: '#21182d',
      stageHeight: 360,
      stageWidth: 640,
      width: 1280,
    }
    const viewport = { height: 720, width: 1280 }

    expect(contracts.validProjectLyricsState(projectLyrics, viewport)).toBe(true)
    expect(
      contracts.validProjectLyricsState({ ...projectLyrics, resourcesReady: false }, viewport),
    ).toBe(false)
    expect(contracts.validBackgroundState(background, viewport, 'gradient')).toBe(true)
    expect(
      contracts.validBackgroundState(
        { ...background, gradientEndColor: 'blue' },
        viewport,
        'gradient',
      ),
    ).toBe(false)
    expect(
      contracts.validLeadVocalState(
        {
          controls: 4,
          height: 720,
          resourcesReady: true,
          stageHeight: 360,
          stageWidth: 640,
          width: 1280,
          wordProgress: ['100%', '50%', '0%', '0%', '0%', '0%', '0%', '0%'],
        },
        viewport,
      ),
    ).toBe(true)
    expect(
      contracts.validLeadVocalState(
        {
          controls: 4,
          height: 720,
          resourcesReady: true,
          stageHeight: 360,
          stageWidth: 640,
          width: 1280,
          wordProgress: ['0%', '0%', '0%', '0%', '0%', '0%', '0%', '0%'],
        },
        viewport,
      ),
    ).toBe(false)
    const template = {
      controls: 5,
      height: 720,
      name: contracts.STYLE_TEMPLATE_NAME,
      resourcesReady: true,
      stageHeight: 360,
      stageWidth: 640,
      status: `Saved “${contracts.STYLE_TEMPLATE_NAME}”.`,
      width: 1280,
    }
    expect(contracts.validStyleTemplateState(template, viewport)).toBe(true)
    expect(contracts.validStyleTemplateState({ ...template, controls: 4 }, viewport)).toBe(false)
    const templateForm = {
      controls: 2,
      height: 720,
      nameReady: true,
      resourcesReady: true,
      stageHeight: 360,
      stageWidth: 640,
      width: 1280,
    }
    expect(contracts.validStyleTemplateFormState(templateForm, viewport)).toBe(true)
    expect(
      contracts.validStyleTemplateFormState({ ...templateForm, nameReady: false }, viewport),
    ).toBe(false)
  })

  it('validates layout reachability state and optional style layout control behavior', () => {
    const viewport = { height: 720, width: 1280 }
    const baseState = layoutReachabilityState(viewport)
    expect(contracts.validLayoutReachabilityState(baseState, viewport)).toBe(true)
    expect(
      contracts.validLayoutReachabilityState(layoutReachabilityState(viewport, true), viewport, {
        includeStyleTargets: true,
      }),
    ).toBe(true)
    const styleStateWithoutWorkspace = layoutReachabilityState(viewport, true)
    delete styleStateWithoutWorkspace.workspace
    expect(
      contracts.validLayoutReachabilityState(styleStateWithoutWorkspace, viewport, {
        includeStyleTargets: true,
      }),
    ).toBe(true)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          controls: {
            ...baseState.controls,
            saveProject: {
              ...baseState.controls.saveProject,
              exists: false,
            },
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            dividerValue: 45,
            dividerValueRaw: '45',
            valueText: '45% Stage Monitor height; 55% Lyric Timing height',
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            valueText: '44% Stage Monitor height; 55% Lyric Timing height',
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            geometry: { ...baseState.workspace.geometry, stageHeight: 500 },
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            geometry: { ...baseState.workspace.geometry, rootHeight: 900 },
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            maximum: 101,
            maximumRaw: '101',
          },
        },
        viewport,
      ),
    ).toBe(false)
    for (const rawKey of ['minimumRaw', 'maximumRaw', 'dividerValueRaw']) {
      const { [rawKey]: _missing, ...workspaceWithoutRaw } = baseState.workspace
      expect(
        contracts.validLayoutReachabilityState(
          {
            ...baseState,
            workspace: workspaceWithoutRaw,
          },
          viewport,
        ),
      ).toBe(false)
      for (const raw of [undefined, null, '', 'Infinity', 'not-a-number']) {
        expect(
          contracts.validLayoutReachabilityState(
            {
              ...baseState,
              workspace: { ...baseState.workspace, [rawKey]: raw },
            },
            viewport,
          ),
        ).toBe(false)
      }
    }
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: { ...baseState.workspace, minimum: 43 },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            minimum: 56,
            minimumRaw: '56',
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          workspace: {
            ...baseState.workspace,
            dividerValue: 57,
            dividerValueRaw: '57',
          },
        },
        viewport,
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          windowHeight: 719,
        },
        viewport,
      ),
    ).toBe(false)
    const optionalStyleState = layoutReachabilityState(viewport, true)
    optionalStyleState.controls.previewTime = {
      ...optionalStyleState.controls.previewTime,
      exists: false,
      optional: true,
    }
    expect(
      contracts.validLayoutReachabilityState(optionalStyleState, viewport, {
        includeStyleTargets: true,
      }),
    ).toBe(true)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...optionalStyleState,
          controls: {
            ...optionalStyleState.controls,
            styleSession: { ...optionalStyleState.controls.styleSession, exists: false },
          },
        },
        viewport,
        { includeStyleTargets: true },
      ),
    ).toBe(false)
    expect(
      contracts.validLayoutReachabilityState(
        {
          ...baseState,
          controlNames: baseState.controlNames.slice(0, -1),
        },
        viewport,
      ),
    ).toBe(false)
  })

  it('builds layout reachability scripts from deterministic selector metadata', () => {
    const viewport = { height: 720, width: 1280 }
    const script = contracts.layoutReachabilityScript(viewport)
    expect(script).toContain('"name":"style"')
    expect(script).toContain('const expected =')
    expect(script).toContain('focusScroll')
    expect(script).toContain('focusedInViewport')
    expect(script).not.toContain('scrollIntoView')
    expect(script).toContain('scrollportBefore')
    expect(script).toContain('clippedByOverflow')
    expect(script).toContain('const viewport')
    expect(script).toContain('nearestScrollport.scrollTop = scrollportBefore.scrollTop')
    expect(script).toContain("getAttribute('aria-valuetext')")
    expect(script).toContain('workspaceGeometry')
  })

  it('uses the selected Lyrics destination as the trusted Lead Vocal entry point', () => {
    const script = contracts.styleSessionActionScript('lead')
    expect(script).toContain('lead: projectTab')
    expect(script).toContain("lead: projectTab?.getAttribute('aria-selected') === 'true'")
    expect(script).not.toContain("leadVocalTab?.getAttribute('aria-selected') === 'false'")
  })

  it('uses the visible Lead Vocal content rather than the hidden footprint', () => {
    const script = contracts.projectLyricsReadinessScript(
      { height: 720, width: 1280 },
      { kind: 'lead-vocal' },
    )
    expect(script).toContain(
      '\'[data-design-preview="lead-vocal"] [data-lyric-object-content] .stage-line\'',
    )
    expect(script).toContain("JSON.stringify(['100%', '50%', '0%'")
    expect(
      contracts.validLeadVocalState(
        {
          controls: 4,
          height: 720,
          resourcesReady: true,
          stageHeight: 360,
          stageWidth: 640,
          width: 1280,
          wordProgress: ['0%', '0%', '0%', '0%', '0%', '0%', '0%', '0%'],
        },
        { height: 720, width: 1280 },
      ),
    ).toBe(false)
  })

  it('treats keyboard assertions as exact contracts, including every selection change', () => {
    const keyboard = {
      changes: contracts.STYLE_KEY_CHANGES.map((role: string) => ({
        active: true,
        checked: true,
        checkedCount: 1,
        role,
      })),
      clean: true,
      closed: false,
      focus: contracts.STYLE_KEY_FOCUS,
      redoDisabled: true,
      undoDisabled: true,
    }
    expect(contracts.validStyleKeyboardState(keyboard)).toBe(true)
    expect(contracts.validStyleKeyboardState({ ...keyboard, closed: true })).toBe(false)
    expect(contracts.validStyleKeyboardState({ ...keyboard, focus: [] })).toBe(false)
    expect(
      contracts.validStyleKeyboardState({ ...keyboard, changes: keyboard.changes.slice(1) }),
    ).toBe(false)
  })

  it('requires each Style destination to retain its visible scroll position and tab focus', () => {
    const layout = {
      activePanel: 'style-title-card-panel',
      activeTab: 'title-card',
      clientHeight: 420,
      contentBounded: true,
      focusOwnsDestination: true,
      headingBounded: true,
      hiddenPanelFocus: false,
      panelBounded: true,
      scrollHeight: 720,
      scrollTop: contracts.STYLE_DESTINATION_SCROLL_TOPS['title-card'],
      selected: true,
    }
    expect(
      contracts.validStyleDestinationLayout(
        layout,
        'title-card',
        contracts.STYLE_DESTINATION_SCROLL_TOPS['title-card'],
      ),
    ).toBe(true)
    expect(
      contracts.validStyleDestinationLayout(
        { ...layout, hiddenPanelFocus: true },
        'title-card',
        contracts.STYLE_DESTINATION_SCROLL_TOPS['title-card'],
      ),
    ).toBe(false)
    expect(
      contracts.styleDestinationLayoutScript(
        'templates',
        contracts.STYLE_DESTINATION_SCROLL_TOPS.templates,
        true,
      ),
    ).toContain('panel.scrollTop = expectedScrollTop')
  })

  it('waits for a cancelled Style dialog to unmount before targeting the header button again', () => {
    expect(contracts.STYLE_TARGET_SCRIPT).toContain(
      'document.querySelector(\'.style-workspace[role="dialog"]\')',
    )
    expect(contracts.STYLE_TARGET_SCRIPT).toContain(
      'if (workspace || !(target instanceof HTMLButtonElement)',
    )
  })

  it('permits non-Lyrics destination tabs from any other unselected Style destination', () => {
    const action = contracts.styleSessionActionScript('templates')
    expect(action).toContain(
      "background: workspace instanceof HTMLElement && backgroundTab?.getAttribute('aria-selected') === 'false',",
    )
    expect(action).toContain(
      "title: workspace instanceof HTMLElement && titleTab?.getAttribute('aria-selected') === 'false',",
    )
    expect(action).toContain(
      "stage: workspace instanceof HTMLElement && stageTab?.getAttribute('aria-selected') === 'false',",
    )
    expect(action).toContain(
      "templates: workspace instanceof HTMLElement &&\n        templatesTab?.getAttribute('aria-selected') === 'false',",
    )
  })

  it('targets the Opening lead-in control only when the title tab is selected', () => {
    const action = contracts.styleSessionActionScript('opening-timing')
    expect(action).toContain('Opening lead-in seconds')
    expect(action).toContain("'opening-timing'")
    expect(action).toContain('titleTab?.getAttribute')
    expect(action).toContain('openingTiming instanceof HTMLInputElement')
    expect(action).toContain('.style-destination-panel')
    expect(action).toContain('.style-editor__actions')
    expect(action).toContain('openingTimingPanel')
    expect(action).toContain('openingTimingBelowFooterBoundary')
    expect(action).toContain('openingTimingInDestinationPanel')
  })

  it('fails invalid opening timing action state shapes in validator', () => {
    expect(contracts.validStyleActionTarget(openingTimingStyleTarget(), 'opening-timing')).toBe(
      true,
    )
    expect(
      contracts.validStyleActionTarget(
        { ...openingTimingStyleTarget(), boundsHeight: 0 },
        'opening-timing',
      ),
    ).toBe(false)
    expect(
      contracts.validStyleActionTarget(
        {
          ...openingTimingStyleTarget(),
          openingTimingTitleTabSelected: false,
        },
        'opening-timing',
      ),
    ).toBe(false)
    expect(
      contracts.validStyleActionTarget(
        {
          ...openingTimingStyleTarget(),
          openingTimingInDestinationPanel: false,
        },
        'opening-timing',
      ),
    ).toBe(false)
    expect(
      contracts.validStyleActionTarget(
        {
          ...openingTimingStyleTarget(),
          openingTimingPanelId: 'project-style-lyrics-panel',
        },
        'opening-timing',
      ),
    ).toBe(false)
    expect(
      contracts.validStyleActionTarget(
        {
          ...openingTimingStyleTarget(),
          openingTimingBelowFooterBoundary: false,
        },
        'opening-timing',
      ),
    ).toBe(false)
    expect(
      contracts.validStyleActionTarget(
        {
          ...openingTimingStyleTarget(),
          openingTimingCenterInViewport: false,
        },
        'opening-timing',
      ),
    ).toBe(false)
  })

  it('uses the unified lyric design preview while editing background style', () => {
    expect(
      contracts.projectLyricsReadinessScript(
        { height: 720, width: 1280 },
        {
          kind: 'background',
          mode: 'gradient',
        },
      ),
    ).toContain('[aria-label="Lyrics design preview"]')
  })

  it('uses a bounded deadline and exposes neither Node authority nor action interpolation', async () => {
    vi.useFakeTimers()
    const pending = contracts.executeBeforeDeadline(() => new Promise(() => {}), 10)
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'VISUAL_SMOKE_READINESS_INVALID',
    })
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    await expect(contracts.executeBeforeDeadline(() => 'ready', 10)).resolves.toBe('ready')
    expect(() => contracts.executeBeforeDeadline(() => 'ready', 0)).toThrow(
      'VISUAL_SMOKE_READINESS_INVALID',
    )

    const action = contracts.styleSessionActionScript('"; globalThis.pwned = true; //')
    const template = contracts.styleTemplateReadinessScript(
      { height: 720, width: 1280 },
      contracts.STYLE_TEMPLATE_NAME,
    )
    const templateForm = contracts.styleTemplateFormReadinessScript({ height: 720, width: 1280 })
    for (const script of [
      contracts.STABLE_RENDERER_SCRIPT,
      contracts.STYLE_TARGET_SCRIPT,
      action,
      template,
      templateForm,
    ])
      expect(script).not.toContain('require(')
    expect(action).not.toContain('const action = "; globalThis.pwned')
    expect(template).not.toContain('window.studio')
    expect(template).toContain('Saved “')
    expect(templateForm).toContain('MutationObserver')
    expect(templateForm).toContain('aria-busy')
  })

  it('validates compact layout reachability across zoom-expected viewport profiles', () => {
    const makeRect = (left: number, top: number, width: number, height: number) => ({
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
    })
    for (const profile of [
      { width: 1280, height: 720, ratio: 1 },
      { width: 1280, height: 720, ratio: 1.25 },
      { width: 1280, height: 720, ratio: 1.5 },
      { width: 1280, height: 720, ratio: 2 },
    ]) {
      const state = layoutReachabilityState({ width: profile.width, height: profile.height })
      expect(
        contracts.validLayoutReachabilityState(state, {
          width: profile.width,
          height: profile.height,
        }),
      ).toBe(true)
    }

    const clipped = layoutReachabilityState({ width: 1280, height: 720 })
    clipped.controls.newProject.clippedByOverflow = true
    clipped.controls.newProject.clippedByOverflowAfterFocus = true
    expect(contracts.validLayoutReachabilityState(clipped, { width: 1280, height: 720 })).toBe(
      false,
    )

    for (const controlName of ['workflow', 'lyricTiming']) {
      const focusRevealed = layoutReachabilityState({ width: 1280, height: 720 })
      focusRevealed.controls[controlName] = {
        ...focusRevealed.controls[controlName],
        clippedByOverflow: true,
        clippedByOverflowAfterFocus: false,
        focused: true,
        focusedInScrollport: true,
        focusedInViewport: true,
        inViewport: true,
      }
      expect(
        contracts.validLayoutReachabilityState(focusRevealed, { width: 1280, height: 720 }),
      ).toBe(false)
    }

    const hidden = layoutReachabilityState({ width: 1280, height: 720 })
    hidden.controls.newProject.scrollportBefore.overflowX = 'hidden'
    expect(contracts.validLayoutReachabilityState(hidden, { width: 1280, height: 720 })).toBe(false)

    const focusRevealed = layoutReachabilityState({ width: 1024, height: 576 })
    focusRevealed.controls.newProject.inViewport = false
    focusRevealed.controls.newProject.focusedInViewport = true
    focusRevealed.controls.newProject.focusedInScrollport = true
    focusRevealed.controls.newProject.scrollportAfter.scrollLeft = 16
    expect(
      contracts.validLayoutReachabilityState(
        focusRevealed,
        { width: 1024, height: 576 },
        {
          requireInitialViewport: false,
        },
      ),
    ).toBe(true)
  })

  it('requires the baseline Opening lead-in control to be reachable', () => {
    const missing = layoutReachabilityState({ width: 1280, height: 720 })
    if (!missing.controls.openingTiming || !missing.controls.openingTiming.required) {
      throw new Error('openingTiming control fixture should be required')
    }
    missing.controls.openingTiming = {
      ...missing.controls.openingTiming,
      clippedByOverflow: false,
      clippedByOverflowAfterFocus: false,
      exists: false,
      visible: false,
      inViewport: false,
    }

    expect(
      contracts.validLayoutReachabilityState(missing, {
        width: 1280,
        height: 720,
      }),
    ).toBe(false)
  })
})
