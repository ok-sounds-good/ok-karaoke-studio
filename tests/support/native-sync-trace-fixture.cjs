'use strict'

const { parseProjectJson } = require('../../electron/project-schema.cjs')

const WORDS = 5_000
const DURATION_MS = WORDS
const TRACKS = 8
const WORDS_PER_TRACK = WORDS / TRACKS
const FIXTURES = new Set(['eight-tracks', 'one-active-line'])

function typeface(kind, family) {
  return {
    kind,
    family,
    faces: [
      ['Regular', 400, 'normal'],
      ['Italic', 400, 'italic'],
      ['Semi Bold', 600, 'normal'],
      ['Bold', 700, 'normal'],
      ['Extra Bold', 800, 'normal'],
    ].map(([style, weight, slant]) => ({
      fullName: `${family} ${style}`,
      postscriptName: null,
      slant,
      style,
      weight,
    })),
  }
}

const ui = typeface('system-ui', 'System UI')
const mono = typeface('system-monospace', 'System Monospace')
const face = (family, style) =>
  structuredClone(
    (family === 'mono' ? mono : ui).faces.find((candidate) => candidate.style === style),
  )
const text = (family, style, sizePx, color, visible, position) => ({
  typeface: structuredClone(family === 'mono' ? mono : ui),
  fontStyle: face(family, style),
  sizePx,
  color,
  ...(visible === undefined ? {} : { visible }),
  ...(position ? { position } : {}),
})
const vocalStyle = () => ({
  alignment: 'center',
  position: { x: 960, y: 850 },
  previewMs: 3_000,
  sungColor: '#FF8A2B',
  syncAid: { enabled: false, maxLeadMs: 3_000, minLeadMs: 2_000 },
  unsungColor: '#72687D',
})
const baseProject = {
  schemaVersion: 0,
  id: 'native-sync-trace-base',
  title: 'Native sync trace tone',
  artist: 'Okay Karaoke Studio',
  audioPath: null,
  durationMs: DURATION_MS,
  offsetMs: 0,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
  lyricDisplay: { lineCount: 2, advanceMode: 'scroll' },
  opening: { leadInMs: 0, titleTiming: { mode: 'until-lyrics' } },
  stageStyle: {
    background: {
      mode: 'gradient',
      solidColor: '#21182D',
      gradientStartColor: '#322242',
      gradientEndColor: '#1E1629',
      imagePath: null,
    },
    lyrics: { typeface: structuredClone(ui), fontStyle: face('ui', 'Extra Bold'), sizePx: 82 },
    titleCard: {
      eyebrow: text('ui', 'Extra Bold', 25, '#FFAD69', true, { x: 960, y: 447 }),
      title: text('ui', 'Extra Bold', 104, '#FBF9FD', true, { x: 960, y: 550 }),
      artist: text('ui', 'Semi Bold', 42, '#B4ACBD', true, { x: 960, y: 650 }),
    },
    stageFrame: {
      enabled: true,
      lineColor: '#473C54',
      lineWidthPx: 2,
      brand: text('mono', 'Bold', 25, '#C1BBC7', true),
      clock: text('mono', 'Semi Bold', 27, '#BBB7C0', true),
      footer: text('ui', 'Bold', 24, '#B2AEB8', true),
    },
  },
}

function words(count, prefix, startOrdinal = 0) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = startOrdinal + index
    return {
      endMs: ordinal + 1,
      id: `${prefix}-word-${index}`,
      startMs: ordinal,
      text: `w${ordinal}`,
    }
  })
}

function track(index, count, startOrdinal) {
  const id = `trace-track-${index}`
  const lineWords = count === 0 ? [] : words(count, id, startOrdinal)
  return {
    id,
    lines:
      lineWords.length === 0
        ? []
        : [
            {
              endMs: lineWords.at(-1).endMs,
              id: `${id}-line-0`,
              startMs: lineWords[0].startMs,
              text: lineWords.map((word) => word.text).join(' '),
              words: lineWords,
            },
          ],
    muted: false,
    name: `Trace Voice ${index + 1}`,
    solo: false,
    vocalStyle: vocalStyle(),
  }
}

function serializeNativeSyncTraceFixture(name) {
  if (!FIXTURES.has(name)) throw new Error('NATIVE_SYNC_TRACE_FIXTURE_INVALID')
  const tracks = Array.from({ length: TRACKS }, (_, index) =>
    track(
      index,
      name === 'eight-tracks' ? WORDS_PER_TRACK : index === 0 ? WORDS : 0,
      name === 'eight-tracks' ? index * WORDS_PER_TRACK : 0,
    ),
  )
  return JSON.stringify({
    ...structuredClone(baseProject),
    id: `native-sync-trace-${name}`,
    tracks,
  })
}

function createNativeSyncTraceFixture(name) {
  return parseProjectJson(serializeNativeSyncTraceFixture(name))
}

module.exports = {
  DURATION_MS,
  FIXTURES,
  TRACKS,
  WORDS,
  WORDS_PER_TRACK,
  createNativeSyncTraceFixture,
  serializeNativeSyncTraceFixture,
}
