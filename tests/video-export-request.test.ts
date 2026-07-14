import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'
import { nativeFixturePath } from './support/native-path'

const require = createRequire(import.meta.url)
const { createLinkedAssetRegistry } = require('../electron/linked-assets.cjs') as {
  createLinkedAssetRegistry(extensions: Set<string>): any
}
const { createVideoExportRequestAuthorizer } = require('../electron/video-export-request.cjs') as {
  createVideoExportRequestAuthorizer(options: Record<string, unknown>): (
    ownerId: number,
    request: Record<string, unknown>,
  ) => Record<string, unknown>
}

const SONG_AUDIO_PATH = nativeFixturePath('audio', 'song.mp3')
const STAGE_IMAGE_PATH = nativeFixturePath('images', 'stage.png')

function projectJson(
  mode: 'solid' | 'gradient' | 'image',
  imagePath = STAGE_IMAGE_PATH,
) {
  const project = createProject({ audioPath: SONG_AUDIO_PATH })
  project.stageStyle.background.mode = mode
  project.stageStyle.background.imagePath = mode === 'image' ? imagePath : null
  return serializeProject(project)
}

function request(project: string) {
  return {
    projectJson: project,
    audioPath: SONG_AUDIO_PATH,
    durationMs: 5_000,
    resolution: '720p',
    fps: 30,
    suggestedName: 'song.mp4',
  }
}

function authorizer(registry: any, sourcePath: string | null = null) {
  return createVideoExportRequestAuthorizer({
    linkedAssets: registry,
    audioExtensions: new Set(['.mp3']),
    maxDurationMs: 30 * 60 * 1_000,
    maxProjectBytes: 32 * 1024 * 1024,
    normalizeVideoSettings: ({ resolution, fps }: { resolution: string; fps: number }) => ({
      resolution,
      fps,
    }),
    projectSourcePath: () => sourcePath,
  })
}

describe('main-process video export request authorization', () => {
  it('rejects unknown current-schema data before checking capabilities', () => {
    const ownerId = 41
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register(SONG_AUDIO_PATH, ownerId, 'audio')
    const parsed = JSON.parse(projectJson('solid'))
    parsed.unknownRootField = true

    expect(() => authorizer(registry)(ownerId, request(JSON.stringify(parsed)))).toThrow(
      'unknownRootField is not supported',
    )
  })

  it.each([
    { name: 'no image capability', tokenOwner: null, tokenPath: null },
    {
      name: 'mismatched image capability',
      tokenOwner: 42,
      tokenPath: nativeFixturePath('images', 'other.png'),
    },
    { name: 'another owner image capability', tokenOwner: 999, tokenPath: STAGE_IMAGE_PATH },
  ])('rejects image mode with $name', ({ tokenOwner, tokenPath }) => {
    const ownerId = 42
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register(SONG_AUDIO_PATH, ownerId, 'audio')
    if (tokenOwner !== null && tokenPath !== null) {
      registry.register(tokenPath, tokenOwner, 'background')
    }

    expect(() => authorizer(registry)(ownerId, request(projectJson('image')))).toThrow(
      'not an active linked image capability',
    )
  })

  it('allows image mode only when the same owner has the exact active path', () => {
    const ownerId = 43
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register(SONG_AUDIO_PATH, ownerId, 'audio')
    registry.register(STAGE_IMAGE_PATH, ownerId, 'background')

    expect(authorizer(registry)(ownerId, request(projectJson('image')))).toMatchObject({
      audioPath: SONG_AUDIO_PATH,
      resolution: '720p',
      fps: 30,
    })
  })

  it.each(['solid', 'gradient'] as const)('allows %s without a background capability', (mode) => {
    const ownerId = 44
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register(SONG_AUDIO_PATH, ownerId, 'audio')

    expect(authorizer(registry)(ownerId, request(projectJson(mode)))).toMatchObject({
      audioPath: SONG_AUDIO_PATH,
    })
  })

  it('rejects an active audio capability that the serialized project does not select', () => {
    const ownerId = 45
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register(SONG_AUDIO_PATH, ownerId, 'audio')
    const project = createProject({ audioPath: null })

    expect(() => authorizer(registry)(ownerId, request(serializeProject(project)))).toThrow(
      'project does not select the active linked audio capability',
    )
  })

  it('rejects a stale project audio path even when another active capability is requested', () => {
    const ownerId = 46
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const newAudioPath = nativeFixturePath('audio', 'new.mp3')
    registry.register(newAudioPath, ownerId, 'audio')
    const project = createProject({ audioPath: nativeFixturePath('audio', 'old.mp3') })
    const value = {
      ...request(serializeProject(project)),
      audioPath: newAudioPath,
    }

    expect(() => authorizer(registry)(ownerId, value)).toThrow(
      'project audio selection does not match',
    )
  })

  it('resolves a relative project audio path only against its trusted open source', () => {
    const ownerId = 47
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sourcePath = nativeFixturePath('projects', 'song', 'project.oks')
    const audioPath = resolve(dirname(sourcePath), '../audio/song.mp3')
    registry.register(audioPath, ownerId, 'audio')
    const project = createProject({ audioPath: '../audio/song.mp3' })
    const value = {
      ...request(serializeProject(project)),
      audioPath,
    }

    expect(authorizer(registry, sourcePath)(ownerId, value)).toMatchObject({
      audioPath,
    })
    expect(() => authorizer(registry)(ownerId, value)).toThrow(
      'project audio selection does not match',
    )
  })
})
