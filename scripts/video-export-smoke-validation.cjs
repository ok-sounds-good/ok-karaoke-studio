'use strict'

const path = require('node:path')

function invalid(label) {
  const error = new Error(`VIDEO_SMOKE_VALIDATION_FAILED:${label}`)
  error.code = 'VIDEO_SMOKE_VALIDATION_FAILED'
  return error
}

function strictNumber(value, label) {
  const text = typeof value === 'number' ? String(value) : value
  if (
    typeof text !== 'string' ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)
  ) throw invalid(label)
  const number = Number(text)
  if (!Number.isFinite(number)) throw invalid(label)
  return number
}

function strictPositiveInteger(value, label) {
  const number = strictNumber(value, label)
  if (!Number.isSafeInteger(number) || number <= 0) throw invalid(label)
  return number
}

function strictRational(value, label) {
  if (typeof value !== 'string') throw invalid(label)
  const match = /^([+-]?\d+)\/([+-]?\d+)$/u.exec(value)
  if (!match) throw invalid(label)
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (
    !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) throw invalid(label)
  const result = numerator / denominator
  if (!Number.isFinite(result) || result <= 0) throw invalid(label)
  return result
}

function closeTo(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance
}

function validateProbeReport(report, expected) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw invalid('report')
  if (!Array.isArray(report.streams) || report.streams.length !== 2) {
    throw invalid('stream-count')
  }
  const videoStreams = report.streams.filter((stream) => (
    stream?.codec_type === 'video' && stream?.codec_name === 'h264'
  ))
  const audioStreams = report.streams.filter((stream) => (
    stream?.codec_type === 'audio' && stream?.codec_name === 'aac'
  ))
  if (videoStreams.length !== 1 || audioStreams.length !== 1) throw invalid('codecs')
  if (report.streams.some((stream) => !videoStreams.includes(stream) && !audioStreams.includes(stream))) {
    throw invalid('extra-stream')
  }
  const video = videoStreams[0]
  const audio = audioStreams[0]
  if (
    strictPositiveInteger(video.width, 'width') !== expected.width ||
    strictPositiveInteger(video.height, 'height') !== expected.height ||
    video.pix_fmt !== 'yuv420p' ||
    video.color_range !== 'tv'
  ) throw invalid('video-format')

  const rateTolerance = expected.rateTolerance ?? 0.001
  if (
    !closeTo(strictRational(video.r_frame_rate, 'r-frame-rate'), expected.fps, rateTolerance) ||
    !closeTo(strictRational(video.avg_frame_rate, 'avg-frame-rate'), expected.fps, rateTolerance)
  ) throw invalid('frame-rate')
  const frameCount = strictPositiveInteger(video.nb_read_frames, 'frame-count')
  if (!expected.allowShorterDuration && frameCount !== expected.frameCount) {
    throw invalid('frame-count')
  }
  if (expected.allowShorterDuration && frameCount > expected.frameCount) {
    throw invalid('frame-count')
  }

  const format = report.format
  if (!format || typeof format !== 'object' || Array.isArray(format)) throw invalid('format')
  const formatStartSeconds = strictNumber(format.start_time, 'format-start')
  const videoStartSeconds = strictNumber(video.start_time, 'video-start')
  const audioStartSeconds = strictNumber(audio.start_time, 'audio-start')
  if (
    formatStartSeconds < 0 || videoStartSeconds < 0 || audioStartSeconds < 0 ||
    !closeTo(videoStartSeconds, audioStartSeconds, expected.startToleranceSeconds ?? 0.001)
  ) throw invalid('start-time')

  const durationSeconds = strictNumber(format.duration, 'format-duration')
  const videoDurationSeconds = strictNumber(video.duration, 'video-duration')
  const audioDurationSeconds = strictNumber(audio.duration, 'audio-duration')
  const durations = [durationSeconds, videoDurationSeconds, audioDurationSeconds]
  if (durations.some((duration) => duration <= 0)) throw invalid('duration')
  const durationTolerance = expected.durationToleranceSeconds ?? 0.08
  if (expected.allowShorterDuration) {
    if (durations.some((duration) => duration > expected.durationSeconds + durationTolerance)) {
      throw invalid('duration')
    }
  } else if (durations.some((duration) => (
    !closeTo(duration, expected.durationSeconds, durationTolerance)
  ))) throw invalid('duration')

  return {
    audioStartSeconds,
    durationSeconds,
    formatStartSeconds,
    frameCount,
    videoStartSeconds,
  }
}

function validateExporterResult(result, expected) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalid('result')
  const expectedPath = path.resolve(expected.outputPath)
  if (
    result.path !== expectedPath ||
    result.durationMs !== expected.durationMs ||
    result.resolution !== expected.resolution ||
    result.width !== expected.width ||
    result.height !== expected.height ||
    result.fps !== expected.fps ||
    result.frameCount !== expected.frameCount ||
    !Array.isArray(result.fontFallbacks) ||
    JSON.stringify(result.fontFallbacks) !== JSON.stringify(expected.fontFallbacks ?? [])
  ) throw invalid('exporter-result')
  return true
}

module.exports = {
  strictRational,
  validateExporterResult,
  validateProbeReport,
}
