'use strict'

const { pathsAreSeparate, validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const {
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('./smoke-artifacts.cjs')
const { focusSmokeWindow } = require('./smoke-window-focus.cjs')
const { createResultArtifacts, VIEWPORT } = require('../scripts/visual-result-validation.cjs')

const TRIGGER = '--oks-video-style-visual-smoke'
const OPTION_PREFIX = '--oks-video-style-visual-'
const OPTIONS = Object.freeze({
  output: '--oks-video-style-visual-output=',
  sessionData: '--oks-video-style-visual-session-data=',
  sessionIdentity: '--oks-video-style-visual-session-identity=',
  userData: '--oks-video-style-visual-user-data=',
  userIdentity: '--oks-video-style-visual-user-identity=',
})
const PACKAGED_APP_URL = 'studio-app://app/index.html'
const PUBLIC_FAILURE = Object.freeze({ code: 'VISUAL_SMOKE_FAILED', ok: false })

const STABLE_RENDERER_SCRIPT = `(() => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const sample = () => {
    const root = document.getElementById('root')
    const bounds = root?.getBoundingClientRect()
    return {
      bodyHeight: document.body?.scrollHeight ?? -1,
      bodyWidth: document.body?.scrollWidth ?? -1,
      rootChildren: root?.childElementCount ?? 0,
      rootHeight: bounds?.height ?? -1,
      rootWidth: bounds?.width ?? -1,
    }
  }
  return (async () => {
    await document.fonts?.ready
    await Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return Promise.resolve()
      return image.decode?.().catch(() => undefined) ?? Promise.resolve()
    }))
    await frame()
    await frame()
    const first = sample()
    await delay(120)
    await frame()
    await frame()
    const second = sample()
    return {
      devicePixelRatio: window.devicePixelRatio,
      height: document.documentElement.clientHeight,
      href: window.location.href,
      readyState: document.readyState,
      rootChildren: second.rootChildren,
      stable: JSON.stringify(first) === JSON.stringify(second),
      width: document.documentElement.clientWidth,
    }
  })()
})()`

function smokeError(code = 'VISUAL_SMOKE_FAILED') {
  const error = new Error(code)
  error.code = code
  return error
}

function parseOption(args, prefix) {
  const matches = args.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  const value = matches[0].slice(prefix.length)
  if (!value || value.includes('\0')) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  return value
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

function validRendererState(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.devicePixelRatio === 1 &&
    value.height === VIEWPORT.height &&
    value.width === VIEWPORT.width &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    Number.isSafeInteger(value.rootChildren) &&
    value.rootChildren > 0 &&
    value.stable === true,
  )
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

async function captureBaseline(window, app, options) {
  if (!liveWindow(window) || window.webContents.getURL() !== PACKAGED_APP_URL) {
    throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  }
  window.setContentSize(VIEWPORT.width, VIEWPORT.height, false)
  await options.focus({
    app,
    window,
    errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
    timeoutMs: 5_000,
  })
  const displayScale = await window.webContents.executeJavaScript('window.devicePixelRatio', false)
  if (displayScale !== 1 && displayScale !== 2) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  if (displayScale === 2) {
    window.webContents.setZoomFactor(0.5)
    window.setMinimumSize(1, 1)
    window.setContentSize(VIEWPORT.width / 2, VIEWPORT.height / 2, false)
  }
  const observedContentSize = liveWindow(window) ? window.getContentSize() : []
  const expectedContentSize = [VIEWPORT.width / displayScale, VIEWPORT.height / displayScale]
  if (observedContentSize.join(',') !== expectedContentSize.join(',')) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  const rendererState = await window.webContents.executeJavaScript(STABLE_RENDERER_SCRIPT, false)
  if (!validRendererState(rendererState)) throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
  let image
  try {
    image = await window.webContents.capturePage()
  } catch {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  if (
    !image ||
    image.isEmpty() ||
    image.getSize().width !== VIEWPORT.width ||
    image.getSize().height !== VIEWPORT.height
  )
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  const png = image.toPNG()
  return options.createArtifacts(png).artifacts
}

function destroyWindow(window) {
  try {
    if (window && !window.isDestroyed()) window.destroy()
  } catch {
    // Teardown is best effort after all evidence bytes are closed and published.
  }
}

async function runVisualSmoke({ app, config, window }, dependencies = {}) {
  const options = {
    createArtifacts: dependencies.createArtifacts || createResultArtifacts,
    focus: dependencies.focus || focusSmokeWindow,
    publish: dependencies.publish || publishArtifactBuffers,
    writeFailure: dependencies.writeFailure || writeFreshLauncherFailure,
  }
  try {
    const artifacts = await captureBaseline(window, app, options)
    await options.publish(config.output, artifacts)
    return Object.freeze({ ok: true })
  } catch {
    try {
      await options.writeFailure(config.output, PUBLIC_FAILURE)
    } catch {
      // Preserve an existing or partially claimed output rather than replacing it.
    }
    return Object.freeze({ ok: false })
  } finally {
    destroyWindow(window)
  }
}

module.exports = {
  OPTIONS,
  PACKAGED_APP_URL,
  PUBLIC_FAILURE,
  STABLE_RENDERER_SCRIPT,
  TRIGGER,
  VIEWPORT,
  captureBaseline,
  configureVisualSmokeBeforeReady,
  parseVisualSmokeArguments,
  runVisualSmoke,
}
