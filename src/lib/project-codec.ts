import { decodeStageStyle, decodeVocalStyle } from './video-style-codec'
import {
  MAX_PROJECT_LINES,
  MAX_PROJECT_TRACKS,
  MAX_PROJECT_WORDS,
  PROJECT_SCHEMA_VERSION,
  UNSUPPORTED_PROJECT_FORMAT_ERROR,
  validateProject,
} from './project-validation'
import type {
  KaraokeProject,
  LyricDisplaySettings,
  LyricLine,
  LyricWord,
  VocalTrack,
} from './karaoke'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireCurrentRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`)
  return value
}

function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const allowed = new Set(expected)
  const unexpected = Object.keys(record).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported.`)
  const missing = expected.find((key) => !Object.hasOwn(record, key))
  if (missing) throw new TypeError(`${path}.${missing} is required.`)
}

function requireCurrentString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new TypeError(`${path}.${key} must be a string.`)
  return value
}

function requireCurrentBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean.`)
  return value
}

function requireCurrentInteger(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key]
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${path}.${key} must be a safe integer.`)
  }
  return value as number
}

function requireCurrentNullableNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | null {
  const value = record[key]
  if (value !== null && typeof value !== 'number') {
    throw new TypeError(`${path}.${key} must be a number or null.`)
  }
  return value
}

function requireCurrentArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) throw new TypeError(`${path}.${key} must be an array.`)
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${path}.${key}[${index}] is required.`)
    }
  }
  return value
}

interface ProjectCardinality {
  lines: number
  words: number
}

function decodeCurrentWord(value: unknown, path: string): LyricWord {
  const record = requireCurrentRecord(value, path)
  requireExactKeys(record, ['id', 'text', 'startMs', 'endMs'], path)
  return {
    id: requireCurrentString(record, 'id', path),
    text: requireCurrentString(record, 'text', path),
    startMs: requireCurrentNullableNumber(record, 'startMs', path),
    endMs: requireCurrentNullableNumber(record, 'endMs', path),
  }
}

function decodeCurrentLine(
  value: unknown,
  path: string,
  cardinality: ProjectCardinality,
): LyricLine {
  const record = requireCurrentRecord(value, path)
  requireExactKeys(record, ['id', 'text', 'startMs', 'endMs', 'words'], path)
  const words = requireCurrentArray(record, 'words', path)
  cardinality.words += words.length
  if (cardinality.words > MAX_PROJECT_WORDS) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_WORDS} lyric words.`)
  }
  return {
    id: requireCurrentString(record, 'id', path),
    text: requireCurrentString(record, 'text', path),
    startMs: requireCurrentNullableNumber(record, 'startMs', path),
    endMs: requireCurrentNullableNumber(record, 'endMs', path),
    words: words.map((word, index) => decodeCurrentWord(word, `${path}.words[${index}]`)),
  }
}

function decodeCurrentTrack(
  value: unknown,
  path: string,
  cardinality: ProjectCardinality,
): VocalTrack {
  const record = requireCurrentRecord(value, path)
  requireExactKeys(record, ['id', 'name', 'vocalStyle', 'muted', 'solo', 'lines'], path)
  const lines = requireCurrentArray(record, 'lines', path)
  cardinality.lines += lines.length
  if (cardinality.lines > MAX_PROJECT_LINES) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_LINES} lyric lines.`)
  }
  return {
    id: requireCurrentString(record, 'id', path),
    name: requireCurrentString(record, 'name', path),
    vocalStyle: decodeVocalStyle(record.vocalStyle, `${path}.vocalStyle`),
    muted: requireCurrentBoolean(record, 'muted', path),
    solo: requireCurrentBoolean(record, 'solo', path),
    lines: lines.map((line, index) =>
      decodeCurrentLine(line, `${path}.lines[${index}]`, cardinality),
    ),
  }
}

function decodeCurrentLyricDisplay(value: unknown): LyricDisplaySettings {
  const record = requireCurrentRecord(value, 'project.lyricDisplay')
  requireExactKeys(record, ['lineCount', 'advanceMode'], 'project.lyricDisplay')
  const advanceMode = requireCurrentString(record, 'advanceMode', 'project.lyricDisplay')
  if (advanceMode !== 'clear' && advanceMode !== 'scroll') {
    throw new TypeError('project.lyricDisplay.advanceMode must be clear or scroll.')
  }
  return {
    lineCount: requireCurrentInteger(record, 'lineCount', 'project.lyricDisplay'),
    advanceMode,
  }
}

function decodeCurrentProject(value: Record<string, unknown>): KaraokeProject {
  requireExactKeys(
    value,
    [
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
    ],
    'project',
  )
  const rawTracks = requireCurrentArray(value, 'tracks', 'project')
  if (rawTracks.length > MAX_PROJECT_TRACKS) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_TRACKS} vocal tracks.`)
  }
  const cardinality = { lines: 0, words: 0 }
  const audioPath = value.audioPath
  if (audioPath !== null && typeof audioPath !== 'string') {
    throw new TypeError('project.audioPath must be a string or null.')
  }
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: requireCurrentString(value, 'id', 'project'),
    title: requireCurrentString(value, 'title', 'project'),
    artist: requireCurrentString(value, 'artist', 'project'),
    audioPath,
    durationMs: requireCurrentNullableNumber(value, 'durationMs', 'project'),
    offsetMs: (() => {
      const offset = value.offsetMs
      if (typeof offset !== 'number') throw new TypeError('project.offsetMs must be a number.')
      return offset
    })(),
    createdAt: requireCurrentString(value, 'createdAt', 'project'),
    updatedAt: requireCurrentString(value, 'updatedAt', 'project'),
    lyricDisplay: decodeCurrentLyricDisplay(value.lyricDisplay),
    stageStyle: decodeStageStyle(value.stageStyle),
    tracks: rawTracks.map((track, index) =>
      decodeCurrentTrack(track, `project.tracks[${index}]`, cardinality),
    ),
  }
}

export function decodeProject(value: unknown): KaraokeProject {
  if (!isRecord(value)) throw new TypeError('Project data must be a JSON object.')
  const declaredVersion = value.schemaVersion
  if (declaredVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(UNSUPPORTED_PROJECT_FORMAT_ERROR)
  }
  const project = decodeCurrentProject(value)
  const firstError = validateProject(project).find(
    (validationIssue) => validationIssue.severity === 'error',
  )
  if (firstError) throw new Error(`Invalid karaoke project: ${firstError.message}`)
  return project
}

export function serializeProject(project: KaraokeProject): string {
  try {
    return JSON.stringify(decodeProject(project), null, 2)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot serialize an invalid project: ${detail}`)
  }
}

export function parseProject(json: string): KaraokeProject {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SyntaxError(`Invalid project JSON: ${detail}`)
  }
  return decodeProject(data)
}
