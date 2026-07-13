import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const videoExport = require('../electron/video-export.cjs') as {
  buildFfmpegArguments(audioPath: string, outputPath: string, durationMs: number): string[]
  buildFrameTimeline(project: unknown, durationMs?: number): { durationMs: number; times: number[] }
  effectiveVideoDuration(project: unknown, durationMs?: number): number
  frameStateAt(project: unknown, playbackMs: number): {
    showTitle: boolean
    instrumental: boolean
    lines: Array<{ track: string; text: string; progress: number }>
    nextInMs: number | null
  }
  parseProjectForVideo(json: string): unknown
  renderDocument(): string
}

function videoProject() {
  return {
    title: 'Video Test',
    artist: 'Okay Singer',
    audioPath: '/music/test.mp3',
    durationMs: 5_000,
    offsetMs: 1_000,
    lyricDisplay: { lineCount: 3, advanceMode: 'clear' },
    tracks: [
      {
        name: 'Lead',
        color: '#d7fa4a',
        muted: false,
        solo: false,
        lines: [
          {
            text: 'Hello world',
            startMs: 1_000,
            endMs: 3_000,
            words: [
              { text: 'Hello', startMs: 1_000, endMs: 2_000 },
              { text: 'world', startMs: 2_000, endMs: 3_000 },
            ],
          },
        ],
      },
    ],
  }
}

function timedVideoLine(text: string, startMs: number, endMs: number) {
  return {
    text,
    startMs,
    endMs,
    words: [{ text, startMs, endMs }],
  }
}

function blankVideoLine() {
  return {
    text: '',
    startMs: null,
    endMs: null,
    words: [],
  }
}

describe('karaoke video frame planning', () => {
  it('builds progressive word frames on the offset-adjusted playback clock', () => {
    const timeline = videoExport.buildFrameTimeline(videoProject(), 6_000)

    expect(timeline.durationMs).toBe(6_000)
    expect(timeline.times).toHaveLength(60)
    expect(timeline.times[0]).toBe(0)
    expect(timeline.times.at(-1)).toBe(5_900)
    expect(timeline.times.every((time, index) => index === 0 || time - timeline.times[index - 1] === 100)).toBe(true)
  })

  it('renders title, active lyric progress, and instrumental states', () => {
    expect(videoExport.frameStateAt(videoProject(), 0).showTitle).toBe(true)

    const active = videoExport.frameStateAt(videoProject(), 2_500)
    expect(active.showTitle).toBe(false)
    expect(active.lines[0].text).toBe('Hello world')
    expect(active.lines[0].progress).toBeGreaterThan(0.2)
    expect(active.lines[0].progress).toBeLessThan(0.3)

    const finished = videoExport.frameStateAt(videoProject(), 4_600)
    expect(finished.instrumental).toBe(true)
    expect(finished.lines).toEqual([])
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
    expect(videoExport.frameStateAt(project, 3_000).lines.map((line) => line.text)).toEqual([
      'D',
      'E',
      'F',
      'G',
      'H',
    ])
    expect(videoExport.frameStateAt(project, 10_000).lines).toEqual([])
    expect(videoExport.frameStateAt(project, 3_000)).not.toHaveProperty('nextLine')
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
    }, 1_000).lines.map((line) => line.text)).toEqual(['Two', 'Three', 'Four'])
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
          name: 'Harmony',
          color: '#58d6de',
          lines: lines.map((line) => ({
            ...line,
            text: line.text.replace('Lead', 'Harmony'),
            words: line.words.map((word) => ({
              ...word,
              text: word.text.replace('Lead', 'Harmony'),
            })),
          })),
        },
      ],
    }

    const state = videoExport.frameStateAt(project, 0)
    expect(state.lines).toHaveLength(3)
    expect(new Set(state.lines.map((line) => line.track))).toEqual(new Set(['Lead', 'Harmony']))
  })

  it('rejects malformed and unbounded project payloads', () => {
    expect(() => videoExport.parseProjectForVideo('{oops')).toThrow('project JSON is invalid')
    expect(() => videoExport.parseProjectForVideo(JSON.stringify({ tracks: [] }))).toThrow(
      'between 1 and 2 vocal tracks',
    )

    const invalidTiming = videoProject()
    invalidTiming.tracks[0].lines[0].words[0].startMs = -1
    expect(() => videoExport.parseProjectForVideo(JSON.stringify(invalidTiming))).toThrow(
      'must be between zero and thirty minutes',
    )

    const incompleteTiming = videoProject()
    incompleteTiming.tracks[0].lines[0].words[0].endMs = null as unknown as number
    expect(() => videoExport.parseProjectForVideo(JSON.stringify(incompleteTiming))).toThrow(
      'must have both a start and end time',
    )

    expect(() => videoExport.parseProjectForVideo(JSON.stringify({
      ...videoProject(),
      lyricDisplay: { lineCount: 6, advanceMode: 'clear' },
    }))).toThrow('lineCount must be between 1 and 5')
  })

  it('does not render a mini upcoming-line element', () => {
    const document = videoExport.renderDocument()
    expect(document).not.toContain('state.nextLine')
    expect(document).not.toContain('Next ·')
  })

  it('uses only visible tracks when extending duration', () => {
    const project = videoProject()
    project.durationMs = 1_000
    project.tracks.push({
      name: 'Muted guide',
      color: '#ffffff',
      muted: true,
      solo: false,
      lines: [{
        text: 'Hidden',
        startMs: 20_000,
        endMs: 25_000,
        words: [{ text: 'Hidden', startMs: 20_000, endMs: 25_000 }],
      }],
    })

    expect(videoExport.effectiveVideoDuration(project, 1_000)).toBe(4_000)
  })

  it('renders smooth line-timed progress and upcoming-line countdowns', () => {
    const project = videoProject()
    project.offsetMs = 0
    project.durationMs = 23_000
    const untimedWords = [
      { text: 'Line', startMs: null as unknown as number, endMs: null as unknown as number },
      { text: 'timed', startMs: null as unknown as number, endMs: null as unknown as number },
      { text: 'only', startMs: null as unknown as number, endMs: null as unknown as number },
    ]
    project.tracks[0].lines = [
      { text: 'Line timed only', startMs: 0, endMs: 2_000, words: untimedWords },
      { text: 'After the break', startMs: 20_000, endMs: 22_000, words: untimedWords },
    ]

    expect(videoExport.frameStateAt(project, 12_000).nextInMs).toBe(8_000)
    expect(videoExport.frameStateAt(project, 1_000).lines[0].progress).toBeCloseTo(0.5)
  })

  it('streams PNG frames and pads audio to the explicit timeline duration', () => {
    const args = videoExport.buildFfmpegArguments('/music/source.wav', '/exports/video.mp4', 5_000)

    expect(args).toEqual(expect.arrayContaining([
      '-f', 'image2pipe',
      '-framerate', '10',
      '-i', 'pipe:0',
      '-af', 'apad',
      '-t', '5.000',
      '-vf', 'fps=30,format=yuv420p',
    ]))
    expect(args).not.toContain('concat')
    expect(args).not.toContain('-shortest')
    expect(args.at(-1)).toBe('/exports/video.mp4')
  })
})
