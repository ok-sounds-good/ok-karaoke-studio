'use strict'

const path = require('node:path')
const { parseCurrentProject } = require('./project-schema.cjs')

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value, key) {
  if (typeof value[key] !== 'string' || !value[key]) {
    throw new TypeError(`${key} must be a non-empty string`)
  }
  return value[key]
}

function optionalString(value, key) {
  if (value[key] === undefined) return undefined
  return requiredString(value, key)
}

function createVideoExportRequestAuthorizer({
  linkedAssets,
  audioExtensions,
  maxDurationMs,
  maxProjectBytes,
  normalizeVideoSettings,
  decodeProjectJson = parseCurrentProject,
  projectSourcePath = () => null,
}) {
  return function authorizeVideoExportRequest(ownerId, value) {
    if (!isRecord(value)) throw new TypeError('exportVideo requires an options object')
    const durationMs = value.durationMs
    if (!Number.isSafeInteger(durationMs) || durationMs < 1_000 || durationMs > maxDurationMs) {
      throw new RangeError('durationMs must be an integer between one second and thirty minutes')
    }
    const projectJson = requiredString(value, 'projectJson')
    if (Buffer.byteLength(projectJson, 'utf8') > maxProjectBytes) {
      throw new RangeError('projectJson is too large')
    }
    const project = decodeProjectJson(projectJson)
    const requestedAudioPath = requiredString(value, 'audioPath')
    if (!path.isAbsolute(requestedAudioPath)) {
      throw new TypeError('audioPath must be the active absolute linked audio path')
    }
    const audioPath = path.resolve(requestedAudioPath)
    if (!audioExtensions.has(path.extname(audioPath).toLowerCase())) {
      throw new TypeError('audioPath must reference a supported audio file')
    }
    if (linkedAssets.activeOwnerPath(ownerId, 'audio') !== audioPath) {
      throw new Error('The requested audio is not the active linked audio capability')
    }
    if (typeof project.audioPath !== 'string' || !project.audioPath) {
      throw new Error('The project does not select the active linked audio capability')
    }
    const sourcePath = projectSourcePath(ownerId)
    const projectAudioPath = path.isAbsolute(project.audioPath)
      ? path.resolve(project.audioPath)
      : typeof sourcePath === 'string' && sourcePath
        ? path.resolve(path.dirname(sourcePath), project.audioPath)
        : null
    if (projectAudioPath !== audioPath) {
      throw new Error('The project audio selection does not match the active linked audio capability')
    }

    const background = project.stageStyle.background
    let backgroundPath = null
    if (background.mode === 'image') {
      backgroundPath = path.resolve(background.imagePath)
      if (linkedAssets.activeOwnerPath(ownerId, 'background') !== backgroundPath) {
        throw new Error('The requested background is not an active linked image capability')
      }
    }

    const settings = normalizeVideoSettings({ resolution: value.resolution, fps: value.fps })
    return {
      audioPath,
      backgroundPath,
      durationMs,
      projectJson,
      resolution: settings.resolution,
      fps: settings.fps,
      suggestedName: optionalString(value, 'suggestedName'),
    }
  }
}

module.exports = { createVideoExportRequestAuthorizer }
