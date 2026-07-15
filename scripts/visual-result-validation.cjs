'use strict'

const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { PNG_LIMITS, parseBoundedPngContainer } = require('../electron/png-validation.cjs')
const { validateFreshOutputPath } = require('../electron/smoke-artifacts.cjs')

const BASELINE_NAME = '01-baseline.png'
const RESULT_NAME = 'result.json'
const EXPECTED_FILES = Object.freeze([BASELINE_NAME, RESULT_NAME])
const VIEWPORT = Object.freeze({ height: 720, width: 1280 })
const MAX_RESULT_BYTES = 16 * 1024
const WORKFLOW_EVIDENCE_NAME = 'okay-karaoke-studio-video-style-visual'
const WORKFLOW_PATH_ARGUMENT = '--emit-workflow-evidence-path'

function resultError() {
  const error = new Error('VISUAL_SMOKE_RESULT_INVALID')
  error.code = 'VISUAL_SMOKE_RESULT_INVALID'
  return error
}

function statIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

function workflowEvidencePath(rawTemporaryRoot, pathApi = path) {
  try {
    if (
      typeof rawTemporaryRoot !== 'string' ||
      !rawTemporaryRoot ||
      !pathApi ||
      typeof pathApi.resolve !== 'function' ||
      typeof pathApi.join !== 'function' ||
      pathApi.resolve(rawTemporaryRoot) !== rawTemporaryRoot
    )
      throw resultError()
    const output = pathApi.join(rawTemporaryRoot, WORKFLOW_EVIDENCE_NAME)
    if (/[\r\n]/u.test(output)) throw resultError()
    return validateFreshOutputPath(output, pathApi)
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

async function writeWorkflowEvidencePath(environment = process.env, fsApi = fs, pathApi = path) {
  try {
    const githubOutput = environment?.GITHUB_OUTPUT
    if (
      typeof githubOutput !== 'string' ||
      !githubOutput ||
      githubOutput.includes('\0') ||
      /[\r\n]/u.test(githubOutput)
    )
      throw resultError()
    const output = workflowEvidencePath(environment.RUNNER_TEMP, pathApi)
    await fsApi.appendFile(githubOutput, `path=${output}\n`, 'utf8')
    return output
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

function plainDataObject(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw resultError()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))) {
    throw resultError()
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function validateBaselinePng(bytes) {
  let parsed
  try {
    parsed = parseBoundedPngContainer(bytes)
  } catch {
    throw resultError()
  }
  if (parsed.animated || parsed.width !== VIEWPORT.width || parsed.height !== VIEWPORT.height)
    throw resultError()
  return Object.freeze({
    bytes: bytes.length,
    height: parsed.height,
    name: BASELINE_NAME,
    sha256: sha256(bytes),
    width: parsed.width,
  })
}

function normalizeManifest(value) {
  const manifest = plainDataObject(value, ['artifacts', 'ok', 'schemaVersion'])
  if (
    manifest.ok !== true ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== 1
  )
    throw resultError()
  const artifact = plainDataObject(manifest.artifacts[0], [
    'bytes',
    'height',
    'name',
    'sha256',
    'width',
  ])
  if (
    artifact.name !== BASELINE_NAME ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    artifact.bytes > PNG_LIMITS.maxBytes ||
    artifact.width !== VIEWPORT.width ||
    artifact.height !== VIEWPORT.height ||
    typeof artifact.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(artifact.sha256)
  )
    throw resultError()
  return Object.freeze({
    artifacts: [Object.freeze(artifact)],
    ok: true,
    schemaVersion: 1,
  })
}

function serializeManifest(manifest) {
  return `${JSON.stringify(normalizeManifest(manifest))}\n`
}

function createResultArtifacts(pngBytes) {
  if (!Buffer.isBuffer(pngBytes)) throw resultError()
  const artifact = validateBaselinePng(pngBytes)
  const manifest = normalizeManifest({ artifacts: [artifact], ok: true, schemaVersion: 1 })
  return Object.freeze({
    artifacts: Object.freeze([
      Object.freeze({ bytes: Buffer.from(pngBytes), name: BASELINE_NAME }),
      Object.freeze({ bytes: Buffer.from(serializeManifest(manifest)), name: RESULT_NAME }),
    ]),
    manifest,
  })
}

async function assertDirectory(identity, fsApi) {
  try {
    const stats = await fsApi.lstat(identity.output, { bigint: true })
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !sameIdentity(statIdentity(stats), identity) ||
      (await fsApi.realpath(identity.output)) !== identity.realPath
    )
      throw resultError()
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

async function readRegularFile(identity, name, limit, options, fsApi) {
  const filePath = path.join(identity.output, name)
  await options.beforeRead?.(identity.output, name)
  await assertDirectory(identity, fsApi)
  let handle
  try {
    const linked = await fsApi.lstat(filePath, { bigint: true })
    if (!linked.isFile() || linked.isSymbolicLink() || linked.size > BigInt(limit)) {
      throw resultError()
    }
    handle = await fsApi.open(filePath, 'r')
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameIdentity(statIdentity(linked), statIdentity(opened))) {
      throw resultError()
    }
    const bytes = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    if (
      bytes.length !== Number(afterRead.size) ||
      !sameIdentity(statIdentity(opened), statIdentity(afterRead))
    )
      throw resultError()
    await handle.close()
    handle = null
    const finalLink = await fsApi.lstat(filePath, { bigint: true })
    if (
      !finalLink.isFile() ||
      finalLink.isSymbolicLink() ||
      !sameIdentity(statIdentity(opened), statIdentity(finalLink))
    )
      throw resultError()
    await assertDirectory(identity, fsApi)
    return bytes
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  } finally {
    await handle?.close()
  }
}

async function validateVisualResultDirectory(rawOutput, options = {}) {
  const fsApi = options.fsApi || fs
  let output
  try {
    output = validateFreshOutputPath(rawOutput)
    const stats = await fsApi.lstat(output, { bigint: true })
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw resultError()
    const identity = {
      ...statIdentity(stats),
      output,
      realPath: await fsApi.realpath(output),
    }
    await assertDirectory(identity, fsApi)
    const names = (await fsApi.readdir(output)).sort()
    if (names.join(',') !== EXPECTED_FILES.join(',')) throw resultError()

    const resultBytes = await readRegularFile(
      identity,
      RESULT_NAME,
      MAX_RESULT_BYTES,
      options,
      fsApi,
    )
    let parsed
    try {
      parsed = JSON.parse(resultBytes.toString('utf8'))
    } catch {
      throw resultError()
    }
    const manifest = normalizeManifest(parsed)
    if (!resultBytes.equals(Buffer.from(serializeManifest(manifest)))) throw resultError()

    const pngBytes = await readRegularFile(
      identity,
      BASELINE_NAME,
      manifest.artifacts[0].bytes,
      options,
      fsApi,
    )
    const actual = validateBaselinePng(pngBytes)
    if (
      actual.bytes !== manifest.artifacts[0].bytes ||
      actual.sha256 !== manifest.artifacts[0].sha256
    )
      throw resultError()
    await assertDirectory(identity, fsApi)
    if ((await fsApi.readdir(output)).sort().join(',') !== EXPECTED_FILES.join(',')) {
      throw resultError()
    }
    return manifest
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== WORKFLOW_PATH_ARGUMENT) throw resultError()
  await writeWorkflowEvidencePath()
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('VISUAL_SMOKE_RESULT_INVALID\n')
    process.exitCode = 1
  })
}

module.exports = {
  BASELINE_NAME,
  EXPECTED_FILES,
  RESULT_NAME,
  VIEWPORT,
  createResultArtifacts,
  normalizeManifest,
  serializeManifest,
  validateBaselinePng,
  validateVisualResultDirectory,
  workflowEvidencePath,
  writeWorkflowEvidencePath,
}
