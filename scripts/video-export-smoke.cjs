'use strict'

const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const presets = require('../electron/video-export-presets.json')
const { exportKaraokeVideo, findFfmpeg } = require('../electron/video-export.cjs')
const { countSungPixels } = require('./video-export-smoke-evidence.cjs')

const ROOT_ENVIRONMENT_KEY = 'OKS_VIDEO_SMOKE_ROOT'
const FIXTURE_DURATION_MS = 1_000
const AUDIO_DURATION_SECONDS = 0.5
const OPENING_AUDIO_DURATION_SECONDS = 1
const OPENING_LEAD_IN_MS = 300
const OPENING_VIDEO_DURATION_MS = OPENING_LEAD_IN_MS + OPENING_AUDIO_DURATION_SECONDS * 1_000
const CASE_TIMEOUT_MS = 2 * 60 * 1_000
const PROCESS_TIMEOUT_MS = 30_000
const MAX_DIAGNOSTIC_CHARACTERS = 400
const MATRIX = Object.freeze(
  presets.resolutions
    .flatMap((preset) =>
      presets.frameRates.map((fps, index) => Object.freeze({ ...preset, fps, ordinal: index + 1 })),
    )
    .map((entry, index) => Object.freeze({ ...entry, ordinal: index + 1 })),
)
const SCROLL_CASES = Object.freeze([30, 60])

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

function toneWav(durationSeconds, sampleRate = 48_000) {
  const wav = silentWav(durationSeconds, sampleRate)
  for (let sample = 0; sample < durationSeconds * sampleRate; sample += 1) {
    const value = Math.round(Math.sin((sample * Math.PI * 2 * 440) / sampleRate) * 12_000)
    const offset = 44 + sample * 4
    wav.writeInt16LE(value, offset)
    wav.writeInt16LE(value, offset + 2)
  }
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

function sanitizedDiagnostic(value, root) {
  const diagnostic = String(value || 'unknown failure')
  return (root ? diagnostic.split(root).join('<smoke-root>') : diagnostic)
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .slice(0, MAX_DIAGNOSTIC_CHARACTERS)
}

function checkedSpawn(executable, args, options, label, root) {
  const result = spawnSync(executable, args, {
    ...options,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label}: ${sanitizedDiagnostic(result.error?.message || result.stderr, root)}`,
    )
  }
  return result
}

function rationalValue(value) {
  const [numerator, denominator = '1'] = String(value).split('/')
  const result = Number(numerator) / Number(denominator)
  return Number.isFinite(result) ? result : Number.NaN
}

function cropFor(width, height) {
  const cropWidth = Math.min(1_024, Math.floor((width * 0.68) / 2) * 2)
  const cropHeight = Math.min(320, Math.floor((height * 0.28) / 2) * 2)
  return {
    height: cropHeight,
    width: cropWidth,
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor(height * 0.36),
  }
}

function decodeLyricCrop(ffmpegPath, videoPath, frameIndex, width, height, root) {
  const fullFrame = width === 960 && height === 540
  const crop = fullFrame ? { width: 960, height: 540 } : cropFor(width, height)
  const frameBytes = crop.width * crop.height * 3
  const decoded = checkedSpawn(
    ffmpegPath,
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-an',
      '-vf',
      fullFrame
        ? `select=eq(n\\,${frameIndex}),scale=${crop.width}:${crop.height}`
        : `select=eq(n\\,${frameIndex}),crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: frameBytes + 1_024 },
    `decode frame ${frameIndex}`,
    root,
  )
  if (!Buffer.isBuffer(decoded.stdout) || decoded.stdout.length !== frameBytes) {
    throw new Error(`decode frame ${frameIndex}: expected ${frameBytes} bytes`)
  }
  return decoded.stdout
}

function lyricDifference(before, after) {
  let changedPixels = 0
  let totalDifference = 0
  for (let pixel = 0; pixel < before.length; pixel += 3) {
    const red = Math.abs(after[pixel] - before[pixel])
    const green = Math.abs(after[pixel + 1] - before[pixel + 1])
    const blue = Math.abs(after[pixel + 2] - before[pixel + 2])
    if (Math.max(red, green, blue) >= 12) changedPixels += 1
    totalDifference += red + green + blue
  }
  return { changedPixels, totalDifference }
}

