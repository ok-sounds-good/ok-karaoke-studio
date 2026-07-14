import {
  deterministicFontFamily,
  fontStyleFromDescriptor,
  resolveFontFace,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
} from './video-style'

const loadedAliases = new Map<string, Promise<string | null>>()

function stableAlias(postscriptName: string): string {
  let hash = 2166136261
  for (const character of postscriptName) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `oks-local-${(hash >>> 0).toString(36)}`
}

export async function loadLocalFont(
  typeface: FontTypefaceDescriptor,
  requestedStyle: FontFaceDescriptor,
  retry = false,
): Promise<string | null> {
  const requestedFace = resolveFontFace(typeface, requestedStyle)
  if (
    typeface.kind !== 'local' ||
    !requestedFace.postscriptName ||
    typeof FontFace === 'undefined'
  ) {
    return null
  }
  if (!/^[a-z0-9._+-]{1,300}$/iu.test(requestedFace.postscriptName)) return null
  const key = requestedFace.postscriptName
  if (retry) loadedAliases.delete(key)
  const existing = loadedAliases.get(key)
  if (existing) return existing
  const promise = (async () => {
    const alias = stableAlias(key)
    try {
      const loadedFace = new FontFace(alias, `local("${key}")`, {
        style: fontStyleFromDescriptor(requestedFace),
        weight: String(requestedFace.weight),
        display: 'block',
      })
      const loaded = await loadedFace.load()
      document.fonts.add(loaded)
      return alias
    } catch {
      return null
    }
  })()
  loadedAliases.set(key, promise)
  void promise.then((alias) => {
    if (!alias && loadedAliases.get(key) === promise) loadedAliases.delete(key)
  })
  return promise
}

export function fontFamilyFor(typeface: FontTypefaceDescriptor, alias: string | null): string {
  return deterministicFontFamily(typeface, alias ?? undefined)
}
