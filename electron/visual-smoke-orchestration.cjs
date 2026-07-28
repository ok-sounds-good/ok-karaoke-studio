'use strict'

const { parseBoundedPngContainer } = require('./png-validation.cjs')
const { focusSmokeWindow } = require('./smoke-window-focus.cjs')
const {
  BASELINE_SCENARIO,
  STYLE_SESSION_SCENARIO,
  STYLE_SESSION_VIEWPORTS,
  TIMELINE_DENSITY_SCENARIO,
  VIEWPORT,
  createResultArtifacts,
  createScenarioResultArtifacts,
} = require('../scripts/visual-result-validation.cjs')
const {
  PACKAGED_APP_URL,
  STABLE_RENDERER_SCRIPT,
  layoutReachabilityScript,
  timelineLeadInGeometryScript,
  STYLE_KEY_RECORDER_SCRIPT,
  STYLE_KEY_RESULT_SCRIPT,
  STYLE_KEY_SEQUENCE,
  STYLE_DESTINATION_STATE_SCRIPT,
  STYLE_DESTINATION_SCROLL_TOPS,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_TEMPLATE_NAME,
  STYLE_TARGET_SCRIPT,
  TIMELINE_DENSITY_OPEN_TARGET_SCRIPT,
  TIMELINE_DENSITY_TIMING_TARGET_SCRIPT,
  executeBeforeDeadline,
  projectLyricsReadinessScript,
  styleDestinationLayoutScript,
  styleSessionActionScript,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  timelineDensityCaptureStateScript,
  timelineDensityReadinessScript,
  validBackgroundState,
  validLeadVocalState,
  validProjectLyricsState,
  validRendererState,
  validLayoutReachabilityState,
  validTimelineLeadInGeometryState,
  validStageFrameState,
  validStyleActionTarget,
  validStyleDestinationLayout,
  validStyleKeyboardState,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
  validTimelineDensityCaptureState,
  validTimelineDensityOpenTarget,
  validTimelineDensityState,
  validTimelineDensityTimingTarget,
} = require('./visual-smoke-renderer-contracts.cjs')
const { layoutSmokeProfile } = require('./visual-smoke-layout-profiles.cjs')
const { publishArtifactBuffers, writeFreshLauncherFailure } = require('./smoke-artifacts.cjs')

const CAPTURE_STABILITY_CANDIDATE_LIMIT = 5
const CAPTURE_STABILITY_SETTLE_MS = 50
const FATAL_GRACE_MS = 250
const PUBLIC_FAILURE = Object.freeze({ code: 'VISUAL_SMOKE_FAILED', ok: false })

function smokeError(code = 'VISUAL_SMOKE_FAILED') {
  const error = new Error(code)
  error.code = code
  return error
}

function fatalObserved(observer) {
  if (!observer) return false
  try {
    return observer.hasFatal() === true
  } catch {
    return true
  }
}

function settleSmoke() {
  return new Promise((resolve) => setTimeout(resolve, FATAL_GRACE_MS))
}

function settleCapture() {
  return new Promise((resolve) => setTimeout(resolve, CAPTURE_STABILITY_SETTLE_MS))
}

function liveWindow(window) {
  try {
    return Boolean(
      window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed(),
    )
  } catch {
    return false
  }
}

function singleLiveSmokeWindow(window, getWindows) {
  try {
    const windows = getWindows()
    if (!Array.isArray(windows)) return false
    const live = windows.filter((candidate) => liveWindow(candidate))
    return live.length === 1 && live[0] === window
  } catch {
    return false
  }
}

function setExactViewport(window, viewport, displayScale) {
  if (!liveWindow(window)) throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  const expectedContentSize = [viewport.width / displayScale, viewport.height / displayScale]
  if (expectedContentSize.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  window.setContentSize(expectedContentSize[0], expectedContentSize[1], false)
  const observedContentSize = liveWindow(window) ? window.getContentSize() : []
  if (observedContentSize.join(',') !== expectedContentSize.join(',')) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
}

function expectedContentSize(profile) {
  return [profile.contentWidth, profile.contentHeight]
}

function restoreCaptureGeometry(window, contents, state) {
  try {
    if (typeof contents.setZoomFactor === 'function') contents.setZoomFactor(state.zoomFactor)
  } catch {}
  try {
    if (Array.isArray(state.contentSize) && state.contentSize.length === 2)
      window.setContentSize(state.contentSize[0], state.contentSize[1], false)
  } catch {}
}

async function observedCssViewport(contents) {
  const value = await contents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => resolve({ devicePixelRatio: window.devicePixelRatio, height: document.documentElement.clientHeight, width: document.documentElement.clientWidth })))',
    false,
  )
  if (
    !value ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.width <= 0 ||
    value.height <= 0 ||
    !Number.isFinite(value.devicePixelRatio) ||
    value.devicePixelRatio <= 0
  )
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  return Object.freeze({
    devicePixelRatio: value.devicePixelRatio,
    height: value.height,
    width: value.width,
  })
}