function lyricEvidence({ ffmpegPath, videoPath, fps, startMs, root }) {
  const boundaryFrame = (startMs * fps) / 1_000
  if (!Number.isInteger(boundaryFrame)) throw new Error('transition is not frame-aligned')
  const before = decodeLyricCrop(ffmpegPath, videoPath, boundaryFrame, 960, 540, root)
  const after = decodeLyricCrop(ffmpegPath, videoPath, boundaryFrame + 1, 960, 540, root)
  const minimumChangedPixels = Math.max(8, Math.round(before.length / 30_000))
  const difference = lyricDifference(before, after)
  if (difference.changedPixels < minimumChangedPixels) {
    const next = lyricDifference(
      before,
      decodeLyricCrop(ffmpegPath, videoPath, boundaryFrame + 2, 960, 540, root),
    )
    throw new Error(
      `transition absent (${difference.changedPixels}/${minimumChangedPixels}; next=${next.changedPixels})`,
    )
  }
  return { boundaryFrame, observedFrame: boundaryFrame + 1, ...difference }
}

function decodeFullFrame(ffmpegPath, videoPath, frameIndex, width, height, root) {
  const frameBytes = width * height * 3
  const decoded = checkedSpawn(
    ffmpegPath,
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-an',
      '-vf',
      `select=eq(n\\,${frameIndex}),scale=${width}:${height}`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: frameBytes + 1_024 },
    `decode full frame ${frameIndex}`,
    root,
  )
  if (!Buffer.isBuffer(decoded.stdout) || decoded.stdout.length !== frameBytes) {
    throw new Error(`decode full frame ${frameIndex}: expected ${frameBytes} bytes`)
  }
  return decoded.stdout
}

function magentaBands(decoded, width, height) {
  const rows = Array.from({ length: height }, () => 0)
  for (let pixel = 0; pixel < decoded.length; pixel += 3) {
    const [red, green, blue] = decoded.subarray(pixel, pixel + 3)
    if (red >= 100 && blue >= 100 && red - green >= 10 && blue - green >= 10) {
      rows[Math.floor(pixel / 3 / width)] += 1
    }
  }
  const bands = []
  let start = null
  for (let row = 0; row <= height; row += 1) {
    if (row < height && rows[row] > 0) {
      if (start === null) start = row
      continue
    }
    if (start === null) continue
    let pixels = 0
    let weightedRows = 0
    for (let index = start; index < row; index += 1) {
      pixels += rows[index]
      weightedRows += index * rows[index]
    }
    bands.push({ bottom: row - 1, center: weightedRows / pixels, pixels, top: start })
    start = null
  }
  return bands
}

function sameWithin(left, right, tolerance = 2) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance
}

function lyricPresenceEvidence({ ffmpegPath, videoPath, fps, root }) {
  const blank = decodeLyricCrop(ffmpegPath, videoPath, (300 * fps) / 1_000, 960, 540, root)
  const before = decodeLyricCrop(ffmpegPath, videoPath, (400 * fps) / 1_000, 960, 540, root)
  const after = decodeLyricCrop(ffmpegPath, videoPath, (900 * fps) / 1_000, 960, 540, root)
  const lyricPixels = countSungPixels(after) - countSungPixels(before)
  if (countSungPixels(before) !== countSungPixels(blank) || lyricPixels < 8)
    throw new Error(`decoded lyric evidence absent (${lyricPixels})`)
  return { observedFrame: (900 * fps) / 1_000, lyricPixels }
}

