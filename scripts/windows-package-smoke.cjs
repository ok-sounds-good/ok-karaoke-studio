'use strict'

const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { publicChildOutcomeCode, runBoundedChild } = require('./bounded-child.cjs')
const visualLauncher = require('./video-style-visual-smoke.cjs')
const visualResults = require('./visual-result-validation.cjs')
const { lockedJobChildOptions } = require('./windows-locked-job.cjs')
const smokeArtifacts = require('../electron/smoke-artifacts.cjs')
const { PACKAGED_APP_URL, STUDIO_BRIDGE_KEYS } = require('../electron/video-style-visual-smoke.cjs')

const REPOSITORY_ROOT = path.resolve(__dirname, '..')
const EXECUTABLE_RELATIVE_PATH = 'release/win-unpacked/Okay Karaoke Studio.exe'
const RESOURCE_RELATIVE_PATH = 'release/win-unpacked/resources/app.asar'
const OUTPUT_RELATIVE_PATH = 'release/windows-package-smoke'
const DEFAULT_TIMEOUT_MS = 120_000
const FAILURE = Object.freeze({ code: 'WINDOWS_PACKAGE_SMOKE_FAILED', ok: false })
const SCENARIOS = [
  { directory: 'baseline', name: visualResults.BASELINE_SCENARIO },
  { directory: 'style-session', name: visualResults.STYLE_SESSION_SCENARIO },
]

function smokeError() {
  const error = new Error(FAILURE.code)
  error.code = FAILURE.code
  return error
}

function ownedPath(root, relativePath) {
  const candidate = path.resolve(root, ...relativePath.split('/'))
  const relative = path.relative(path.resolve(root), candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) throw smokeError()
  return candidate
}

function sameFile(left, right) {
  return Boolean(
    left &&
    right &&
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((field) => left[field] === right[field]),
  )
}

async function assertPlainPath(root, candidate, fsApi, directory = false) {
  const relative = path.relative(root, candidate)
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stats = await fsApi.lstat(current, { bigint: true })
    const leaf = current === candidate
    if (
      stats.isSymbolicLink() ||
      (leaf ? (directory ? !stats.isDirectory() : !stats.isFile()) : !stats.isDirectory())
    )
      throw smokeError()
  }
  const realRoot = await fsApi.realpath(root)
  const realCandidate = await fsApi.realpath(candidate)
  const realRelative = path.relative(realRoot, realCandidate)
  if (
    !realRelative ||
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  )
    throw smokeError()
}

async function readRegular(file, limit, fsApi) {
  const linked = await fsApi.lstat(file, { bigint: true })
  if (!linked.isFile() || linked.isSymbolicLink() || linked.size > BigInt(limit)) throw smokeError()
  let handle
  try {
    handle = await fsApi.open(file, 'r')
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFile(linked, opened)) throw smokeError()
    const bytes = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    if (!sameFile(opened, afterRead) || BigInt(bytes.length) !== afterRead.size) throw smokeError()
    await handle.close()
    handle = null
    const final = await fsApi.lstat(file, { bigint: true })
    if (final.isSymbolicLink() || !sameFile(afterRead, final)) throw smokeError()
    return bytes
  } finally {
    await handle?.close()
  }
}

