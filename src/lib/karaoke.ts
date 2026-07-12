export const PROJECT_SCHEMA_VERSION = 2 as const

export type ProjectSchemaVersion = typeof PROJECT_SCHEMA_VERSION

export interface LyricWord {
  id: string
  text: string
  startMs: number | null
  endMs: number | null
}

export interface LyricLine {
  id: string
  text: string
  startMs: number | null
  endMs: number | null
  words: LyricWord[]
}

export interface VocalTrack {
  id: string
  name: string
  color: string
  muted: boolean
  solo: boolean
  lines: LyricLine[]
}

export interface KaraokeProject {
  schemaVersion: ProjectSchemaVersion
  id: string
  title: string
  artist: string
  audioPath: string | null
  durationMs: number | null
  offsetMs: number
  createdAt: string
  updatedAt: string
  tracks: VocalTrack[]
}

export type ValidationSeverity = 'error' | 'warning'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  path: string
  trackId?: string
  lineId?: string
  wordId?: string
}

export interface TimingRange {
  startMs: number
  endMs: number
}

export interface TimingBounds {
  minMs?: number
  maxMs?: number
  minimumDurationMs?: number
}

export interface CreateProjectOptions {
  id?: string
  title?: string
  artist?: string
  audioPath?: string | null
  durationMs?: number | null
  offsetMs?: number
  createdAt?: string
  updatedAt?: string
  tracks?: VocalTrack[]
}

const DEFAULT_TRACK_COLOR = '#22d3ee'
const DEFAULT_LRC_LINE_DURATION_MS = 3_000
let idSequence = 0

function createId(prefix: string): string {
  idSequence += 1
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${randomPart}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asIntegerMs(value: unknown): number | null {
  const number = asFiniteNumber(value)
  return number === null ? null : Math.round(number)
}

function legacySecondsToMs(value: unknown): number | null {
  const number = asFiniteNumber(value)
  return number === null ? null : Math.round(number * 1_000)
}

function timingFromRecord(
  record: Record<string, unknown>,
  msKey: string,
  legacySecondKeys: string[],
): number | null {
  if (msKey in record) return asIntegerMs(record[msKey])
  for (const key of legacySecondKeys) {
    if (key in record) return legacySecondsToMs(record[key])
  }
  return null
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ')
}

export function tokenizeLyricLine(text: string): string[] {
  const normalized = normalizeText(text)
  return normalized ? normalized.split(' ') : []
}

export function createLyricWord(
  text: string,
  options: Partial<Omit<LyricWord, 'text'>> = {},
): LyricWord {
  return {
    id: options.id ?? createId('word'),
    text,
    startMs: options.startMs ?? null,
    endMs: options.endMs ?? null,
  }
}

export function createLyricLine(
  text: string,
  options: Partial<Omit<LyricLine, 'text' | 'words'>> & { words?: LyricWord[] } = {},
): LyricLine {
  const normalized = normalizeText(text)
  return {
    id: options.id ?? createId('line'),
    text: normalized,
    startMs: options.startMs ?? null,
    endMs: options.endMs ?? null,
    words:
      options.words?.map((word) => ({ ...word })) ??
      tokenizeLyricLine(normalized).map((word) => createLyricWord(word)),
  }
}

export function createVocalTrack(
  options: Partial<VocalTrack> & Pick<VocalTrack, 'id'>,
): VocalTrack {
  return {
    id: options.id,
    name: options.name ?? 'Lead Vocal',
    color: options.color ?? DEFAULT_TRACK_COLOR,
    muted: options.muted ?? false,
    solo: options.solo ?? false,
    lines: options.lines?.map(cloneLine) ?? [],
  }
}

function cloneLine(line: LyricLine): LyricLine {
  return {
    ...line,
    words: line.words.map((word) => ({ ...word })),
  }
}

function cloneTrack(track: VocalTrack): VocalTrack {
  return {
    ...track,
    lines: track.lines.map(cloneLine),
  }
}

export function createProject(options: CreateProjectOptions = {}): KaraokeProject {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.id ?? createId('project'),
    title: options.title ?? 'Untitled Song',
    artist: options.artist ?? 'Unknown Artist',
    audioPath: options.audioPath ?? null,
    durationMs: options.durationMs ?? null,
    offsetMs: options.offsetMs ?? 0,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    tracks:
      options.tracks?.map(cloneTrack) ??
      [createVocalTrack({ id: createId('track'), name: 'Lead Vocal' })],
  }
}

