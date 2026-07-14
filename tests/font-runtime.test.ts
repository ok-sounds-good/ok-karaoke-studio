// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadLocalFont } from '../src/lib/font-runtime'
import type { FontFaceDescriptor, FontTypefaceDescriptor } from '../src/lib/video-style'

const localFace: FontFaceDescriptor = {
  fullName: 'Retry Face Bold',
  style: 'Bold Italic',
  postscriptName: 'RetryFace-Bold',
  weight: 700,
  slant: 'italic',
}

const localTypeface: FontTypefaceDescriptor = {
  kind: 'local',
  family: 'Retry Face',
  faces: [localFace],
}

afterEach(() => vi.unstubAllGlobals())

describe('local font runtime', () => {
  it('evicts a failed load so Retry can change fallback into the requested font', async () => {
    let succeeds = false
    const add = vi.fn()
    const descriptors: FontFaceDescriptors[] = []
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add },
    })
    vi.stubGlobal('FontFace', class {
      constructor(_family: string, _source: string, descriptor: FontFaceDescriptors) {
        descriptors.push(descriptor)
      }

      async load() {
        if (!succeeds) throw new Error('missing')
        return this
      }
    })

    await expect(loadLocalFont(localTypeface, localFace, true)).resolves.toBeNull()
    succeeds = true
    await expect(loadLocalFont(localTypeface, localFace)).resolves.toMatch(/^oks-local-/)
    expect(add).toHaveBeenCalledOnce()
    expect(descriptors.at(-1)).toMatchObject({ style: 'italic', weight: '700' })
  })
})
