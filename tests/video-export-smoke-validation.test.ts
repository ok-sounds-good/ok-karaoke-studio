import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const validation = require('../scripts/video-export-smoke-validation.cjs') as {
  strictRational(value: unknown, label: string): number
  validateExporterResult(result: unknown, expected: Record<string, unknown>): true
  validateProbeReport(report: unknown, expected: Record<string, unknown>): Record<string, unknown>
}

function expected(overrides: Record<string, unknown> = {}) {
  return {
    outputPath: resolve(tmpdir(), 'smoke.mp4'),
    durationMs: 2_000,
    durationSeconds: 2,
    resolution: '240p',
    width: 426,
    height: 240,
    fps: 30,
    frameCount: 60,
    fontFallbacks: [],
    ...overrides,
  }
}

function report() {
  return {
    streams: [
      {
        codec_type: 'video', codec_name: 'h264', width: 426, height: 240,
        pix_fmt: 'yuv420p', color_range: 'tv', r_frame_rate: '30/1', avg_frame_rate: '60/2',
        start_time: '0.000000', duration: '2.000000', nb_read_frames: '60',
      },
      {
        codec_type: 'audio', codec_name: 'aac', start_time: '0.000000',
        duration: '2.005000',
      },
    ],
    format: { start_time: '0.000000', duration: '2.005000' },
  }
}

describe('video smoke FFprobe validation', () => {
  it('accepts exactly one H.264 video and one AAC audio stream with strict metadata', () => {
    expect(validation.validateProbeReport(report(), expected())).toMatchObject({
      frameCount: 60,
      videoStartSeconds: 0,
      audioStartSeconds: 0,
    })
    expect(validation.strictRational('30000/1000', 'rate')).toBe(30)
  })

  it.each([
    ['extra stream', (value: ReturnType<typeof report>) => value.streams.push({
      codec_type: 'subtitle', codec_name: 'mov_text',
    } as never)],
    ['missing stream', (value: ReturnType<typeof report>) => value.streams.pop()],
    ['wrong codec', (value: ReturnType<typeof report>) => { value.streams[1].codec_name = 'mp3' }],
    ['zero rational', (value: ReturnType<typeof report>) => { value.streams[0].r_frame_rate = '0/0' }],
    ['malformed rational', (value: ReturnType<typeof report>) => {
      value.streams[0].avg_frame_rate = '30'
    }],
    ['wrong dimensions', (value: ReturnType<typeof report>) => { value.streams[0].width = 425 }],
    ['wrong color range', (value: ReturnType<typeof report>) => {
      value.streams[0].color_range = 'pc'
    }],
    ['wrong frame count', (value: ReturnType<typeof report>) => {
      value.streams[0].nb_read_frames = '59'
    }],
    ['negative start', (value: ReturnType<typeof report>) => {
      value.streams[1].start_time = '-0.001'
    }],
    ['missing duration', (value: ReturnType<typeof report>) => {
      delete (value.streams[0] as { duration?: string }).duration
    }],
    ['NaN duration', (value: ReturnType<typeof report>) => { value.format.duration = 'NaN' }],
    ['infinite duration', (value: ReturnType<typeof report>) => {
      value.format.duration = 'Infinity'
    }],
    ['wrong duration', (value: ReturnType<typeof report>) => { value.format.duration = '1.5' }],
  ])('rejects %s', (_label, mutate) => {
    const value = report()
    mutate(value)
    expect(() => validation.validateProbeReport(value, expected())).toThrow(
      'VIDEO_SMOKE_VALIDATION_FAILED',
    )
  })

  it('accepts a shorter readable cancellation artifact but still bounds every field', () => {
    const value = report()
    value.streams[0].nb_read_frames = '15'
    value.streams[0].duration = '0.500000'
    value.streams[1].duration = '0.510000'
    value.format.duration = '0.510000'
    expect(validation.validateProbeReport(value, expected({ allowShorterDuration: true })))
      .toMatchObject({ frameCount: 15 })
  })

  it('requires exporter metadata to match the requested contract exactly', () => {
    const result = {
      path: resolve(tmpdir(), 'smoke.mp4'), durationMs: 2_000, resolution: '240p',
      width: 426, height: 240, fps: 30, frameCount: 60, fontFallbacks: [],
    }
    expect(validation.validateExporterResult(result, expected())).toBe(true)
    expect(() => validation.validateExporterResult({ ...result, fps: 60 }, expected())).toThrow(
      'VIDEO_SMOKE_VALIDATION_FAILED',
    )
    expect(() => validation.validateExporterResult({
      ...result,
      path: resolve(tmpdir(), 'other.mp4'),
    }, expected()))
      .toThrow('VIDEO_SMOKE_VALIDATION_FAILED')
    expect(() => validation.validateExporterResult({ ...result, fontFallbacks: ['secret'] }, expected()))
      .toThrow('VIDEO_SMOKE_VALIDATION_FAILED')
  })
})