function decodedOpeningAudioEvidence({ ffmpegPath, videoPath, root }) {
  const sampleRate = 48_000
  const decoded = checkedSpawn(
    ffmpegPath,
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { maxBuffer: 512 * 1_024 },
    'decode opening audio',
    root,
  ).stdout
  if (!Buffer.isBuffer(decoded) || decoded.length < sampleRate * 4 * 0.6) {
    throw new Error('decoded opening audio is incomplete')
  }
  let firstAudible = -1
  let preLeadPeak = 0
  const leadSamples = (OPENING_LEAD_IN_MS * sampleRate) / 1_000
  const toleranceSamples = (50 * sampleRate) / 1_000
  for (let sample = 0; sample < decoded.length / 4; sample += 1) {
    const amplitude = Math.abs(decoded.readFloatLE(sample * 4))
    if (sample < leadSamples - toleranceSamples) preLeadPeak = Math.max(preLeadPeak, amplitude)
    if (firstAudible < 0 && amplitude >= 0.02) firstAudible = sample
  }
  if (
    preLeadPeak > 0.002 ||
    firstAudible < leadSamples ||
    firstAudible > leadSamples + toleranceSamples
  ) {
    throw new Error(
      `opening audio onset mismatch pre=${preLeadPeak.toFixed(4)} onset=${firstAudible}`,
    )
  }
  return {
    leadInMs: OPENING_LEAD_IN_MS,
    firstAudibleMs: (firstAudible * 1_000) / sampleRate,
    preLeadPeak,
    pcmSha256: createHash('sha256').update(decoded).digest('hex'),
  }
}

function projectFixture(project, audioPath) {
  Object.assign(project, {
    id: 'video-export-smoke',
    title: 'Video export smoke test',
    artist: 'Okay Karaoke Studio',
    audioPath,
    durationMs: FIXTURE_DURATION_MS,
    offsetMs: 0,
  })
  Object.assign(project.stageStyle.background, { mode: 'gradient', imagePath: null })
  project.stageStyle.stageFrame.enabled = false
  project.stageStyle.lyrics.sizePx = 180
  project.tracks[0].vocalStyle.sungColor = '#FF00FF'
  Object.assign(project.tracks[0], {
    id: 'smoke-track',
    lines: [
      {
        id: 'smoke-line',
        text: 'Smoke test',
        startMs: 500,
        endMs: 1_000,
        words: [
          { id: 'smoke-word-1', text: 'Smoke', startMs: 500, endMs: 533 },
          { id: 'smoke-word-2', text: 'test', startMs: 700, endMs: 733 },
        ],
      },
    ],
  })
  return project
}

function scrollProjectFixture(project, audioPath) {
  Object.assign(project, {
    id: 'video-export-scroll-smoke',
    title: 'Video export Scroll smoke test',
    artist: 'Okay Karaoke Studio',
    audioPath,
    durationMs: FIXTURE_DURATION_MS,
    lyricDisplay: { lineCount: 2, advanceMode: 'scroll' },
    offsetMs: 0,
  })
  Object.assign(project.stageStyle.background, {
    mode: 'solid',
    imagePath: null,
    solidColor: '#000000',
  })
  project.stageStyle.stageFrame.enabled = false
  project.stageStyle.lyrics.sizePx = 180
  Object.assign(project.tracks[0], {
    id: 'scroll-smoke-track',
    vocalStyle: {
      ...project.tracks[0].vocalStyle,
      previewMs: 0,
      syncAid: { enabled: false, minLeadMs: 0, maxLeadMs: 0 },
    },
    lines: [
      {
        id: 'scroll-smoke-a',
        text: 'MMMM',
        startMs: 0,
        endMs: 150,
        words: [{ id: 'scroll-smoke-a-word', text: 'MMMM', startMs: 0, endMs: 50 }],
      },
      {
        id: 'scroll-smoke-b',
        text: 'MMMM',
        startMs: 150,
        endMs: 300,
        words: [{ id: 'scroll-smoke-b-word', text: 'MMMM', startMs: 150, endMs: 200 }],
      },
      {
        id: 'scroll-smoke-c',
        text: 'MMMM',
        startMs: 350,
        endMs: 900,
        words: [{ id: 'scroll-smoke-c-word', text: 'MMMM', startMs: 350, endMs: 400 }],
      },
    ],
  })
  project.tracks[0].vocalStyle.sungColor = '#FF00FF'
  return project
}

function failCase(entry, phase, error) {
  const failure = new Error(error?.message || String(error))
  failure.case = {
    ordinal: entry?.ordinal ?? 0,
    preset: entry?.value ?? 'setup',
    fps: entry?.fps ?? 0,
    phase,
  }
  return failure
}