async function fingerprintFile(root, relativePath, fsApi = fs) {
  const candidate = ownedPath(root, relativePath)
  try {
    await assertPlainPath(root, candidate, fsApi)
    const bytes = await readRegular(candidate, Number.MAX_SAFE_INTEGER, fsApi)
    return {
      bytes: bytes.length,
      path: relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  } catch (error) {
    if (error?.code === FAILURE.code) throw error
    throw smokeError()
  }
}

function fingerprintPackage(root, fsApi) {
  return Promise.all([
    fingerprintFile(root, EXECUTABLE_RELATIVE_PATH, fsApi),
    fingerprintFile(root, RESOURCE_RELATIVE_PATH, fsApi),
  ])
}

function packageChildOptions(options, root, fingerprints) {
  const resource = ownedPath(root, RESOURCE_RELATIVE_PATH)
  return lockedJobChildOptions(options, {
    executableSha256: fingerprints[0].sha256,
    resource,
    resourceSha256: fingerprints[1].sha256,
    root,
  })
}

function cleanChildOutcome(outcome) {
  const evidence = {
    code: outcome?.code ?? null,
    fatal: outcome?.diagnostics?.fatal === true,
    overflow: outcome?.diagnostics?.overflow === true,
    signal: outcome?.signal ?? null,
    terminationConfirmed: outcome?.terminationConfirmed === true,
    timedOut: outcome?.timedOut === true,
  }
  if (
    publicChildOutcomeCode('VISUAL_SMOKE', outcome) ||
    !evidence.terminationConfirmed ||
    outcome?.forwardedSignal ||
    outcome?.terminationAttempted === true ||
    outcome?.killFailed === true
  )
    throw smokeError()
  return evidence
}

function launchLog(launches) {
  return `${launches
    .map(({ child, scenario }) => JSON.stringify({ scenario, ...child }))
    .join('\n')}\n`
}

function artifactEvidence(manifest) {
  return manifest.artifacts.map(({ bytes, height, name, sha256, width }) => ({
    bytes,
    height,
    name,
    sha256,
    width,
  }))
}

function manifestFor(executable, resource, launches) {
  return {
    cleanup: {
      outputPublishedAfterExit: true,
      profiles: 'ephemeral-machine-teardown',
    },
    diagnostics: { fatal: false, maxBytesPerStream: 64 * 1024, overflow: false },
    executable,
    launches,
    ok: true,
    resource,
    runtime: {
      bridge: 'studio',
      bridgeFrozen: true,
      bridgeFunctions: true,
      bridgeKeys: STUDIO_BRIDGE_KEYS,
      ipcRoundTrip: 'getPendingWindowClose',
      nodeAccess: false,
      url: PACKAGED_APP_URL,
      windows: 1,
    },
    schemaVersion: 1,
  }
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest)}\n`
}

async function validateWindowsPackageSmokeDirectory(rawOutput, options = {}) {
  const root = path.resolve(options.root || REPOSITORY_ROOT)
  const fsApi = options.fsApi || fs
  const validateVisual = options.validateVisual || visualResults.validateVisualResultDirectory
  const output = smokeArtifacts.validateFreshOutputPath(rawOutput)
  if (output !== ownedPath(root, OUTPUT_RELATIVE_PATH)) throw smokeError()
  await assertPlainPath(root, output, fsApi, true)
  const claim = await smokeArtifacts.inspectOutputDirectory(output, fsApi)
  const stableDirectory = await fsApi.lstat(output, { bigint: true })
  const names = (await fsApi.readdir(output)).sort()
  await smokeArtifacts.assertClaimedDirectory(claim, fsApi)
  if (names.join(',') !== 'baseline,launch.log,result.json,style-session') throw smokeError()
  const resultBytes = await readRegular(path.join(output, 'result.json'), 128 * 1024, fsApi)
  await smokeArtifacts.assertClaimedDirectory(claim, fsApi)
  let manifest
  try {
    manifest = JSON.parse(resultBytes.toString('utf8'))
  } catch {
    throw smokeError()
  }
  if (
    !Array.isArray(manifest?.launches) ||
    manifest.launches.length !== SCENARIOS.length ||
    !resultBytes.equals(
      Buffer.from(
        serializeManifest(manifestFor(manifest.executable, manifest.resource, manifest.launches)),
      ),
    )
  )
    throw smokeError()

  for (const [index, scenario] of SCENARIOS.entries()) {
    const launch = manifest.launches[index]
    if (
      !launch ||
      Object.keys(launch).sort().join(',') !== 'artifacts,child,directory,scenario' ||
      launch.scenario !== scenario.name ||
      launch.directory !== scenario.directory ||
      JSON.stringify(launch.child) !==
        '{"code":0,"fatal":false,"overflow":false,"signal":null,"terminationConfirmed":true,"timedOut":false}'
    )
      throw smokeError()
    const visual = await validateVisual(path.join(output, scenario.directory), {
      fsApi,
      scenario: scenario.name,
    })
    await smokeArtifacts.assertClaimedDirectory(claim, fsApi)
    if (JSON.stringify(launch.artifacts) !== JSON.stringify(artifactEvidence(visual))) {
      throw smokeError()
    }
  }
  const [executable, resource] = await fingerprintPackage(root, fsApi)
  if (
    JSON.stringify(executable) !== JSON.stringify(manifest.executable) ||
    JSON.stringify(resource) !== JSON.stringify(manifest.resource)
  )
    throw smokeError()
  const finalResult = await readRegular(path.join(output, 'result.json'), 128 * 1024, fsApi)
  const finalLog = await readRegular(path.join(output, 'launch.log'), 8 * 1024, fsApi)
  const finalNames = await fsApi.readdir(output)
  if (
    !finalResult.equals(resultBytes) ||
    finalLog.toString('utf8') !== launchLog(manifest.launches) ||
    finalNames.sort().join(',') !== names.join(',')
  )
    throw smokeError()
  if (!sameFile(stableDirectory, await fsApi.lstat(output, { bigint: true }))) throw smokeError()
  await assertPlainPath(root, output, fsApi, true)
  await smokeArtifacts.assertClaimedDirectory(claim, fsApi)
  return Object.freeze(manifest)
}

async function writeFailure(claim, fsApi) {
  try {
    await smokeArtifacts.writeCompletionMarker(
      claim,
      { bytes: Buffer.from(`${JSON.stringify(FAILURE)}\n`), name: 'failure.json' },
      {},
      fsApi,
    )
  } catch {
    // Preserve any existing result or failure rather than replacing evidence.
  }
}

async function runWindowsPackageSmoke(options = {}, supplied = {}) {
  const root = path.resolve(options.root || REPOSITORY_ROOT)
  const fsApi = options.fsApi || fs
  const output = smokeArtifacts.validateFreshOutputPath(
    options.output || ownedPath(root, OUTPUT_RELATIVE_PATH),
  )
  const executablePath = ownedPath(root, EXECUTABLE_RELATIVE_PATH)
  const runChild = supplied.runChild || runBoundedChild
  const runVisual = supplied.runVisual || visualLauncher.runLauncher
  const validateVisual = supplied.validateVisual || visualResults.validateVisualResultDirectory
  const record = options.record || ((value) => process.stdout.write(`${JSON.stringify(value)}\n`))
  let outputClaim = null
  try {
    if (output !== ownedPath(root, OUTPUT_RELATIVE_PATH)) throw smokeError()
    const packageFingerprint = await fingerprintPackage(root, fsApi)
    const [executable, resource] = packageFingerprint
    record({ event: 'windows-package-smoke-executable', ...executable })
    outputClaim = await smokeArtifacts.claimOutputDirectory(output, { fsApi })
    await assertPlainPath(root, output, fsApi, true)

    const launches = []
    for (const scenario of SCENARIOS) {
      await smokeArtifacts.assertClaimedDirectory(outputClaim, fsApi)
      let child = null
      const scenarioOutput = path.join(output, scenario.directory)
      const argv =
        scenario.name === visualResults.BASELINE_SCENARIO
          ? [scenarioOutput]
          : [`${visualLauncher.SCENARIO_ARGUMENT}${scenario.name}`, scenarioOutput]
      const outcome = await runVisual(
        {
          argv,
          executable: executablePath,
          packaged: true,
          timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        },
        {
          runChild: async (childOptions) => {
            const observed = await runChild(
              packageChildOptions(childOptions, root, packageFingerprint),
            )
            child = cleanChildOutcome(observed)
            return observed
          },
        },
      )
      if (!outcome?.ok || !child) throw smokeError()
      await smokeArtifacts.assertClaimedDirectory(outputClaim, fsApi)
      const visual = await validateVisual(scenarioOutput, { fsApi, scenario: scenario.name })
      launches.push({
        artifacts: artifactEvidence(visual),
        child,
        directory: scenario.directory,
        scenario: scenario.name,
      })
    }
    if (
      JSON.stringify(await fingerprintPackage(root, fsApi)) !== JSON.stringify(packageFingerprint)
    )
      throw smokeError()

    const manifest = manifestFor(executable, resource, launches)
    await smokeArtifacts.writeExclusiveArtifact(
      outputClaim,
      { bytes: Buffer.from(launchLog(launches)), name: 'launch.log' },
      {},
      fsApi,
    )
    await smokeArtifacts.writeCompletionMarker(
      outputClaim,
      { bytes: Buffer.from(serializeManifest(manifest)), name: 'result.json' },
      {},
      fsApi,
    )
    return {
      manifest: await validateWindowsPackageSmokeDirectory(output, {
        fsApi,
        root,
        validateVisual,
      }),
      ok: true,
    }
  } catch {
    if (outputClaim) await writeFailure(outputClaim, fsApi)
    return FAILURE
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--validate') {
    await validateWindowsPackageSmokeDirectory(ownedPath(REPOSITORY_ROOT, OUTPUT_RELATIVE_PATH))
    process.stdout.write('{"ok":true,"validated":true}\n')
    return
  }
  if (argv.length !== 0) throw smokeError()
  const result = await runWindowsPackageSmoke()
  const stream = result.ok ? process.stdout : process.stderr
  stream.write(`${JSON.stringify(result.ok ? { ok: true } : FAILURE)}\n`)
  process.exitCode = result.ok ? 0 : 1
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(`${JSON.stringify(FAILURE)}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  EXECUTABLE_RELATIVE_PATH,
  FAILURE,
  OUTPUT_RELATIVE_PATH,
  RESOURCE_RELATIVE_PATH,
  runWindowsPackageSmoke,
  validateWindowsPackageSmokeDirectory,
}
