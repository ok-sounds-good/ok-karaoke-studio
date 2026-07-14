import {
  isHexColor,
  isValidSyncAid,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
  type StageStyle,
  type TextStyle,
  type VocalStyle,
} from './video-style'

type RecordValue = Record<string, unknown>

function isAbsoluteLinkedPath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\')
}

function exactKeys(value: RecordValue, expected: readonly string[], path: string): void {
  const allowed = new Set(expected)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported.`)
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (missing) throw new TypeError(`${path}.${missing} is required.`)
}

function record(value: unknown, path: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return value as RecordValue
}

function string(value: RecordValue, key: string, path: string): string {
  if (typeof value[key] !== 'string') throw new TypeError(`${path}.${key} must be a string.`)
  return value[key]
}

function boolean(value: RecordValue, key: string, path: string): boolean {
  if (typeof value[key] !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean.`)
  return value[key]
}

function integer(value: RecordValue, key: string, path: string): number {
  if (!Number.isSafeInteger(value[key])) {
    throw new TypeError(`${path}.${key} must be a safe integer.`)
  }
  return value[key] as number
}

function boundedInteger(
  value: RecordValue,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
): number {
  const result = integer(value, key, path)
  if (result < minimum || result > maximum) {
    throw new RangeError(`${path}.${key} must be from ${minimum} to ${maximum}.`)
  }
  return result
}

function color(value: RecordValue, key: string, path: string): string {
  const result = string(value, key, path)
  if (!isHexColor(result)) throw new TypeError(`${path}.${key} must be a six-digit hex color.`)
  return result
}

export function validFontFaceDescriptor(value: unknown): value is FontFaceDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const face = value as RecordValue
  return typeof face.fullName === 'string' && Boolean(face.fullName.trim()) && face.fullName.length <= 300 &&
    typeof face.style === 'string' && Boolean(face.style.trim()) && face.style.length <= 120 &&
    (face.postscriptName === null || (
      typeof face.postscriptName === 'string' && /^[a-z0-9._+-]{1,300}$/iu.test(face.postscriptName)
    )) &&
    Number.isSafeInteger(face.weight) && Number(face.weight) >= 100 && Number(face.weight) <= 900 &&
    ['normal', 'italic', 'oblique'].includes(String(face.slant))
}

export function validTypefaceDescriptor(value: unknown): value is FontTypefaceDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const typeface = value as RecordValue
  if (!['system-ui', 'system-monospace', 'local'].includes(String(typeface.kind))) return false
  if (typeof typeface.family !== 'string' || !typeface.family.trim() || typeface.family.length > 300) {
    return false
  }
  if (!Array.isArray(typeface.faces) || typeface.faces.length < 1 || typeface.faces.length > 100) {
    return false
  }
  if (!typeface.faces.every(validFontFaceDescriptor)) return false
  const postscriptNames = typeface.faces.map((face) => face.postscriptName)
  if (typeface.kind === 'local') {
    return postscriptNames.every((name) => name !== null) &&
      new Set(postscriptNames).size === postscriptNames.length
  }
  return postscriptNames.every((name) => name === null)
}

function validTextStyle(value: unknown, withVisibility = false): value is TextStyle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const style = value as RecordValue
  return validTypefaceDescriptor(style.typeface) && validFontFaceDescriptor(style.fontStyle) &&
    Number.isSafeInteger(style.sizePx) && Number(style.sizePx) >= 8 && Number(style.sizePx) <= 400 &&
    typeof style.color === 'string' && isHexColor(style.color) &&
    (!withVisibility || typeof style.visible === 'boolean')
}

export function decodeFontFace(value: unknown, path: string): FontFaceDescriptor {
  const source = record(value, path)
  exactKeys(source, ['fullName', 'style', 'postscriptName', 'weight', 'slant'], path)
  const face = {
    fullName: string(source, 'fullName', path),
    style: string(source, 'style', path),
    postscriptName: source.postscriptName,
    weight: integer(source, 'weight', path),
    slant: string(source, 'slant', path),
  }
  if (!validFontFaceDescriptor(face)) throw new TypeError(`${path} is not a valid font face.`)
  return face
}

