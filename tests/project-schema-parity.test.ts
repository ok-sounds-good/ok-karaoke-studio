import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  parseProject,
  serializeProject,
  type KaraokeProject,
} from '../src/lib/karaoke'

const require = createRequire(import.meta.url)
const { parseCurrentProject } = require('../electron/project-schema.cjs') as {
  parseCurrentProject(json: string): unknown
}
const { parseProjectForVideo } = require('../electron/video-export.cjs') as {
  parseProjectForVideo(json: string): unknown
}
const { createLinkedAssetRegistry } = require('../electron/linked-assets.cjs') as {
  createLinkedAssetRegistry(extensions: Set<string>): {
    authorizeProject(ownerId: number, projectPath: string, contents: string): boolean
    consumeAuthorization(
      ownerId: number,
      projectPath: string,
      kind: 'audio' | 'background',
    ): string | null
  }
}

type JsonRecord = Record<string, any>

function currentProject(): JsonRecord {
  const word = createLyricWord('Hello', {
    id: 'word-1',
    startMs: 1_000,
    endMs: 2_000,
  })
  const line = createLyricLine('Hello', {
    id: 'line-1',
    startMs: 1_000,
    endMs: 2_000,
    words: [word],
  })
  const project = createProject({
    id: 'project-1',
    title: 'Strict project',
    artist: 'Schema Singer',
    audioPath: '../audio/song.mp3',
    durationMs: 5_000,
    offsetMs: 0,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    tracks: [createVocalTrack({ id: 'track-1', lines: [line] })],
  })
  project.stageStyle.background.mode = 'image'
  project.stageStyle.background.imagePath = '/images/stage.png'
  return JSON.parse(serializeProject(project)) as JsonRecord
}

interface ParityCase {
  name: string
  accepted: boolean
  mutate?: (project: JsonRecord) => void
  authorize?: boolean
}

const cases: ParityCase[] = [
  { name: 'complete current schema', accepted: true },
  { name: 'root extra', accepted: false, mutate: (p) => { p.future = true } },
  { name: 'root missing', accepted: false, mutate: (p) => { delete p.artist } },
  { name: 'root wrong type', accepted: false, mutate: (p) => { p.title = 42 } },
  { name: 'wrong schema', accepted: false, mutate: (p) => { p.schemaVersion = 3 } },
  { name: 'lyric display extra', accepted: false, mutate: (p) => { p.lyricDisplay.future = true } },
  { name: 'lyric display wrong type', accepted: false, mutate: (p) => { p.lyricDisplay.lineCount = '3' } },
  { name: 'lyric display bounds', accepted: false, mutate: (p) => { p.lyricDisplay.lineCount = 6 } },
  { name: 'stage extra', accepted: false, mutate: (p) => { p.stageStyle.future = true } },
  { name: 'background extra', accepted: false, mutate: (p) => { p.stageStyle.background.future = true } },
  { name: 'background wrong type', accepted: false, mutate: (p) => { p.stageStyle.background.mode = 1 } },
  { name: 'relative linked image', accepted: false, mutate: (p) => { p.stageStyle.background.imagePath = 'stage.png' } },
  { name: 'image mode without path', accepted: false, mutate: (p) => { p.stageStyle.background.imagePath = null } },
  { name: 'lyrics role wrong type', accepted: false, mutate: (p) => { p.stageStyle.lyrics.sungColor = 7 } },
  { name: 'text role extra', accepted: false, mutate: (p) => { p.stageStyle.titleCard.title.future = true } },
  { name: 'text role visible wrong type', accepted: false, mutate: (p) => { p.stageStyle.titleCard.title.visible = 'yes' } },
  { name: 'frame enabled wrong type', accepted: false, mutate: (p) => { p.stageStyle.stageFrame.enabled = 1 } },
  { name: 'frame width bounds', accepted: false, mutate: (p) => { p.stageStyle.stageFrame.lineWidthPx = 33 } },
  { name: 'font face extra', accepted: false, mutate: (p) => { p.stageStyle.lyrics.fontStyle.future = true } },
  { name: 'vocal style extra', accepted: false, mutate: (p) => { p.tracks[0].vocalStyle.future = true } },
  { name: 'vocal style size bounds', accepted: false, mutate: (p) => { p.tracks[0].vocalStyle.sizePx = 7 } },
  { name: 'sync aid enabled wrong type', accepted: false, mutate: (p) => { p.tracks[0].vocalStyle.syncAid.enabled = 1 } },
  { name: 'sync aid timing bounds', accepted: false, mutate: (p) => { p.tracks[0].vocalStyle.syncAid.maxLeadMs = 60_001 } },
  { name: 'track extra', accepted: false, mutate: (p) => { p.tracks[0].future = true } },
  { name: 'track boolean wrong type', accepted: false, mutate: (p) => { p.tracks[0].muted = 'false' } },
  { name: 'track lines wrong type', accepted: false, mutate: (p) => { p.tracks[0].lines = {} } },
  { name: 'line extra', accepted: false, mutate: (p) => { p.tracks[0].lines[0].future = true } },
  { name: 'line wrong type', accepted: false, mutate: (p) => { p.tracks[0].lines[0].text = 1 } },
  { name: 'line words wrong type', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words = {} } },
  { name: 'word extra', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].future = true } },
  { name: 'word wrong type', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].text = 1 } },
  { name: 'incomplete timing pair', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].endMs = null } },
  { name: 'fractional timing', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].startMs = 1_000.5 } },
  { name: 'negative timing', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].startMs = -1 } },
  { name: 'reversed timing', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].endMs = 999 } },
  { name: 'word outside line', accepted: false, mutate: (p) => { p.tracks[0].lines[0].words[0].endMs = 2_001 } },
  { name: 'duplicate id', accepted: false, mutate: (p) => { p.tracks[0].id = p.id } },
  { name: 'duration bounds', accepted: false, mutate: (p) => { p.durationMs = 14_400_001 } },
  { name: 'offset bounds', accepted: false, mutate: (p) => { p.offsetMs = -14_400_001 } },
  {
    name: 'track cardinality',
    accepted: false,
    mutate: (p) => {
      p.tracks = Array.from({ length: 9 }, (_, index) => ({
        ...p.tracks[0],
        id: `track-${index}`,
        lines: [],
      }))
    },
  },
  {
    name: 'line cardinality',
    accepted: false,
    authorize: false,
    mutate: (p) => {
      const line = { ...p.tracks[0].lines[0], words: [] }
      p.tracks[0].lines = Array.from({ length: 20_001 }, () => line)
    },
  },
  {
    name: 'word cardinality',
    accepted: false,
    authorize: false,
    mutate: (p) => {
      const word = p.tracks[0].lines[0].words[0]
      p.tracks[0].lines[0].words = Array.from({ length: 150_001 }, () => word)
    },
  },
]

