import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseProject } from '../src/lib/karaoke'

const require = createRequire(import.meta.url)
const { createVideoExportSmokeProject } = require('../scripts/video-export-smoke-project.cjs') as {
  createVideoExportSmokeProject(audioPath: string): Record<string, unknown>
}
const { parseCurrentProject } = require('../electron/project-schema.cjs') as {
  parseCurrentProject(json: string): Record<string, unknown>
}
const { parseProjectForVideo } = require('../electron/video-export.cjs') as {
  parseProjectForVideo(json: string): Record<string, unknown>
}

describe('representative video smoke fixture', () => {
  it('is accepted by the renderer, main process, and video export decoders', () => {
    const fixture = createVideoExportSmokeProject('/synthetic/silence.wav')
    const json = JSON.stringify(fixture)

    const renderer = parseProject(json)
    const main = parseCurrentProject(json)
    const video = parseProjectForVideo(json)

    expect(renderer.schemaVersion).toBe(4)
    expect(main.stageStyle).toEqual(renderer.stageStyle)
    expect(video.stageStyle).toEqual(renderer.stageStyle)
    expect(video.tracks).toHaveLength(1)
  })

  it('uses current typeface and fontStyle fields rather than stale font objects', () => {
    const fixture = createVideoExportSmokeProject('/synthetic/silence.wav') as any

    expect(fixture.stageStyle.lyrics.typeface.kind).toBe('system-ui')
    expect(fixture.stageStyle.lyrics.fontStyle.weight).toBe(700)
    expect(fixture.stageStyle.lyrics).not.toHaveProperty('font')
    expect(fixture.tracks[0].vocalStyle).not.toHaveProperty('font')
  })
})
