import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  nativeSyncTraceProject,
  NATIVE_SYNC_TRACE_DURATION_MS,
  NATIVE_SYNC_TRACE_FIXTURES,
  NATIVE_SYNC_TRACE_WORDS,
  type NativeSyncTraceFixture,
} from '../src/lib/native-sync-trace-fixture'
import { parseProject, serializeProject, type KaraokeProject } from '../src/lib/model'
import {
  MAX_PROJECT_LINES,
  MAX_PROJECT_TRACKS,
  MAX_PROJECT_WORDS,
  validateProject,
} from '../src/lib/project-validation'

const require = createRequire(import.meta.url)
const mainFixture = require('./support/native-sync-trace-fixture.cjs') as {
  DURATION_MS: number
  FIXTURES: Set<string>
  TRACKS: number
  WORDS: number
  WORDS_PER_TRACK: number
  createNativeSyncTraceFixture(name: string): KaraokeProject
  serializeNativeSyncTraceFixture(name: string): string
}
const mainSchema = require('../electron/project-schema.cjs') as {
  parseProjectJson(json: string): KaraokeProject
}
const currentProjectJson = readFileSync(
  new URL('./fixtures/current-project-v0.json', import.meta.url),
  'utf8',
)

type JsonObject = Record<string, unknown>

function countWords(project: KaraokeProject) {
  let total = 0
  for (const track of project.tracks) {
    for (const line of track.lines) total += line.words.length
  }
  return total
}

function countLines(project: KaraokeProject) {
  let total = 0
  for (const track of project.tracks) total += track.lines.length
  return total
}

function assertSequentialTiming(project: KaraokeProject) {
  let priorEndMs = 0
  let wordCount = 0
  for (const track of project.tracks) {
    for (const line of track.lines) {
      expect(line.words.length).toBeGreaterThan(0)
      expect(line.text).toBe(line.words.map((word) => word.text).join(' '))
      expect(line.startMs).toBe(line.words[0]!.startMs)
      expect(line.endMs).toBe(line.words.at(-1)!.endMs)
      for (const word of line.words) {
        expect(word.startMs).toBe(priorEndMs)
        expect(word.endMs).toBe(priorEndMs + 1)
        priorEndMs = word.endMs!
        wordCount += 1
      }
    }
  }
  expect(wordCount).toBe(NATIVE_SYNC_TRACE_WORDS)
  expect(priorEndMs).toBe(NATIVE_SYNC_TRACE_DURATION_MS)
}

function currentProject() {
  return JSON.parse(currentProjectJson) as JsonObject
}

function expectRejectedByBothCodecs(project: JsonObject, limit: number) {
  const json = JSON.stringify(project)
  const message = `Projects are limited to ${limit}`
  expect(() => parseProject(json)).toThrow(message)
  expect(() => mainSchema.parseProjectJson(json)).toThrow(message)
}

