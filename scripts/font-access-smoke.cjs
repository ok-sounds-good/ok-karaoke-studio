'use strict'

const path = require('node:path')

const electron = require('electron')
const {
  createOwnedSmokeProfile,
  verifyRetainedSmokeProfile,
} = require('../electron/smoke-profile.cjs')
const {
  publicChildOutcomeCode,
  publicStatusLine,
  runBoundedChild,
} = require('./bounded-child.cjs')

const CHILD_TIMEOUT_MS = 45_000

function emitPublicFailure(code) {
  console.error(publicStatusLine(code))
}

async function run(options = {}) {
  const environment = options.environment || process.env
  const emitFailure = options.emitFailure || emitPublicFailure
  const runChild = options.runChild || runBoundedChild
  const createProfile = options.createProfile || createOwnedSmokeProfile
  const verifyProfile = options.verifyProfile || verifyRetainedSmokeProfile
  const repositoryRoot = path.resolve(__dirname, '..')
  let profile
  try {
    profile = await createProfile('okay-karaoke-font-smoke-')
  } catch {
    emitFailure('FONT_SMOKE_PROFILE_FAILED')
    return 1
  }

  const outcome = await runChild({
    executable: electron,
    args: ['--force-device-scale-factor=1', '.', '--font-access-smoke'],
    spawnOptions: {
      cwd: repositoryRoot,
      env: {
        ...environment,
        OKS_FONT_SMOKE_PROFILE_IDENTITY: profile.serializedIdentity,
        OKS_FONT_SMOKE_USER_DATA: profile.path,
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
    if (profileIdentityFailed) emitFailure('FONT_SMOKE_PROFILE_IDENTITY_FAILED')
    ;(options.forwardSignal || process.kill)(process.pid, outcome.forwardedSignal)
    return 1
  }

  const outcomeCode = publicChildOutcomeCode('FONT_SMOKE', outcome)
  if (outcomeCode || profileIdentityFailed) {
    emitFailure(outcomeCode || 'FONT_SMOKE_PROFILE_IDENTITY_FAILED')
    return 1
  }
  return 0
}

if (require.main === module) {
  run().then((code) => {
    process.exitCode = code
  }).catch(() => {
    emitPublicFailure('FONT_SMOKE_LAUNCHER_FAILED')
    process.exitCode = 1
  })
}

module.exports = { run }
