'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const COMPLETION_MARKERS = new Set(['failure.json', 'result.json'])
const ARTIFACT_NAME = /^[a-z0-9][a-z0-9.-]{0,100}$/iu

function artifactError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function validateFreshOutputPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath || !path.isAbsolute(rawPath)) {
    throw artifactError('VISUAL_OUTPUT_INVALID')
  }
  const resolved = path.resolve(rawPath)
  if (resolved === path.parse(resolved).root) throw artifactError('VISUAL_OUTPUT_INVALID')
  return resolved
}

async function lstatOrNull(filePath, fsApi = fs) {
  try {
    return await fsApi.lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function outputState(rawOutput, fsApi = fs) {
  const output = validateFreshOutputPath(rawOutput)
  const stats = await lstatOrNull(output, fsApi)
  if (!stats) return { output, state: 'absent' }
  if (!stats.isDirectory() || stats.isSymbolicLink()) return { output, state: 'unknown' }
  for (const marker of COMPLETION_MARKERS) {
    const markerStats = await lstatOrNull(path.join(output, marker), fsApi)
    if (markerStats?.isFile() && !markerStats.isSymbolicLink()) {
      return { output, state: 'complete' }
    }
  }
  return { output, state: 'unknown' }
}

function statIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

async function assertClaimedDirectory(claim, fsApi) {
  let stats
  let realPath
  try {
    stats = await fsApi.lstat(claim.output)
    realPath = await fsApi.realpath(claim.output)
  } catch {
    throw artifactError('VISUAL_OUTPUT_RACE')
  }
  if (
    !stats.isDirectory() || stats.isSymbolicLink() ||
    !sameIdentity(statIdentity(stats), claim) ||
    realPath !== claim.realPath
  ) throw artifactError('VISUAL_OUTPUT_RACE')
}

async function claimOutputDirectory(rawOutput, options = {}) {
  const fsApi = options.fsApi || fs
  const { output, state } = await outputState(rawOutput, fsApi)
  if (state !== 'absent') throw artifactError('VISUAL_OUTPUT_EXISTS')
  await options.beforeClaim?.(output)
  try {
    await fsApi.mkdir(output, { recursive: false })
  } catch (error) {
    if (error?.code === 'EEXIST') throw artifactError('VISUAL_OUTPUT_EXISTS')
    throw error
  }
  const stats = await fsApi.lstat(output)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw artifactError('VISUAL_OUTPUT_RACE')
  }
  return {
    ...statIdentity(stats),
    output,
    realPath: await fsApi.realpath(output),
  }
}

function normalizeArtifactBuffers(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw artifactError('VISUAL_ARTIFACTS_INVALID')
  }
  const names = new Set()
  const normalized = artifacts.map((artifact) => {
    if (
      !artifact || typeof artifact !== 'object' ||
      typeof artifact.name !== 'string' || !ARTIFACT_NAME.test(artifact.name) ||
      names.has(artifact.name) || !Buffer.isBuffer(artifact.bytes)
    ) throw artifactError('VISUAL_ARTIFACTS_INVALID')
    names.add(artifact.name)
    return { name: artifact.name, bytes: artifact.bytes }
  })
  const markers = normalized.filter((artifact) => COMPLETION_MARKERS.has(artifact.name))
  if (
    markers.length !== 1 ||
    normalized.at(-1).name !== markers[0].name
  ) throw artifactError('VISUAL_ARTIFACTS_INVALID')
  return normalized
}

async function publishArtifactBuffers(rawOutput, artifacts, options = {}) {
  const fsApi = options.fsApi || fs
  const normalized = normalizeArtifactBuffers(artifacts)
  const claim = await claimOutputDirectory(rawOutput, options)
  for (const artifact of normalized) {
    await options.beforeWrite?.(claim.output, artifact.name)
    await assertClaimedDirectory(claim, fsApi)
    try {
      await fsApi.writeFile(path.join(claim.output, artifact.name), artifact.bytes, { flag: 'wx' })
    } catch (error) {
      if (error?.code === 'EEXIST') throw artifactError('VISUAL_OUTPUT_RACE')
      throw error
    }
    await assertClaimedDirectory(claim, fsApi)
  }
  return claim.output
}

async function writeFreshLauncherFailure(rawOutput, failure, options = {}) {
  const fsApi = options.fsApi || fs
  const { output, state } = await outputState(rawOutput, fsApi)
  if (state === 'complete') return 'existing-complete'
  if (state !== 'absent') throw artifactError('VISUAL_OUTPUT_EXISTS')
  await publishArtifactBuffers(output, [{
    name: 'failure.json',
    bytes: Buffer.from(`${JSON.stringify(failure, null, 2)}\n`, 'utf8'),
  }], options)
  return 'created'
}

module.exports = {
  artifactError,
  outputState,
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
}