function sameViewport(left, right) {
  return Boolean(left && right && left.height === right.height && left.width === right.width)
}

async function applyLayoutProfile(window, profile) {
  if (!liveWindow(window) || !profile) throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  const contents = window.webContents
  const contentSize = expectedContentSize(profile)
  if (typeof contents.setZoomFactor !== 'function')
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  contents.setZoomFactor(profile.browserZoom)
  window.setMinimumSize(1, 1)
  window.setContentSize(contentSize[0], contentSize[1], false)
  if (window.getContentSize().join(',') !== contentSize.join(','))
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  const browserZoom = contents.getZoomFactor?.()
  const viewport = await observedCssViewport(contents)
  if (
    browserZoom !== profile.browserZoom ||
    viewport.devicePixelRatio !== profile.deviceScale * profile.browserZoom ||
    !sameViewport(viewport, profile.cssViewport)
  )
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  return Object.freeze({
    browserZoom,
    contentHeight: contentSize[1],
    contentWidth: contentSize[0],
    cssHeight: viewport.height,
    cssWidth: viewport.width,
    devicePixelRatio: viewport.devicePixelRatio,
  })
}

async function prepareCaptureWindow(window, app, options, config) {
  if (!liveWindow(window) || window.webContents.getURL() !== PACKAGED_APP_URL) {
    throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  }
  const focused = await options.focus({
    app,
    window,
    errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
    timeoutMs: 5_000,
  })
  if (focused !== true) throw smokeError('VISUAL_SMOKE_FOCUS_FAILED')
  const nativeScale = await window.webContents.executeJavaScript('window.devicePixelRatio', false)
  const profile = config?.profile || layoutSmokeProfile(nativeScale === 2 ? 'dpr2' : '100')
  if (!profile) throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  if ((nativeScale !== 1 && nativeScale !== 2) || nativeScale !== profile.deviceScale) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  const original = {
    contentSize: window.getContentSize(),
    zoomFactor:
      typeof window.webContents.getZoomFactor === 'function'
        ? window.webContents.getZoomFactor()
        : 1,
  }
  const observation = await applyLayoutProfile(window, profile)
  return Object.freeze({
    nativeScale,
    observation: Object.freeze({ ...observation, deviceScale: nativeScale, name: profile.name }),
    original,
    profile,
    viewport: Object.freeze({ height: observation.cssHeight, width: observation.cssWidth }),
  })
}

