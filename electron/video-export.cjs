'use strict'

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { ffmpegExecutableCandidates } = require('./ffmpeg-setup.cjs')
const { decodeCurrentProject } = require('./project-schema.cjs')
const SYNC_AID_GEOMETRY = require('./sync-aid-geometry.json')
const STAGE_LAYOUT = require('./stage-layout.json')
const {
  adjustedLineRange,
  frameStateAt: styleFrameStateAt,
  normalizeVocalStyle,
  resolveVocalStyle,
  visibleTracks: styledVisibleTracks,
} = require('./video-style-domain.cjs')
const {
  assetInvocation,
  frameInvocation,
  renderDocument: renderStyleDocument,
} = require('./video-style-document.cjs')

const VIDEO_RESOLUTION_PRESETS = Object.freeze({
  '240p': Object.freeze({ width: 426, height: 240 }),
  '360p': Object.freeze({ width: 640, height: 360 }),
  '480p': Object.freeze({ width: 854, height: 480 }),
  '720p': Object.freeze({ width: 1280, height: 720 }),
  '1080p': Object.freeze({ width: 1920, height: 1080 }),
  '1440p': Object.freeze({ width: 2560, height: 1440 }),
  '2160p': Object.freeze({ width: 3840, height: 2160 }),
})
const VIDEO_FRAME_RATES = Object.freeze([30, 60])
const DEFAULT_VIDEO_RESOLUTION = '720p'
const DEFAULT_VIDEO_FPS = 30
const VIDEO_RENDER_FPS = DEFAULT_VIDEO_FPS
const MAX_VIDEO_DURATION_MS = 30 * 60 * 1000
const MAX_VIDEO_FRAMES = Math.ceil(MAX_VIDEO_DURATION_MS * Math.max(...VIDEO_FRAME_RATES) / 1_000)
const MAX_TRACKS = 2
const MAX_LINES = 20_000
const MAX_WORDS = 150_000

function normalizeVideoSettings(value = {}) {
  if (!isRecord(value)) throw new TypeError('Video settings must be an object')
  const resolution = value.resolution ?? DEFAULT_VIDEO_RESOLUTION
  const fps = value.fps ?? DEFAULT_VIDEO_FPS
  if (typeof resolution !== 'string' || !Object.hasOwn(VIDEO_RESOLUTION_PRESETS, resolution)) {
    throw new RangeError('Video resolution preset is not supported')
  }
  const dimensions = VIDEO_RESOLUTION_PRESETS[resolution]
  if (!VIDEO_FRAME_RATES.includes(fps)) throw new RangeError('Video frame rate must be 30 or 60 fps')
  return { resolution, fps, ...dimensions }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback
}

function limitedText(value, fallback, maximumLength = 500) {
  if (typeof value !== 'string') return fallback
  return value.replaceAll('\0', '').slice(0, maximumLength)
}

