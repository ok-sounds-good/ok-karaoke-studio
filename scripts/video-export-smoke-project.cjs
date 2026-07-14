'use strict'

const SYSTEM_UI = Object.freeze({
  kind: 'system-ui',
  family: 'System UI',
  faces: Object.freeze([
    Object.freeze({
      fullName: 'System UI Regular',
      style: 'Regular',
      postscriptName: null,
      weight: 400,
      slant: 'normal',
    }),
    Object.freeze({
      fullName: 'System UI Bold',
      style: 'Bold',
      postscriptName: null,
      weight: 700,
      slant: 'normal',
    }),
  ]),
})

function face(style) {
  return { ...SYSTEM_UI.faces.find((candidate) => candidate.style === style) }
}

function typeface() {
  return { ...SYSTEM_UI, faces: SYSTEM_UI.faces.map((candidate) => ({ ...candidate })) }
}

function textStyle(sizePx, color, style = 'Regular') {
  return {
    typeface: typeface(),
    fontStyle: face(style),
    sizePx,
    color,
    visible: true,
  }
}

function createVideoExportSmokeProject(audioPath) {
  return {
    schemaVersion: 4,
    id: 'video-export-smoke',
    title: 'Video export smoke test',
    artist: 'Okay Karaoke Studio',
    audioPath,
    durationMs: 2_000,
    offsetMs: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lyricDisplay: { lineCount: 3, advanceMode: 'clear' },
    stageStyle: {
      background: {
        mode: 'solid',
        solidColor: '#102030',
        gradientStartColor: '#203040',
        gradientEndColor: '#304050',
        imagePath: null,
      },
      lyrics: {
        typeface: typeface(),
        fontStyle: face('Bold'),
        sizePx: 72,
        unsungColor: '#F8F6FB',
        sungColor: '#D6F94B',
      },
      titleCard: {
        eyebrow: textStyle(24, '#E0E0E0', 'Bold'),
        title: textStyle(96, '#FFFFFF', 'Bold'),
        artist: textStyle(40, '#D0D0D0'),
      },
      stageFrame: {
        enabled: false,
        lineColor: '#405060',
        lineWidthPx: 2,
        brand: textStyle(24, '#A0A0A0', 'Bold'),
        clock: textStyle(24, '#B0B0B0'),
        footer: textStyle(24, '#C0C0C0'),
      },
    },
    tracks: [{
      id: 'smoke-lead',
      name: 'Lead Vocal',
      vocalStyle: {
        typeface: null,
        fontStyle: null,
        sizePx: null,
        unsungColor: null,
        sungColor: null,
        alignment: 'center',
        previewMs: 0,
        syncAid: { enabled: false, minLeadMs: 0, maxLeadMs: 0 },
      },
      muted: false,
      solo: false,
      lines: [{
        id: 'smoke-line',
        text: 'Smoke test',
        startMs: 500,
        endMs: 1_500,
        words: [
          { id: 'smoke-word', text: 'Smoke', startMs: 500, endMs: 700 },
          { id: 'test-word', text: 'test', startMs: 700, endMs: 900 },
        ],
      }],
    }],
  }
}

module.exports = { createVideoExportSmokeProject }