async function capturePngCandidate(window, viewport) {
  let image
  try {
    image = await window.webContents.capturePage()
  } catch {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  if (
    !image ||
    image.isEmpty() ||
    image.getSize().width !== viewport.width ||
    image.getSize().height !== viewport.height
  )
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  let bytes
  let parsed
  try {
    bytes = image.toPNG()
    if (!Buffer.isBuffer(bytes)) throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
    parsed = parseBoundedPngContainer(bytes)
  } catch {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  if (parsed.animated || parsed.width !== viewport.width || parsed.height !== viewport.height) {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  return Buffer.from(bytes)
}

async function captureViewport(window, viewport, settle = settleCapture) {
  let previous
  for (
    let candidateIndex = 0;
    candidateIndex < CAPTURE_STABILITY_CANDIDATE_LIMIT;
    candidateIndex += 1
  ) {
    const candidate = await capturePngCandidate(window, viewport)
    if (previous && previous.equals(candidate)) return candidate
    previous = candidate
    if (candidateIndex < CAPTURE_STABILITY_CANDIDATE_LIMIT - 1) {
      try {
        await settle()
      } catch {
        throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
      }
    }
  }
  throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
}

async function captureBaseline(window, app, options, config) {
  const prepared = await prepareCaptureWindow(window, app, options, config)
  try {
    await validateLayoutReachability(window, options, prepared.viewport, false, {
      requireInitialViewport: prepared.profile.requireInitialViewport,
    })
    const leadInGeometry = await window.webContents.executeJavaScript(
      timelineLeadInGeometryScript(),
      false,
    )
    if (!validTimelineLeadInGeometryState(leadInGeometry)) {
      throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
    }
    const captureProfile = layoutSmokeProfile(prepared.nativeScale === 2 ? 'dpr2' : '100')
    await applyLayoutProfile(window, captureProfile)
    const rendererState = await window.webContents.executeJavaScript(STABLE_RENDERER_SCRIPT, false)
    if (!validRendererState(rendererState)) throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
    const png = await captureViewport(window, VIEWPORT, options.captureSettle)
    return options.createArtifacts(png, prepared.observation).artifacts
  } finally {
    restoreCaptureGeometry(window, window.webContents, prepared.original)
  }
}

async function validateLayoutReachability(
  window,
  options,
  viewport,
  includeStyleTargets = false,
  checkOptions = {},
) {
  const deadline = Date.now() + options.readinessTimeoutMs
  while (Date.now() <= deadline) {
    const remaining = Math.max(1, deadline - Date.now())
    const state = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          layoutReachabilityScript(viewport, includeStyleTargets),
          false,
        ),
      remaining,
    )
    if (validLayoutReachabilityState(state, viewport, { includeStyleTargets, ...checkOptions }))
      return
    if (Date.now() >= deadline) break
    await options.captureSettle()
  }
  throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
}

function sendTrustedStyleActivation(contents, target, browserZoom = 1) {
  if (
    !contents ||
    typeof contents.sendInputEvent !== 'function' ||
    !validStyleTarget(target) ||
    !Number.isFinite(browserZoom) ||
    browserZoom <= 0 ||
    browserZoom > 2
  ) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  const x = Math.round(target.x * browserZoom)
  const y = Math.round(target.y * browserZoom)
  const contentWidth = Math.round(target.width * browserZoom)
  const contentHeight = Math.round(target.height * browserZoom)
  if (
    !Number.isSafeInteger(x) ||
    x < 0 ||
    x + Math.ceil(target.boundsWidth * browserZoom) > contentWidth ||
    !Number.isSafeInteger(y) ||
    y < 0 ||
    y + Math.ceil(target.boundsHeight * browserZoom) > contentHeight
  ) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  try {
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    contents.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseDown', x, y })
    contents.sendInputEvent({ button: 'left', clickCount: 1, type: 'mouseUp', x, y })
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

function sendTrustedStyleKey(contents, accelerator) {
  if (
    !contents ||
    typeof contents.sendInputEvent !== 'function' ||
    !STYLE_KEY_SEQUENCE.includes(accelerator)
  )
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  const shifted = accelerator.startsWith('Shift+')
  const keyCode = shifted ? accelerator.slice(6) : accelerator
  const eventTypes = accelerator === 'Enter' ? ['keyDown', 'char', 'keyUp'] : ['keyDown', 'keyUp']
  try {
    for (const type of eventTypes) {
      const event = { keyCode, type }
      if (shifted) event.modifiers = ['shift']
      contents.sendInputEvent(event)
    }
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

function sendTrustedStyleText(contents, text) {
  if (
    !contents ||
    typeof contents.sendInputEvent !== 'function' ||
    text !== STYLE_TEMPLATE_NAME ||
    !/^[A-Za-z0-9 ]+$/u.test(text)
  )
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  try {
    for (const keyCode of text) {
      contents.sendInputEvent({ keyCode, type: 'keyDown' })
      contents.sendInputEvent({ keyCode, type: 'char' })
      contents.sendInputEvent({ keyCode, type: 'keyUp' })
    }
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

function sendTrustedTimelineDensityOpen(contents) {
  if (!contents || typeof contents.sendInputEvent !== 'function') {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  try {
    contents.sendInputEvent({ keyCode: 'Enter', type: 'keyDown' })
    contents.sendInputEvent({ keyCode: 'Enter', type: 'char' })
    contents.sendInputEvent({ keyCode: 'Enter', type: 'keyUp' })
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

function sendTrustedTimelineDensityTiming(contents) {
  if (!contents || typeof contents.sendInputEvent !== 'function') {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  try {
    contents.sendInputEvent({ keyCode: 'Home', type: 'keyDown' })
    contents.sendInputEvent({ keyCode: 'Home', type: 'keyUp' })
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

async function captureStyleSession(window, app, options, config) {
  const prepared = await prepareCaptureWindow(window, app, options, config)
  const displayScale = prepared.nativeScale
  const capture = (viewport) => captureViewport(window, viewport, options.captureSettle)
  const readinessInvalid = () => {
    throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  }
  try {
    await validateLayoutReachability(window, options, prepared.viewport, false, {
      requireInitialViewport: prepared.profile.requireInitialViewport,
    })
    const captureProfile = layoutSmokeProfile(displayScale === 2 ? 'dpr2' : '100')
    if (!captureProfile) throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
    await applyLayoutProfile(window, captureProfile)
    const target = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(STYLE_TARGET_SCRIPT, false),
      options.readinessTimeoutMs,
    )
    if (!validStyleTarget(target)) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    sendTrustedStyleActivation(window.webContents, target, captureProfile.browserZoom)
    await applyLayoutProfile(window, captureProfile)
    await validateLayoutReachability(window, options, VIEWPORT, true, {
      requireInitialViewport: captureProfile.requireInitialViewport,
    })
    const pngs = []
    for (const viewport of STYLE_SESSION_VIEWPORTS.slice(0, 2)) {
      setExactViewport(window, viewport, displayScale)
      const state = await executeBeforeDeadline(
        () => window.webContents.executeJavaScript(projectLyricsReadinessScript(viewport), false),
        options.readinessTimeoutMs,
      )
      if (!validProjectLyricsState(state, viewport)) {
        readinessInvalid()
      }
      pngs.push(await capture(viewport))
    }
    const viewport = STYLE_SESSION_VIEWPORTS[2]
    setExactViewport(window, viewport, displayScale)
    const lyricsTarget = await window.webContents.executeJavaScript(
      styleSessionActionScript('lyrics'),
      false,
    )
    if (!validStyleActionTarget(lyricsTarget, 'lyrics'))
      throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    sendTrustedStyleActivation(window.webContents, lyricsTarget, captureProfile.browserZoom)
    await options.captureSettle()
    const resizedDestination = await window.webContents.executeJavaScript(
      STYLE_DESTINATION_STATE_SCRIPT,
      false,
    )
    const resizedContract =
      resizedDestination === 'lyrics'
        ? { kind: 'project-lyrics' }
        : resizedDestination === 'stage-frame'
          ? { enabled: true, kind: 'stage-frame', role: 'brand', roleVisible: true }
          : null
    if (!resizedContract) throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    const resized = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          projectLyricsReadinessScript(viewport, resizedContract),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (
      (resizedDestination === 'lyrics' && !validProjectLyricsState(resized, viewport)) ||
      (resizedDestination === 'stage-frame' &&
        !validStageFrameState(resized, viewport, resizedContract))
    )
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    const actionTarget = async (action) => {
      const deadline = Date.now() + options.readinessTimeoutMs
      while (Date.now() <= deadline) {
        const target = await window.webContents.executeJavaScript(
          styleSessionActionScript(action),
          false,
        )
        if (action === 'stage' && target === null && resizedDestination === 'stage-frame')
          return null
        if (validStyleActionTarget(target, action)) return target
        if (Date.now() >= deadline) break
        await options.captureSettle()
      }
      throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    }
    const activate = async (action) => {
      if (action === 'reopen') {
        const actionTarget = await executeBeforeDeadline(
          () => window.webContents.executeJavaScript(STYLE_TARGET_SCRIPT, false),
          options.readinessTimeoutMs,
        )
        if (!validStyleTarget(actionTarget)) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
        sendTrustedStyleActivation(window.webContents, actionTarget, captureProfile.browserZoom)
        return
      }
      const target = await actionTarget(action)
      if (target !== null)
        sendTrustedStyleActivation(window.webContents, target, captureProfile.browserZoom)
    }
    const stageFrameState = async (contract) => {
      const state = await executeBeforeDeadline(
        () =>
          window.webContents.executeJavaScript(
            projectLyricsReadinessScript(viewport, { kind: 'stage-frame', ...contract }),
            false,
          ),
        options.readinessTimeoutMs,
      )
      if (!validStageFrameState(state, viewport, contract)) readinessInvalid()
      return state
    }
    const styleDestinationLayout = async (destination, scrollTop, setScrollTop) => {
      const state = await executeBeforeDeadline(
        () =>
          window.webContents.executeJavaScript(
            styleDestinationLayoutScript(destination, scrollTop, setScrollTop),
            false,
          ),
        options.readinessTimeoutMs,
      )
      if (!validStyleDestinationLayout(state, destination, scrollTop)) readinessInvalid()
    }
    await activate('stage')
    await stageFrameState({ enabled: true, role: 'brand', roleVisible: true })
    const armed = await window.webContents.executeJavaScript(STYLE_KEY_RECORDER_SCRIPT, false)
    if (armed !== true) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    STYLE_KEY_SEQUENCE.forEach((key) => sendTrustedStyleKey(window.webContents, key))
    const keyboardState = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(STYLE_KEY_RESULT_SCRIPT, false),
      options.readinessTimeoutMs,
    )
    if (!validStyleKeyboardState(keyboardState)) readinessInvalid()
    await activate('cancel')
    await activate('reopen')
    const backgroundState = async (mode, colors = null, applied = false) => {
      const state = await executeBeforeDeadline(
        () =>
          window.webContents.executeJavaScript(
            projectLyricsReadinessScript(viewport, { applied, colors, kind: 'background', mode }),
            false,
          ),
        options.readinessTimeoutMs,
      )
      if (!validBackgroundState(state, viewport, mode, colors, applied)) readinessInvalid()
      return state
    }
    await activate('background')
    await backgroundState('gradient')
    pngs.push(await capture(viewport))
    await activate('solid')
    const solid = await backgroundState('solid')
    pngs.push(await capture(viewport))
    const colors = Object.fromEntries(
      ['gradientEndColor', 'gradientStartColor', 'solidColor'].map((key) => [key, solid[key]]),
    )
    await activate('apply')
    await backgroundState('solid', colors, true)
    pngs.push(await capture(viewport))
    const titleCardState = async (contract) => {
      const state = await executeBeforeDeadline(
        () =>
          window.webContents.executeJavaScript(
            projectLyricsReadinessScript(viewport, { kind: 'title-card', ...contract }),
            false,
          ),
        options.readinessTimeoutMs,
      )
      if (
        !state ||
        state.resourcesReady !== true ||
        state.role !== contract.role ||
        state.applied !== (contract.applied === true)
      )
        readinessInvalid()
      return state
    }
    await activate('reopen')
    await activate('title')
    await titleCardState({ role: 'eyebrow', eyebrowHidden: false, artistHidden: false })
    await styleDestinationLayout('title-card', STYLE_DESTINATION_SCROLL_TOPS['title-card'], true)
    await activate('templates')
    await styleDestinationLayout('templates', STYLE_DESTINATION_SCROLL_TOPS.templates, true)
    await activate('title')
    await styleDestinationLayout('title-card', STYLE_DESTINATION_SCROLL_TOPS['title-card'], false)
    await activate('templates')
    await styleDestinationLayout('templates', STYLE_DESTINATION_SCROLL_TOPS.templates, false)
    await activate('title')
    pngs.push(await capture(viewport))
    await styleDestinationLayout('title-card', 0, true)
    await activate('eyebrow-visibility')
    await titleCardState({ role: 'eyebrow', eyebrowHidden: true, artistHidden: false })
    pngs.push(await capture(viewport))
    await activate('artist')
    await activate('artist-visibility')
    const artistBeforeMove = await titleCardState({
      role: 'artist',
      eyebrowHidden: true,
      artistHidden: true,
    })
    await activate('move-selected')
    sendTrustedStyleKey(window.webContents, 'Right')
    const artistAfterMove = await titleCardState({
      role: 'artist',
      eyebrowHidden: true,
      artistHidden: true,
    })
    if (
      typeof artistBeforeMove.position !== 'string' ||
      typeof artistAfterMove.position !== 'string' ||
      artistBeforeMove.position === artistAfterMove.position
    )
      readinessInvalid('artist-move', { artistAfterMove, artistBeforeMove })
    pngs.push(await capture(viewport))
    await activate('apply-title')
    await titleCardState({ applied: true, role: 'artist', eyebrowHidden: true, artistHidden: true })
    pngs.push(await capture(viewport))
    await activate('reopen')
    await activate('stage')
    const baselineFrame = await stageFrameState({ enabled: true, role: 'brand', roleVisible: true })
    pngs.push(await capture(viewport))
    const preservedFrame = {
      brandStyle: baselineFrame.brandStyle,
      clockStyle: baselineFrame.clockStyle,
      clockWeight: baselineFrame.clockWeight,
      lineColor: baselineFrame.lineColor,
      lineWidth: baselineFrame.lineWidth,
    }
    await activate('stage-off')
    await stageFrameState({ ...preservedFrame, enabled: false, role: 'brand', roleVisible: true })
    pngs.push(await capture(viewport))
    await activate('stage-on')
    await stageFrameState({ ...preservedFrame, enabled: true, role: 'brand', roleVisible: true })
    await activate('clock')
    await stageFrameState({ ...preservedFrame, enabled: true, role: 'clock', roleVisible: true })
    await activate('clock-face')
    const clockFrame = await stageFrameState({
      ...preservedFrame,
      clockStyle: undefined,
      clockWeight: '700',
      enabled: true,
      role: 'clock',
      roleVisible: true,
    })
    pngs.push(await capture(viewport))
    const changedFrame = {
      ...preservedFrame,
      clockStyle: clockFrame.clockStyle,
      clockWeight: '700',
    }
    await activate('footer')
    await stageFrameState({ ...changedFrame, enabled: true, role: 'footer', roleVisible: true })
    await activate('footer-visibility')
    await stageFrameState({ ...changedFrame, enabled: true, role: 'footer', roleVisible: false })
    pngs.push(await capture(viewport))
    await activate('apply-stage')
    await stageFrameState({
      ...changedFrame,
      applied: true,
      enabled: true,
      role: 'footer',
      roleVisible: false,
    })
    pngs.push(await capture(viewport))
    await activate('reopen')
    await activate('lead')
    await activate('sync-aid')
    const leadVocalState = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          projectLyricsReadinessScript(viewport, { kind: 'lead-vocal' }),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (!validLeadVocalState(leadVocalState, viewport)) readinessInvalid()
    pngs.push(await capture(viewport))
    await activate('templates')
    const templateFormState = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(styleTemplateFormReadinessScript(viewport), false),
      options.readinessTimeoutMs,
    )
    if (!validStyleTemplateFormState(templateFormState, viewport)) readinessInvalid()
    await activate('template-name')
    sendTrustedStyleText(window.webContents, STYLE_TEMPLATE_NAME)
    await activate('save-template')
    const templateState = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          styleTemplateReadinessScript(viewport, STYLE_TEMPLATE_NAME),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (!validStyleTemplateState(templateState, viewport, STYLE_TEMPLATE_NAME)) readinessInvalid()
    pngs.push(await capture(viewport))
    await activate('title')
    await activate('opening-timing')
    pngs.push(await capture(viewport))
    return options.createScenarioArtifacts(STYLE_SESSION_SCENARIO, pngs, prepared.observation)
      .artifacts
  } finally {
    restoreCaptureGeometry(window, window.webContents, prepared.original)
  }
}

async function captureTimelineDensity(window, app, options, config) {
  const prepared = await prepareCaptureWindow(window, app, options, config)
  try {
    await validateLayoutReachability(window, options, prepared.viewport, false, {
      requireInitialViewport: prepared.profile.requireInitialViewport,
    })
    const timingTarget = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(TIMELINE_DENSITY_TIMING_TARGET_SCRIPT, false),
      options.readinessTimeoutMs,
    )
    if (
      !validTimelineDensityTimingTarget(
        timingTarget,
        prepared.viewport,
        prepared.observation.devicePixelRatio,
      )
    ) {
      throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    }
    sendTrustedTimelineDensityTiming(window.webContents)
    const target = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(TIMELINE_DENSITY_OPEN_TARGET_SCRIPT, false),
      options.readinessTimeoutMs,
    )
    if (
      !validTimelineDensityOpenTarget(
        target,
        prepared.viewport,
        prepared.observation.devicePixelRatio,
      )
    ) {
      throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    }
    sendTrustedTimelineDensityOpen(window.webContents)
    const rendererState = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          timelineDensityReadinessScript(prepared.viewport, prepared.observation),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (!validTimelineDensityState(rendererState, prepared.viewport, prepared.observation)) {
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    }
    const png = await captureViewport(window, VIEWPORT, options.captureSettle)
    const captureState = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          timelineDensityCaptureStateScript(prepared.viewport, prepared.observation, rendererState),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (
      !validTimelineDensityCaptureState(
        captureState,
        prepared.viewport,
        prepared.observation,
        rendererState,
      )
    ) {
      throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
    }
    return options.createScenarioArtifacts(TIMELINE_DENSITY_SCENARIO, [png], prepared.observation)
      .artifacts
  } finally {
    restoreCaptureGeometry(window, window.webContents, prepared.original)
  }
}

function destroyWindow(window) {
  try {
    if (!window || typeof window.isDestroyed !== 'function' || typeof window.destroy !== 'function')
      throw smokeError('VISUAL_SMOKE_TEARDOWN_FAILED')
    if (window.isDestroyed()) return
    window.destroy()
    if (!window.isDestroyed()) throw smokeError('VISUAL_SMOKE_TEARDOWN_FAILED')
  } catch {
    throw smokeError('VISUAL_SMOKE_TEARDOWN_FAILED')
  }
}

async function writeFailure(output, options) {
  try {
    await options.writeFailure(output, PUBLIC_FAILURE)
  } catch {
    // Preserve an existing or partially claimed output rather than replacing it.
  }
  return Object.freeze({ ok: false })
}

async function runVisualSmoke(
  { app, config, fatalObserver, getWindows, window },
  dependencies = {},
) {
  const options = {
    captureSettle: dependencies.captureSettle || settleCapture,
    createArtifacts: dependencies.createArtifacts || createResultArtifacts,
    createScenarioArtifacts: dependencies.createScenarioArtifacts || createScenarioResultArtifacts,
    focus: dependencies.focus || focusSmokeWindow,
    getWindows: dependencies.getWindows || getWindows || (() => [window]),
    publish: dependencies.publish || publishArtifactBuffers,
    readinessTimeoutMs: dependencies.readinessTimeoutMs ?? STYLE_SESSION_READINESS_TIMEOUT_MS,
    settle: dependencies.settle || settleSmoke,
    writeFailure: dependencies.writeFailure || writeFreshLauncherFailure,
  }
  let artifacts
  let failed = fatalObserved(fatalObserver) || !singleLiveSmokeWindow(window, options.getWindows)
  if (!failed) {
    try {
      const scenario = config.scenario ?? BASELINE_SCENARIO
      if (scenario === BASELINE_SCENARIO)
        artifacts = await captureBaseline(window, app, options, config)
      else if (scenario === STYLE_SESSION_SCENARIO)
        artifacts = await captureStyleSession(window, app, options, config)
      else if (scenario === TIMELINE_DENSITY_SCENARIO)
        artifacts = await captureTimelineDensity(window, app, options, config)
      else throw smokeError('VISUAL_SMOKE_SCENARIO_INVALID')
    } catch {
      failed = true
    }
  }
  try {
    await options.settle()
  } catch {
    failed = true
  }
  if (fatalObserved(fatalObserver) || !singleLiveSmokeWindow(window, options.getWindows))
    failed = true
  try {
    fatalObserver?.disposeRenderers()
  } catch {
    failed = true
  }
  try {
    destroyWindow(window)
  } catch {
    failed = true
  }
  try {
    await options.settle()
  } catch {
    failed = true
  }
  try {
    if (options.getWindows().some((candidate) => liveWindow(candidate))) failed = true
  } catch {
    failed = true
  }
  if (fatalObserved(fatalObserver)) failed = true
  if (failed) return writeFailure(config.output, options)
  try {
    await options.publish(config.output, artifacts)
    return Object.freeze({ ok: true })
  } catch {
    return writeFailure(config.output, options)
  }
}

module.exports = {
  PUBLIC_FAILURE,
  captureBaseline,
  captureStyleSession,
  captureTimelineDensity,
  runVisualSmoke,
  sendTrustedStyleActivation,
  sendTrustedStyleText,
  sendTrustedTimelineDensityOpen,
  sendTrustedTimelineDensityTiming,
}