export function clampTiming(
  startMs: number,
  endMs: number,
  boundsOrDuration: TimingBounds | number = {},
): TimingRange {
  const bounds =
    typeof boundsOrDuration === 'number'
      ? { maxMs: boundsOrDuration }
      : boundsOrDuration
  const minMs = Math.round(Number.isFinite(bounds.minMs) ? bounds.minMs ?? 0 : 0)
  const requestedMax = Number.isFinite(bounds.maxMs)
    ? Math.round(bounds.maxMs ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY
  const maxMs = Math.max(minMs, requestedMax)
  const availableDuration = Number.isFinite(maxMs) ? maxMs - minMs : Number.POSITIVE_INFINITY
  const requestedMinimum = Math.max(
    0,
    Math.round(
      Number.isFinite(bounds.minimumDurationMs)
        ? bounds.minimumDurationMs ?? 1
        : 1,
    ),
  )
  const minimumDurationMs = Math.min(requestedMinimum, availableDuration)

  let start = Number.isFinite(startMs) ? Math.round(startMs) : minMs
  let end = Number.isFinite(endMs) ? Math.round(endMs) : start + minimumDurationMs
  start = Math.max(minMs, Math.min(start, maxMs))
  end = Math.max(minMs, Math.min(end, maxMs))

  if (end < start) [start, end] = [end, start]
  if (end - start < minimumDurationMs) {
    end = Math.min(maxMs, start + minimumDurationMs)
    start = Math.max(minMs, end - minimumDurationMs)
  }

  return { startMs: start, endMs: end }
}

export function retimeLine(line: LyricLine, startMs: number, endMs: number): LyricLine {
  const range = clampTiming(startMs, endMs, {
    minimumDurationMs: Math.max(1, line.words.length),
  })
  const duration = range.endMs - range.startMs
  const words = line.words.map((word, index) => {
    const wordStart = range.startMs + Math.round((duration * index) / line.words.length)
    const wordEnd = range.startMs + Math.round((duration * (index + 1)) / line.words.length)
    return {
      ...word,
      startMs: wordStart,
      endMs: Math.max(wordStart + 1, wordEnd),
    }
  })

  return {
    ...line,
    startMs: range.startMs,
    endMs: range.endMs,
    words,
  }
}

function demoLine(
  id: string,
  text: string,
  startMs: number,
  endMs: number,
): LyricLine {
  return retimeLine(
    createLyricLine(text, {
      id,
      words: tokenizeLyricLine(text).map((word, index) =>
        createLyricWord(word, { id: `${id}-word-${index + 1}` }),
      ),
    }),
    startMs,
    endMs,
  )
}

export function createDemoProject(): KaraokeProject {
  const createdAt = '2026-01-01T00:00:00.000Z'
  const lead = createVocalTrack({
    id: 'demo-lead',
    name: 'Lead Vocal',
    color: '#22d3ee',
    lines: [
      demoLine('demo-line-1', 'City lights are calling out my name', 2_000, 5_400),
      demoLine('demo-line-2', 'Every heartbeat lands right on the one', 6_100, 9_700),
      demoLine('demo-line-3', 'We can turn the midnight into gold', 10_500, 13_800),
      demoLine('demo-line-4', 'Sing it louder till the morning comes', 14_700, 18_100),
      demoLine('demo-line-5', 'This is our neon afterglow', 19_000, 22_500),
    ],
  })

  return createProject({
    id: 'demo-project',
    title: 'Neon Afterglow',
    artist: 'Okay Karaoke',
    durationMs: 28_000,
    createdAt,
    updatedAt: createdAt,
    tracks: [lead],
  })
}

function alignExistingWords(tokens: string[], existingWords: LyricWord[]): LyricWord[] {
  const result: LyricWord[] = []
  let searchFrom = 0

  for (const token of tokens) {
    const matchIndex = existingWords.findIndex(
      (word, index) => index >= searchFrom && word.text === token,
    )
    if (matchIndex >= 0) {
      result.push({ ...existingWords[matchIndex], text: token })
      searchFrom = matchIndex + 1
    } else {
      result.push(createLyricWord(token))
    }
  }
  return result
}

function lineSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeLyricLine(left.toLowerCase()))
  const rightTokens = new Set(tokenizeLyricLine(right.toLowerCase()))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1
  })
  return intersection / Math.max(leftTokens.size, rightTokens.size)
}

