import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, Search } from 'lucide-react'
import {
  SYSTEM_MONOSPACE_TYPEFACE,
  SYSTEM_UI_TYPEFACE,
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  fontSlantFromStyle,
  fontTypefaceKey,
  fontWeightFromStyle,
  normalizeStyleInteger,
  resolveFontFace,
  type FontFaceDescriptor,
  type FontSizeStyle,
  type FontTypefaceDescriptor,
} from '../lib/video-style'
import { Button } from './ui'
import { fontFamilyFor, loadLocalFont } from '../lib/font-runtime'

export type FontAccessState = 'loading' | 'ready' | 'denied' | 'unavailable'

interface FontSelectorProps {
  value: FontSizeStyle
  fonts: FontTypefaceDescriptor[]
  accessState: FontAccessState
  onTypefaceChange: (typeface: FontTypefaceDescriptor) => void
  onFontStyleChange: (fontStyle: FontFaceDescriptor) => void
  onSizeChange: (sizePx: number) => void
  onRetry: () => void
  onBack: () => void
  initialSearch?: string
}

export function systemFontChoices(): FontTypefaceDescriptor[] {
  return [cloneTypeface(SYSTEM_UI_TYPEFACE), cloneTypeface(SYSTEM_MONOSPACE_TYPEFACE)]
}