function normalizeTiming(value, label) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer or null`)
  if (value < 0 || value > MAX_VIDEO_DURATION_MS) {
    throw new RangeError(`${label} must be between zero and thirty minutes`)
  }
  return value
}

function validateTimingPair(startMs, endMs, label) {
  if ((startMs === null) !== (endMs === null)) {
    throw new TypeError(`${label} must have both a start and end time, or neither`)
  }
  if (startMs !== null && endMs <= startMs) {
    throw new RangeError(`${label} must end after it starts`)
  }
}

function normalizeProjectForVideo(value) {
  const project = decodeCurrentProject(value)
  if (project.tracks.length === 0 || project.tracks.length > MAX_TRACKS) {
    throw new TypeError(`Video export supports between 1 and ${MAX_TRACKS} vocal tracks`)
  }

  let lineCount = 0
  let wordCount = 0
  const tracks = project.tracks.map((rawTrack, trackIndex) => {
    lineCount += rawTrack.lines.length
    if (lineCount > MAX_LINES) throw new RangeError(`Video export supports at most ${MAX_LINES} lyric lines`)

    const lines = rawTrack.lines.map((rawLine, lineIndex) => {
      wordCount += rawLine.words.length
      if (wordCount > MAX_WORDS) throw new RangeError(`Video export supports at most ${MAX_WORDS} words`)

      const words = rawLine.words.map((rawWord, wordIndex) => {
        const startMs = normalizeTiming(
          rawWord.startMs,
          `tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}].startMs`,
        )
        const endMs = normalizeTiming(
          rawWord.endMs,
          `tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}].endMs`,
        )
        validateTimingPair(
          startMs,
          endMs,
          `tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}]`,
        )
        return {
          text: limitedText(rawWord.text, '', 250),
          startMs,
          endMs,
        }
      })

      const startMs = normalizeTiming(
        rawLine.startMs,
        `tracks[${trackIndex}].lines[${lineIndex}].startMs`,
      )
      const endMs = normalizeTiming(
        rawLine.endMs,
        `tracks[${trackIndex}].lines[${lineIndex}].endMs`,
      )
      validateTimingPair(startMs, endMs, `tracks[${trackIndex}].lines[${lineIndex}]`)
      return {
        id: limitedText(rawLine.id, `line-${trackIndex}-${lineIndex}`, 300),
        text: limitedText(rawLine.text, words.map((word) => word.text).join(' '), 2_000),
        startMs,
        endMs,
        words,
      }
    })

    return {
      id: limitedText(rawTrack.id, `track-${trackIndex}`, 300),
      name: limitedText(rawTrack.name, `Vocal ${trackIndex + 1}`, 120),
      vocalStyle: normalizeVocalStyle(rawTrack.vocalStyle, `tracks[${trackIndex}].vocalStyle`),
      muted: rawTrack.muted === true,
      solo: rawTrack.solo === true,
      lines,
    }
  })

  const durationMs = project.durationMs ?? 0
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > MAX_VIDEO_DURATION_MS) {
    throw new RangeError('Project duration must be between zero and thirty minutes')
  }
  const offsetMs = project.offsetMs
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > MAX_VIDEO_DURATION_MS) {
    throw new RangeError('Project offset must be within thirty minutes')
  }

  return {
    title: limitedText(project.title, 'Untitled song', 300),
    artist: limitedText(project.artist, 'Unknown artist', 300),
    audioPath: limitedText(project.audioPath, '', 8_192),
    durationMs,
    offsetMs,
    lyricDisplay: { ...project.lyricDisplay },
    stageStyle: project.stageStyle,
    tracks,
  }
}

function parseProjectForVideo(json) {
  if (typeof json !== 'string') throw new TypeError('projectJson must be a string')
  if (Buffer.byteLength(json, 'utf8') > 50 * 1024 * 1024) {
    throw new RangeError('The project is too large to render as video')
  }
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new TypeError('The project JSON is invalid')
  }
  return normalizeProjectForVideo(parsed)
}

function effectiveVideoDurationForProject(project, requestedDurationMs) {
  const latestLyricMs = styledVisibleTracks(project).reduce((latestTrack, track) => {
    const latestLine = track.lines.reduce((latest, line) => {
      const range = adjustedLineRange(line, project.offsetMs)
      return range ? Math.max(latest, range.endMs) : latest
    }, 0)
    return Math.max(latestTrack, latestLine)
  }, 0)
  const requested = finiteInteger(requestedDurationMs)
  const durationMs = Math.max(project.durationMs, requested, latestLyricMs, 1_000)
  if (durationMs > MAX_VIDEO_DURATION_MS) {
    throw new RangeError('Video export is limited to thirty minutes')
  }
  return durationMs
}

function effectiveVideoDuration(projectValue, requestedDurationMs) {
  return effectiveVideoDurationForProject(normalizeProjectForVideo(projectValue), requestedDurationMs)
}

function buildFrameTimelineForProject(project, requestedDurationMs, fps = DEFAULT_VIDEO_FPS) {
  if (!VIDEO_FRAME_RATES.includes(fps)) {
    throw new RangeError('Video frame rate must be 30 or 60 fps')
  }
  const durationMs = effectiveVideoDurationForProject(project, requestedDurationMs)
  const frameCount = Math.ceil(durationMs * fps / 1_000)
  if (frameCount > MAX_VIDEO_FRAMES) {
    throw new RangeError(`Video export would require more than ${MAX_VIDEO_FRAMES} lyric frames`)
  }
  const times = Array.from(
    { length: frameCount },
    (_unused, index) => Math.round(index * 1_000 / fps),
  )
  return { project, durationMs, fps, times }
}

function buildFrameTimeline(projectValue, requestedDurationMs, settings = {}) {
  const { fps } = normalizeVideoSettings(settings)
  return buildFrameTimelineForProject(
    normalizeProjectForVideo(projectValue),
    requestedDurationMs,
    fps,
  )
}

function frameStateAt(projectValue, playbackMs) {
  const project = normalizeProjectForVideo(projectValue)
  return styleFrameStateAt(project, playbackMs)
}

function renderDocument(settings = {}) {
  return renderStyleDocument(normalizeVideoSettings(settings))
}

function createAbortError() {
  const error = new Error('Video export canceled')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

function createVideoExportCommitState() {
  let state = 'cancellable'

  return {
    get state() {
      return state
    },
    tryBeginCancellation() {
      if (state !== 'cancellable') return false
      state = 'canceling'
      return true
    },
    beginPromotion() {
      if (state !== 'cancellable') return false
      state = 'promoting'
      return true
    },
    finishPromotion() {
      if (state !== 'promoting') {
        throw new Error('Video export cannot be committed before promotion begins')
      }
      state = 'committed'
    },
  }
}

async function promoteVideoOutput(partialPath, outputPath, {
  renameFile = fs.rename,
  onPromotionStart,
  onPromotionComplete,
} = {}) {
  if (onPromotionStart?.() === false) throw createAbortError()
  await renameFile(partialPath, outputPath)
  onPromotionComplete?.()
}

function waitForNextPaint(contents, update, signal) {
  return new Promise((resolve, reject) => {
    let updateFinished = false
    const cleanup = () => {
      clearTimeout(timeout)
      contents.off('paint', onPaint)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error) => {
      cleanup()
      reject(error)
    }
    const timeout = setTimeout(() => {
      fail(new Error('Timed out while rendering a video frame'))
    }, 10_000)
    const onPaint = (_event, _dirtyRect, image) => {
      if (!updateFinished || image.isEmpty()) return
      cleanup()
      resolve()
    }
    const onAbort = () => fail(createAbortError())
    if (signal?.aborted) {
      fail(createAbortError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    contents.on('paint', onPaint)
    Promise.resolve()
      .then(update)
      .then(() => {
        throwIfAborted(signal)
        updateFinished = true
        // Offscreen rendering does not promise that capturePage observes the
        // compositor state produced by the immediately preceding DOM update.
        // Invalidate and consume the following paint so every encoded frame is
        // tied to the requested lyric state.
        contents.invalidate()
      })
      .catch(fail)
  })
}

async function captureRenderedPage(contents, update, signal) {
  await waitForNextPaint(contents, update, signal)
  throwIfAborted(signal)
  // The paint event is the presentation barrier. capturePage then copies the
  // fully composed surface instead of reusing Electron's offscreen paint image,
  // whose backing storage may be recycled by a later frame.
  const image = await contents.capturePage()
  throwIfAborted(signal)
  if (image.isEmpty()) throw new Error('Electron returned an empty video frame')
  return image
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return null
  // FFmpeg handles SIGINT by finalizing the container trailer before exiting,
  // which leaves a useful partial artifact after an explicit cancellation.
  child.kill('SIGINT')
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 2_000)
  timeout.unref?.()
  return timeout
}

function runProcess(executable, args, { signal, inputWriter } = {}) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: [inputWriter ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    let spawnError
    let writerError
    let killTimeout
    let abortGraceTimer
    const finishAbort = () => {
      if (child.exitCode === null && child.signalCode === null) {
        killTimeout ||= terminateChild(child)
      }
    }
    const requestAbort = () => {
      if (inputWriter && child.stdin && !child.stdin.destroyed) {
        child.stdin.end()
        if (!abortGraceTimer) {
          abortGraceTimer = setTimeout(finishAbort, 350)
          abortGraceTimer.unref?.()
        }
      } else {
        finishAbort()
      }
    }
    const onAbort = () => {
      writerError ||= createAbortError()
      requestAbort()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64_000) stderr += chunk.toString()
    })
    child.stdin?.on('error', (error) => {
      writerError ||= error
    })
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, terminationSignal) => {
      if (abortGraceTimer) clearTimeout(abortGraceTimer)
      if (killTimeout) clearTimeout(killTimeout)
      signal?.removeEventListener?.('abort', onAbort)
      if (spawnError) reject(spawnError)
      else if (writerError?.name === 'AbortError' || signal?.aborted) reject(createAbortError())
      else if (code === 0 && !writerError) resolve()
      else if (code === 0) reject(writerError)
      else reject(new Error(`FFmpeg failed${terminationSignal ? ` (${terminationSignal})` : ''}: ${stderr.trim() || `exit code ${code}`}`))
    })

    if (inputWriter) {
      Promise.resolve()
        .then(() => inputWriter(child.stdin))
        .then(() => {
          throwIfAborted(signal)
          child.stdin.end()
        })
        .catch((error) => {
          writerError ||= error
          if (error?.name === 'AbortError' || signal?.aborted) requestAbort()
          else {
            child.stdin.destroy(error)
            finishAbort()
          }
        })
    }
  })
}

async function findFfmpeg(preferredPath, signal) {
  for (const candidate of ffmpegExecutableCandidates({ preferredPath })) {
    try {
      await runProcess(candidate, ['-hide_banner', '-loglevel', 'error', '-version'], { signal })
      return candidate
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      // Try the next explicit or PATH-based candidate.
    }
  }
  throw new Error('FFmpeg was not found. Install FFmpeg or set OKAY_KARAOKE_FFMPEG to its path.')
}

function projectFonts(project) {
  const style = project.stageStyle
  const fonts = [
    style.lyrics,
    style.titleCard.eyebrow,
    style.titleCard.title,
    style.titleCard.artist,
    style.stageFrame.brand,
    style.stageFrame.clock,
    style.stageFrame.footer,
    ...project.tracks.map((track) => resolveVocalStyle(style.lyrics, track.vocalStyle)),
  ]
  return [...new Map(fonts.map(({ typeface, fontStyle }) => [
    JSON.stringify([typeface, fontStyle]),
    { typeface, fontStyle },
  ])).values()]
}

async function prepareStyleRuntime(project, readLinkedImage) {
  const runtime = {
    fonts: projectFonts(project),
    backgroundDataUrl: '',
    stageLayout: STAGE_LAYOUT,
    syncAidGeometry: SYNC_AID_GEOMETRY,
  }
  const background = project.stageStyle.background
  if (background.mode !== 'image') return runtime
  if (!background.imagePath) throw new Error('Choose a linked background image before exporting')
  if (!path.isAbsolute(background.imagePath)) {
    throw new Error('The linked background image path must be absolute')
  }
  if (typeof readLinkedImage !== 'function') {
    throw new Error('The linked background image decoder is unavailable')
  }
  const { bytes, mime } = await readLinkedImage(background.imagePath)
  runtime.backgroundDataUrl = `data:${mime};base64,${bytes.toString('base64')}`
  return runtime
}

async function writeJpegFrame(stream, image, settings, signal) {
  throwIfAborted(signal)
  if (stream.destroyed) throw new Error('FFmpeg stopped accepting video frames')
  const size = image.getSize()
  const frame = size.width === settings.width && size.height === settings.height
    ? image
    : image.resize({ width: settings.width, height: settings.height, quality: 'best' })
  if (!stream.write(frame.toJPEG(95))) {
    await once(stream, 'drain', signal ? { signal } : undefined)
  }
  throwIfAborted(signal)
}

async function renderVideoFrames(
  BrowserWindow,
  project,
  timeline,
  stream,
  settings,
  runtime,
  onProgress,
  signal,
) {
  throwIfAborted(signal)
  const window = new BrowserWindow({
    show: false,
    width: settings.width,
    height: settings.height,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setFrameRate(settings.fps)
  const onAbort = () => {
    if (!window.isDestroyed()) window.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(renderDocument(settings))}`
    await window.loadURL(documentUrl)
    throwIfAborted(signal)
    const assetResult = await window.webContents.executeJavaScript(assetInvocation(runtime))
    throwIfAborted(signal)
    let lastProgressMs = Number.NEGATIVE_INFINITY

    for (let frameIndex = 0; frameIndex < timeline.times.length; frameIndex += 1) {
      throwIfAborted(signal)
      const currentMs = timeline.times[frameIndex]
      const state = styleFrameStateAt(project, currentMs)
      const image = await captureRenderedPage(window.webContents, () =>
        window.webContents.executeJavaScript(frameInvocation(state, frameIndex)),
      signal)
      await writeJpegFrame(stream, image, settings, signal)
      if (
        frameIndex === 0 ||
        frameIndex === timeline.times.length - 1 ||
        currentMs - lastProgressMs >= 100
      ) {
        lastProgressMs = currentMs
        onProgress?.({ phase: 'frames', completed: frameIndex + 1, total: timeline.times.length })
      }
    }
    return assetResult
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!window.isDestroyed()) window.destroy()
  }
}

