'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathsAreSeparate, validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const { validateFreshOutputPath } = require('./smoke-artifacts.cjs')
const { PROJECT_OPEN_FILTERS } = require('./save-paths.cjs')
const {
  BASELINE_SCENARIO,
  STYLE_SESSION_SCENARIO,
  TIMELINE_DENSITY_SCENARIO,
  VIEWPORT,
} = require('../scripts/visual-result-validation.cjs')
const { layoutSmokeProfile } = require('./visual-smoke-layout-profiles.cjs')
const {
  PACKAGED_APP_URL,
  STABLE_RENDERER_SCRIPT,
  STUDIO_BRIDGE_KEYS,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_TEMPLATE_NAME,
  STYLE_DESTINATION_SCROLL_TOPS,
  STYLE_TARGET_SCRIPT,
  TIMELINE_DENSITY_DIALOG_ACTIVATION_SCRIPT,
  TIMELINE_DENSITY_DOM_CAP_PER_TRACK,
  TIMELINE_DENSITY_OPEN_TARGET_SCRIPT,
  TIMELINE_DENSITY_TIMING_TARGET_SCRIPT,
  TIMELINE_DENSITY_TITLE,
  TIMELINE_DENSITY_TRACK_COUNT,
  TIMELINE_DENSITY_WORD_COUNT,
  TIMELINE_DENSITY_WORDS_PER_TRACK,
  executeBeforeDeadline,
  projectLyricsReadinessScript,
  styleDestinationLayoutScript,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  timelineDensityCaptureStateScript,
  timelineDensityReadinessScript,
  validProjectLyricsState,
  validStyleDestinationLayout,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
  validTimelineDensityCaptureState,
  validTimelineDensityOpenTarget,
  validTimelineDensityState,
  validTimelineDensityTimingTarget,
} = require('./visual-smoke-renderer-contracts.cjs')
const {
  PUBLIC_FAILURE,
  captureBaseline,
  captureStyleSession,
  captureTimelineDensity,
  runVisualSmoke,
  sendTrustedStyleActivation,
  sendTrustedStyleText,
  sendTrustedTimelineDensityOpen,
  sendTrustedTimelineDensityTiming,
} = require('./visual-smoke-orchestration.cjs')

