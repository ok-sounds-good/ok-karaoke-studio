import { useCallback, useState } from 'react'
import type { FontTypefaceDescriptor } from '../lib/video-style'
import {
  normalizeInstalledFonts,
  type FontAccessState,
} from '../components/FontSelector'

export function useInstalledFonts() {
  const [fonts, setFonts] = useState<FontTypefaceDescriptor[]>([])
  const [accessState, setAccessState] = useState<FontAccessState>('unavailable')

  const request = useCallback(() => {
    if (!window.queryLocalFonts) {
      setAccessState('unavailable')
      return
    }
    setAccessState('loading')
    // Keep the browser request inside the initiating click's user activation.
    const pending = window.queryLocalFonts()
    void pending.then((available) => {
      setFonts(normalizeInstalledFonts(available))
      setAccessState('ready')
    }).catch(() => setAccessState('denied'))
  }, [])

  return { accessState, fonts, request }
}
