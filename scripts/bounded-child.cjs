'use strict'

const { spawn } = require('node:child_process')

const PUBLIC_CODES = new Set([
  'FONT_SMOKE_CHILD_FAILED',
  'FONT_SMOKE_CHILD_SIGNAL',
  'FONT_SMOKE_LAUNCHER_FAILED',
  'FONT_SMOKE_PROFILE_IDENTITY_FAILED',
  'FONT_SMOKE_PROFILE_FAILED',
  'FONT_SMOKE_START_FAILED',
  'FONT_SMOKE_TERMINATION_UNCONFIRMED',
  'FONT_SMOKE_TIMEOUT',
  'SMOKE_LAUNCHER_FAILED',
  'VISUAL_SMOKE_CHILD_FAILED',
  'VISUAL_SMOKE_CHILD_SIGNAL',
  'VISUAL_SMOKE_LAUNCHER_FAILED',
  'VISUAL_SMOKE_OUTPUT_EXISTS',
  'VISUAL_SMOKE_OUTPUT_INVALID',
  'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED',
  'VISUAL_SMOKE_PROFILE_FAILED',
  'VISUAL_SMOKE_RESULT_INVALID',
  'VISUAL_SMOKE_START_FAILED',
  'VISUAL_SMOKE_TERMINATION_UNCONFIRMED',
  'VISUAL_SMOKE_TIMEOUT',
])

function childHasExited(child) {
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null))
}

function ignoredStdioOptions(spawnOptions) {
  if (!spawnOptions || typeof spawnOptions !== 'object' || Array.isArray(spawnOptions)) return null
  const stdio = spawnOptions.stdio
  const ignoredArray = Array.isArray(stdio) && stdio.length >= 3 &&
    stdio.every((entry) => entry === 'ignore')
  if (stdio !== undefined && stdio !== 'ignore' && !ignoredArray) return null
  return { ...spawnOptions, stdio: ignoredArray ? [...stdio] : 'ignore' }
}

function validDuration(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function startFailure() {
  return {
    code: null,
    forwardedSignal: null,
    killFailed: false,
    postSpawnError: false,
    signal: null,
    spawned: false,
    startFailed: true,
    terminationAttempted: false,
    terminationConfirmed: true,
    terminationUnconfirmed: false,
    timedOut: false,
  }
}

function runBoundedChild(options) {
  const {
    executable,
    args = [],
    spawnOptions = {},
    timeoutMs,
    killGraceMs = 2_000,
    forceSettleMs = 250,
    spawnImpl = spawn,
    processLike = process,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = options

  const safeSpawnOptions = ignoredStdioOptions(spawnOptions)
  if (
    !safeSpawnOptions || !validDuration(timeoutMs) ||
    !validDuration(killGraceMs) || !validDuration(forceSettleMs)
  ) return Promise.resolve(startFailure())

  return new Promise((resolve) => {
    let child = null
    let timeout = null
    let forceKill = null
    let forceSettle = null
    let settled = false
    let spawned = false
    let timedOut = false
    let forwardedSignal = null
    let postSpawnError = false
    let killFailed = false
    let terminationAttempted = false

    const cleanup = () => {
      if (timeout !== null) clearTimeoutImpl(timeout)
      if (forceKill !== null) clearTimeoutImpl(forceKill)
      if (forceSettle !== null) clearTimeoutImpl(forceSettle)
      processLike.removeListener('SIGINT', onInterrupt)
      processLike.removeListener('SIGTERM', onTermination)
    }
    const finish = (outcome) => {
      if (settled) return
      settled = true
      if (outcome.terminationUnconfirmed) {
        try {
          child.unref()
        } catch {
          killFailed = true
        }
      }
      cleanup()
      resolve({
        forwardedSignal,
        killFailed,
        postSpawnError,
        spawned,
        terminationAttempted,
        timedOut,
        ...outcome,
      })
    }
    const attemptKill = (signal) => {
      if (!child || childHasExited(child)) return
      try {
        if (child.kill(signal) === false) killFailed = true
      } catch {
        killFailed = true
      }
    }
    const requestTermination = (signal) => {
      if (settled || !child || childHasExited(child)) return
      terminationAttempted = true
      attemptKill(signal)
      if (forceKill) return
      forceKill = setTimeoutImpl(() => {
        if (settled || childHasExited(child)) return
        attemptKill('SIGKILL')
        if (settled || childHasExited(child)) return
        forceSettle = setTimeoutImpl(() => {
          if (settled) return
          finish({
            code: null,
            signal: null,
            startFailed: false,
            terminationConfirmed: false,
            terminationUnconfirmed: true,
          })
        }, forceSettleMs)
      }, killGraceMs)
    }
    function forward(signal) {
      if (forwardedSignal) return
      forwardedSignal = signal
      requestTermination(signal)
    }
    function onInterrupt() { forward('SIGINT') }
    function onTermination() { forward('SIGTERM') }

    processLike.on('SIGINT', onInterrupt)
    processLike.on('SIGTERM', onTermination)
    try {
      child = spawnImpl(executable, args, safeSpawnOptions)
    } catch {
      finish({
        code: null,
        signal: null,
        startFailed: true,
        terminationConfirmed: true,
        terminationUnconfirmed: false,
      })
      return
    }

    child.once('spawn', () => { spawned = true })
    child.on('error', () => {
      if (!spawned && !terminationAttempted) {
        finish({
          code: null,
          signal: null,
          startFailed: true,
          terminationConfirmed: true,
          terminationUnconfirmed: false,
        })
        return
      }
      postSpawnError = true
      requestTermination('SIGTERM')
    })
    child.once('exit', (code, signal) => finish({
      code,
      signal,
      startFailed: false,
      terminationConfirmed: true,
      terminationUnconfirmed: false,
    }))
    timeout = setTimeoutImpl(() => {
      timedOut = true
      requestTermination('SIGTERM')
    }, timeoutMs)
    // A signal can arrive synchronously inside a test or wrapper spawnImpl,
    // before its returned child has been assigned. Replay it only after all
    // child lifecycle listeners are installed so escalation stays observable.
    if (forwardedSignal) requestTermination(forwardedSignal)
  })
}

function publicChildOutcomeCode(prefix, outcome) {
  if (prefix !== 'FONT_SMOKE' && prefix !== 'VISUAL_SMOKE') {
    return 'SMOKE_LAUNCHER_FAILED'
  }
  if (outcome.startFailed) return `${prefix}_START_FAILED`
  if (outcome.terminationUnconfirmed) return `${prefix}_TERMINATION_UNCONFIRMED`
  if (outcome.timedOut) return `${prefix}_TIMEOUT`
  if (outcome.signal) return `${prefix}_CHILD_SIGNAL`
  if (outcome.postSpawnError || outcome.code !== 0) return `${prefix}_CHILD_FAILED`
  return null
}

function publicStatusLine(code) {
  return JSON.stringify({
    code: PUBLIC_CODES.has(code) ? code : 'SMOKE_LAUNCHER_FAILED',
    ok: false,
  })
}

module.exports = {
  publicChildOutcomeCode,
  publicStatusLine,
  runBoundedChild,
}
