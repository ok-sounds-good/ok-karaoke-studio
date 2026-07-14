import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import { cloneVocalStyle, DEFAULT_VOCAL_STYLE } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const videoExport = require('../electron/video-export.cjs') as {
  VIDEO_RESOLUTION_PRESETS: Record<string, { width: number; height: number }>
  buildFfmpegArguments(
    audioPath: string,
    outputPath: string,
    durationMs: number,
    settings?: { resolution?: string; fps?: number },
  ): string[]
  buildFrameTimeline(
    project: unknown,
    durationMs?: number,
    settings?: { resolution?: string; fps?: number },
  ): { durationMs: number; times: number[] }
  createVideoExportCommitState(): {
    readonly state: 'cancellable' | 'canceling' | 'promoting' | 'committed'
    tryBeginCancellation(): boolean
    beginPromotion(): boolean
    finishPromotion(): void
  }
  effectiveVideoDuration(project: unknown, durationMs?: number): number
  exportKaraokeVideo(options: {
    BrowserWindow: new (...args: unknown[]) => unknown
    projectJson: string
    durationMs: number
    audioPath: string
    outputPath: string
    readLinkedImage(path: string): Promise<{ bytes: Buffer; mime: string }>
    resolveFfmpegPath(): Promise<string | null>
  }): Promise<unknown>
  frameStateAt(project: unknown, playbackMs: number): {
    showTitle: boolean
    lines: Array<{
      text: string
      style: { sungColor: string }
      words: Array<{ text: string; progress: number }>
    }>
    syncAids: Array<{ lineId: string; trackId: string; progress: number }>
  }
  normalizeVideoSettings(value?: unknown): {
    resolution: string
    width: number
    height: number
    fps: 30 | 60
  }
  parseProjectForVideo(json: string): unknown
  promoteVideoOutput(
    partialPath: string,
    outputPath: string,
    options?: {
      renameFile?: (partialPath: string, outputPath: string) => Promise<void>
      onPromotionStart?: () => boolean
      onPromotionComplete?: () => void
    },
  ): Promise<void>
  renderDocument(settings?: { resolution?: string; fps?: number }): string
}
const { createLinkedImageValidator } = require('../electron/linked-assets.cjs') as {
  createLinkedImageValidator(
    decoder: () => boolean,
  ): {
    readStaticImage(path: string): Promise<{ bytes: Buffer; mime: string }>
  }
}

function videoProject() {
  const line = createLyricLine('Hello world', {
    id: 'video-line',
    startMs: 1_000,
    endMs: 3_000,
    words: [
      createLyricWord('Hello', { id: 'video-word-1', startMs: 1_000, endMs: 2_000 }),
      createLyricWord('world', { id: 'video-word-2', startMs: 2_000, endMs: 3_000 }),
    ],
  })
  const vocalStyle = cloneVocalStyle(DEFAULT_VOCAL_STYLE)
  vocalStyle.previewMs = 1_500
  vocalStyle.syncAid.minLeadMs = 1_000
  vocalStyle.syncAid.maxLeadMs = 1_500
  return createProject({
    title: 'Video Test',
    artist: 'Okay Singer',
    audioPath: '/music/test.mp3',
    durationMs: 5_000,
    offsetMs: 1_000,
    lyricDisplay: { lineCount: 3, advanceMode: 'clear' },
    tracks: [createVocalTrack({
        id: 'video-track',
        name: 'Lead',
        vocalStyle,
        muted: false,
        solo: false,
        lines: [line],
      })],
  })
}

function timedVideoLine(text: string, startMs: number, endMs: number) {
  return createLyricLine(text, {
    startMs,
    endMs,
    words: [createLyricWord(text, { startMs, endMs })],
  })
}

function blankVideoLine() {
  return createLyricLine('')
}

