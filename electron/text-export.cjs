'use strict'

const path = require('node:path')

const EXPORT_FILTERS = Object.freeze({
  lrc: Object.freeze([{ name: 'LRC Lyrics', extensions: ['lrc'] }]),
  ass: Object.freeze([{ name: 'Advanced SubStation Alpha', extensions: ['ass'] }]),
  oks: Object.freeze([{ name: 'Okay Karaoke Studio Project', extensions: ['oks'] }]),
})

const KNOWN_EXPORT_EXTENSIONS = new Set([
  '.ass',
  '.json',
  '.lrc',
  '.mp4',
  '.oks',
  '.okstudio',
  '.txt',
])
const OUTPUT_FORMATS = new Set([...Object.keys(EXPORT_FILTERS), 'mp4'])

function normalizeExportFormat(value) {
  if (typeof value !== 'string') throw new TypeError('format must be a string')
  const format = value.toLowerCase()
  if (!Object.hasOwn(EXPORT_FILTERS, format)) {
    throw new TypeError('format must be lrc, ass, or oks')
  }
  return format
}

function ensureExportExtension(fileName, format) {
  if (typeof format !== 'string') throw new TypeError('format must be a string')
  const normalizedFormat = format.toLowerCase()
  if (!OUTPUT_FORMATS.has(normalizedFormat)) {
    throw new TypeError('unsupported export filename format')
  }
  const desiredExtension = `.${normalizedFormat}`
  const currentExtension = path.extname(fileName).toLowerCase()
  if (currentExtension === desiredExtension) return fileName

  if (!KNOWN_EXPORT_EXTENSIONS.has(currentExtension)) {
    return `${fileName}${desiredExtension}`
  }

  const stem = path.basename(fileName, currentExtension)
  return `${stem || (normalizedFormat === 'oks' ? 'project' : 'lyrics')}${desiredExtension}`
}

module.exports = {
  EXPORT_FILTERS,
  ensureExportExtension,
  normalizeExportFormat,
}
