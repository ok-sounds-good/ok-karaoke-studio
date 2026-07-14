import { createRequire } from 'node:module'
import { Buffer } from 'node:buffer'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const documentRuntime = require('../electron/video-style-document.cjs') as {
  assetInvocation(value: unknown): string
  frameInvocation(value: unknown, sequence: number): string
}

function invocationContext(method: string, receiver: ReturnType<typeof vi.fn>) {
  return {
    TextDecoder,
    Uint8Array,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    window: { [method]: receiver },
  }
}

describe('isolated video style document invocations', () => {
  it('round-trips Unicode frame data without interpolating it as source', () => {
    const frame = { title: 'Café 🌙 </script>', lyrics: ['歌って'] }
    const render = vi.fn(() => true)
    const invocation = documentRuntime.frameInvocation(frame, 42)

    expect(invocation).not.toContain(frame.title)
    expect(runInNewContext(
      invocation,
      invocationContext('renderKaraokeFrame', render),
    )).toBe(true)
    expect(render).toHaveBeenCalledWith(frame, 42)
  })

  it('round-trips Unicode asset descriptors through the same UTF-8 boundary', async () => {
    const runtime = { fonts: [{ family: 'ヒラギノ角ゴ' }], backgroundDataUrl: '' }
    const result = { fontFallbacks: [{ requested: 'ヒラギノ角ゴ', effective: 'System UI' }] }
    const prepare = vi.fn(async () => result)
    const invocation = documentRuntime.assetInvocation(runtime)

    await expect(runInNewContext(
      invocation,
      invocationContext('prepareKaraokeAssets', prepare),
    )).resolves.toEqual(result)
    expect(prepare).toHaveBeenCalledWith(runtime)
  })
})