async function probeCase(entry, ffmpegPath, outputPath, root) {
  const probe = checkedSpawn(
    probeExecutable(ffmpegPath),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,start_time:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,start_time,nb_read_frames',
      '-count_frames',
      '-of',
      'json',
      outputPath,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1_024 },
    'ffprobe',
    root,
  )
  const report = JSON.parse(probe.stdout)
  const streams = Array.isArray(report.streams) ? report.streams : []
  const videos = streams.filter((stream) => stream.codec_type === 'video')
  const audios = streams.filter((stream) => stream.codec_type === 'audio')
  const video = videos[0]
  const audio = audios[0]
  const durationSeconds = Number(report.format?.duration)
  const videoStartSeconds = Number(video?.start_time)
  const audioStartSeconds = Number(audio?.start_time)
  const renderedRate = rationalValue(video?.r_frame_rate)
  const observedFrameCount = Number(video?.nb_read_frames)
  if (
    streams.length !== 2 ||
    videos.length !== 1 ||
    audios.length !== 1 ||
    video.codec_name !== 'h264' ||
    audio.codec_name !== 'aac' ||
    video.width !== entry.width ||
    video.height !== entry.height ||
    !Number.isFinite(renderedRate) ||
    Math.abs(renderedRate - entry.fps) > 0.001 ||
    observedFrameCount !== (FIXTURE_DURATION_MS * entry.fps) / 1_000 ||
    !Number.isFinite(videoStartSeconds) ||
    !Number.isFinite(audioStartSeconds) ||
    Math.abs(videoStartSeconds) > 0.001 ||
    Math.abs(audioStartSeconds) > 0.001 ||
    Math.abs(videoStartSeconds - audioStartSeconds) > 0.001 ||
    !Number.isFinite(durationSeconds) ||
    Math.abs(durationSeconds - FIXTURE_DURATION_MS / 1_000) > 0.05
  ) {
    throw new Error(`stream mismatch ${JSON.stringify(report)}`)
  }
  return {
    observedDimensions: { width: video.width, height: video.height },
    rationalRate: {
      average: video.avg_frame_rate,
      frames: observedFrameCount,
      rendered: video.r_frame_rate,
    },
    codecs: { audio: audio.codec_name, video: video.codec_name },
    streamStarts: { audioSeconds: audioStartSeconds, videoSeconds: videoStartSeconds },
    durationSeconds,
  }
}

async function exportCase(entry, context) {
  const outputPath = path.join(context.root, `${entry.ordinal}-${entry.value}-${entry.fps}.mp4`)
  let exported
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CASE_TIMEOUT_MS)
  try {
    exported = await exportKaraokeVideo({
      BrowserWindow,
      projectJson: context.projectJson,
      durationMs: FIXTURE_DURATION_MS,
      audioPath: context.audioPath,
      outputPath,
      ffmpegPath: context.ffmpegPath,
      resolution: entry.value,
      fps: entry.fps,
      signal: controller.signal,
    })
  } catch (error) {
    throw failCase(entry, timedOut ? 'export-timeout' : 'export', error)
  } finally {
    clearTimeout(timeout)
  }
  let probe
  try {
    probe = await probeCase(entry, context.ffmpegPath, outputPath, context.root)
  } catch (error) {
    throw failCase(entry, 'probe', error)
  }
  let decodedLyricEvidence
  try {
    const parameters = {
      ...entry,
      ffmpegPath: context.ffmpegPath,
      videoPath: outputPath,
      root: context.root,
    }
    decodedLyricEvidence =
      entry.ordinal <= 2
        ? [500, 700].map((startMs) => lyricEvidence({ ...parameters, startMs }))
        : [lyricPresenceEvidence(parameters)]
  } catch (error) {
    throw failCase(entry, 'decode', error)
  }
  const file = await fs.readFile(outputPath)
  if (exported.frameCount !== (FIXTURE_DURATION_MS * entry.fps) / 1_000 || file.length < 1) {
    throw failCase(entry, 'validate', new Error('export result or output size is invalid'))
  }
  return {
    ordinal: entry.ordinal,
    preset: entry.value,
    fps: entry.fps,
    ...probe,
    decodedLyricEvidence,
    bytes: file.length,
    sha256: createHash('sha256').update(file).digest('hex'),
  }
}

