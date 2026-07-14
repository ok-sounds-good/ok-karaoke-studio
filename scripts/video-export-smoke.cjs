'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { detectFfmpeg } = require('../electron/ffmpeg-setup.cjs')
const { exportKaraokeVideo } = require('../electron/video-export.cjs')
const { createVideoExportSmokeProject } = require('./video-export-smoke-project.cjs')
const {
  validateExporterResult,
  validateProbeReport,
} = require('./video-export-smoke-validation.cjs')

function silentWav(durationSeconds, sampleRate = 48_000) {
  const channels = 2
  const bytesPerSample = 2
  const dataLength = durationSeconds * sampleRate * channels * bytesPerSample
  const wav = Buffer.alloc(44 + dataLength)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataLength, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  wav.writeUInt16LE(channels * bytesPerSample, 32)
  wav.writeUInt16LE(bytesPerSample * 8, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataLength, 40)
  return wav
}

function probeExecutable(ffmpegPath) {
  if (path.basename(ffmpegPath).toLowerCase().startsWith('ffmpeg')) {
    return path.join(
      path.dirname(ffmpegPath),
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    )
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

function probeRenderedVideo(ffmpegPath, videoPath, expected) {
  const probe = spawnSync(probeExecutable(ffmpegPath), [
    '-v', 'error',
    '-count_frames',
    '-show_entries', [
      'format=duration,start_time',
      'stream=codec_type,codec_name,width,height,pix_fmt,color_range,r_frame_rate,avg_frame_rate,start_time,duration,nb_read_frames',
    ].join(':'),
    '-of', 'json',
    videoPath,
  ], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error(probe.stderr || 'FFprobe failed')
  return validateProbeReport(JSON.parse(probe.stdout), expected)
}

function decodeRgbFrame(ffmpegPath, videoPath, frameIndex, width, height) {
  const frameBytes = width * height * 3
  const decoded = spawnSync(ffmpegPath, [
    '-v', 'error',
    '-i', videoPath,
    '-an',
    '-vf', `select=eq(n\\,${frameIndex})`,
    '-frames:v', '1',
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    'pipe:1',
  ], { maxBuffer: frameBytes * 2 })
  if (decoded.status !== 0) {
    throw new Error(decoded.stderr?.toString() || `Could not decode video frame ${frameIndex}`)
  }
  if (!Buffer.isBuffer(decoded.stdout) || decoded.stdout.length !== frameBytes) {
    throw new Error(
      `Expected ${frameBytes} RGB bytes for frame ${frameIndex}, received ${decoded.stdout?.length ?? 0}`,
    )
  }
  return decoded.stdout
}

function lyricFrameDifference(before, after, width, height) {
  // The lyric text is centered in this crop. Excluding the header keeps the
  // clock and brand from masking a missing word transition.
  const left = Math.floor(width * 0.16)
  const right = Math.ceil(width * 0.84)
  const top = Math.floor(height * 0.36)
  const bottom = Math.ceil(height * 0.64)
  let changedPixels = 0
  let totalDifference = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = (y * width + x) * 3
      const redDifference = Math.abs(after[pixel] - before[pixel])
      const greenDifference = Math.abs(after[pixel + 1] - before[pixel + 1])
      const blueDifference = Math.abs(after[pixel + 2] - before[pixel + 2])
      const strongestDifference = Math.max(redDifference, greenDifference, blueDifference)
      if (strongestDifference >= 12) changedPixels += 1
      totalDifference += redDifference + greenDifference + blueDifference
    }
  }
  return { changedPixels, totalDifference }
}

function assertHighlightStartsOnPlannedFrame({
  ffmpegPath,
  videoPath,
  width,
  height,
  fps,
  startMs,
  label,
}) {
  const boundaryFrame = startMs * fps / 1_000
  if (!Number.isInteger(boundaryFrame)) {
    throw new Error(`${label} must start on an exact ${fps} fps frame boundary`)
  }
  const boundaryRgb = decodeRgbFrame(ffmpegPath, videoPath, boundaryFrame, width, height)
  const firstProgressRgb = decodeRgbFrame(
    ffmpegPath,
    videoPath,
    boundaryFrame + 1,
    width,
    height,
  )
  const difference = lyricFrameDifference(boundaryRgb, firstProgressRgb, width, height)
  const minimumChangedPixels = Math.max(8, Math.round(width * height / 10_000))
  if (difference.changedPixels < minimumChangedPixels) {
    let firstObservedChange
    for (let frameOffset = 2; frameOffset <= 4; frameOffset += 1) {
      const laterRgb = decodeRgbFrame(
        ffmpegPath,
        videoPath,
        boundaryFrame + frameOffset,
        width,
        height,
      )
      const laterDifference = lyricFrameDifference(boundaryRgb, laterRgb, width, height)
      if (laterDifference.changedPixels >= minimumChangedPixels) {
        firstObservedChange = {
          frame: boundaryFrame + frameOffset,
          ...laterDifference,
        }
        break
      }
    }
    throw new Error(
      `${label} highlight did not appear on frame ${boundaryFrame + 1} at ${fps} fps: ` +
      `changed-pixels=${difference.changedPixels}, total-difference=${difference.totalDifference}, ` +
      `minimum-changed-pixels=${minimumChangedPixels}, ` +
      `first-observed-change=${JSON.stringify(firstObservedChange ?? null)}`,
    )
  }
  return {
    boundaryFrame,
    firstProgressFrame: boundaryFrame + 1,
    ...difference,
  }
}

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'okay-karaoke-video-smoke-'))
  const audioPath = path.join(directory, 'silence.wav')
  const outputPath = path.join(directory, 'smoke.mp4')

  try {
    // One second of audio exercises FFmpeg's silence padding against a
    // two-second lyric/video timeline.
    await fs.writeFile(audioPath, silentWav(1))
    const ffmpeg = await detectFfmpeg()
    if (!ffmpeg.exportCapable || !ffmpeg.path) {
      throw new Error(
        `FFmpeg must provide libx264 and AAC; missing: ${ffmpeg.missingEncoders.join(', ')}`,
      )
    }
    const ffmpegPath = ffmpeg.path
    const project = createVideoExportSmokeProject(audioPath)
    const expected30 = {
      outputPath,
      durationMs: 2_000,
      durationSeconds: 2,
      resolution: '240p',
      width: 426,
      height: 240,
      fps: 30,
      frameCount: 60,
      fontFallbacks: [],
    }
    const result = await exportKaraokeVideo({
      BrowserWindow,
      projectJson: JSON.stringify(project),
      durationMs: 2_000,
      audioPath,
      outputPath,
      ffmpegPath,
      resolution: '240p',
      fps: 30,
    })
    validateExporterResult(result, expected30)
    const {
      audioStartSeconds,
      durationSeconds,
      videoStartSeconds,
    } = probeRenderedVideo(ffmpegPath, outputPath, expected30)
    const highlightTransitions30 = [
      assertHighlightStartsOnPlannedFrame({
        ffmpegPath,
        videoPath: outputPath,
        width: 426,
        height: 240,
        fps: 30,
        startMs: 500,
        label: 'First word',
      }),
      assertHighlightStartsOnPlannedFrame({
        ffmpegPath,
        videoPath: outputPath,
        width: 426,
        height: 240,
        fps: 30,
        startMs: 700,
        label: 'Second word',
      }),
    ]

    const output60Path = path.join(directory, 'smoke-60fps.mp4')
    const expected60 = {
      outputPath: output60Path,
      durationMs: 2_000,
      durationSeconds: 2,
      resolution: '360p',
      width: 640,
      height: 360,
      fps: 60,
      frameCount: 120,
      fontFallbacks: [],
    }
    const result60 = await exportKaraokeVideo({
      BrowserWindow,
      projectJson: JSON.stringify(project),
      durationMs: 2_000,
      audioPath,
      outputPath: output60Path,
      ffmpegPath,
      resolution: '360p',
      fps: 60,
    })
    validateExporterResult(result60, expected60)
    probeRenderedVideo(ffmpegPath, output60Path, expected60)
    const highlightTransitions60 = [
      assertHighlightStartsOnPlannedFrame({
        ffmpegPath,
        videoPath: output60Path,
        width: 640,
        height: 360,
        fps: 60,
        startMs: 500,
        label: 'First word',
      }),
      assertHighlightStartsOnPlannedFrame({
        ffmpegPath,
        videoPath: output60Path,
        width: 640,
        height: 360,
        fps: 60,
        startMs: 700,
        label: 'Second word',
      }),
    ]

    const successfulEntries = await fs.readdir(directory)
    const successfulPartials = successfulEntries.filter((name) => name.includes('.partial-'))
    if (successfulPartials.length > 0) {
      throw new Error(`Successful exports left partial outputs: ${JSON.stringify(successfulPartials)}`)
    }

    const corruptAudioPath = path.join(directory, 'corrupt-audio.wav')
    const ordinaryFailurePath = path.join(directory, 'ordinary-failure.mp4')
    const destinationSentinel = Buffer.from('existing caller destination\n')
    await fs.writeFile(corruptAudioPath, Buffer.from('not a wav or any other media container'))
    await fs.writeFile(ordinaryFailurePath, destinationSentinel)
    let ordinaryFailureObserved = false
    try {
      await exportKaraokeVideo({
        BrowserWindow,
        projectJson: JSON.stringify(createVideoExportSmokeProject(corruptAudioPath)),
        durationMs: 2_000,
        audioPath: corruptAudioPath,
        outputPath: ordinaryFailurePath,
        ffmpegPath,
        resolution: '240p',
        fps: 30,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      ordinaryFailureObserved = true
    }
    const ordinaryEntries = await fs.readdir(directory)
    const ordinaryPartials = ordinaryEntries.filter((name) => (
      name.startsWith('ordinary-failure.partial-')
    ))
    const ordinaryStats = await fs.stat(ordinaryFailurePath)
    if (
      !ordinaryFailureObserved || !ordinaryStats.isFile() || ordinaryStats.size === 0 ||
      !destinationSentinel.equals(await fs.readFile(ordinaryFailurePath)) ||
      ordinaryPartials.length !== 0
    ) throw new Error('Ordinary FFmpeg failure did not preserve the destination atomically')

    const canceledPath = path.join(directory, 'canceled.mp4')
    const controller = new AbortController()
    let cancellationObserved = false
    let cancellationScheduled = false
    try {
      await exportKaraokeVideo({
        BrowserWindow,
        projectJson: JSON.stringify(project),
        durationMs: 2_000,
        audioPath,
        outputPath: canceledPath,
        ffmpegPath,
        resolution: '240p',
        fps: 30,
        signal: controller.signal,
        onProgress: (progress) => {
          if (
            progress.phase === 'frames' &&
            progress.completed >= 15 &&
            !cancellationScheduled
          ) {
            cancellationScheduled = true
            setImmediate(() => controller.abort())
          }
        },
      })
    } catch (error) {
      if (error?.name !== 'AbortError') throw error
      cancellationObserved = true
    }
    const canceledDestinationExists = await fs.stat(canceledPath).then(
      () => true,
      () => false,
    )
    const partialPattern = new RegExp([
      '^canceled\\.partial-[0-9a-f]{8}-[0-9a-f]{4}-',
      '4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.mp4$',
    ].join(''), 'iu')
    const directoryEntries = await fs.readdir(directory)
    const partialCancellationFiles = directoryEntries
      .filter((fileName) => partialPattern.test(fileName))
    const allPartialFiles = directoryEntries.filter((fileName) => fileName.includes('.partial-'))
    if (
      !cancellationObserved ||
      canceledDestinationExists ||
      partialCancellationFiles.length !== 1 ||
      allPartialFiles.length !== 1
    ) {
      throw new Error(
        `Canceled video export did not preserve exactly one partial output: ${JSON.stringify(directoryEntries)}`,
      )
    }
    const partialCancellationPath = path.join(directory, partialCancellationFiles[0])
    const partialStats = await fs.stat(partialCancellationPath)
    if (!partialStats.isFile() || partialStats.size <= 0) {
      throw new Error('Canceled video export partial is not a non-empty regular file')
    }
    const cancellationProbe = probeRenderedVideo(ffmpegPath, partialCancellationPath, {
      ...expected30,
      allowShorterDuration: true,
    })

    console.log(JSON.stringify({
      ...result,
      sixtyFpsFrameCount: result60.frameCount,
      codecs: ['h264', 'aac'],
      resolution: '426x240',
      fps: 30,
      verified60FpsResolution: '640x360',
      probedDurationSeconds: durationSeconds,
      videoStartSeconds,
      audioStartSeconds,
      paddedAudio: true,
      highlightTransitions30,
      highlightTransitions60,
      ordinaryFailureAtomic: true,
      cancellationPartialPreserved: true,
      cancellationPartialReadable: true,
      cancellationFrameCount: cancellationProbe.frameCount,
    }))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
    app.quit()
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
