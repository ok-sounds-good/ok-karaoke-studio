'use strict'

const FONT_KINDS = new Set(['system-ui', 'system-monospace', 'local'])
const FONT_SLANTS = new Set(['normal', 'italic', 'oblique'])
const ALIGNMENTS = new Set(['left', 'center', 'right'])
const BACKGROUND_MODES = new Set(['solid', 'gradient', 'image'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function color(value, path) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new TypeError(`${path} must be a six-digit hex color`)
  }
  return value.toUpperCase()
}

function integer(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function boolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
  return value
}

function isAbsoluteLinkedPath(value) {
  return value.startsWith('/') || /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\')
}

function exactKeys(value, expected, path) {
  const actual = Object.keys(value)
  const unexpected = actual.find((key) => !expected.includes(key))
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported`)
  if (missing) throw new TypeError(`${path}.${missing} is required`)
}

function fontFace(value, path) {
  if (!isRecord(value)) throw new TypeError(`${path} is not a font face descriptor`)
  exactKeys(value, ['fullName', 'style', 'postscriptName', 'weight', 'slant'], path)
  const stringField = (key, maximum) => {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > maximum) {
      throw new TypeError(`${path}.${key} is invalid`)
    }
    return value[key]
  }
  if (
    value.postscriptName !== null &&
    (typeof value.postscriptName !== 'string' || !/^[a-z0-9._+-]{1,300}$/iu.test(value.postscriptName))
  ) {
    throw new TypeError(`${path}.postscriptName is invalid`)
  }
  if (!FONT_SLANTS.has(value.slant)) throw new TypeError(`${path}.slant is invalid`)
  return {
    fullName: stringField('fullName', 300),
    style: stringField('style', 120),
    postscriptName: value.postscriptName,
    weight: integer(value.weight, `${path}.weight`, 100, 900),
    slant: value.slant,
  }
}

function typeface(value, path) {
  if (!isRecord(value) || !FONT_KINDS.has(value.kind)) {
    throw new TypeError(`${path} is not a supported typeface descriptor`)
  }
  exactKeys(value, ['kind', 'family', 'faces'], path)
  const stringField = (key, maximum) => {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > maximum) {
      throw new TypeError(`${path}.${key} is invalid`)
    }
    return value[key]
  }
  if (!Array.isArray(value.faces) || value.faces.length < 1 || value.faces.length > 100) {
    throw new RangeError(`${path}.faces must contain from 1 to 100 faces`)
  }
  const faces = value.faces.map((face, index) => fontFace(face, `${path}.faces[${index}]`))
  const postscriptNames = faces.map((face) => face.postscriptName)
  if (value.kind === 'local' && (
    postscriptNames.some((name) => name === null) ||
    new Set(postscriptNames).size !== postscriptNames.length
  )) throw new TypeError(`${path}.faces must contain unique local PostScript names`)
  if (value.kind !== 'local' && postscriptNames.some((name) => name !== null)) {
    throw new TypeError(`${path}.faces must not name local faces for system fonts`)
  }
  return {
    kind: value.kind,
    family: stringField('family', 300),
    faces,
  }
}

function resolveFontFace(typefaceValue, requested) {
  const exactPostscript = requested.postscriptName
    ? typefaceValue.faces.find((face) => face.postscriptName === requested.postscriptName)
    : null
  if (exactPostscript) return { ...exactPostscript }
  const exactStyle = typefaceValue.faces.find((face) => (
    face.style.toLowerCase() === requested.style.toLowerCase() &&
    face.weight === requested.weight &&
    face.slant === requested.slant
  ))
  if (exactStyle) return { ...exactStyle }
  return { ...[...typefaceValue.faces].sort((left, right) => {
    const score = (face) => Math.abs(face.weight - requested.weight) +
      (face.slant === requested.slant ? 0 : 1_000)
    return score(left) - score(right) ||
      left.style.localeCompare(right.style) ||
      left.fullName.localeCompare(right.fullName) ||
      String(left.postscriptName).localeCompare(String(right.postscriptName))
  })[0] }
}

function fontSizeStyle(value, path) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`)
  return {
    typeface: typeface(value.typeface, `${path}.typeface`),
    fontStyle: fontFace(value.fontStyle, `${path}.fontStyle`),
    sizePx: integer(value.sizePx, `${path}.sizePx`, 8, 400),
  }
}

