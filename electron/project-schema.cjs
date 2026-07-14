'use strict'

const {
  normalizeStageStyle,
  normalizeVocalStyle,
} = require('./video-style-domain.cjs')

const PROJECT_SCHEMA_VERSION = 4
const MAX_PROJECT_DURATION_MS = 4 * 60 * 60 * 1_000
const MAX_PROJECT_TRACKS = 8
const MAX_PROJECT_LINES = 20_000
const MAX_PROJECT_WORDS = 150_000
const MIN_LYRIC_DISPLAY_LINES = 1
const MAX_LYRIC_DISPLAY_LINES = 5

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`)
  return value
}

function exactKeys(value, expected, path) {
  const unexpected = Object.keys(value).find((key) => !expected.includes(key))
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported`)
  if (missing) throw new TypeError(`${path}.${missing} is required`)
}

function string(value, key, path) {
  if (typeof value[key] !== 'string') throw new TypeError(`${path}.${key} must be a string`)
  return value[key]
}

function boolean(value, key, path) {
  if (typeof value[key] !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean`)
  return value[key]
}

function array(value, key, path) {
  if (!Array.isArray(value[key])) throw new TypeError(`${path}.${key} must be an array`)
  return value[key]
}

function nullableString(value, key, path) {
  if (value[key] !== null && typeof value[key] !== 'string') {
    throw new TypeError(`${path}.${key} must be a string or null`)
  }
  return value[key]
}

function boundedInteger(value, key, path, minimum, maximum, nullable = false) {
  const candidate = value[key]
  if (nullable && candidate === null) return null
  if (!Number.isSafeInteger(candidate)) {
    throw new TypeError(`${path}.${key} must be a safe integer${nullable ? ' or null' : ''}`)
  }
  if (candidate < minimum || candidate > maximum) {
    throw new RangeError(`${path}.${key} must be from ${minimum} to ${maximum}`)
  }
  return candidate
}

function timingPair(value, path) {
  const startMs = boundedInteger(value, 'startMs', path, 0, MAX_PROJECT_DURATION_MS, true)
  const endMs = boundedInteger(value, 'endMs', path, 0, MAX_PROJECT_DURATION_MS, true)
  if ((startMs === null) !== (endMs === null)) {
    throw new TypeError(`${path} must have both a start and end time, or neither`)
  }
  if (startMs !== null && endMs <= startMs) {
    throw new RangeError(`${path} must end after it starts`)
  }
  return { startMs, endMs }
}

function assertRawCardinality(rawTracks) {
  if (rawTracks.length > MAX_PROJECT_TRACKS) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_TRACKS} vocal tracks`)
  }
  let lineCount = 0
  let wordCount = 0
  for (const rawTrack of rawTracks) {
    if (!isRecord(rawTrack) || !Array.isArray(rawTrack.lines)) continue
    lineCount += rawTrack.lines.length
    if (lineCount > MAX_PROJECT_LINES) {
      throw new RangeError(`Projects are limited to ${MAX_PROJECT_LINES} lyric lines`)
    }
    for (const rawLine of rawTrack.lines) {
      if (!isRecord(rawLine) || !Array.isArray(rawLine.words)) continue
      wordCount += rawLine.words.length
      if (wordCount > MAX_PROJECT_WORDS) {
        throw new RangeError(`Projects are limited to ${MAX_PROJECT_WORDS} lyric words`)
      }
    }
  }
}

function decodeWord(value, path) {
  const source = record(value, path)
  exactKeys(source, ['id', 'text', 'startMs', 'endMs'], path)
  return {
    id: string(source, 'id', path),
    text: string(source, 'text', path),
    ...timingPair(source, path),
  }
}

function decodeLine(value, path) {
  const source = record(value, path)
  exactKeys(source, ['id', 'text', 'startMs', 'endMs', 'words'], path)
  return {
    id: string(source, 'id', path),
    text: string(source, 'text', path),
    ...timingPair(source, path),
    words: array(source, 'words', path).map((word, index) => (
      decodeWord(word, `${path}.words[${index}]`)
    )),
  }
}

function decodeTrack(value, path) {
  const source = record(value, path)
  exactKeys(source, ['id', 'name', 'vocalStyle', 'muted', 'solo', 'lines'], path)
  return {
    id: string(source, 'id', path),
    name: string(source, 'name', path),
    vocalStyle: normalizeVocalStyle(source.vocalStyle, `${path}.vocalStyle`),
    muted: boolean(source, 'muted', path),
    solo: boolean(source, 'solo', path),
    lines: array(source, 'lines', path).map((line, index) => (
      decodeLine(line, `${path}.lines[${index}]`)
    )),
  }
}

