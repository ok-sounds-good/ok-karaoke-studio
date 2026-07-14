'use strict'

const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { parseStrictPng } = require('../electron/png-validation.cjs')

const SCREENSHOT_FILES = Object.freeze([
  '01-default.png',
  '02-style-background.png',
  '03-font-selector.png',
])
const EXPECTED_FILES = Object.freeze([...SCREENSHOT_FILES, 'result.json'].sort())
const HASH = /^[0-9a-f]{64}$/u

function resultError() {
  const error = new Error('VISUAL_SMOKE_RESULT_INVALID')
  error.code = 'VISUAL_SMOKE_RESULT_INVALID'
  return error
}

function exactKeys(value, expected) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(','),
  )
}

function nonnegativeDuration(value) {
  return Number.isSafeInteger(value) && value >= 0
}

async function regularFileBytes(output, name, fsApi) {
  const filePath = path.join(output, name)
  const stats = await fsApi.lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw resultError()
  return fsApi.readFile(filePath)
}

async function exactEntries(output, fsApi) {
  const entries = await fsApi.readdir(output, { withFileTypes: true })
  if (
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    entries.map((entry) => entry.name).sort().join(',') !== EXPECTED_FILES.join(',')
  ) throw resultError()
}

async function validateVisualSmokeResult(rawOutput, options = {}) {
  const fsApi = options.fsApi || fs
  const output = path.resolve(rawOutput)
  try {
    const directoryStats = await fsApi.lstat(output)
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw resultError()
    const directoryIdentity = {
      dev: String(directoryStats.dev),
      ino: String(directoryStats.ino),
      realPath: await fsApi.realpath(output),
    }
    await exactEntries(output, fsApi)
    const resultBytes = await regularFileBytes(output, 'result.json', fsApi)
    if (resultBytes.length > 256 * 1024) throw resultError()
    const result = JSON.parse(resultBytes.toString('utf8'))
    if (
      !exactKeys(result, ['captures', 'durationMs', 'font', 'ok', 'order', 'viewport']) ||
      result.ok !== true || !nonnegativeDuration(result.durationMs) ||
      JSON.stringify(result.order) !== JSON.stringify(SCREENSHOT_FILES) ||
      !exactKeys(result.viewport, ['dpr', 'height', 'width']) ||
      result.viewport.width !== 1280 || result.viewport.height !== 720 ||
      result.viewport.dpr !== 1 ||
      !exactKeys(result.font, [
        'catalogNonEmpty',
        'localFontLoaded',
        'publicCaptureBoundary',
        'restoredSystem',
      ]) || Object.values(result.font).some((value) => value !== true) ||
      !Array.isArray(result.captures) || result.captures.length !== SCREENSHOT_FILES.length
    ) throw resultError()

    for (let index = 0; index < SCREENSHOT_FILES.length; index += 1) {
      const capture = result.captures[index]
      const file = SCREENSHOT_FILES[index]
      if (
        !exactKeys(capture, ['durationMs', 'file', 'sha256']) ||
        capture.file !== file || !HASH.test(capture.sha256) ||
        !nonnegativeDuration(capture.durationMs)
      ) throw resultError()
      const bytes = await regularFileBytes(output, file, fsApi)
      const dimensions = parseStrictPng(bytes)
      if (dimensions.width !== 1280 || dimensions.height !== 720) throw resultError()
      if (createHash('sha256').update(bytes).digest('hex') !== capture.sha256) {
        throw resultError()
      }
    }

    await exactEntries(output, fsApi)
    const finalStats = await fsApi.lstat(output)
    if (
      finalStats.isSymbolicLink() || !finalStats.isDirectory() ||
      String(finalStats.dev) !== directoryIdentity.dev ||
      String(finalStats.ino) !== directoryIdentity.ino ||
      await fsApi.realpath(output) !== directoryIdentity.realPath
    ) throw resultError()
    return result
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

module.exports = { SCREENSHOT_FILES, validateVisualSmokeResult }