export function normalizeInstalledFonts(fonts: LocalFontData[]): FontTypefaceDescriptor[] {
  const families = new Map<string, Map<string, FontFaceDescriptor>>()
  fonts.forEach((font) => {
    if (
      typeof font.postscriptName !== 'string' ||
      !/^[a-z0-9._+-]{1,300}$/iu.test(font.postscriptName) ||
      typeof font.family !== 'string' || !font.family.trim() ||
      typeof font.fullName !== 'string' || !font.fullName.trim() ||
      typeof font.style !== 'string' || !font.style.trim()
    ) return
    const family = font.family.slice(0, 300)
    const faces = families.get(family) ?? new Map<string, FontFaceDescriptor>()
    const style = font.style.slice(0, 120)
    faces.set(font.postscriptName, {
      fullName: font.fullName.slice(0, 300),
      style,
      postscriptName: font.postscriptName,
      weight: fontWeightFromStyle(style),
      slant: fontSlantFromStyle(style),
    })
    families.set(family, faces)
  })
  return [...families.entries()]
    .map(([family, faces]) => ({
      kind: 'local' as const,
      family,
      faces: [...faces.values()].sort((left, right) => (
        left.weight - right.weight ||
        left.slant.localeCompare(right.slant) ||
        left.style.localeCompare(right.style) ||
        left.fullName.localeCompare(right.fullName)
      )),
    }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

function typefaceFamiliesMatch(
  requested: FontTypefaceDescriptor,
  installed: FontTypefaceDescriptor,
): boolean {
  if (requested.kind !== 'local' || installed.kind !== 'local') return false
  return requested.family.localeCompare(installed.family, undefined, { sensitivity: 'base' }) === 0
}

export function FontSelector({
  value,
  fonts,
  accessState,
  onTypefaceChange,
  onFontStyleChange,
  onSizeChange,
  onRetry,
  onBack,
  initialSearch = '',
}: FontSelectorProps) {
  const [search, setSearch] = useState(initialSearch)
  const requestedKey = fontTypefaceKey(value.typeface)
  const installedFamily = fonts.find((font) => typefaceFamiliesMatch(value.typeface, font))
  const choices = useMemo(() => {
    const all = [
      ...systemFontChoices(),
      ...(value.typeface.kind === 'local' ? [cloneTypeface(value.typeface)] : []),
      ...fonts,
    ]
    return [...new Map(all.map((typeface) => [fontTypefaceKey(typeface), typeface])).values()]
  }, [fonts, value.typeface])
  const filtered = useMemo(() => choices.filter((typeface) => (
    typeface.family.toLowerCase().includes(search.trim().toLowerCase())
  )), [choices, search])
  const selectedTypeface = choices.find((typeface) => (
    fontTypefaceKey(typeface) === requestedKey
  )) ??
    value.typeface
  const selectionVisible = filtered.some((typeface) => (
    fontTypefaceKey(typeface) === requestedKey
  ))
  const selectedFace = resolveFontFace(selectedTypeface, value.fontStyle)
  const selectedTypefaceKey = fontTypefaceKey(selectedTypeface)
  const selectedFaceKey = fontFaceKey(selectedFace)
  const installedHasSelectedFace = selectedFace.postscriptName !== null &&
    installedFamily?.faces.some((face) => face.postscriptName === selectedFace.postscriptName)
  const missing = accessState === 'ready' &&
    value.typeface.kind === 'local' &&
    !installedHasSelectedFace
  const installedReplacement = installedFamily &&
    fontTypefaceKey(installedFamily) !== requestedKey
      ? installedFamily
      : null
  const [previewAlias, setPreviewAlias] = useState<string | null>(null)
  const [previewUnavailable, setPreviewUnavailable] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    let active = true
    setPreviewAlias(null)
    setPreviewUnavailable(false)
    void loadLocalFont(selectedTypeface, selectedFace).then((alias) => {
      if (!active) return
      setPreviewAlias(alias)
      setPreviewUnavailable(selectedTypeface.kind === 'local' && alias === null)
    })
    return () => { active = false }
  }, [selectedFaceKey, selectedTypefaceKey])

  const retry = () => {
    onRetry()
    if (selectedTypeface.kind !== 'local') return
    setPreviewUnavailable(false)
    void loadLocalFont(selectedTypeface, selectedFace, true).then((alias) => {
      setPreviewAlias(alias)
      setPreviewUnavailable(alias === null)
    })
  }

  return (
    <div className="font-selector" aria-labelledby="font-selector-title">
      <div className="font-selector__top">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14} /> Back</Button>
        <div>
          <span className="eyebrow">Installed fonts</span>
          <h3 id="font-selector-title">Choose font</h3>
        </div>
      </div>

      <label className="font-search">
        <Search size={14} />
        <span className="sr-only">Search typefaces</span>
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search typefaces"
        />
      </label>

      <div className="font-selector__columns">
        <label>
          <span>Typeface</span>
          <select
            size={9}
            value={selectionVisible ? requestedKey : ''}
            onChange={(event) => {
              const nextTypeface = choices.find((typeface) => (
                fontTypefaceKey(typeface) === event.target.value
              ))
              if (nextTypeface) onTypefaceChange(cloneTypeface(nextTypeface))
            }}
          >
            {!selectionVisible && <option value="" disabled>Choose a typeface</option>}
            {filtered.map((typeface) => (
              <option key={fontTypefaceKey(typeface)} value={fontTypefaceKey(typeface)}>
                {typeface.family}
                {fontTypefaceKey(typeface) === requestedKey && installedReplacement
                  ? missing ? ' (saved, missing)' : ' (saved)'
                  : installedReplacement && typefaceFamiliesMatch(value.typeface, typeface)
                    ? ' (installed)'
                    : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Style</span>
          <select
            size={9}
            value={fontFaceKey(selectedFace)}
            onChange={(event) => {
              const nextFace = selectedTypeface.faces.find((face) => (
                fontFaceKey(face) === event.target.value
              ))
              if (nextFace) onFontStyleChange(cloneFontFace(nextFace))
            }}
          >
            {selectedTypeface.faces.map((face) => (
              <option key={fontFaceKey(face)} value={fontFaceKey(face)}>{face.style}</option>
            ))}
          </select>
        </label>
        <label className="font-size-field">
          <span>Size</span>
          <input
            type="number"
            min={8}
            max={400}
            step={1}
            value={value.sizePx}
            onChange={(event) => onSizeChange(
              normalizeStyleInteger(event.target.value, 8, 400),
            )}
          />
          <small>logical px</small>
        </label>
      </div>

      <div
        className="font-selector__sample"
        aria-label={`Font sample at ${value.sizePx} logical pixels`}
        style={{
          fontFamily: fontFamilyFor(selectedTypeface, previewAlias),
          fontSize: `${value.sizePx}px`,
          fontStyle: selectedFace.slant,
          fontWeight: selectedFace.weight,
        }}
      >
        This is {selectedTypeface.family}
      </div>

      {accessState === 'loading' && (
        <p className="resource-status" role="status">Reading installed font names…</p>
      )}
      {(accessState === 'denied' || accessState === 'unavailable') && (
        <p className="resource-status resource-status--warning" role="status">
          {accessState === 'denied'
            ? 'Installed-font access was denied. The saved choice is preserved and System UI is used as fallback.'
            : 'Installed-font access is unavailable. System fonts remain available.'}
          {' '}<button onClick={retry}><RefreshCw size={12} /> Retry</button>
        </p>
      )}
      {missing && (
        <p className="resource-status resource-status--warning" role="status">
          Requested: {selectedFace.fullName} (missing). Previewing/exporting with: System UI.
          {installedReplacement && (
            <>{' '}<button onClick={() => onTypefaceChange(cloneTypeface(installedReplacement))}>
              Use installed {installedReplacement.family}
            </button></>
          )}
          {' '}<button onClick={() => onTypefaceChange(cloneTypeface(SYSTEM_UI_TYPEFACE))}>
            Use System UI
          </button>
          {' '}<button onClick={retry}><RefreshCw size={12} /> Retry</button>
        </p>
      )}
      {previewUnavailable && !missing && (
        <p className="resource-status resource-status--warning" role="status">
          Requested: {selectedFace.fullName}. Previewing/exporting with: System UI.
          {' '}<button onClick={retry}><RefreshCw size={12} /> Retry</button>
        </p>
      )}
    </div>
  )
}