function buildFfmpegArguments(audioPath, outputPath, durationMs, settings = {}) {
  const { fps } = normalizeVideoSettings(settings)
  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-probesize', '32768',
    '-analyzeduration', '0',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-vcodec', 'mjpeg',
    '-i', 'pipe:0',
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-bf', '0',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'apad',
    '-t', (durationMs / 1000).toFixed(3),
    '-movflags', '+faststart',
    outputPath,
  ]
}

async function exportKaraokeVideo({
  BrowserWindow,
  projectJson,
  durationMs,
  audioPath,
  outputPath,
  ffmpegPath,
  resolveFfmpegPath,
  readLinkedImage,
  resolution = DEFAULT_VIDEO_RESOLUTION,
  fps = DEFAULT_VIDEO_FPS,
  onProgress,
  onPromotionStart,
  onPromotionComplete,
  signal,
}) {
  throwIfAborted(signal)
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required')
  const project = parseProjectForVideo(projectJson)
  const requestedAudioPath = limitedText(audioPath, '', 8_192).trim()
  const requestedOutputPath = limitedText(outputPath, '', 8_192).trim()
  if (!requestedAudioPath || !requestedOutputPath) throw new TypeError('Audio and output paths are required')
  if (!path.isAbsolute(requestedAudioPath)) {
    throw new TypeError('Video export requires the active absolute linked audio path')
  }
  const resolvedAudioPath = path.resolve(requestedAudioPath)
  const resolvedOutputPath = path.resolve(requestedOutputPath)
  const settings = normalizeVideoSettings({ resolution, fps })

  const audioStats = await fs.stat(resolvedAudioPath).catch(() => null)
  if (!audioStats?.isFile()) throw new Error('The linked audio file could not be read')
  const timeline = buildFrameTimelineForProject(project, durationMs, settings.fps)
  const runtime = await prepareStyleRuntime(project, readLinkedImage)
  const executable = ffmpegPath || (
    typeof resolveFfmpegPath === 'function'
      ? await resolveFfmpegPath(signal)
      : await findFfmpeg(undefined, signal)
  )
  if (!executable) return null
  const parsedOutput = path.parse(resolvedOutputPath)
  const partialPath = path.join(
    parsedOutput.dir,
    `${parsedOutput.name}.partial-${randomUUID()}${parsedOutput.ext || '.mp4'}`,
  )
  let preservePartial = false
  let fontFallbacks = []

  try {
    throwIfAborted(signal)
    onProgress?.({ phase: 'preparing', completed: 0, total: 1 })
    await runProcess(executable, buildFfmpegArguments(
      resolvedAudioPath,
      partialPath,
      timeline.durationMs,
      settings,
    ), {
      signal,
      inputWriter: async (stream) => {
        const assetResult = await renderVideoFrames(
          BrowserWindow,
          project,
          timeline,
          stream,
          settings,
          runtime,
          onProgress,
          signal,
        )
        fontFallbacks = Array.isArray(assetResult?.fontFallbacks)
          ? assetResult.fontFallbacks
          : []
        throwIfAborted(signal)
        onProgress?.({ phase: 'encoding', completed: 0, total: 1 })
      },
    })
    throwIfAborted(signal)
    await promoteVideoOutput(partialPath, resolvedOutputPath, {
      onPromotionStart,
      onPromotionComplete,
    })
    onProgress?.({ phase: 'complete', completed: 1, total: 1 })
    return {
      path: resolvedOutputPath,
      durationMs: timeline.durationMs,
      frameCount: timeline.times.length,
      resolution: settings.resolution,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      fontFallbacks,
    }
  } catch (error) {
    preservePartial = error?.name === 'AbortError' || signal?.aborted === true
    if (preservePartial && error instanceof Error) {
      error.message = `Video export canceled. Partial output was kept beside the destination as ${path.basename(partialPath)}`
    }
    throw error
  } finally {
    if (!preservePartial) await fs.rm(partialPath, { force: true }).catch(() => {})
  }
}

module.exports = {
  MAX_VIDEO_DURATION_MS,
  MAX_VIDEO_FRAMES,
  VIDEO_FRAME_RATES,
  VIDEO_RESOLUTION_PRESETS,
  VIDEO_RENDER_FPS,
  buildFfmpegArguments,
  buildFrameTimeline,
  createVideoExportCommitState,
  effectiveVideoDuration,
  exportKaraokeVideo,
  findFfmpeg,
  frameStateAt,
  normalizeProjectForVideo,
  normalizeVideoSettings,
  parseProjectForVideo,
  promoteVideoOutput,
  renderDocument,
}
