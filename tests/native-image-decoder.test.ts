import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createNativeImageDecoder } = require('../electron/native-image-decoder.cjs') as {
  createNativeImageDecoder(nativeImage: {
    createFromBuffer(bytes: Buffer): {
      isEmpty(): boolean
      getSize(): { width: number; height: number }
    }
  }): (input: { bytes: Buffer }) => boolean
}

describe('Electron linked-image decoder boundary', () => {
  it('accepts only a non-empty decoded image with positive dimensions', () => {
    const createFromBuffer = vi.fn(() => ({
      isEmpty: () => false,
      getSize: () => ({ width: 1280, height: 720 }),
    }))
    const decode = createNativeImageDecoder({ createFromBuffer })
    const bytes = Buffer.from('image bytes')

    expect(decode({ bytes })).toBe(true)
    expect(createFromBuffer).toHaveBeenCalledWith(bytes)
  })

  it.each([
    { empty: true, width: 1280, height: 720 },
    { empty: false, width: 0, height: 720 },
    { empty: false, width: 1280, height: 0 },
  ])('rejects undecodable or dimensionless native images: $empty/$width/$height', ({
    empty,
    width,
    height,
  }) => {
    const decode = createNativeImageDecoder({
      createFromBuffer: () => ({
        isEmpty: () => empty,
        getSize: () => ({ width, height }),
      }),
    })

    expect(decode({ bytes: Buffer.from('corrupt') })).toBe(false)
  })
})