export function decodeTypeface(value: unknown, path: string): FontTypefaceDescriptor {
  const source = record(value, path)
  exactKeys(source, ['kind', 'family', 'faces'], path)
  const typeface = {
    kind: string(source, 'kind', path),
    family: string(source, 'family', path),
    faces: Array.isArray(source.faces)
      ? source.faces.map((face, index) => decodeFontFace(face, `${path}.faces[${index}]`))
      : source.faces,
  }
  if (!validTypefaceDescriptor(typeface)) {
    throw new TypeError(`${path} is not a valid typeface descriptor.`)
  }
  return typeface
}

function decodeTextStyle(value: unknown, path: string, withVisibility = false) {
  const source = record(value, path)
  exactKeys(
    source,
    withVisibility
      ? ['typeface', 'fontStyle', 'sizePx', 'color', 'visible']
      : ['typeface', 'fontStyle', 'sizePx', 'color'],
    path,
  )
  const decoded = {
    typeface: decodeTypeface(source.typeface, `${path}.typeface`),
    fontStyle: decodeFontFace(source.fontStyle, `${path}.fontStyle`),
    sizePx: boundedInteger(source, 'sizePx', path, 8, 400),
    color: color(source, 'color', path),
    ...(withVisibility ? { visible: boolean(source, 'visible', path) } : {}),
  }
  if (!validTextStyle(decoded, withVisibility)) {
    throw new TypeError(`${path} is not a valid text style.`)
  }
  return decoded
}

export function decodeStageStyle(value: unknown): StageStyle {
  const source = record(value, 'project.stageStyle')
  exactKeys(source, ['background', 'lyrics', 'titleCard', 'stageFrame'], 'project.stageStyle')
  const background = record(source.background, 'project.stageStyle.background')
  exactKeys(
    background,
    ['mode', 'solidColor', 'gradientStartColor', 'gradientEndColor', 'imagePath'],
    'project.stageStyle.background',
  )
  const mode = string(background, 'mode', 'project.stageStyle.background')
  if (mode !== 'solid' && mode !== 'gradient' && mode !== 'image') {
    throw new TypeError('project.stageStyle.background.mode must be solid, gradient, or image.')
  }
  if (background.imagePath !== null && typeof background.imagePath !== 'string') {
    throw new TypeError('project.stageStyle.background.imagePath must be a string or null.')
  }
  if (
    typeof background.imagePath === 'string' &&
    (!background.imagePath || !isAbsoluteLinkedPath(background.imagePath))
  ) {
    throw new TypeError('project.stageStyle.background.imagePath must be an absolute path or null.')
  }
  if (typeof background.imagePath === 'string' && background.imagePath.length > 8_192) {
    throw new RangeError('project.stageStyle.background.imagePath is too long.')
  }
  if (mode === 'image' && background.imagePath === null) {
    throw new TypeError('project.stageStyle.background.imagePath is required in image mode.')
  }
  const lyrics = record(source.lyrics, 'project.stageStyle.lyrics')
  const title = record(source.titleCard, 'project.stageStyle.titleCard')
  const frame = record(source.stageFrame, 'project.stageStyle.stageFrame')
  exactKeys(
    lyrics,
    ['typeface', 'fontStyle', 'sizePx', 'unsungColor', 'sungColor'],
    'project.stageStyle.lyrics',
  )
  exactKeys(title, ['eyebrow', 'title', 'artist'], 'project.stageStyle.titleCard')
  exactKeys(
    frame,
    ['enabled', 'lineColor', 'lineWidthPx', 'brand', 'clock', 'footer'],
    'project.stageStyle.stageFrame',
  )
  return {
    background: {
      mode,
      solidColor: color(background, 'solidColor', 'project.stageStyle.background'),
      gradientStartColor: color(background, 'gradientStartColor', 'project.stageStyle.background'),
      gradientEndColor: color(background, 'gradientEndColor', 'project.stageStyle.background'),
      imagePath: background.imagePath,
    },
    lyrics: {
      typeface: decodeTypeface(lyrics.typeface, 'project.stageStyle.lyrics.typeface'),
      fontStyle: decodeFontFace(lyrics.fontStyle, 'project.stageStyle.lyrics.fontStyle'),
      sizePx: boundedInteger(lyrics, 'sizePx', 'project.stageStyle.lyrics', 8, 400),
      unsungColor: color(lyrics, 'unsungColor', 'project.stageStyle.lyrics'),
      sungColor: color(lyrics, 'sungColor', 'project.stageStyle.lyrics'),
    },
    titleCard: {
      eyebrow: decodeTextStyle(
        title.eyebrow,
        'project.stageStyle.titleCard.eyebrow',
        true,
      ) as StageStyle['titleCard']['eyebrow'],
      title: decodeTextStyle(
        title.title,
        'project.stageStyle.titleCard.title',
        true,
      ) as StageStyle['titleCard']['title'],
      artist: decodeTextStyle(
        title.artist,
        'project.stageStyle.titleCard.artist',
        true,
      ) as StageStyle['titleCard']['artist'],
    },
    stageFrame: {
      enabled: boolean(frame, 'enabled', 'project.stageStyle.stageFrame'),
      lineColor: color(frame, 'lineColor', 'project.stageStyle.stageFrame'),
      lineWidthPx: boundedInteger(frame, 'lineWidthPx', 'project.stageStyle.stageFrame', 0, 32),
      brand: decodeTextStyle(
        frame.brand,
        'project.stageStyle.stageFrame.brand',
        true,
      ) as StageStyle['stageFrame']['brand'],
      clock: decodeTextStyle(
        frame.clock,
        'project.stageStyle.stageFrame.clock',
        true,
      ) as StageStyle['stageFrame']['clock'],
      footer: decodeTextStyle(
        frame.footer,
        'project.stageStyle.stageFrame.footer',
        true,
      ) as StageStyle['stageFrame']['footer'],
    },
  }
}