describe('karaoke video frame planning', () => {
  it('never resolves a serialized relative audio path against the process cwd', async () => {
    const resolveFfmpegPath = vi.fn(async () => '/tools/ffmpeg')

    await expect(videoExport.exportKaraokeVideo({
      BrowserWindow: class {},
      projectJson: JSON.stringify(videoProject()),
      durationMs: 5_000,
      audioPath: '../music/test.mp3',
      outputPath: '/exports/song.mp4',
      readLinkedImage: async () => ({ bytes: Buffer.alloc(0), mime: 'image/png' }),
      resolveFfmpegPath,
    })).rejects.toThrow('active absolute linked audio path')
    expect(resolveFfmpegPath).not.toHaveBeenCalled()
  })

  it('rejects a corrupt linked image before FFmpeg and preserves the destination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'okay-video-corrupt-image-'))
    const audioPath = join(directory, 'song.mp3')
    const backgroundPath = join(directory, 'stage.png')
    const outputPath = join(directory, 'song.mp4')
    const project = videoProject()
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = backgroundPath
    const resolveFfmpegPath = vi.fn(async () => join(directory, 'ffmpeg'))
    const validator = createLinkedImageValidator(() => false)

    await writeFile(audioPath, 'synthetic audio fixture')
    await writeFile(backgroundPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    await writeFile(outputPath, 'existing destination')

    try {
      await expect(videoExport.exportKaraokeVideo({
        BrowserWindow: class {},
        projectJson: JSON.stringify(project),
        durationMs: 5_000,
        audioPath,
        outputPath,
        readLinkedImage: validator.readStaticImage,
        resolveFfmpegPath,
      })).rejects.toThrow(`Linked image is invalid or unreadable: ${backgroundPath}`)

      expect(resolveFfmpegPath).not.toHaveBeenCalled()
      expect(await readFile(outputPath, 'utf8')).toBe('existing destination')
      expect((await readdir(directory)).some((name) => name.includes('.partial-'))).toBe(false)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('refuses cancellation once an existing destination enters atomic promotion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'okay-video-promotion-'))
    const partialPath = join(directory, 'song.partial.mp4')
    const outputPath = join(directory, 'song.mp4')
    const commitState = videoExport.createVideoExportCommitState()
    let releaseRename = () => {}
    let reportRenameStarted = () => {}
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve })
    const renameStarted = new Promise<void>((resolve) => { reportRenameStarted = resolve })

    await writeFile(partialPath, 'new complete video')
    await writeFile(outputPath, 'existing destination')

    const promotion = videoExport.promoteVideoOutput(partialPath, outputPath, {
      onPromotionStart: () => commitState.beginPromotion(),
      onPromotionComplete: () => commitState.finishPromotion(),
      renameFile: async (source, destination) => {
        reportRenameStarted()
        await renameGate
        await rename(source, destination)
      },
    })

    try {
      await renameStarted

      expect(commitState.state).toBe('promoting')
      expect(commitState.tryBeginCancellation()).toBe(false)
      expect(await readFile(outputPath, 'utf8')).toBe('existing destination')

      releaseRename()
      await promotion

      expect(commitState.state).toBe('committed')
      expect(await readFile(outputPath, 'utf8')).toBe('new complete video')
      await expect(readFile(partialPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      releaseRename()
      await promotion.catch(() => {})
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('keeps cancellation atomic before promotion begins', () => {
    const commitState = videoExport.createVideoExportCommitState()

    expect(commitState.tryBeginCancellation()).toBe(true)
    expect(commitState.state).toBe('canceling')
    expect(commitState.beginPromotion()).toBe(false)
  })

  it('maps every supported resolution exactly and accepts only 30 or 60 fps', () => {
    expect(videoExport.VIDEO_RESOLUTION_PRESETS).toEqual({
      '240p': { width: 426, height: 240 },
      '360p': { width: 640, height: 360 },
      '480p': { width: 854, height: 480 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '1440p': { width: 2560, height: 1440 },
      '2160p': { width: 3840, height: 2160 },
    })

    for (const [resolution, dimensions] of Object.entries(videoExport.VIDEO_RESOLUTION_PRESETS)) {
      for (const fps of [30, 60] as const) {
        expect(videoExport.normalizeVideoSettings({ resolution, fps })).toEqual({
          resolution,
          ...dimensions,
          fps,
        })
      }
    }
    expect(videoExport.normalizeVideoSettings()).toEqual({
      resolution: '720p',
      width: 1280,
      height: 720,
      fps: 30,
    })
    expect(() => videoExport.normalizeVideoSettings({ resolution: '4320p', fps: 30 })).toThrow()
    expect(() => videoExport.normalizeVideoSettings({ resolution: '__proto__', fps: 30 })).toThrow()
    expect(() => videoExport.normalizeVideoSettings({ resolution: '720p', fps: 24 })).toThrow()
  })

  it('builds frames at the selected output rate on the offset-adjusted playback clock', () => {
    const timeline30 = videoExport.buildFrameTimeline(videoProject(), 6_000, { fps: 30 })
    const timeline60 = videoExport.buildFrameTimeline(videoProject(), 6_000, { fps: 60 })

    expect(timeline30.durationMs).toBe(6_000)
    expect(timeline30.times).toHaveLength(180)
    expect(timeline30.times.every(
      (time, index) => time === Math.round(index * 1_000 / 30),
    )).toBe(true)
    expect(timeline60.durationMs).toBe(6_000)
    expect(timeline60.times).toHaveLength(360)
    expect(timeline60.times.every(
      (time, index) => time === Math.round(index * 1_000 / 60),
    )).toBe(true)
  })

  it('renders title and per-word progress aligned to word starts and ends', () => {
    expect(videoExport.frameStateAt(videoProject(), 0).showTitle).toBe(true)

    const firstStart = videoExport.frameStateAt(videoProject(), 2_000)
    expect(firstStart.showTitle).toBe(false)
    expect(firstStart.lines[0].text).toBe('Hello world')
    expect(firstStart.lines[0].words).toEqual([
      { text: 'Hello', progress: 0 },
      { text: 'world', progress: 0 },
    ])

    const firstMiddle = videoExport.frameStateAt(videoProject(), 2_500)
    expect(firstMiddle.lines[0].words[0].progress).toBeCloseTo(0.5)
    expect(firstMiddle.lines[0].words[1].progress).toBe(0)

    const secondStart = videoExport.frameStateAt(videoProject(), 3_000)
    expect(secondStart.lines[0].words).toEqual([
      { text: 'Hello', progress: 1 },
      { text: 'world', progress: 0 },
    ])

    const secondMiddle = videoExport.frameStateAt(videoProject(), 3_500)
    expect(secondMiddle.lines[0].words[0].progress).toBe(1)
    expect(secondMiddle.lines[0].words[1].progress).toBeCloseTo(0.5)

    const finished = videoExport.frameStateAt(videoProject(), 4_600)
    expect(finished.lines).toEqual([])
    expect(finished).not.toHaveProperty('instrumental')
    expect(finished).not.toHaveProperty('nextInMs')
  })

  it('does not transfer a section sync aid from an invalid first word to a later word', () => {
    const project = videoProject()
    project.offsetMs = 0
    project.durationMs = 7_000
    project.tracks[0].vocalStyle.previewMs = 3_000
    project.tracks[0].vocalStyle.syncAid = {
      enabled: true,
      minLeadMs: 2_000,
      maxLeadMs: 3_000,
    }
    project.tracks[0].lines = [createLyricLine('Untimed Later', {
      id: 'literal-first-line',
      startMs: 5_000,
      endMs: 6_000,
      words: [
        createLyricWord('Untimed', { startMs: null, endMs: null }),
        createLyricWord('Later', { startMs: 5_000, endMs: 6_000 }),
      ],
    })]

    expect(videoExport.frameStateAt(project, 2_000).syncAids).toEqual([])
    project.tracks[0].lines[0].words[0] = createLyricWord('Timed', {
      startMs: 5_000,
      endMs: 5_500,
    })
    expect(videoExport.frameStateAt(project, 2_000).syncAids).toMatchObject([{
      lineId: 'literal-first-line',
      trackId: 'video-track',
      progress: 0,
    }])
  })

  it('renders clear-mode lyric groups without crossing blank separators', () => {
    const base = videoProject()
    const project = {
      ...base,
      offsetMs: 0,
      durationMs: 11_000,
      lyricDisplay: { lineCount: 5, advanceMode: 'clear' },
      tracks: [{
        ...base.tracks[0],
        lines: [
          timedVideoLine('A', 0, 1_000),
          timedVideoLine('B', 1_000, 2_000),
          timedVideoLine('C', 2_000, 3_000),
          blankVideoLine(),
          timedVideoLine('D', 5_000, 6_000),
          timedVideoLine('E', 6_000, 7_000),
          timedVideoLine('F', 7_000, 8_000),
          timedVideoLine('G', 8_000, 9_000),
          timedVideoLine('H', 9_000, 10_000),
        ],
      }],
    }

    expect(videoExport.frameStateAt(project, 0).lines.map((line) => line.text)).toEqual([
      'A',
      'B',
      'C',
    ])
    expect(videoExport.frameStateAt(project, 3_500).lines.map((line) => line.text)).toEqual([
      'D',
      'E',
      'F',
      'G',
      'H',
    ])
    expect(videoExport.frameStateAt(project, 10_000).lines).toEqual([])
    expect(videoExport.frameStateAt(project, 3_500)).not.toHaveProperty('nextLine')
  })

  it('pages in clear mode and advances one line in scroll mode', () => {
    const base = videoProject()
    const lines = [
      timedVideoLine('One', 0, 1_000),
      timedVideoLine('Two', 1_000, 2_000),
      timedVideoLine('Three', 2_000, 3_000),
      timedVideoLine('Four', 3_000, 4_000),
    ]
    const project = {
      ...base,
      offsetMs: 0,
      tracks: [{ ...base.tracks[0], lines }],
    }

    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
    }, 1_500).lines.map((line) => line.text)).toEqual(['One', 'Two'])
    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
    }, 2_000).lines.map((line) => line.text)).toEqual(['Three', 'Four'])
    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
    }, 1_000).lines.map((line) => line.text)).toEqual(['One', 'Two', 'Three'])
    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
    }, 2_000).lines.map((line) => line.text)).toEqual(['Two', 'Three', 'Four'])
  })

  it('treats line count as a stage-wide limit while retaining both visible voices', () => {
    const base = videoProject()
    const lines = [
      timedVideoLine('Lead one', 0, 1_000),
      timedVideoLine('Lead two', 1_000, 2_000),
      timedVideoLine('Lead three', 2_000, 3_000),
    ]
    const project = {
      ...base,
      offsetMs: 0,
      lyricDisplay: { lineCount: 3, advanceMode: 'clear' },
      tracks: [
        { ...base.tracks[0], name: 'Lead', lines },
        {
          ...base.tracks[0],
          id: 'harmony-video-track',
          name: 'Harmony',
          vocalStyle: {
            ...cloneVocalStyle(base.tracks[0].vocalStyle),
            sungColor: '#58D6DE',
          },
          lines: lines.map((line, lineIndex) => ({
            ...line,
            id: `harmony-line-${lineIndex}`,
            text: line.text.replace('Lead', 'Harmony'),
            words: line.words.map((word, wordIndex) => ({
              ...word,
              id: `harmony-word-${lineIndex}-${wordIndex}`,
              text: word.text.replace('Lead', 'Harmony'),
            })),
          })),
        },
      ],
    }

    const state = videoExport.frameStateAt(project, 0)
    expect(state.lines).toHaveLength(3)
    expect(new Set(state.lines.map((line) => line.text.split(' ')[0]))).toEqual(
      new Set(['Lead', 'Harmony']),
    )
  })

  it('rejects malformed and unbounded project payloads', () => {
    expect(() => videoExport.parseProjectForVideo('{oops')).toThrow('project JSON is invalid')
    expect(() => videoExport.parseProjectForVideo(JSON.stringify({
      ...videoProject(),
      tracks: [],
    }))).toThrow(
      'between 1 and 2 vocal tracks',
    )

    const invalidTiming = videoProject()
    invalidTiming.tracks[0].lines[0].words[0].startMs = -1
    expect(() => videoExport.parseProjectForVideo(JSON.stringify(invalidTiming))).toThrow(
      'startMs must be from 0',
    )

    const incompleteTiming = videoProject()
    incompleteTiming.tracks[0].lines[0].words[0].endMs = null as unknown as number
    expect(() => videoExport.parseProjectForVideo(JSON.stringify(incompleteTiming))).toThrow(
      'must have both a start and end time',
    )

    expect(() => videoExport.parseProjectForVideo(JSON.stringify({
      ...videoProject(),
      lyricDisplay: { lineCount: 6, advanceMode: 'clear' },
    }))).toThrow('lineCount must be from 1 to 5')
  })

  it('renders neither track labels, mini upcoming lines, nor an instrumental fallback', () => {
    const document = videoExport.renderDocument()
    expect(document).not.toContain('state.nextLine')
    expect(document).not.toContain('Next ·')
    expect(document).not.toContain('line-label')
    expect(document).not.toMatch(/textContent\s*=\s*item\.track\b/u)
    expect(document).not.toMatch(/instrumental/iu)
    const script = document.match(/<script>([\s\S]*)<\/script>/u)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Script(script)).not.toThrow()
  })

  it('keeps stage colors in project data instead of hard-coding a renderer palette', () => {
    const document = videoExport.renderDocument()

    expect(document).not.toMatch(/#(?:173126|07100d|22d3ee|7b817d)/iu)
    expect(document).toContain("lyric.style.setProperty('--sung', item.style.sungColor)")
    expect(document).toContain('color: var(--sung)')

    const project = videoProject()
    project.tracks[0].vocalStyle.sungColor = '#A1B2C3'
    expect(videoExport.frameStateAt(project, 2_000).lines[0].style.sungColor).toBe('#A1B2C3')
  })

  it('uses only visible tracks when extending duration', () => {
    const project = videoProject()
    project.durationMs = null
    project.tracks.push(createVocalTrack({
      id: 'muted-guide-track',
      name: 'Muted guide',
      muted: true,
      solo: false,
      lines: [timedVideoLine('Hidden', 20_000, 25_000)],
    }))

    expect(videoExport.effectiveVideoDuration(project, 1_000)).toBe(4_000)
  })

  it('leaves untimed words unfilled even when the containing line has timing', () => {
    const project = videoProject()
    project.offsetMs = 0
    project.durationMs = 23_000
    const untimedWords = ['Line', 'timed', 'only'].map((text) => createLyricWord(text))
    project.tracks[0].lines = [
      createLyricLine('Line timed only', {
        startMs: 0,
        endMs: 2_000,
        words: untimedWords,
      }),
      createLyricLine('After the break', {
        startMs: 20_000,
        endMs: 22_000,
        words: untimedWords.map((word) => createLyricWord(word.text)),
      }),
    ]

    expect(videoExport.frameStateAt(project, 1_000).lines[0].words).toEqual([
      { text: 'Line', progress: 0 },
      { text: 'timed', progress: 0 },
      { text: 'only', progress: 0 },
    ])
  })

  it('streams JPEG frames at the selected output rate without a duplicate-frame filter', () => {
    const args = videoExport.buildFfmpegArguments(
      '/music/source.wav',
      '/exports/video.mp4',
      5_000,
      { resolution: '1440p', fps: 60 },
    )

    expect(args).toEqual(expect.arrayContaining([
      '-f', 'image2pipe',
      '-framerate', '60',
      '-vcodec', 'mjpeg',
      '-i', 'pipe:0',
      '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
      '-af', 'apad',
      '-t', '5.000',
    ]))
    expect(args.filter((argument) => argument.includes('in_range=full'))).toEqual([
      'scale=in_range=full:out_range=tv,format=yuv420p',
    ])
    expect(args.some((argument) => /(?:^|,)fps=/u.test(argument))).toBe(false)
    expect(args).not.toContain('concat')
    expect(args).not.toContain('-shortest')
    expect(args.at(-1)).toBe('/exports/video.mp4')
  })
})