function textStyle(value, path, visible = false) {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`)
  exactKeys(
    value,
    visible
      ? ['typeface', 'fontStyle', 'sizePx', 'color', 'visible']
      : ['typeface', 'fontStyle', 'sizePx', 'color'],
    path,
  )
  return {
    ...fontSizeStyle(value, path),
    color: color(value.color, `${path}.color`),
    ...(visible ? { visible: boolean(value.visible, `${path}.visible`) } : {}),
  }
}

function normalizeStageStyle(value) {
  if (!isRecord(value)) throw new TypeError('stageStyle must be an object')
  exactKeys(value, ['background', 'lyrics', 'titleCard', 'stageFrame'], 'stageStyle')
  if (!isRecord(value.background) || !BACKGROUND_MODES.has(value.background.mode)) {
    throw new TypeError('stageStyle.background is invalid')
  }
  exactKeys(
    value.background,
    ['mode', 'solidColor', 'gradientStartColor', 'gradientEndColor', 'imagePath'],
    'stageStyle.background',
  )
  if (value.background.imagePath !== null && typeof value.background.imagePath !== 'string') {
    throw new TypeError('stageStyle.background.imagePath must be a string or null')
  }
  if (typeof value.background.imagePath === 'string' && value.background.imagePath.length > 8192) {
    throw new RangeError('stageStyle.background.imagePath is too long')
  }
  if (
    typeof value.background.imagePath === 'string' &&
    (!value.background.imagePath || !isAbsoluteLinkedPath(value.background.imagePath))
  ) {
    throw new TypeError('stageStyle.background.imagePath must be an absolute path or null')
  }
  if (value.background.mode === 'image' && value.background.imagePath === null) {
    throw new TypeError('stageStyle.background.imagePath is required in image mode')
  }
  if (!isRecord(value.lyrics) || !isRecord(value.titleCard) || !isRecord(value.stageFrame)) {
    throw new TypeError('stageStyle role settings are invalid')
  }
  exactKeys(
    value.lyrics,
    ['typeface', 'fontStyle', 'sizePx', 'unsungColor', 'sungColor'],
    'stageStyle.lyrics',
  )
  exactKeys(value.titleCard, ['eyebrow', 'title', 'artist'], 'stageStyle.titleCard')
  const frame = value.stageFrame
  exactKeys(
    frame,
    ['enabled', 'lineColor', 'lineWidthPx', 'brand', 'clock', 'footer'],
    'stageStyle.stageFrame',
  )
  return {
    background: {
      mode: value.background.mode,
      solidColor: color(value.background.solidColor, 'stageStyle.background.solidColor'),
      gradientStartColor: color(value.background.gradientStartColor, 'stageStyle.background.gradientStartColor'),
      gradientEndColor: color(value.background.gradientEndColor, 'stageStyle.background.gradientEndColor'),
      imagePath: value.background.imagePath,
    },
    lyrics: {
      ...fontSizeStyle(value.lyrics, 'stageStyle.lyrics'),
      unsungColor: color(value.lyrics.unsungColor, 'stageStyle.lyrics.unsungColor'),
      sungColor: color(value.lyrics.sungColor, 'stageStyle.lyrics.sungColor'),
    },
    titleCard: {
      eyebrow: textStyle(value.titleCard.eyebrow, 'stageStyle.titleCard.eyebrow', true),
      title: textStyle(value.titleCard.title, 'stageStyle.titleCard.title', true),
      artist: textStyle(value.titleCard.artist, 'stageStyle.titleCard.artist', true),
    },
    stageFrame: {
      enabled: boolean(frame.enabled, 'stageStyle.stageFrame.enabled'),
      lineColor: color(frame.lineColor, 'stageStyle.stageFrame.lineColor'),
      lineWidthPx: integer(frame.lineWidthPx, 'stageStyle.stageFrame.lineWidthPx', 0, 32),
      brand: textStyle(frame.brand, 'stageStyle.stageFrame.brand', true),
      clock: textStyle(frame.clock, 'stageStyle.stageFrame.clock', true),
      footer: textStyle(frame.footer, 'stageStyle.stageFrame.footer', true),
    },
  }
}

function nullable(value, normalize, path) {
  return value === null ? null : normalize(value, path)
}

function normalizeVocalStyle(value, path) {
  if (!isRecord(value) || !ALIGNMENTS.has(value.alignment) || !isRecord(value.syncAid)) {
    throw new TypeError(`${path} is invalid`)
  }
  exactKeys(
    value,
    [
      'typeface',
      'fontStyle',
      'sizePx',
      'unsungColor',
      'sungColor',
      'alignment',
      'previewMs',
      'syncAid',
    ],
    path,
  )
  exactKeys(value.syncAid, ['enabled', 'minLeadMs', 'maxLeadMs'], `${path}.syncAid`)
  const sizePx = value.sizePx === null
    ? null
    : integer(value.sizePx, `${path}.sizePx`, 8, 400)
  const previewMs = integer(value.previewMs, `${path}.previewMs`, 0, 60_000)
  const minLeadMs = integer(value.syncAid.minLeadMs, `${path}.syncAid.minLeadMs`, 0, 60_000)
  const maxLeadMs = integer(value.syncAid.maxLeadMs, `${path}.syncAid.maxLeadMs`, 0, 60_000)
  if (minLeadMs > maxLeadMs || maxLeadMs > previewMs) {
    throw new RangeError(`${path} must satisfy 0 <= Minimum <= Maximum <= Preview`)
  }
  return {
    typeface: nullable(value.typeface, typeface, `${path}.typeface`),
    fontStyle: nullable(value.fontStyle, fontFace, `${path}.fontStyle`),
    sizePx,
    unsungColor: nullable(value.unsungColor, color, `${path}.unsungColor`),
    sungColor: nullable(value.sungColor, color, `${path}.sungColor`),
    alignment: value.alignment,
    previewMs,
    syncAid: {
      enabled: boolean(value.syncAid.enabled, `${path}.syncAid.enabled`),
      minLeadMs,
      maxLeadMs,
    },
  }
}

function resolveVocalStyle(projectLyrics, vocal) {
  const resolvedTypeface = vocal.typeface || projectLyrics.typeface
  const requestedStyle = vocal.fontStyle || projectLyrics.fontStyle
  return {
    typeface: resolvedTypeface,
    fontStyle: resolveFontFace(resolvedTypeface, requestedStyle),
    sizePx: vocal.sizePx ?? projectLyrics.sizePx,
    unsungColor: vocal.unsungColor || projectLyrics.unsungColor,
    sungColor: vocal.sungColor || projectLyrics.sungColor,
    alignment: vocal.alignment,
    previewMs: vocal.previewMs,
    syncAid: { ...vocal.syncAid },
  }
}

function rawLineRange(line) {
  const timedWords = line.words.filter((word) => word.startMs !== null && word.endMs !== null)
  const startMs = line.startMs ?? timedWords[0]?.startMs ?? null
  const endMs = line.endMs ?? timedWords.at(-1)?.endMs ?? null
  if (startMs === null || endMs === null || endMs <= startMs) return null
  return { startMs, endMs }
}

function adjustedLineRange(line, offsetMs) {
  const range = rawLineRange(line)
  if (!range) return null
  const startMs = Math.max(0, range.startMs + offsetMs)
  const endMs = range.endMs + offsetMs
  return endMs > startMs ? { startMs, endMs } : null
}

function visibleTracks(project) {
  const hasSolo = project.tracks.some((track) => track.solo && !track.muted)
  return project.tracks.filter((track) => !track.muted && (!hasSolo || track.solo))
}

function sectionsForTrack(track) {
  const sections = []
  let section = []
  for (const line of track.lines) {
    if (!line.text.trim() && line.words.length === 0) {
      if (section.length) sections.push(section)
      section = []
    } else {
      section.push(line)
    }
  }
  if (section.length) sections.push(section)
  return sections
}

function displayWindows(track, settings) {
  const windows = []
  let priorCompletion = Number.NEGATIVE_INFINITY
  for (const section of sectionsForTrack(track)) {
    const timedEntries = section.flatMap((line) => {
      const range = rawLineRange(line)
      return range ? [{ line, range }] : []
    })
    if (!timedEntries.length) continue
    const timedSection = timedEntries.map(({ line }) => line)
    const ranges = timedEntries.map(({ range }) => range)
    if (settings.advanceMode === 'clear') {
      for (let start = 0; start < timedSection.length; start += settings.lineCount) {
        const lines = timedSection.slice(start, start + settings.lineCount)
        const pageRanges = ranges.slice(start, start + settings.lineCount)
        const activationMs = Math.max(pageRanges[0].startMs - track.vocalStyle.previewMs, priorCompletion)
        const completionMs = Math.max(...pageRanges.map((range) => range.endMs))
        windows.push({ lines, activationMs, completionMs })
        priorCompletion = completionMs
      }
    } else {
      const maximumStart = Math.max(0, timedSection.length - settings.lineCount)
      for (let start = 0; start <= maximumStart; start += 1) {
        const lines = timedSection.slice(start, start + settings.lineCount)
        const entering = start === 0
          ? ranges[0]
          : ranges[Math.min(timedSection.length - 1, start + settings.lineCount - 1)]
        const removed = start > 0 ? ranges[start - 1] : null
        const activationMs = Math.max(
          entering.startMs - track.vocalStyle.previewMs,
          removed?.endMs ?? priorCompletion,
        )
        const completionMs = Math.max(...ranges.slice(start, start + settings.lineCount)
          .map((range) => range.endMs))
        windows.push({ lines, activationMs, completionMs })
        if (start === maximumStart) priorCompletion = completionMs
      }
    }
  }
  return windows
}

function plannedTrackLines(track, lyricMs, settings) {
  const windows = displayWindows(track, settings)
  let active
  for (const candidate of windows) {
    if (candidate.activationMs <= lyricMs) active = candidate
    else break
  }
  if (!active || (active === windows.at(-1) && lyricMs >= active.completionMs)) return []
  return active.lines.map((line) => ({ line, visibleAtMs: active.activationMs }))
}

function firstSectionLineIds(track) {
  return new Set(sectionsForTrack(track).flatMap((section) => section[0] ? [section[0].id] : []))
}

function syncAidFor(track, planned, lyricMs) {
  const config = track.vocalStyle.syncAid
  if (!config.enabled) return null
  const firstIds = firstSectionLineIds(track)
  const entry = planned.find(({ line }) => firstIds.has(line.id))
  const firstWord = entry?.line.words[0]
  if (
    !entry ||
    !firstWord ||
    firstWord.startMs === null ||
    firstWord.endMs === null ||
    firstWord.endMs <= firstWord.startMs
  ) return null
  const firstWordMs = firstWord.startMs
  const availableMs = Math.max(0, firstWordMs - entry.visibleAtMs)
  const durationMs = Math.min(availableMs, config.maxLeadMs, track.vocalStyle.previewMs)
  if (durationMs < config.minLeadMs) return null
  const startMs = firstWordMs - durationMs
  if (lyricMs < startMs || lyricMs >= firstWordMs) return null
  return {
    lineId: entry.line.id,
    startMs,
    endMs: firstWordMs,
    durationMs,
    progress: Math.max(0, Math.min(1, (lyricMs - startMs) / Math.max(1, durationMs))),
  }
}

function wordProgress(word, lyricMs) {
  if (word.startMs === null || word.endMs === null) return 0
  if (lyricMs <= word.startMs) return 0
  if (lyricMs >= word.endMs) return 1
  return Math.max(0, Math.min(1, (lyricMs - word.startMs) / Math.max(1, word.endMs - word.startMs)))
}

function titleHandoff(project) {
  return visibleTracks(project).reduce((handoff, track) => {
    const first = track.lines.flatMap((line) => line.words).find((word) => word.startMs !== null)
    return first?.startMs === null || first?.startMs === undefined
      ? handoff
      : Math.min(handoff, Math.max(0, first.startMs + project.offsetMs - track.vocalStyle.previewMs))
  }, Number.POSITIVE_INFINITY)
}

function frameStateAt(project, playbackMs) {
  const lyricMs = playbackMs - project.offsetMs
  const tracks = visibleTracks(project)
  const planned = tracks.map((track) => ({
    track,
    lines: plannedTrackLines(track, lyricMs, project.lyricDisplay),
  }))
  const lines = []
  for (
    let index = 0;
    index < project.lyricDisplay.lineCount && lines.length < project.lyricDisplay.lineCount;
    index += 1
  ) {
    for (const window of planned) {
      const entry = window.lines[index]
      if (!entry || lines.length >= project.lyricDisplay.lineCount) continue
      const style = resolveVocalStyle(project.stageStyle.lyrics, window.track.vocalStyle)
      lines.push({
        id: entry.line.id,
        trackId: window.track.id,
        text: entry.line.text.replaceAll('/', '·'),
        style,
        words: entry.line.words.filter((word) => word.text).map((word) => ({
          text: word.text.replaceAll('/', '·'),
          progress: wordProgress(word, lyricMs),
        })),
      })
    }
  }
  const admittedLineKeys = new Set(lines.map((line) => `${line.trackId}:${line.id}`))
  return {
    title: project.title || 'Untitled song',
    artist: project.artist || 'Unknown artist',
    playbackMs,
    showTitle: playbackMs < titleHandoff(project),
    stageStyle: project.stageStyle,
    lines,
    syncAids: planned.flatMap(({ track, lines: entries }) => {
      const aid = syncAidFor(track, entries, lyricMs)
      return aid && admittedLineKeys.has(`${track.id}:${aid.lineId}`) ? [{
        ...aid,
        trackId: track.id,
        style: resolveVocalStyle(project.stageStyle.lyrics, track.vocalStyle),
      }] : []
    }),
  }
}

module.exports = {
  adjustedLineRange,
  frameStateAt,
  normalizeStageStyle,
  normalizeVocalStyle,
  resolveVocalStyle,
  visibleTracks,
}
