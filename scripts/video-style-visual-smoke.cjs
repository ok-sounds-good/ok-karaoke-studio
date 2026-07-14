'use strict'

const { randomUUID } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')

const electron = require('electron')
const { outputState } = require('../electron/smoke-artifacts.cjs')
const {
  createOwnedSmokeProfile,
  verifyRetainedSmokeProfile,
} = require('../electron/smoke-profile.cjs')
const {
  validateOutputPath,
  writeLauncherFailureArtifact,
} = require('../electron/video-style-visual-smoke.cjs')
const {
  publicChildOutcomeCode,
  publicStatusLine,
  runBoundedChild,
} = require('./bounded-child.cjs')
const { validateVisualSmokeResult } = require('./visual-result-validation.cjs')

const CHILD_TIMEOUT_MS = 60_000

function emitPublicFailure(code) {
  console.error(publicStatusLine(code))
}

async function run(options = {}) {
  const environment = options.environment || process.env
  const emitFailure = options.emitFailure || emitPublicFailure
  const runChild = options.runChild || runBoundedChild
  const createProfile = options.createProfile || createOwnedSmokeProfile
  const verifyProfile = options.verifyProfile || verifyRetainedSmokeProfile
  const validateResult = options.validateResult || validateVisualSmokeResult
  const repositoryRoot = path.resolve(__dirname, '..')
  const defaultOutput = path.join(
    os.tmpdir(),
    `okay-karaoke-video-style-evidence-${randomUUID()}`,
  )
  const rawOutput = environment.OKS_VISUAL_SMOKE_OUTPUT ?? defaultOutput
  let output
  try {
    output = validateOutputPath(rawOutput)
    if ((await outputState(output)).state !== 'absent') {
      emitFailure('VISUAL_SMOKE_OUTPUT_EXISTS')
      return 1
    }
  } catch {
    emitFailure('VISUAL_SMOKE_OUTPUT_INVALID')
    return 1
  }

  let profile
  try {
    profile = await createProfile('okay-karaoke-visual-profile-')
  } catch {
    emitFailure('VISUAL_SMOKE_PROFILE_FAILED')
    return 1
  }

  const outcome = await runChild({
    executable: electron,
    args: ['--force-device-scale-factor=1', '.', '--video-style-visual-smoke'],
    spawnOptions: {
      cwd: repositoryRoot,
      env: {
        ...environment,
        OKS_VISUAL_SMOKE_OUTPUT: output,
        OKS_VISUAL_SMOKE_PROFILE_IDENTITY: profile.serializedIdentity,
        OKS_VISUAL_SMOKE_USER_DATA: profile.path,
      },
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
    timeoutMs: CHILD_TIMEOUT_MS,
  })

  let profileIdentityFailed = false
  if (outcome.terminationConfirmed) {
    try {
      await verifyProfile(profile)
    } catch {
      profileIdentityFailed = true
    }
  }

  if (outcome.forwardedSignal && outcome.terminationConfirmed) {
    try {
      await writeLauncherFailureArtifact(output)
    } catch {
      // A completed or raced output remains untouched.
    }
    if (profileIdentityFailed) emitFailure('VISUAL_SMOKE_PROFILE_IDENTITY_FAILED')
    ;(options.forwardSignal || process.kill)(process.pid, outcome.forwardedSignal)
    return 1
  }

  let outcomeCode = publicChildOutcomeCode('VISUAL_SMOKE', outcome)
  if (!outcomeCode && !profileIdentityFailed) {
    try {
      await validateResult(output)
    } catch {
      outcomeCode = 'VISUAL_SMOKE_RESULT_INVALID'
    }
  }
  const failureCode = outcomeCode || (
    profileIdentityFailed ? 'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED' : null
  )
  if (failureCode) {
    try {
      await writeLauncherFailureArtifact(output)
    } catch {
      // A fixed status remains safe when the evidence directory cannot be claimed.
    }
    emitFailure(failureCode)
    return 1
  }
  return 0
}

if (require.main === module) {
  run().then((code) => {
    process.exitCode = code
  }).catch(() => {
    emitPublicFailure('VISUAL_SMOKE_LAUNCHER_FAILED')
    process.exitCode = 1
  })
}

module.exports = { run }
