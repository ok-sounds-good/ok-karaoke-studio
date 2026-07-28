'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const electronExecutable = require('electron')
const {
  createOwnedSmokeProfile,
  pathsAreSeparate,
  verifyRetainedSmokeProfile,
} = require('../electron/smoke-profile.cjs')
const {
  outputState,
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('../electron/smoke-artifacts.cjs')
const { publicChildOutcomeCode, publicStatusLine, runBoundedChild } = require('./bounded-child.cjs')
const {
  BASELINE_SCENARIO,
  STYLE_SESSION_SCENARIO,
  TIMELINE_DENSITY_SCENARIO,
  validateVisualResultDirectory,
} = require('./visual-result-validation.cjs')
const {
  FATAL_DIAGNOSTIC,
  OPTIONS,
  TIMELINE_DENSITY_FIXTURE_NAME,
  TIMELINE_DENSITY_TITLE,
  TRIGGER,
} = require('../electron/video-style-visual-smoke.cjs')
const { LAYOUT_SMOKE_PROFILES } = require('../electron/visual-smoke-layout-profiles.cjs')

const REPOSITORY_ROOT = path.resolve(__dirname, '..')
const OUTPUT_ENVIRONMENT_KEY = 'OKS_VISUAL_EVIDENCE_DIR'
const PROFILE_ARGUMENT = '--profile='
const SCENARIO_ARGUMENT = '--scenario='
const DEFAULT_TIMEOUT_MS = 45_000
const MAX_DIAGNOSTIC_BYTES = 64 * 1024
const FATAL_DIAGNOSTIC_PATTERNS = Object.freeze([
  FATAL_DIAGNOSTIC.trim(),
  'Uncaught ',
  'UnhandledPromiseRejection',
  'Unhandled Rejection',
  'TypeError: Object has been destroyed',
  'Fatal error',
  'FATAL:',
  'CHECK failed',
])

function capturedFatalDiagnostic(stdout, stderr) {
  const captured = Buffer.concat([stdout, Buffer.from('\n'), stderr]).toString('utf8')
  const normalized = captured.toLocaleLowerCase('en-US')
  return FATAL_DIAGNOSTIC_PATTERNS.some((pattern) =>
    normalized.includes(pattern.toLocaleLowerCase('en-US')),
  )
}

function launcherError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

const TIMELINE_DENSITY_TRACK_COUNT = 8
const TIMELINE_DENSITY_LINES_PER_TRACK = 125
const TIMELINE_DENSITY_WORDS_PER_LINE = 5
const TIMELINE_DENSITY_WORDS_PER_TRACK =
  TIMELINE_DENSITY_LINES_PER_TRACK * TIMELINE_DENSITY_WORDS_PER_LINE
const TIMELINE_DENSITY_WORD_COUNT = TIMELINE_DENSITY_TRACK_COUNT * TIMELINE_DENSITY_WORDS_PER_TRACK
const TIMELINE_DENSITY_WORD_STEP_MS = 160
const TIMELINE_DENSITY_WORD_DURATION_MS = 150
const TIMELINE_DENSITY_SINGER_COLORS = Object.freeze([
  Object.freeze({ unsungColor: '#72687D', sungColor: '#FF8A2B' }),
  Object.freeze({ unsungColor: '#53707A', sungColor: '#42D3E8' }),
  Object.freeze({ unsungColor: '#765F7F', sungColor: '#E879F9' }),
  Object.freeze({ unsungColor: '#66714D', sungColor: '#A3E635' }),
  Object.freeze({ unsungColor: '#7C6252', sungColor: '#FB7185' }),
  Object.freeze({ unsungColor: '#596A86', sungColor: '#60A5FA' }),
  Object.freeze({ unsungColor: '#7A6546', sungColor: '#FACC15' }),
  Object.freeze({ unsungColor: '#4E7467', sungColor: '#34D399' }),
])

function systemTypeface(kind, family) {
  return {
    kind,
    family,
    faces: [
      {
        fullName: `${family} Regular`,
        style: 'Regular',
        postscriptName: null,
        weight: 400,
        slant: 'normal',
      },
      {
        fullName: `${family} Italic`,
        style: 'Italic',
        postscriptName: null,
        weight: 400,
        slant: 'italic',
      },
      {
        fullName: `${family} Semi Bold`,
        style: 'Semi Bold',
        postscriptName: null,
        weight: 600,
        slant: 'normal',
      },
      {
        fullName: `${family} Bold`,
        style: 'Bold',
        postscriptName: null,
        weight: 700,
        slant: 'normal',
      },
      {
        fullName: `${family} Extra Bold`,
        style: 'Extra Bold',
        postscriptName: null,
        weight: 800,
        slant: 'normal',
      },
    ],
  }
}

function textStyle(typeface, style, sizePx, color, extras = {}) {
  return {
    typeface,
    fontStyle: typeface.faces.find((face) => face.style === style),
    sizePx,
    color,
    ...extras,
  }
}

function timelineDensityStageStyle() {
  const systemUi = systemTypeface('system-ui', 'System UI')
  const systemMonospace = systemTypeface('system-monospace', 'System Monospace')
  return {
    background: {
      mode: 'gradient',
      solidColor: '#21182D',
      gradientStartColor: '#322242',
      gradientEndColor: '#1E1629',
      imagePath: null,
    },
    lyrics: {
      typeface: systemUi,
      fontStyle: systemUi.faces.find((face) => face.style === 'Extra Bold'),
      sizePx: 82,
    },
    titleCard: {
      eyebrow: textStyle(systemUi, 'Extra Bold', 25, '#FFAD69', {
        visible: true,
        position: { x: 960, y: 447 },
      }),
      title: textStyle(systemUi, 'Extra Bold', 104, '#FBF9FD', {
        visible: true,
        position: { x: 960, y: 550 },
      }),
      artist: textStyle(systemUi, 'Semi Bold', 42, '#B4ACBD', {
        visible: true,
        position: { x: 960, y: 650 },
      }),
    },
    stageFrame: {
      enabled: true,
      lineColor: '#473C54',
      lineWidthPx: 2,
      brand: textStyle(systemMonospace, 'Bold', 25, '#C1BBC7', { visible: true }),
      clock: textStyle(systemMonospace, 'Semi Bold', 27, '#BBB7C0', { visible: true }),
      footer: textStyle(systemUi, 'Bold', 24, '#B2AEB8', { visible: true }),
    },
  }
}

function createTimelineDensityProject() {
  const tracks = Array.from({ length: TIMELINE_DENSITY_TRACK_COUNT }, (_, trackIndex) => {
    const trackOrdinal = trackIndex + 1
    const trackToken = String(trackOrdinal).padStart(2, '0')
    const lines = Array.from({ length: TIMELINE_DENSITY_LINES_PER_TRACK }, (_, lineIndex) => {
      const lineOrdinal = lineIndex + 1
      const lineToken = String(lineOrdinal).padStart(3, '0')
      const words = Array.from({ length: TIMELINE_DENSITY_WORDS_PER_LINE }, (_, wordIndex) => {
        const wordOrdinal = wordIndex + 1
        const trackWordOrdinal = lineIndex * TIMELINE_DENSITY_WORDS_PER_LINE + wordIndex
        const startMs = trackWordOrdinal * TIMELINE_DENSITY_WORD_STEP_MS
        return {
          id: `timeline-density-word-${trackToken}-${lineToken}-${wordOrdinal}`,
          // Compact, per-track base-36 identities keep the real 150% Timeline
          // label lanes shallow while remaining exact across all 625 words.
          text: trackWordOrdinal.toString(36).padStart(2, '0'),
          startMs,
          endMs: startMs + TIMELINE_DENSITY_WORD_DURATION_MS,
        }
      })
      return {
        id: `timeline-density-line-${trackToken}-${lineToken}`,
        text: words.map(({ text }) => text).join(' '),
        startMs: words[0].startMs,
        endMs: words.at(-1).endMs,
        words,
      }
    })
    return {
      id: `timeline-density-track-${trackToken}`,
      name: `Density Vocal ${trackOrdinal}`,
      vocalStyle: {
        ...TIMELINE_DENSITY_SINGER_COLORS[trackIndex],
        alignment: 'center',
        position: { x: 960, y: 550 },
        previewMs: 3_000,
        syncAid: { enabled: false, minLeadMs: 2_000, maxLeadMs: 3_000 },
      },
      muted: false,
      solo: false,
      lines,
    }
  })
  return {
    schemaVersion: 0,
    id: 'timeline-density-5000-project',
    title: TIMELINE_DENSITY_TITLE,
    artist: 'Synthetic Evidence',
    audioPath: null,
    durationMs: TIMELINE_DENSITY_WORDS_PER_TRACK * TIMELINE_DENSITY_WORD_STEP_MS,
    offsetMs: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lyricDisplay: { lineCount: 2, advanceMode: 'scroll' },
    opening: { leadInMs: 0, titleTiming: { mode: 'until-lyrics' } },
    stageStyle: timelineDensityStageStyle(),
    tracks,
  }
}

function serializeTimelineDensityProject() {
  return `${JSON.stringify(createTimelineDensityProject())}\n`
}

async function writeTimelineDensityFixture(userProfile, fsApi = fs) {
  try {
    const profileRoot = validateFreshOutputPath(userProfile?.path)
    const fixturePath = validateFreshOutputPath(
      path.join(profileRoot, TIMELINE_DENSITY_FIXTURE_NAME),
    )
    if (path.dirname(fixturePath) !== profileRoot) throw launcherError('invalid fixture path')
    await fsApi.writeFile(fixturePath, serializeTimelineDensityProject(), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    return fixturePath
  } catch {
    throw launcherError('VISUAL_SMOKE_PROFILE_FAILED')
  }
}

async function requestedOutput(argv, environment, fsApi = fs) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
  if (argv.length > 1 || (argv.length === 1 && environment[OUTPUT_ENVIRONMENT_KEY])) {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
  let rawOutput = argv[0] || environment[OUTPUT_ENVIRONMENT_KEY]
  if (!rawOutput) {
    const root = await fsApi.mkdtemp(path.join(os.tmpdir(), 'oks-visual-evidence-'))
    rawOutput = path.join(root, 'video-style')
  }
  try {
    return validateFreshOutputPath(rawOutput)
  } catch {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
}

function requestedScenario(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  const scenarioArguments = argv.filter((value) => value.startsWith('--scenario'))
  if (scenarioArguments.length === 0) return BASELINE_SCENARIO
  if (scenarioArguments.length !== 1 || !scenarioArguments[0].startsWith(SCENARIO_ARGUMENT)) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  const scenario = scenarioArguments[0].slice(SCENARIO_ARGUMENT.length)
  if (scenario !== STYLE_SESSION_SCENARIO && scenario !== TIMELINE_DENSITY_SCENARIO) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  return scenario
}

function requestedProfile(argv, scenario) {
  const profileArguments = argv.filter((value) => value.startsWith('--profile'))
  if (scenario !== TIMELINE_DENSITY_SCENARIO) {
    if (profileArguments.length > 0) throw launcherError('VISUAL_SMOKE_PROFILE_INVALID')
    return null
  }
  if (profileArguments.length !== 1 || !profileArguments[0].startsWith(PROFILE_ARGUMENT)) {
    throw launcherError('VISUAL_SMOKE_PROFILE_INVALID')
  }
  const profileName = profileArguments[0].slice(PROFILE_ARGUMENT.length)
  const profile = LAYOUT_SMOKE_PROFILES.find(({ name }) => name === profileName)
  if (!profile) throw launcherError('VISUAL_SMOKE_PROFILE_INVALID')
  return profile
}

async function requestedRun(argv, environment, fsApi = fs) {
  const scenario = requestedScenario(argv)
  const profile = requestedProfile(argv, scenario)
  const outputArguments = argv.filter(
    (value) => !value.startsWith('--scenario') && !value.startsWith('--profile'),
  )
  const output = await requestedOutput(outputArguments, environment, fsApi)
  return Object.freeze({ output, profile, scenario })
}

async function claimFreshOutput(rawOutput, dependencies = {}) {
  const state = await (dependencies.outputState || outputState)(rawOutput)
  if (state.state !== 'absent') throw launcherError('VISUAL_SMOKE_OUTPUT_EXISTS')
  return state.output
}

async function createPrivateRawRoot(fsApi = fs) {
  return createOwnedSmokeProfile('oks-visual-raw-', { fsApi })
}

function privateRawOutput(rawRoot, requested, profileName = '100') {
  try {
    const root = validateFreshOutputPath(rawRoot?.path)
    if (typeof profileName !== 'string' || !/^(100|125|150|dpr2)$/u.test(profileName))
      throw launcherError('VISUAL_SMOKE_PROFILE_INVALID')
    const output = validateFreshOutputPath(path.join(root, `evidence-${profileName}`))
    if (!pathsAreSeparate(output, requested)) throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
    return output
  } catch {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
}

function childArguments(
  output,
  scenario,
  userProfile,
  sessionProfile,
  profile = LAYOUT_SMOKE_PROFILES[0],
  packaged = false,
) {
  if (typeof profile === 'boolean') {
    packaged = profile
    profile = LAYOUT_SMOKE_PROFILES[0]
  }
  if (
    scenario !== BASELINE_SCENARIO &&
    scenario !== STYLE_SESSION_SCENARIO &&
    scenario !== TIMELINE_DENSITY_SCENARIO
  ) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  if (!profile || typeof profile.name !== 'string')
    throw launcherError('VISUAL_SMOKE_PROFILE_INVALID')
  if (profile.deviceScale !== 1 && profile.deviceScale !== 2)
    throw launcherError('VISUAL_SMOKE_PROFILE_INVALID')
  return Object.freeze([
    `--force-device-scale-factor=${profile.deviceScale}`,
    ...(packaged ? [] : [REPOSITORY_ROOT]),
    TRIGGER,
    `${OPTIONS.output}${output}`,
    `${OPTIONS.profile}${profile.name}`,
    `${OPTIONS.scenario}${scenario}`,
    `${OPTIONS.userData}${userProfile.path}`,
    `${OPTIONS.userIdentity}${userProfile.serializedIdentity}`,
    `${OPTIONS.sessionData}${sessionProfile.path}`,
    `${OPTIONS.sessionIdentity}${sessionProfile.serializedIdentity}`,
  ])
}

async function retainProfiles(profiles, verify) {
  const results = await Promise.allSettled(profiles.map((profile) => verify(profile)))
  return results.every((result) => result.status === 'fulfilled')
}

async function publishLauncherFailure(output, code, dependencies) {
  const safeCode =
    typeof code === 'string' && code.startsWith('VISUAL_SMOKE_')
      ? code
      : 'VISUAL_SMOKE_LAUNCHER_FAILED'
  try {
    const current = await dependencies.outputState(output)
    if (current.state === 'absent') {
      await dependencies.writeFailure(output, { code: safeCode, ok: false })
    }
  } catch {
    return 'VISUAL_SMOKE_OUTPUT_INVALID'
  }
  return safeCode
}

async function runLauncher(options = {}, supplied = {}) {
  const fsApi = options.fsApi || fs
  const dependencies = {
    createRawRoot: supplied.createRawRoot || (() => createPrivateRawRoot(fsApi)),
    createProfile: supplied.createProfile || createOwnedSmokeProfile,
    outputState: supplied.outputState || outputState,
    publish: supplied.publish || publishArtifactBuffers,
    runChild: supplied.runChild || runBoundedChild,
    validateResult: supplied.validateResult || validateVisualResultDirectory,
    verifyProfile: supplied.verifyProfile || verifyRetainedSmokeProfile,
    verifyRawRoot:
      supplied.verifyRawRoot || ((rawRoot) => verifyRetainedSmokeProfile(rawRoot, { fsApi })),
    writeFailure: supplied.writeFailure || writeFreshLauncherFailure,
    writeDensityFixture:
      supplied.writeDensityFixture || ((profile) => writeTimelineDensityFixture(profile, fsApi)),
  }
  const argv = options.argv || []
  const environment = options.environment || {}
  let output
  let scenario
  let profiles = []
  let publishedArtifacts
  let rawRoot
  let rawRootClaimed = false
  let failureCode = null

  try {
    const request = await requestedRun(argv, environment, fsApi)
    output = request.output
    scenario = request.scenario
    output = await claimFreshOutput(output, dependencies)
    rawRoot = await dependencies.createRawRoot()
    rawRootClaimed = true
    const executable = options.executable || electronExecutable
    const packaged = options.packaged === true
    const requestedProfiles =
      scenario === TIMELINE_DENSITY_SCENARIO ? [request.profile] : LAYOUT_SMOKE_PROFILES
    for (const profile of requestedProfiles) {
      const profileOutput = privateRawOutput(rawRoot, output, profile.name)
      const userProfile = await dependencies.createProfile(`oks-visual-user-data-${profile.name}-`)
      const sessionProfile = await dependencies.createProfile(
        `oks-visual-session-data-${profile.name}-`,
      )
      profiles.push(userProfile, sessionProfile)
      if (scenario === TIMELINE_DENSITY_SCENARIO) {
        await dependencies.writeDensityFixture(userProfile)
      }
      const outcome = await dependencies.runChild({
        executable,
        args: childArguments(
          profileOutput,
          scenario,
          userProfile,
          sessionProfile,
          profile,
          packaged,
        ),
        captureOutput: {
          classify: capturedFatalDiagnostic,
          maxBytesPerStream: MAX_DIAGNOSTIC_BYTES,
        },
        spawnOptions: {
          cwd: packaged ? path.dirname(executable) : REPOSITORY_ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      })
      failureCode = publicChildOutcomeCode('VISUAL_SMOKE', outcome)
      if (
        !failureCode &&
        (outcome?.diagnostics?.fatal !== false || outcome?.diagnostics?.overflow !== false)
      ) {
        failureCode = 'VISUAL_SMOKE_CHILD_FAILED'
      }
      if (failureCode) break
      try {
        const validated = await dependencies.validateResult(profileOutput, {
          expectedProfile: profile,
          scenario,
        })
        if (!Array.isArray(validated?.publishedArtifacts)) throw launcherError('invalid result')
        if (scenario === TIMELINE_DENSITY_SCENARIO || profile.name === '100') {
          publishedArtifacts = validated.publishedArtifacts
        }
      } catch {
        failureCode = 'VISUAL_SMOKE_RESULT_INVALID'
        break
      }
    }
  } catch (error) {
    failureCode = typeof error?.code === 'string' ? error.code : 'VISUAL_SMOKE_LAUNCHER_FAILED'
  }

  if (profiles.length > 0 && !(await retainProfiles(profiles, dependencies.verifyProfile))) {
    failureCode = 'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED'
  }

  if (!failureCode && !Array.isArray(publishedArtifacts))
    failureCode = 'VISUAL_SMOKE_RESULT_INVALID'

  if (rawRootClaimed) {
    try {
      // Reuse the profile retention invariant: Node cannot recursively remove
      // a directory conditionally by its held identity on every platform.
      const retention = await dependencies.verifyRawRoot(rawRoot)
      if (retention?.retained !== true) throw launcherError('invalid retention')
    } catch {
      return Object.freeze({ code: 'VISUAL_SMOKE_OUTPUT_INVALID', ok: false })
    }
  }

  if (failureCode) {
    if (output) failureCode = await publishLauncherFailure(output, failureCode, dependencies)
    return Object.freeze({ code: failureCode, ok: false })
  }

  try {
    await dependencies.publish(output, publishedArtifacts)
    return Object.freeze({ ok: true })
  } catch {
    return Object.freeze({ code: 'VISUAL_SMOKE_OUTPUT_INVALID', ok: false })
  }
}

async function main() {
  const outcome = await runLauncher({
    argv: process.argv.slice(2),
    environment: process.env,
  })
  if (outcome.ok) {
    process.stdout.write('{"ok":true}\n')
    return 0
  }
  process.stderr.write(`${publicStatusLine(outcome.code)}\n`)
  return 1
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    () => {
      process.stderr.write(`${publicStatusLine('VISUAL_SMOKE_LAUNCHER_FAILED')}\n`)
      process.exitCode = 1
    },
  )
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_DIAGNOSTIC_BYTES,
  OUTPUT_ENVIRONMENT_KEY,
  PROFILE_ARGUMENT,
  REPOSITORY_ROOT,
  SCENARIO_ARGUMENT,
  childArguments,
  claimFreshOutput,
  createTimelineDensityProject,
  requestedOutput,
  requestedProfile,
  requestedRun,
  requestedScenario,
  runLauncher,
  serializeTimelineDensityProject,
  writeTimelineDensityFixture,
}