function scrollFrameEvidence({ entry, ffmpegPath, root, videoPath }) {
  const samples = [300, 500, 700].map((timeMs) => {
    const frameIndex = (timeMs * entry.fps) / 1_000
    if (!Number.isInteger(frameIndex)) throw new Error('Scroll sample is not frame-aligned')
    return {
      bands: magentaBands(
        decodeFullFrame(ffmpegPath, videoPath, frameIndex, entry.width, entry.height, root),
        entry.width,
        entry.height,
      ),
      frameIndex,
      timeMs,
    }
  })
  const [before, during, after] = samples
  if (before.bands.length !== 2 || during.bands.length !== 3 || after.bands.length !== 2) {
    throw new Error('Scroll row evidence is incomplete')
  }
  const slotPx = before.bands[1].center - before.bands[0].center
  if (
    !sameWithin(after.bands[1].center - after.bands[0].center, slotPx) ||
    !sameWithin(before.bands[1].center - during.bands[1].center, slotPx / 2) ||
    !sameWithin(after.bands[0].center, before.bands[0].center) ||
    !sameWithin(after.bands[1].center, before.bands[1].center) ||
    during.bands[0].center >= during.bands[1].center ||
    during.bands[1].center >= during.bands[2].center ||
    during.bands[0].pixels >= before.bands[0].pixels ||
    during.bands[2].pixels >= before.bands[0].pixels
  ) {
    throw new Error('Scroll slot or clipping geometry is invalid')
  }
  return { samples, slotPx }
}

async function exportScrollCase(fps, context) {
  const entry = { fps, height: 240, value: '240p', width: 426 }
  const outputPath = path.join(context.root, `scroll-${fps}.mp4`)
  let exported
  try {
    exported = await exportKaraokeVideo({
      BrowserWindow,
      projectJson: context.scrollProjectJson,
      durationMs: FIXTURE_DURATION_MS,
      audioPath: context.audioPath,
      outputPath,
      ffmpegPath: context.ffmpegPath,
      resolution: entry.value,
      fps,
    })
  } catch (error) {
    throw failCase(null, 'scroll-export', error)
  }
  const probe = await probeCase(entry, context.ffmpegPath, outputPath, context.root).catch(
    (error) => {
      throw failCase(null, 'scroll-probe', error)
    },
  )
  const evidence = (() => {
    try {
      return scrollFrameEvidence({
        entry,
        ffmpegPath: context.ffmpegPath,
        root: context.root,
        videoPath: outputPath,
      })
    } catch (error) {
      throw failCase(null, 'scroll-decode', error)
    }
  })()
  if (exported.frameCount !== fps || exported.durationMs !== FIXTURE_DURATION_MS) {
    throw failCase(null, 'scroll-validate', new Error('Scroll export duration is invalid'))
  }
  return { ...probe, evidence, fps }
}

async function verifyCancellation(context) {
  const outputPath = path.join(context.root, 'canceled.mp4')
  const controller = new AbortController()
  let observed = false
  let scheduled = false
  try {
    await exportKaraokeVideo({
      BrowserWindow,
      projectJson: context.projectJson,
      durationMs: FIXTURE_DURATION_MS,
      audioPath: context.audioPath,
      outputPath,
      ffmpegPath: context.ffmpegPath,
      resolution: '240p',
      fps: 30,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'frames' && progress.completed >= 8 && !scheduled) {
          scheduled = true
          setImmediate(() => controller.abort())
        }
      },
    })
  } catch (error) {
    if (error?.name !== 'AbortError') throw failCase(null, 'cancellation', error)
    observed = true
  }
  const entries = await fs.readdir(context.root)
  const partials = entries.filter((name) => /^canceled\.partial-[0-9a-f-]{36}\.mp4$/iu.test(name))
  const destinationExists = await fs.stat(outputPath).then(
    () => true,
    () => false,
  )
  if (!observed || destinationExists || partials.length !== 1) {
    throw failCase(null, 'cancellation', new Error('partial-output contract failed'))
  }
  return { cancellationPartialPreserved: true }
}