const TRIGGER = '--oks-video-style-visual-smoke'
const OPTION_PREFIX = '--oks-video-style-visual-'
const FATAL_DIAGNOSTIC = '[oks-visual-smoke:fatal]\n'
const TIMELINE_DENSITY_FIXTURE_NAME = 'timeline-density-5000.oks'
const TIMELINE_DENSITY_FIXTURE_HOLD_NAME = '.oks-timeline-density-fixture-hold'
const MAX_TIMELINE_DENSITY_FIXTURE_BYTES = 32 * 1024 * 1024
const OPTIONS = Object.freeze({
  output: '--oks-video-style-visual-output=',
  profile: '--oks-video-style-visual-profile=',
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
    const observeDestroyed = () => {
      active = false
      rendererObservers.delete(rendererObserver)
    }
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

function parseOption(args, prefix) {
  const matches = args.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  const value = matches[0].slice(prefix.length)
  if (!value || value.includes('\0')) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  return value
}

function parseScenario(args) {
  const scenario = parseOption(args, OPTIONS.scenario)
  if (
    scenario !== BASELINE_SCENARIO &&
    scenario !== STYLE_SESSION_SCENARIO &&
    scenario !== TIMELINE_DENSITY_SCENARIO
  ) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  return scenario
}

function parseProfile(args) {
  const profile = layoutSmokeProfile(parseOption(args, OPTIONS.profile))
  if (!profile) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  return profile
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
    profile: parseProfile(argv),
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
    let userData
    let sessionData
    if (config.scenario === TIMELINE_DENSITY_SCENARIO) {
      sessionData = validateOwnedSmokeProfile(
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
      const fixturePath = validateFreshOutputPath(
        path.join(config.userData, TIMELINE_DENSITY_FIXTURE_NAME),
      )
      const holdPath = validateFreshOutputPath(
        path.join(sessionData, TIMELINE_DENSITY_FIXTURE_HOLD_NAME),
      )
      const fixtureStats = fs.lstatSync(fixturePath)
      if (
        path.dirname(fixturePath) !== path.resolve(config.userData) ||
        path.dirname(holdPath) !== sessionData ||
        !fixtureStats.isFile() ||
        fixtureStats.isSymbolicLink() ||
        fixtureStats.size < 1 ||
        fixtureStats.size > MAX_TIMELINE_DENSITY_FIXTURE_BYTES ||
        fs.existsSync(holdPath)
      ) {
        throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
      }
      fs.renameSync(fixturePath, holdPath)
      try {
        userData = validateOwnedSmokeProfile(
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
      } finally {
        fs.renameSync(holdPath, fixturePath)
      }
      validateOwnedSmokeProfile(
        sessionData,
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
    } else {
      userData = validateOwnedSmokeProfile(
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
      sessionData = validateOwnedSmokeProfile(
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
    }
    if (!pathsAreSeparate(userData, sessionData)) {
      throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
    }
    app.setPath('userData', userData)
    app.setPath('sessionData', sessionData)
    app.commandLine.appendSwitch('force-device-scale-factor', String(config.profile.deviceScale))
    return Object.freeze({ ...config, sessionData, userData })
  } catch {
    throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
  }
}

function createVisualSmokeDialogAdapter(dialogApi, config) {
  if (!config || config.scenario !== TIMELINE_DENSITY_SCENARIO) return dialogApi
  if (!dialogApi || typeof dialogApi.showOpenDialog !== 'function') {
    throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
  }
  let profileRoot
  let fixturePath
  try {
    profileRoot = validateFreshOutputPath(config.userData)
    fixturePath = validateFreshOutputPath(path.join(profileRoot, TIMELINE_DENSITY_FIXTURE_NAME))
    if (path.dirname(fixturePath) !== profileRoot) {
      throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
    }
  } catch {
    throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
  }
  let used = false
  return Object.freeze({
    async showOpenDialog(owner, options) {
      if (used) throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
      used = true
      const expectedKeys = ['buttonLabel', 'filters', 'properties', 'title']
      if (
        !owner ||
        !owner.webContents ||
        typeof owner.webContents.executeJavaScript !== 'function' ||
        (typeof owner.isDestroyed === 'function' && owner.isDestroyed()) ||
        (typeof owner.webContents.isDestroyed === 'function' && owner.webContents.isDestroyed()) ||
        (typeof owner.webContents.getURL === 'function' &&
          owner.webContents.getURL() !== PACKAGED_APP_URL) ||
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Object.keys(options).sort().join(',') !== expectedKeys.join(',') ||
        options.title !== 'Open Karaoke Project' ||
        options.buttonLabel !== 'Open Project' ||
        JSON.stringify(options.properties) !== JSON.stringify(['openFile']) ||
        JSON.stringify(options.filters) !== JSON.stringify(PROJECT_OPEN_FILTERS)
      ) {
        throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
      }
      let trusted = false
      try {
        trusted =
          (await owner.webContents.executeJavaScript(
            TIMELINE_DENSITY_DIALOG_ACTIVATION_SCRIPT,
            false,
          )) === true
      } catch {
        throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
      }
      if (!trusted) throw smokeError('VISUAL_SMOKE_DIALOG_INVALID')
      return Object.freeze({
        canceled: false,
        filePaths: Object.freeze([fixturePath]),
      })
    },
  })
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
  STYLE_DESTINATION_SCROLL_TOPS,
  STYLE_TEMPLATE_NAME,
  STYLE_TARGET_SCRIPT,
  TIMELINE_DENSITY_DIALOG_ACTIVATION_SCRIPT,
  TIMELINE_DENSITY_DOM_CAP_PER_TRACK,
  TIMELINE_DENSITY_FIXTURE_NAME,
  TIMELINE_DENSITY_OPEN_TARGET_SCRIPT,
  TIMELINE_DENSITY_TIMING_TARGET_SCRIPT,
  TIMELINE_DENSITY_SCENARIO,
  TIMELINE_DENSITY_TITLE,
  TIMELINE_DENSITY_TRACK_COUNT,
  TIMELINE_DENSITY_WORD_COUNT,
  TIMELINE_DENSITY_WORDS_PER_TRACK,
  TRIGGER,
  VIEWPORT,
  captureBaseline,
  captureStyleSession,
  captureTimelineDensity,
  configureVisualSmokeBeforeReady,
  createVisualSmokeDialogAdapter,
  executeBeforeDeadline,
  installVisualSmokeFatalObserver,
  parseVisualSmokeArguments,
  projectLyricsReadinessScript,
  runVisualSmoke,
  sendTrustedStyleActivation,
  sendTrustedStyleText,
  sendTrustedTimelineDensityOpen,
  sendTrustedTimelineDensityTiming,
  styleDestinationLayoutScript,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  timelineDensityCaptureStateScript,
  timelineDensityReadinessScript,
  validProjectLyricsState,
  validStyleDestinationLayout,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
  validTimelineDensityCaptureState,
  validTimelineDensityOpenTarget,
  validTimelineDensityState,
  validTimelineDensityTimingTarget,
  layoutSmokeProfile,
}