describe('native sync trace fixture codecs', () => {
  it.each(NATIVE_SYNC_TRACE_FIXTURES)(
    'generates %s identically through the renderer and main codecs',
    (fixture: NativeSyncTraceFixture) => {
      const rendererProject = nativeSyncTraceProject(fixture)
      const mainSerialized = mainFixture.serializeNativeSyncTraceFixture(fixture)
      const mainProject = mainSchema.parseProjectJson(mainSerialized)
      const rendererSerialized = serializeProject(rendererProject)

      expect(NATIVE_SYNC_TRACE_WORDS).toBe(MAX_PROJECT_WORDS)
      expect(NATIVE_SYNC_TRACE_DURATION_MS).toBe(MAX_PROJECT_WORDS)
      expect(mainFixture.WORDS).toBe(MAX_PROJECT_WORDS)
      expect(mainFixture.DURATION_MS).toBe(MAX_PROJECT_WORDS)
      expect(mainFixture.TRACKS).toBe(MAX_PROJECT_TRACKS)
      expect(mainFixture.WORDS_PER_TRACK * mainFixture.TRACKS).toBe(MAX_PROJECT_WORDS)
      expect(mainFixture.FIXTURES.has(fixture)).toBe(true)
      expect(mainFixture.createNativeSyncTraceFixture(fixture)).toStrictEqual(mainProject)

      expect(rendererProject).toStrictEqual(mainProject)
      expect(serializeProject(mainProject)).toBe(rendererSerialized)
      expect(parseProject(mainSerialized)).toStrictEqual(rendererProject)
      expect(mainSchema.parseProjectJson(rendererSerialized)).toStrictEqual(mainProject)
      expect(serializeProject(parseProject(rendererSerialized))).toBe(rendererSerialized)

      for (const project of [rendererProject, mainProject]) {
        expect(project.tracks).toHaveLength(MAX_PROJECT_TRACKS)
        expect(countWords(project)).toBe(MAX_PROJECT_WORDS)
        expect(project.durationMs).toBe(NATIVE_SYNC_TRACE_DURATION_MS)
        expect(project.offsetMs).toBe(0)
        expect(validateProject(project)).toEqual([])
        assertSequentialTiming(project)
      }

      if (fixture === 'eight-tracks') {
        expect(countLines(rendererProject)).toBe(MAX_PROJECT_TRACKS)
        expect(rendererProject.tracks.every((track) => track.lines.length === 1)).toBe(true)
        expect(
          rendererProject.tracks.every(
            (track) => track.lines[0]?.words.length === MAX_PROJECT_WORDS / MAX_PROJECT_TRACKS,
          ),
        ).toBe(true)
      } else {
        expect(countLines(rendererProject)).toBe(1)
        expect(rendererProject.tracks[0]?.lines[0]?.words).toHaveLength(MAX_PROJECT_WORDS)
        expect(rendererProject.tracks.slice(1).every((track) => track.lines.length === 0)).toBe(
          true,
        )
      }
    },
  )

  it('accepts the exact line cap through both codecs', () => {
    const exactLines = currentProject()
    const lineTrack = (exactLines.tracks as JsonObject[])[0]!
    lineTrack.lines = Array.from({ length: MAX_PROJECT_LINES }, (_, index) => ({
      endMs: null,
      id: `exact-line-${index}`,
      startMs: null,
      text: '',
      words: [],
    }))
    const json = JSON.stringify(exactLines)

    expect(() => parseProject(json)).not.toThrow()
    expect(() => mainSchema.parseProjectJson(json)).not.toThrow()
  })

  it('rejects unknown fixture names in both codecs', () => {
    expect(() => nativeSyncTraceProject('unknown' as never)).toThrow(
      'NATIVE_SYNC_TRACE_FIXTURE_INVALID',
    )
    expect(() => mainFixture.createNativeSyncTraceFixture('unknown')).toThrow(
      'NATIVE_SYNC_TRACE_FIXTURE_INVALID',
    )
  })

  it('rejects cap-plus-one words, lines, and tracks in both codecs', () => {
    {
      const tooManyWords = currentProject()
      const wordLine = ((tooManyWords.tracks as JsonObject[])[0]!.lines as JsonObject[])[0]!
      const word = (wordLine.words as JsonObject[])[0]!
      wordLine.words = Array.from({ length: MAX_PROJECT_WORDS + 1 }, (_, index) => ({
        ...word,
        id: `over-word-${index}`,
      }))
      expectRejectedByBothCodecs(tooManyWords, MAX_PROJECT_WORDS)
    }

    {
      const tooManyLines = currentProject()
      const lineTrack = (tooManyLines.tracks as JsonObject[])[0]!
      lineTrack.lines = Array.from({ length: MAX_PROJECT_LINES + 1 }, (_, index) => ({
        endMs: null,
        id: `over-line-${index}`,
        startMs: null,
        text: '',
        words: [],
      }))
      expectRejectedByBothCodecs(tooManyLines, MAX_PROJECT_LINES)
    }

    {
      const tooManyTracks = currentProject()
      const track = (tooManyTracks.tracks as JsonObject[])[0]!
      tooManyTracks.tracks = Array.from({ length: MAX_PROJECT_TRACKS + 1 }, (_, index) => ({
        ...track,
        id: `over-track-${index}`,
        lines: [],
      }))
      expectRejectedByBothCodecs(tooManyTracks, MAX_PROJECT_TRACKS)
    }
  })
})