function validateProjectSemantics(project) {
  const ids = new Set()
  const registerId = (id, path) => {
    if (!id.trim()) throw new TypeError(`${path} cannot be empty`)
    if (ids.has(id)) throw new TypeError(`${path} duplicates the ID ${id}`)
    ids.add(id)
  }

  registerId(project.id, 'project.id')
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex]
    const trackPath = `project.tracks[${trackIndex}]`
    registerId(track.id, `${trackPath}.id`)
    let priorTimedLine = null
    let priorTimedWord = null

    for (let lineIndex = 0; lineIndex < track.lines.length; lineIndex += 1) {
      const line = track.lines[lineIndex]
      const linePath = `${trackPath}.lines[${lineIndex}]`
      registerId(line.id, `${linePath}.id`)
      if (line.startMs !== null) {
        if (line.endMs + project.offsetMs > MAX_PROJECT_DURATION_MS) {
          throw new RangeError(`${linePath} offset-adjusted timing exceeds four hours`)
        }
        if (project.durationMs !== null && line.endMs + project.offsetMs > project.durationMs) {
          throw new RangeError(`${linePath} ends after the project duration`)
        }
        if (priorTimedLine && line.startMs < priorTimedLine.startMs) {
          throw new RangeError(`${linePath} is out of start-time order`)
        }
        priorTimedLine = line
      }

      for (let wordIndex = 0; wordIndex < line.words.length; wordIndex += 1) {
        const word = line.words[wordIndex]
        const wordPath = `${linePath}.words[${wordIndex}]`
        registerId(word.id, `${wordPath}.id`)
        if (word.startMs === null) continue
        if (
          line.startMs !== null &&
          (word.startMs < line.startMs || word.endMs > line.endMs)
        ) {
          throw new RangeError(`${wordPath} timing must stay within its line timing`)
        }
        if (word.endMs + project.offsetMs > MAX_PROJECT_DURATION_MS) {
          throw new RangeError(`${wordPath} offset-adjusted timing exceeds four hours`)
        }
        if (project.durationMs !== null && word.endMs + project.offsetMs > project.durationMs) {
          throw new RangeError(`${wordPath} ends after the project duration`)
        }
        if (priorTimedWord && word.startMs < priorTimedWord.startMs) {
          throw new RangeError(`${wordPath} is out of start-time order`)
        }
        priorTimedWord = word
      }
    }
  }
}

function decodeCurrentProject(value) {
  const source = record(value, 'project')
  exactKeys(source, [
    'schemaVersion',
    'id',
    'title',
    'artist',
    'audioPath',
    'durationMs',
    'offsetMs',
    'createdAt',
    'updatedAt',
    'lyricDisplay',
    'stageStyle',
    'tracks',
  ], 'project')
  if (source.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new TypeError(`Project schemaVersion must be ${PROJECT_SCHEMA_VERSION}`)
  }

  const lyricDisplay = record(source.lyricDisplay, 'project.lyricDisplay')
  exactKeys(lyricDisplay, ['lineCount', 'advanceMode'], 'project.lyricDisplay')
  const lineCount = boundedInteger(
    lyricDisplay,
    'lineCount',
    'project.lyricDisplay',
    MIN_LYRIC_DISPLAY_LINES,
    MAX_LYRIC_DISPLAY_LINES,
  )
  const advanceMode = string(lyricDisplay, 'advanceMode', 'project.lyricDisplay')
  if (advanceMode !== 'clear' && advanceMode !== 'scroll') {
    throw new TypeError('project.lyricDisplay.advanceMode must be clear or scroll')
  }

  const rawTracks = array(source, 'tracks', 'project')
  assertRawCardinality(rawTracks)
  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: string(source, 'id', 'project'),
    title: string(source, 'title', 'project'),
    artist: string(source, 'artist', 'project'),
    audioPath: nullableString(source, 'audioPath', 'project'),
    durationMs: boundedInteger(
      source,
      'durationMs',
      'project',
      0,
      MAX_PROJECT_DURATION_MS,
      true,
    ),
    offsetMs: boundedInteger(
      source,
      'offsetMs',
      'project',
      -MAX_PROJECT_DURATION_MS,
      MAX_PROJECT_DURATION_MS,
    ),
    createdAt: string(source, 'createdAt', 'project'),
    updatedAt: string(source, 'updatedAt', 'project'),
    lyricDisplay: { lineCount, advanceMode },
    stageStyle: normalizeStageStyle(source.stageStyle),
    tracks: rawTracks.map((track, index) => decodeTrack(track, `project.tracks[${index}]`)),
  }
  validateProjectSemantics(project)
  return project
}

function parseCurrentProject(json) {
  if (typeof json !== 'string') throw new TypeError('Project JSON must be a string')
  return decodeCurrentProject(JSON.parse(json))
}

module.exports = {
  MAX_PROJECT_DURATION_MS,
  MAX_PROJECT_LINES,
  MAX_PROJECT_TRACKS,
  MAX_PROJECT_WORDS,
  PROJECT_SCHEMA_VERSION,
  decodeCurrentProject,
  parseCurrentProject,
}