export function decodeVocalStyle(value: unknown, path: string): VocalStyle {
  const source = record(value, path)
  exactKeys(
    source,
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
  const nullableColor = (key: 'unsungColor' | 'sungColor') => {
    if (source[key] !== null && typeof source[key] !== 'string') {
      throw new TypeError(`${path}.${key} must be a string or null.`)
    }
    if (typeof source[key] === 'string' && !isHexColor(source[key])) {
      throw new TypeError(`${path}.${key} must be a six-digit hex color or null.`)
    }
    return source[key] as string | null
  }
  if (source.sizePx !== null && !Number.isSafeInteger(source.sizePx)) {
    throw new TypeError(`${path}.sizePx must be an integer or null.`)
  }
  if (typeof source.sizePx === 'number' && (source.sizePx < 8 || source.sizePx > 400)) {
    throw new RangeError(`${path}.sizePx must be from 8 to 400 or null.`)
  }
  const alignment = string(source, 'alignment', path)
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') {
    throw new TypeError(`${path}.alignment must be left, center, or right.`)
  }
  const syncAid = record(source.syncAid, `${path}.syncAid`)
  exactKeys(syncAid, ['enabled', 'minLeadMs', 'maxLeadMs'], `${path}.syncAid`)
  const style: VocalStyle = {
    typeface: source.typeface === null
      ? null
      : decodeTypeface(source.typeface, `${path}.typeface`),
    fontStyle: source.fontStyle === null
      ? null
      : decodeFontFace(source.fontStyle, `${path}.fontStyle`),
    sizePx: source.sizePx as number | null,
    unsungColor: nullableColor('unsungColor'),
    sungColor: nullableColor('sungColor'),
    alignment,
    previewMs: integer(source, 'previewMs', path),
    syncAid: {
      enabled: boolean(syncAid, 'enabled', `${path}.syncAid`),
      minLeadMs: integer(syncAid, 'minLeadMs', `${path}.syncAid`),
      maxLeadMs: integer(syncAid, 'maxLeadMs', `${path}.syncAid`),
    },
  }
  if (!isValidSyncAid(style)) throw new TypeError(`${path} has invalid sync-aid timing.`)
  return style
}

export function videoStyleValidationErrors(
  stageStyle: unknown,
  vocalStyles: Array<{ path: string; style: unknown }>,
): Array<{ code: string; path: string; message: string }> {
  const errors: Array<{ code: string; path: string; message: string }> = []
  try {
    decodeStageStyle(stageStyle)
  } catch (error) {
    errors.push({
      code: 'stage-style-invalid',
      path: 'stageStyle',
      message: error instanceof Error ? error.message : 'Stage style is invalid.',
    })
  }
  vocalStyles.forEach(({ path, style }) => {
    try {
      decodeVocalStyle(style, path)
    } catch (error) {
      errors.push({
        code: 'vocal-style-invalid',
        path,
        message: error instanceof Error ? error.message : 'Vocal style is invalid.',
      })
    }
  })
  return errors
}