/** Align unchanged lines across insertions/deletions before matching edited lines. */
function alignExistingLines(
  lineTexts: string[],
  existingLines: LyricLine[],
): Map<number, LyricLine> {
  const rows = lineTexts.length + 1
  const columns = existingLines.length + 1
  const lengths = Array.from({ length: rows }, () => Array<number>(columns).fill(0))

  for (let newIndex = lineTexts.length - 1; newIndex >= 0; newIndex -= 1) {
    for (let oldIndex = existingLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
      lengths[newIndex][oldIndex] =
        lineTexts[newIndex] === existingLines[oldIndex].text
          ? lengths[newIndex + 1][oldIndex + 1] + 1
          : Math.max(lengths[newIndex + 1][oldIndex], lengths[newIndex][oldIndex + 1])
    }
  }

  const matches = new Map<number, LyricLine>()
  const usedOldIndexes = new Set<number>()
  let newIndex = 0
  let oldIndex = 0
  while (newIndex < lineTexts.length && oldIndex < existingLines.length) {
    if (lineTexts[newIndex] === existingLines[oldIndex].text) {
      matches.set(newIndex, existingLines[oldIndex])
      usedOldIndexes.add(oldIndex)
      newIndex += 1
      oldIndex += 1
    } else if (lengths[newIndex + 1][oldIndex] >= lengths[newIndex][oldIndex + 1]) {
      newIndex += 1
    } else {
      oldIndex += 1
    }
  }

  lineTexts.forEach((lineText, index) => {
    if (matches.has(index) || usedOldIndexes.has(index)) return
    const candidate = existingLines[index]
    if (!candidate) return
    const sameLineCount = lineTexts.length === existingLines.length
    if (sameLineCount || lineSimilarity(lineText, candidate.text) >= 0.4) {
      matches.set(index, candidate)
      usedOldIndexes.add(index)
    }
  })

  return matches
}

export function parseLyrics(
  text: string,
  trackId: string,
  existing?: VocalTrack,
): VocalTrack {
  const lyricLines = text
    .replace(/^\uFEFF/u, '')
    .split(/\r\n?|\n/u)
    .map(normalizeText)
    .filter(Boolean)
  const alignedLines = existing
    ? alignExistingLines(lyricLines, existing.lines)
    : new Map<number, LyricLine>()

  const lines = lyricLines.map((lineText, index) => {
    const previous = alignedLines.get(index)
    const tokens = tokenizeLyricLine(lineText)
    return createLyricLine(lineText, {
      id: previous?.id,
      startMs: previous?.startMs,
      endMs: previous?.endMs,
      words: previous
        ? alignExistingWords(tokens, previous.words)
        : tokens.map((token) => createLyricWord(token)),
    })
  })

  return createVocalTrack({
    id: trackId,
    name: existing?.name ?? 'Lead Vocal',
    color: existing?.color ?? DEFAULT_TRACK_COLOR,
    muted: existing?.muted ?? false,
    solo: existing?.solo ?? false,
    lines,
  })
}

function issue(
  issues: ValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  message: string,
  path: string,
  context: Pick<ValidationIssue, 'trackId' | 'lineId' | 'wordId'> = {},
): void {
  issues.push({ severity, code, message, path, ...context })
}

function validateRange(
  issues: ValidationIssue[],
  startMs: number | null,
  endMs: number | null,
  path: string,
  label: string,
  context: Pick<ValidationIssue, 'trackId' | 'lineId' | 'wordId'>,
): boolean {
  if (startMs === null && endMs === null) return false
  if (startMs === null || endMs === null) {
    issue(
      issues,
      'error',
      'timing-incomplete',
      `${label} must have both a start and end time, or neither.`,
      path,
      context,
    )
    return false
  }
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) {
    issue(
      issues,
      'error',
      'timing-not-integer',
      `${label} timings must be integer milliseconds.`,
      path,
      context,
    )
    return false
  }
  if (startMs < 0 || endMs < 0) {
    issue(
      issues,
      'error',
      'timing-negative',
      `${label} timings cannot be negative.`,
      path,
      context,
    )
    return false
  }
  if (endMs <= startMs) {
    issue(
      issues,
      'error',
      'timing-reversed',
      `${label} must end after it starts.`,
      path,
      context,
    )
    return false
  }
  return true
}

