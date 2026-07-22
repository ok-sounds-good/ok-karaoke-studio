'use strict'

const { pathsAreSeparate, validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const {
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('./smoke-artifacts.cjs')
const { parseBoundedPngContainer } = require('./png-validation.cjs')
const { focusSmokeWindow } = require('./smoke-window-focus.cjs')
const {
  BASELINE_SCENARIO,
  STYLE_SESSION_SCENARIO,
  STYLE_SESSION_VIEWPORTS,
  VIEWPORT,
  createResultArtifacts,
  createScenarioResultArtifacts,
} = require('../scripts/visual-result-validation.cjs')
const {
  PACKAGED_APP_URL,
  STABLE_RENDERER_SCRIPT,
  STUDIO_BRIDGE_KEYS,
  STYLE_KEY_CHANGES,
  STYLE_KEY_FOCUS,
  STYLE_KEY_RECORDER_SCRIPT,
  STYLE_KEY_RESULT_SCRIPT,
  STYLE_KEY_SEQUENCE,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_TARGET_SCRIPT,
  executeBeforeDeadline,
  projectLyricsReadinessScript,
  styleSessionActionScript,
  validBackgroundState,
  validLeadVocalState,
  validProjectLyricsState,
  validRendererState,
  validStageFrameState,
  validStyleActionTarget,
  validStyleKeyboardState,
  validStyleTarget,
} = require('./visual-smoke-renderer-contracts.cjs')

const TRIGGER = '--oks-video-style-visual-smoke'
const OPTION_PREFIX = '--oks-video-style-visual-'
const PUBLIC_FAILURE = Object.freeze({ code: 'VISUAL_SMOKE_FAILED', ok: false })
const FATAL_DIAGNOSTIC = '[oks-visual-smoke:fatal]\n'
const CAPTURE_STABILITY_CANDIDATE_LIMIT = 5
const CAPTURE_STABILITY_SETTLE_MS = 50
const FATAL_GRACE_MS = 250
const OPTIONS = Object.freeze({
  output: '--oks-video-style-visual-output=',
  scenario: '--oks-video-style-visual-scenario=',
  sessionData: '--oks-video-style-visual-session-data=',
  sessionIdentity: '--oks-video-style-visual-session-identity=',
  userData: '--oks-video-style-visual-user-data=',
  userIdentity: '--oks-video-style-visual-user-identity=',
})

function smokeError(code = 'VISUAL_SMOKE_FAILED') {
  const error = new Error(code)
  error.code = code
  return error
}

function installVisualSmokeFatalObserver(processLike = process) {
  if (
    !processLike ||
    typeof processLike.on !== 'function' ||
    typeof processLike.removeListener !== 'function'
  )
    throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
  let fatal = false
  let disposed = false
  const rendererObservers = new Set()
  const observeFatal = () => {
    if (fatal) return
    fatal = true
    try {
      processLike.stderr?.write?.(FATAL_DIAGNOSTIC)
    } catch {
      // Fatal state remains authoritative even when its fixed diagnostic cannot be written.
    }
  }

  const observeRenderer = (contents) => {
    if (
      disposed ||
      !contents ||
      typeof contents.on !== 'function' ||
      typeof contents.once !== 'function' ||
      typeof contents.removeListener !== 'function'
    )
      throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')

    let active = true
    const observeConsoleMessage = (...args) => {
      try {
        const [eventOrDetails, detailsOrLevel] = args
        const details =
          detailsOrLevel && typeof detailsOrLevel === 'object' ? detailsOrLevel : eventOrDetails
        const level = details && typeof details === 'object' ? details.level : undefined
        const legacyLevel = typeof detailsOrLevel === 'number' ? detailsOrLevel : undefined
        if (level === 'error' || level === 3 || (typeof level !== 'string' && legacyLevel === 3))
          observeFatal()
      } catch {
        observeFatal()
      }
    }
    const observeGone = (_event, details) => {
      if (details?.reason !== 'clean-exit') observeFatal()
    }
    const observedEvents = [
      ['console-message', observeConsoleMessage],
      ['did-fail-load', observeFatal],
      ['preload-error', observeFatal],
      ['render-process-gone', observeGone],
      ['unresponsive', observeFatal],
    ]
    const rendererObserver = Object.freeze({
      dispose() {
        if (!active) return
        active = false
        rendererObservers.delete(rendererObserver)
        try {
          if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return
          for (const [event, listener] of observedEvents) contents.removeListener(event, listener)
          contents.removeListener('destroyed', observeDestroyed)
        } catch {
          observeFatal()
        }
      },
    })
    const observeDestroyed = () => {
      active = false
      rendererObservers.delete(rendererObserver)
    }

    try {
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) {
        throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
      }
      for (const [event, listener] of observedEvents) contents.on(event, listener)
      contents.once('destroyed', observeDestroyed)
      rendererObservers.add(rendererObserver)
      return rendererObserver
    } catch {
      try {
        for (const [event, listener] of observedEvents) contents.removeListener(event, listener)
        contents.removeListener('destroyed', observeDestroyed)
      } catch {
        // The fixed observer-installation failure remains the only public diagnostic.
      }
      observeFatal()
      throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
    }
  }

  processLike.on('uncaughtException', observeFatal)
  processLike.on('unhandledRejection', observeFatal)
  return Object.freeze({
    dispose() {
      if (disposed) return
      disposed = true
      for (const rendererObserver of [...rendererObservers]) rendererObserver.dispose()
      try {
        processLike.removeListener('uncaughtException', observeFatal)
        processLike.removeListener('unhandledRejection', observeFatal)
      } catch {
        observeFatal()
      }
    },
    disposeRenderers() {
      for (const rendererObserver of [...rendererObservers]) rendererObserver.dispose()
    },
    hasFatal: () => fatal,
    observeRenderer,
  })
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

function parseOption(args, prefix) {
  const matches = args.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  const value = matches[0].slice(prefix.length)
  if (!value || value.includes('\0')) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  return value
}

function parseScenario(args) {
  const scenario = parseOption(args, OPTIONS.scenario)
  if (scenario !== BASELINE_SCENARIO && scenario !== STYLE_SESSION_SCENARIO) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  return scenario
}

function parseVisualSmokeArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  const related = argv.filter((argument) => argument.startsWith(OPTION_PREFIX))
  const triggers = argv.filter((argument) => argument === TRIGGER)
  if (triggers.length === 0 && related.length === 0) return null
  if (triggers.length !== 1) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  const knownArguments = new Set([TRIGGER])
  for (const prefix of Object.values(OPTIONS)) {
    const match = argv.find((argument) => argument.startsWith(prefix))
    if (match) knownArguments.add(match)
  }
  if (related.some((argument) => !knownArguments.has(argument))) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  return Object.freeze({
    output: validateFreshOutputPath(parseOption(argv, OPTIONS.output)),
    scenario: parseScenario(argv),
    sessionData: parseOption(argv, OPTIONS.sessionData),
    sessionIdentity: parseOption(argv, OPTIONS.sessionIdentity),
    userData: parseOption(argv, OPTIONS.userData),
    userIdentity: parseOption(argv, OPTIONS.userIdentity),
  })
}

function configureVisualSmokeBeforeReady(app, config) {
  if (!config) return null
  if (!app || app.isReady()) throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
  try {
    const defaultUserData = app.getPath('userData')
    const defaultSessionData = app.getPath('sessionData')
    const userData = validateOwnedSmokeProfile(
      config.userData,
      defaultUserData,
      config.userIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    validateOwnedSmokeProfile(
      userData,
      defaultSessionData,
      config.userIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    const sessionData = validateOwnedSmokeProfile(
      config.sessionData,
      defaultUserData,
      config.sessionIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    validateOwnedSmokeProfile(
      sessionData,
      defaultSessionData,
      config.sessionIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    if (!pathsAreSeparate(userData, sessionData)) {
      throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
    }
    app.setPath('userData', userData)
    app.setPath('sessionData', sessionData)
    app.commandLine.appendSwitch('force-device-scale-factor', '1')
    return Object.freeze({ ...config, sessionData, userData })
  } catch {
    throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
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

function liveWindow(window) {
  try {
    return Boolean(
      window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed(),
    )
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

async function prepareCaptureWindow(window, app, options) {
  if (!liveWindow(window) || window.webContents.getURL() !== PACKAGED_APP_URL) {
    throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  }
  window.setContentSize(VIEWPORT.width, VIEWPORT.height, false)
  const focused = await options.focus({
    app,
    window,
    errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
    timeoutMs: 5_000,
  })
  if (focused !== true) throw smokeError('VISUAL_SMOKE_FOCUS_FAILED')
  const displayScale = await window.webContents.executeJavaScript('window.devicePixelRatio', false)
  if (displayScale !== 1 && displayScale !== 2) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  if (displayScale === 2) {
    window.webContents.setZoomFactor(0.5)
    window.setMinimumSize(1, 1)
  }
  setExactViewport(window, VIEWPORT, displayScale)
  return displayScale
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

async function captureBaseline(window, app, options) {
  await prepareCaptureWindow(window, app, options)
  const rendererState = await window.webContents.executeJavaScript(STABLE_RENDERER_SCRIPT, false)
  if (!validRendererState(rendererState)) throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
  const png = await captureViewport(window, VIEWPORT, options.captureSettle)
  return options.createArtifacts(png).artifacts
}


function sendTrustedStyleActivation(contents, target, displayScale) {
  if (
    !contents ||
    typeof contents.sendInputEvent !== 'function' ||
    !validStyleTarget(target) ||
    (displayScale !== 1 && displayScale !== 2)
  ) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  const x = Math.round(target.x / displayScale)
  const y = Math.round(target.y / displayScale)
  const contentWidth = VIEWPORT.width / displayScale
  const contentHeight = VIEWPORT.height / displayScale
  if (
    !Number.isSafeInteger(x) ||
    x < 0 ||
    x >= contentWidth ||
    !Number.isSafeInteger(y) ||
    y < 0 ||
    y >= contentHeight
  ) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  try {
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    contents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseDown',
      x,
      y,
    })
    contents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseUp',
      x,
      y,
    })
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

async function captureStyleSession(window, app, options) {
  const displayScale = await prepareCaptureWindow(window, app, options)
  const capture = (viewport) => captureViewport(window, viewport, options.captureSettle)
  const target = await executeBeforeDeadline(
    () => window.webContents.executeJavaScript(STYLE_TARGET_SCRIPT, false),
    options.readinessTimeoutMs,
  )
  if (!validStyleTarget(target)) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  sendTrustedStyleActivation(window.webContents, target, displayScale)

  const pngs = []
  for (const viewport of STYLE_SESSION_VIEWPORTS.slice(0, 2)) {
    setExactViewport(window, viewport, displayScale)
    const state = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(projectLyricsReadinessScript(viewport), false),
      options.readinessTimeoutMs,
    )
    if (!validProjectLyricsState(state, viewport)) {
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    }
    pngs.push(await capture(viewport))
  }
  const viewport = STYLE_SESSION_VIEWPORTS[2]
  setExactViewport(window, viewport, displayScale)
  const resized = await executeBeforeDeadline(
    () => window.webContents.executeJavaScript(projectLyricsReadinessScript(viewport), false),
    options.readinessTimeoutMs,
  )
  if (!validProjectLyricsState(resized, viewport))
    throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  const activate = async (action) => {
    const actionTarget = await window.webContents.executeJavaScript(
      styleSessionActionScript(action),
      false,
    )
    if (!validStyleActionTarget(actionTarget, action))
      throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    sendTrustedStyleActivation(window.webContents, actionTarget, displayScale)
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
    if (!validStageFrameState(state, viewport, contract))
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    return state
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
  if (!validStyleKeyboardState(keyboardState)) throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  await activate('reopen')
  const backgroundState = async (mode, colors = null, applied = false) => {
    const state = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          projectLyricsReadinessScript(viewport, {
            applied,
            colors,
            kind: 'background',
            mode,
          }),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (!validBackgroundState(state, viewport, mode, colors, applied)) {
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    }
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
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  }
  await activate('reopen')
  await activate('title')
  await titleCardState({ role: 'eyebrow', eyebrowHidden: false, artistHidden: false })
  pngs.push(await capture(viewport))
  await activate('eyebrow-visibility')
  await titleCardState({ role: 'eyebrow', eyebrowHidden: true, artistHidden: false })
  pngs.push(await capture(viewport))
  await activate('artist')
  await activate('artist-visibility')
  await titleCardState({ role: 'artist', eyebrowHidden: true, artistHidden: true })
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
  await activate('clock')
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
  const changedFrame = { ...preservedFrame, clockStyle: clockFrame.clockStyle, clockWeight: '700' }
  await activate('footer')
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
  if (!validLeadVocalState(leadVocalState, viewport))
    throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  pngs.push(await capture(viewport))
  return options.createScenarioArtifacts(STYLE_SESSION_SCENARIO, pngs).artifacts
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
      if (scenario === BASELINE_SCENARIO) {
        artifacts = await captureBaseline(window, app, options)
      } else if (scenario === STYLE_SESSION_SCENARIO) {
        artifacts = await captureStyleSession(window, app, options)
      } else {
        throw smokeError('VISUAL_SMOKE_SCENARIO_INVALID')
      }
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
  BASELINE_SCENARIO,
  FATAL_DIAGNOSTIC,
  OPTIONS,
  PACKAGED_APP_URL,
  PUBLIC_FAILURE,
  STABLE_RENDERER_SCRIPT,
  STUDIO_BRIDGE_KEYS,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_SESSION_SCENARIO,
  STYLE_TARGET_SCRIPT,
  TRIGGER,
  VIEWPORT,
  captureBaseline,
  captureStyleSession,
  configureVisualSmokeBeforeReady,
  executeBeforeDeadline,
  installVisualSmokeFatalObserver,
  parseVisualSmokeArguments,
  projectLyricsReadinessScript,
  runVisualSmoke,
  sendTrustedStyleActivation,
  validProjectLyricsState,
  validStyleTarget,
}