function acceptedBy(decoder: (json: string) => unknown, json: string): boolean {
  try {
    decoder(json)
    return true
  } catch {
    return false
  }
}

describe('current project schema parity', () => {
  it('strictly decodes in-memory projects before serialization', () => {
    const rootExtra = createProject() as KaraokeProject & { future?: boolean }
    rootExtra.future = true
    expect(() => serializeProject(rootExtra)).toThrow('project.future is not supported')

    const nestedExtra = createProject()
    ;(nestedExtra.tracks[0].vocalStyle as typeof nestedExtra.tracks[0]['vocalStyle'] & {
      future?: boolean
    }).future = true
    expect(() => serializeProject(nestedExtra)).toThrow(
      'project.tracks[0].vocalStyle.future is not supported',
    )
  })

  it.each(cases)('$name has the same TypeScript and main-process acceptance', (testCase) => {
    const project = currentProject()
    testCase.mutate?.(project)
    const json = JSON.stringify(project)

    expect(acceptedBy(parseProject, json)).toBe(testCase.accepted)
    expect(acceptedBy(parseCurrentProject, json)).toBe(testCase.accepted)
    expect(acceptedBy(parseProjectForVideo, json)).toBe(testCase.accepted)
  })

  it.each(cases.filter((testCase) => !testCase.accepted && testCase.authorize !== false))(
    '$name grants no restore authorization after rejection',
    (testCase) => {
      const registry = createLinkedAssetRegistry(new Set(['.mp3']))
      const project = currentProject()
      testCase.mutate?.(project)
      const projectPath = '/projects/rejected.oks'

      expect(registry.authorizeProject(22, projectPath, JSON.stringify(project))).toBe(false)
      expect(registry.consumeAuthorization(22, projectPath, 'audio')).toBeNull()
      expect(registry.consumeAuthorization(22, projectPath, 'background')).toBeNull()
    },
  )
})