async function verifyOpeningAudio(context) {
  const outputPath = path.join(context.root, 'opening-audio.mp4')
  const project = JSON.parse(context.projectJson)
  project.opening = { leadInMs: OPENING_LEAD_IN_MS, titleTiming: { mode: 'until-lyrics' } }
  project.durationMs = OPENING_AUDIO_DURATION_SECONDS * 1_000
  project.tracks[0].lines[0].startMs = 0
  project.tracks[0].lines[0].endMs = OPENING_AUDIO_DURATION_SECONDS * 1_000
  project.tracks[0].lines[0].words.forEach((word, index) => {
    word.startMs = index * 200
    word.endMs = index * 200 + 100
  })
  const exported = await exportKaraokeVideo({
    BrowserWindow,
    projectJson: JSON.stringify(project),
    durationMs: OPENING_VIDEO_DURATION_MS,
    audioPath: context.toneAudioPath,
    outputPath,
    ffmpegPath: context.ffmpegPath,
    resolution: '240p',
    fps: 30,
  })
  if (exported.durationMs !== OPENING_VIDEO_DURATION_MS || exported.frameCount !== 39) {
    throw failCase(
      null,
      'opening-export',
      new Error('opening duration was not counted exactly once'),
    )
  }
  const audio = decodedOpeningAudioEvidence({
    ffmpegPath: context.ffmpegPath,
    videoPath: outputPath,
    root: context.root,
  })
  const file = await fs.readFile(outputPath)
  return {
    ...audio,
    bytes: file.length,
    sha256: createHash('sha256').update(file).digest('hex'),
  }
}

async function writeJson(root, name, value) {
  const temporary = path.join(root, `${name}.partial`)
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' })
  await fs.rename(temporary, path.join(root, name))
}

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const root = process.env[ROOT_ENVIRONMENT_KEY]
  try {
    if (!root || !path.isAbsolute(root)) throw failCase(null, 'setup', new Error('invalid root'))
    const audioPath = path.join(root, 'silence.wav')
    const toneAudioPath = path.join(root, 'tone.wav')
    await fs.writeFile(audioPath, silentWav(AUDIO_DURATION_SECONDS), { flag: 'wx' })
    await fs.writeFile(toneAudioPath, toneWav(OPENING_AUDIO_DURATION_SECONDS), { flag: 'wx' })
    const ffmpegPath = await findFfmpeg()
    const fixture = JSON.parse(
      await fs.readFile(path.join(__dirname, '..', 'tests', 'fixtures', 'current-project-v0.json')),
    )
    const context = {
      root,
      audioPath,
      toneAudioPath,
      ffmpegPath,
      projectJson: JSON.stringify(projectFixture(fixture, audioPath)),
      scrollProjectJson: JSON.stringify(
        scrollProjectFixture(
          JSON.parse(
            await fs.readFile(
              path.join(__dirname, '..', 'tests', 'fixtures', 'current-project-v0.json'),
            ),
          ),
          audioPath,
        ),
      ),
    }
    const cases = []
    for (const entry of MATRIX) cases.push(await exportCase(entry, context))
    const scrollEvidence = []
    for (const fps of SCROLL_CASES) scrollEvidence.push(await exportScrollCase(fps, context))
    const cancellation = await verifyCancellation(context)
    const openingAudioEvidence = await verifyOpeningAudio(context)
    await writeJson(root, 'result.json', {
      ok: true,
      fixture: { audioSeconds: AUDIO_DURATION_SECONDS, videoSeconds: FIXTURE_DURATION_MS / 1_000 },
      cases,
      scrollEvidence,
      openingAudioEvidence,
      ...cancellation,
    })
  } catch (error) {
    try {
      await writeJson(root, 'failure.json', {
        ok: false,
        code: 'VIDEO_SMOKE_CHILD_FAILED',
        case: error?.case || { ordinal: 0, preset: 'setup', fps: 0, phase: 'setup' },
        diagnostic: sanitizedDiagnostic(error?.message, root || ''),
      })
    } catch {}
    process.exitCode = 1
  } finally {
    app.exit(process.exitCode || 0)
  }
})
