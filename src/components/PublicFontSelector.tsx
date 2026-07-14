import { useEffect, useState } from 'react'
import {
  SYSTEM_UI_TYPEFACE,
  cloneFontFace,
  cloneTypeface,
  genericFontFace,
  type FontSizeStyle,
  type FontTypefaceDescriptor,
} from '../lib/video-style'
import { FontSelector } from './FontSelector'

export const PUBLIC_FONT_CAPTURE_EVENT = 'oks:request-public-font-capture'

export function usePublicFontCaptureRequest() {
  const [requested, setRequested] = useState(false)
  useEffect(() => {
    const activate = () => setRequested(true)
    window.addEventListener(PUBLIC_FONT_CAPTURE_EVENT, activate)
    return () => window.removeEventListener(PUBLIC_FONT_CAPTURE_EVENT, activate)
  }, [])
  return requested
}

function initialPublicValue(): FontSizeStyle {
  return {
    typeface: cloneTypeface(SYSTEM_UI_TYPEFACE),
    fontStyle: cloneFontFace(genericFontFace(SYSTEM_UI_TYPEFACE, 'Regular')),
    sizePx: 82,
  }
}

export function PublicFontSelector() {
  const [value, setValue] = useState<FontSizeStyle>(initialPublicValue)
  const changeTypeface = (typeface: FontTypefaceDescriptor) => {
    setValue((current) => ({ ...current, typeface: cloneTypeface(typeface) }))
  }

  return (
    <FontSelector
      value={value}
      fonts={[]}
      accessState="ready"
      initialSearch="System"
      onTypefaceChange={changeTypeface}
      onFontStyleChange={(fontStyle) => {
        setValue((current) => ({ ...current, fontStyle: cloneFontFace(fontStyle) }))
      }}
      onSizeChange={(sizePx) => setValue((current) => ({ ...current, sizePx }))}
      onRetry={() => undefined}
      onBack={() => undefined}
    />
  )
}