export function validateProject(project: KaraokeProject): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = new Set<string>()

  const registerId = (
    id: string,
    path: string,
    context: Pick<ValidationIssue, 'trackId' | 'lineId' | 'wordId'> = {},
  ) => {
    if (!id.trim()) {
      issue(issues, 'error', 'id-empty', 'IDs cannot be empty.', path, context)
    } else if (ids.has(id)) {
      issue(issues, 'error', 'id-duplicate', `Duplicate ID: ${id}`, path, context)
    }
    ids.add(id)
  }

  registerId(project.id, 'id')
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    issue(
      issues,
      'error',
      'schema-version',
      `Expected project schema version ${PROJECT_SCHEMA_VERSION}.`,
      'schemaVersion',
    )
  }
  if (
    project.durationMs !== null &&
    (!Number.isInteger(project.durationMs) || project.durationMs < 0)
  ) {
    issue(
      issues,
      'error',
      'duration-invalid',
      'Project duration must be a non-negative integer millisecond value.',
      'durationMs',
    )
  }
  if (!Number.isInteger(project.offsetMs)) {
    issue(
      issues,
      'error',
      'offset-not-integer',
      'Project offset must be an integer millisecond value.',
      'offsetMs',
    )
  }

  project.tracks.forEach((track, trackIndex) => {
    const trackPath = `tracks[${trackIndex}]`
    const trackContext = { trackId: track.id }
    registerId(track.id, `${trackPath}.id`, trackContext)
    let priorTimedLine: LyricLine | undefined

    track.lines.forEach((line, lineIndex) => {
      const linePath = `${trackPath}.lines[${lineIndex}]`
      const lineContext = { ...trackContext, lineId: line.id }
      registerId(line.id, `${linePath}.id`, lineContext)
      const lineIsTimed = validateRange(
        issues,
        line.startMs,
        line.endMs,
        linePath,
        'Line',
        lineContext,
      )

      if (line.text !== line.words.map((word) => word.text).join(' ')) {
        issue(
          issues,
          'warning',
          'line-text-mismatch',
          'Line text does not match its word text.',
          `${linePath}.text`,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        project.durationMs !== null &&
        line.endMs !== null &&
        line.endMs > project.durationMs
      ) {
        issue(
          issues,
          'error',
          'timing-after-duration',
          'Line ends after the project duration.',
          linePath,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        priorTimedLine?.startMs !== null &&
        line.startMs !== null &&
        priorTimedLine?.startMs !== undefined &&
        line.startMs < priorTimedLine.startMs
      ) {
        issue(
          issues,
          'error',
          'line-order',
          'Timed lines must be ordered by start time.',
          linePath,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        priorTimedLine?.endMs !== null &&
        priorTimedLine?.endMs !== undefined &&
        line.startMs !== null &&
        line.startMs < priorTimedLine.endMs
      ) {
        issue(
          issues,
          'warning',
          'line-overlap',
          'This line overlaps the previous line on the same track.',
          linePath,
          lineContext,
        )
      }
      if (lineIsTimed) priorTimedLine = line

      let priorTimedWord: LyricWord | undefined
      line.words.forEach((word, wordIndex) => {
        const wordPath = `${linePath}.words[${wordIndex}]`
        const wordContext = { ...lineContext, wordId: word.id }
        registerId(word.id, `${wordPath}.id`, wordContext)
        const wordIsTimed = validateRange(
          issues,
          word.startMs,
          word.endMs,
          wordPath,
          'Word',
          wordContext,
        )

        if (wordIsTimed && lineIsTimed) {
          if (
            word.startMs !== null &&
            word.endMs !== null &&
            line.startMs !== null &&
            line.endMs !== null &&
            (word.startMs < line.startMs || word.endMs > line.endMs)
          ) {
            issue(
              issues,
              'error',
              'word-outside-line',
              'Word timing must stay within its line timing.',
              wordPath,
              wordContext,
            )
          }
        }
        if (
          wordIsTimed &&
          project.durationMs !== null &&
          word.endMs !== null &&
          word.endMs > project.durationMs
        ) {
          issue(
            issues,
            'error',
            'timing-after-duration',
            'Word ends after the project duration.',
            wordPath,
            wordContext,
          )
        }
        if (
          wordIsTimed &&
          priorTimedWord?.startMs !== null &&
          priorTimedWord?.startMs !== undefined &&
          word.startMs !== null &&
          word.startMs < priorTimedWord.startMs
        ) {
          issue(
            issues,
            'error',
            'word-order',
            'Timed words must be ordered by start time.',
            wordPath,
            wordContext,
          )
        }
        if (
          wordIsTimed &&
          priorTimedWord?.endMs !== null &&
          priorTimedWord?.endMs !== undefined &&
          word.startMs !== null &&
          word.startMs < priorTimedWord.endMs
        ) {
          issue(
            issues,
            'warning',
            'word-overlap',
            'This word overlaps the previous timed word.',
            wordPath,
            wordContext,
          )
        }
        if (wordIsTimed) priorTimedWord = word
      })
    })
  })

  return issues
}

export function hasValidationErrors(issues: ValidationIssue[]): boolean {
  return issues.some((validationIssue) => validationIssue.severity === 'error')
}

export function formatTime(ms: number, compact = false): string {
  const rounded = Math.round(Number.isFinite(ms) ? ms : 0)
  const sign = rounded < 0 ? '-' : ''
  const absolute = Math.abs(rounded)
  const milliseconds = absolute % 1_000
  const totalSeconds = Math.floor(absolute / 1_000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const secondPart = `${seconds.toString().padStart(2, '0')}.${milliseconds
    .toString()
    .padStart(3, '0')}`
  if (compact && hours === 0) return `${sign}${totalMinutes}:${secondPart}`
  return hours > 0
    ? `${sign}${hours}:${minutes.toString().padStart(2, '0')}:${secondPart}`
    : `${sign}${minutes.toString().padStart(2, '0')}:${secondPart}`
}

function parseTimestamp(minutes: string, seconds: string, fraction = ''): number {
  const fractionMs = fraction
    ? Number(fraction.slice(0, 3).padEnd(3, '0'))
    : 0
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + fractionMs
}

const LRC_LINE_TIMESTAMP = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/gu
const LRC_WORD_TIMESTAMP = /<(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?>/gu

interface ImportedLrcLine {
  sourceIndex: number
  startMs: number
  text: string
  words: LyricWord[]
}

function parseEnhancedLrcWords(body: string, offsetMs: number): LyricWord[] {
  const matches = [...body.matchAll(LRC_WORD_TIMESTAMP)]
  if (matches.length === 0) {
    return tokenizeLyricLine(body).map((word) => createLyricWord(word))
  }

  const words: LyricWord[] = []
  const prefix = normalizeText(body.slice(0, matches[0].index))
  if (prefix) {
    words.push(...tokenizeLyricLine(prefix).map((word) => createLyricWord(word)))
  }

  matches.forEach((match, index) => {
    const contentStart = (match.index ?? 0) + match[0].length
    const contentEnd = matches[index + 1]?.index ?? body.length
    const tokens = tokenizeLyricLine(body.slice(contentStart, contentEnd))
    const startMs = Math.max(0, parseTimestamp(match[1], match[2], match[3]) + offsetMs)
    tokens.forEach((token) => {
      words.push(createLyricWord(token, { startMs, endMs: null }))
    })
  })
  return words
}

export function importLrc(text: string, trackId: string): VocalTrack {
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  const offsetMatch = normalized.match(/^\s*\[offset:([+-]?\d+)\]\s*$/imu)
  const offsetMs = offsetMatch ? Number(offsetMatch[1]) : 0
  const imported: ImportedLrcLine[] = []

  normalized.split('\n').forEach((rawLine, sourceIndex) => {
    const timestamps = [...rawLine.matchAll(LRC_LINE_TIMESTAMP)]
    if (timestamps.length === 0) return
    const body = rawLine.replace(LRC_LINE_TIMESTAMP, '').trim()
    timestamps.forEach((timestamp) => {
      const startMs = Math.max(
        0,
        parseTimestamp(timestamp[1], timestamp[2], timestamp[3]) + offsetMs,
      )
      const words = parseEnhancedLrcWords(body, offsetMs)
      imported.push({
        sourceIndex,
        startMs,
        text: words.map((word) => word.text).join(' '),
        words,
      })
    })
  })

  imported.sort((left, right) => left.startMs - right.startMs || left.sourceIndex - right.sourceIndex)

  const lines = imported.map((entry, lineIndex) => {
    const nextStart = imported.find(
      (candidate, candidateIndex) =>
        candidateIndex > lineIndex && candidate.startMs > entry.startMs,
    )?.startMs
    const lastWordStart = entry.words.reduce<number | null>(
      (latest, word) =>
        word.startMs === null ? latest : Math.max(latest ?? word.startMs, word.startMs),
      null,
    )
    const endMs =
      nextStart ??
      Math.max(
        entry.startMs + DEFAULT_LRC_LINE_DURATION_MS,
        (lastWordStart ?? entry.startMs) + 1_500,
      )

    const timedWordIndexes = entry.words
      .map((word, index) => (word.startMs === null ? -1 : index))
      .filter((index) => index >= 0)
    const words = entry.words.map((word, wordIndex) => {
      if (word.startMs === null) return word
      const timedPosition = timedWordIndexes.indexOf(wordIndex)
      const nextTimedIndex = timedWordIndexes[timedPosition + 1]
      const nextWordStart =
        nextTimedIndex === undefined ? endMs : entry.words[nextTimedIndex].startMs ?? endMs
      return {
        ...word,
        endMs: Math.max(word.startMs + 1, nextWordStart),
      }
    })

    return createLyricLine(entry.text, {
      id: `${trackId}-line-${lineIndex + 1}`,
      startMs: entry.startMs,
      endMs,
      words: words.map((word, wordIndex) => ({
        ...word,
        id: `${trackId}-line-${lineIndex + 1}-word-${wordIndex + 1}`,
      })),
    })
  })

  return createVocalTrack({
    id: trackId,
    name: 'Imported LRC',
    color: DEFAULT_TRACK_COLOR,
    lines,
  })
}

function formatLrcTimestamp(ms: number): string {
  const absolute = Math.max(0, Math.round(ms))
  const minutes = Math.floor(absolute / 60_000)
  const seconds = Math.floor((absolute % 60_000) / 1_000)
  const milliseconds = absolute % 1_000
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}

function metadataValue(value: string): string {
  return value.replace(/[\r\n\[\]]/gu, ' ').trim()
}

function trackById(project: KaraokeProject, trackId: string): VocalTrack {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new RangeError(`No vocal track with ID "${trackId}".`)
  return track
}

export function exportLrc(project: KaraokeProject, trackId: string): string {
  const track = trackById(project, trackId)
  const header = [
    `[ti:${metadataValue(project.title)}]`,
    `[ar:${metadataValue(project.artist)}]`,
    `[by:Okay Karaoke Studio]`,
  ]
  if (project.offsetMs !== 0) header.push(`[offset:${project.offsetMs}]`)

  const lines = track.lines.flatMap((line) => {
    const derivedStart = line.words.find((word) => word.startMs !== null)?.startMs ?? null
    const startMs = line.startMs ?? derivedStart
    if (startMs === null) return []

    const hasWordTiming = line.words.some((word) => word.startMs !== null)
    const body = hasWordTiming
      ? line.words
          .map((word) =>
            word.startMs === null
              ? word.text
              : `<${formatLrcTimestamp(word.startMs)}>${word.text}`,
          )
          .join(' ')
      : line.text
    return [`[${formatLrcTimestamp(startMs)}]${body}`]
  })

  return [...header, '', ...lines].join('\n')
}

function formatAssTimestamp(ms: number): string {
  const centisecondsTotal = Math.max(0, Math.round(ms / 10))
  const centiseconds = centisecondsTotal % 100
  const secondsTotal = Math.floor(centisecondsTotal / 100)
  const seconds = secondsTotal % 60
  const minutesTotal = Math.floor(secondsTotal / 60)
  const minutes = minutesTotal % 60
  const hours = Math.floor(minutesTotal / 60)
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
}

function assColor(color: string): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(color)
  if (!match) return '&H00FFFFFF'
  return `&H00${match[3]}${match[2]}${match[1]}`.toUpperCase()
}

function assStyleName(track: VocalTrack, index: number): string {
  const cleaned = track.name.replace(/[,\r\n]/gu, ' ').trim()
  return cleaned || `Vocal ${index + 1}`
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/gu, '\\\\')
    .replace(/\{/gu, '\\{')
    .replace(/\}/gu, '\\}')
    .replace(/\r?\n/gu, '\\N')
}

function assLineText(line: LyricLine, lineStartMs: number): string {
  if (!line.words.some((word) => word.startMs !== null && word.endMs !== null)) {
    return escapeAssText(line.text)
  }
  let cursorMs = lineStartMs
  return line.words.map((word) => {
    if (word.startMs === null || word.endMs === null) return escapeAssText(word.text)
    const gapCs = Math.max(0, Math.round((word.startMs - cursorMs) / 10))
    const durationCs = Math.max(1, Math.round((word.endMs - word.startMs) / 10))
    cursorMs = Math.max(cursorMs, word.endMs)
    const delay = gapCs > 0 ? `{\\k${gapCs}}` : ''
    return `${delay}{\\kf${durationCs}}${escapeAssText(word.text)}`
  }).join(' ')
}

function lineTiming(line: LyricLine): TimingRange | null {
  const timedWords = line.words.filter(
    (word): word is LyricWord & TimingRange => word.startMs !== null && word.endMs !== null,
  )
  const startMs = line.startMs ?? timedWords[0]?.startMs ?? null
  const endMs = line.endMs ?? timedWords.at(-1)?.endMs ?? null
  if (startMs === null || endMs === null || endMs <= startMs) return null
  return { startMs, endMs }
}

export function exportAss(project: KaraokeProject, trackId?: string): string {
  const tracks = trackId ? [trackById(project, trackId)] : project.tracks
  const styleNames = tracks.map((track, index) => {
    const base = assStyleName(track, index)
    const duplicateCount = tracks
      .slice(0, index)
      .filter((candidate, candidateIndex) => assStyleName(candidate, candidateIndex) === base)
      .length
    return duplicateCount === 0 ? base : `${base} ${duplicateCount + 1}`
  })
  const safeTitle = metadataValue(project.title)
  const header = [
    '[Script Info]',
    `Title: ${safeTitle}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...tracks.map((track, index) => {
      const name = styleNames[index]
      const primary = assColor(track.color)
      return `Style: ${name},Arial,72,${primary},&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,80,1`
    }),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = tracks.flatMap((track, trackIndex) =>
    track.lines.flatMap((line) => {
      const timing = lineTiming(line)
      if (!timing) return []
      const adjustedEndMs = timing.endMs + project.offsetMs
      if (adjustedEndMs <= 0) return []
      const adjustedStartMs = Math.max(0, timing.startMs + project.offsetMs)
      const start = formatAssTimestamp(adjustedStartMs)
      const end = formatAssTimestamp(Math.max(adjustedStartMs + 10, adjustedEndMs))
      const style = styleNames[trackIndex]
      return [
        `Dialogue: ${trackIndex},${start},${end},${style},,0,0,0,,${assLineText(line, adjustedStartMs - project.offsetMs)}`,
      ]
    }),
  )

  return [...header, ...events].join('\n')
}

function migrateWord(value: unknown, fallbackId: string): LyricWord {
  if (typeof value === 'string') return createLyricWord(value, { id: fallbackId })
  const record = isRecord(value) ? value : {}
  return createLyricWord(asString(record.text, asString(record.value)), {
    id: asString(record.id, fallbackId),
    startMs: timingFromRecord(record, 'startMs', ['start', 'startTime']),
    endMs: timingFromRecord(record, 'endMs', ['end', 'endTime']),
  })
}

function migrateLine(value: unknown, fallbackId: string): LyricLine {
  const record = isRecord(value) ? value : {}
  const rawText = asString(record.text, asString(record.lyric, asString(record.value)))
  const rawWords = Array.isArray(record.words) ? record.words : null
  const words = rawWords
    ? rawWords.map((word, index) => migrateWord(word, `${fallbackId}-word-${index + 1}`))
    : tokenizeLyricLine(rawText).map((word, index) =>
        createLyricWord(word, { id: `${fallbackId}-word-${index + 1}` }),
      )
  const text = normalizeText(rawText || words.map((word) => word.text).join(' '))
  let startMs = timingFromRecord(record, 'startMs', ['start', 'startTime'])
  let endMs = timingFromRecord(record, 'endMs', ['end', 'endTime'])
  const timedWords = words.filter(
    (word): word is LyricWord & TimingRange => word.startMs !== null && word.endMs !== null,
  )
  startMs ??= timedWords[0]?.startMs ?? null
  endMs ??= timedWords.at(-1)?.endMs ?? null

  return createLyricLine(text, {
    id: asString(record.id, fallbackId),
    startMs,
    endMs,
    words,
  })
}

function migrateTrack(value: unknown, fallbackId: string): VocalTrack {
  const record = isRecord(value) ? value : {}
  const rawLines = Array.isArray(record.lines)
    ? record.lines
    : Array.isArray(record.lyrics)
      ? record.lyrics
      : []
  return createVocalTrack({
    id: asString(record.id, fallbackId),
    name: asString(record.name, asString(record.label, 'Lead Vocal')),
    color: asString(record.color, DEFAULT_TRACK_COLOR),
    muted: asBoolean(record.muted),
    solo: asBoolean(record.solo),
    lines: rawLines.map((line, index) =>
      migrateLine(line, `${fallbackId}-line-${index + 1}`),
    ),
  })
}

/**
 * Normalizes version 1 and current project objects into the current schema.
 * Legacy un-suffixed timing fields (`start`, `end`, `duration`, `offset`) are
 * interpreted as seconds; current `*Ms` fields are rounded to integer ms.
 */
export function migrateProject(value: unknown): KaraokeProject {
  if (!isRecord(value)) throw new TypeError('Project data must be a JSON object.')
  const hasDeclaredVersion = 'schemaVersion' in value || 'version' in value
  const rawDeclaredVersion = value.schemaVersion ?? value.version
  const declaredVersion = hasDeclaredVersion ? rawDeclaredVersion : 1
  const supportedVersion =
    typeof declaredVersion === 'number' &&
    Number.isInteger(declaredVersion) &&
    (declaredVersion === 1 || declaredVersion === PROJECT_SCHEMA_VERSION)
  if (!supportedVersion) {
    if (typeof declaredVersion === 'number' && declaredVersion > PROJECT_SCHEMA_VERSION) {
      throw new Error(
        `Project schema version ${declaredVersion} is newer than supported version ${PROJECT_SCHEMA_VERSION}.`,
      )
    }
    throw new Error(
      `Unsupported project schema version ${String(declaredVersion)}. Supported versions are 1 and ${PROJECT_SCHEMA_VERSION}.`,
    )
  }

  const rawTracks = Array.isArray(value.tracks)
    ? value.tracks
    : Array.isArray(value.vocalTracks)
      ? value.vocalTracks
      : []
  const projectId = asString(value.id, createId('project'))
  const createdAt = asString(value.createdAt, new Date().toISOString())
  const durationMs =
    'durationMs' in value
      ? asIntegerMs(value.durationMs)
      : legacySecondsToMs(value.duration)
  const offsetMs =
    'offsetMs' in value
      ? (asIntegerMs(value.offsetMs) ?? 0)
      : (legacySecondsToMs(value.offset) ?? 0)

  return createProject({
    id: projectId,
    title: asString(value.title, asString(value.name, 'Untitled Song')),
    artist: asString(value.artist, asString(value.performer, 'Unknown Artist')),
    audioPath:
      typeof value.audioPath === 'string'
        ? value.audioPath
        : typeof value.audioFile === 'string'
          ? value.audioFile
          : null,
    durationMs,
    offsetMs,
    createdAt,
    updatedAt: asString(value.updatedAt, createdAt),
    tracks:
      rawTracks.length > 0
        ? rawTracks.map((track, index) =>
            migrateTrack(track, `${projectId}-track-${index + 1}`),
          )
        : [createVocalTrack({ id: `${projectId}-track-1` })],
  })
}

export function serializeProject(project: KaraokeProject): string {
  const errors = validateProject(project).filter(
    (validationIssue) => validationIssue.severity === 'error',
  )
  if (errors.length > 0) {
    throw new Error(`Cannot serialize an invalid project: ${errors[0].message}`)
  }
  return JSON.stringify(project, null, 2)
}

export function parseProject(json: string): KaraokeProject {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SyntaxError(`Invalid project JSON: ${detail}`)
  }
  const project = migrateProject(data)
  const errors = validateProject(project).filter(
    (validationIssue) => validationIssue.severity === 'error',
  )
  if (errors.length > 0) {
    throw new Error(`Invalid karaoke project: ${errors[0].message}`)
  }
  return project
}
