import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'

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

function projectJson(mode: 'solid' | 'gradient' | 'image', imagePath = '/images/stage.png') {
  const project = createProject({ audioPath: '/audio/song.mp3' })
  project.stageStyle.background.mode = mode
  project.stageStyle.background.imagePath = mode === 'image' ? imagePath : null
  return serializeProject(project)
}

function request(project: string) {
  return {
    projectJson: project,
    audioPath: '/audio/song.mp3',
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
    registry.register('/audio/song.mp3', ownerId, 'audio')
    const parsed = JSON.parse(projectJson('solid'))
    parsed.unknownRootField = true

    expect(() => authorizer(registry)(ownerId, request(JSON.stringify(parsed)))).toThrow(
      'unknownRootField is not supported',
    )
  })

  it.each([
    { name: 'no image capability', tokenOwner: null, tokenPath: null },
    { name: 'mismatched image capability', tokenOwner: 42, tokenPath: '/images/other.png' },
    { name: 'another owner image capability', tokenOwner: 999, tokenPath: '/images/stage.png' },
  ])('rejects image mode with $name', ({ tokenOwner, tokenPath }) => {
    const ownerId = 42
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register('/audio/song.mp3', ownerId, 'audio')
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
    registry.register('/audio/song.mp3', ownerId, 'audio')
    registry.register('/images/stage.png', ownerId, 'background')

    expect(authorizer(registry)(ownerId, request(projectJson('image')))).toMatchObject({
      audioPath: '/audio/song.mp3',
      resolution: '720p',
      fps: 30,
    })
  })

  it.each(['solid', 'gradient'] as const)('allows %s without a background capability', (mode) => {
    const ownerId = 44
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register('/audio/song.mp3', ownerId, 'audio')

    expect(authorizer(registry)(ownerId, request(projectJson(mode)))).toMatchObject({
      audioPath: '/audio/song.mp3',
    })
  })

  it('rejects an active audio capability that the serialized project does not select', () => {
    const ownerId = 45
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register('/audio/song.mp3', ownerId, 'audio')
    const project = createProject({ audioPath: null })

    expect(() => authorizer(registry)(ownerId, request(serializeProject(project)))).toThrow(
      'project does not select the active linked audio capability',
    )
  })

  it('rejects a stale project audio path even when another active capability is requested', () => {
    const ownerId = 46
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register('/audio/new.mp3', ownerId, 'audio')
    const project = createProject({ audioPath: '/audio/old.mp3' })
    const value = {
      ...request(serializeProject(project)),
      audioPath: '/audio/new.mp3',
    }

    expect(() => authorizer(registry)(ownerId, value)).toThrow(
      'project audio selection does not match',
    )
  })

  it('resolves a relative project audio path only against its trusted open source', () => {
    const ownerId = 47
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    registry.register('/projects/audio/song.mp3', ownerId, 'audio')
    const project = createProject({ audioPath: '../audio/song.mp3' })
    const value = {
      ...request(serializeProject(project)),
      audioPath: '/projects/audio/song.mp3',
    }

    expect(authorizer(registry, '/projects/song/project.oks')(ownerId, value)).toMatchObject({
      audioPath: '/projects/audio/song.mp3',
    })
    expect(() => authorizer(registry)(ownerId, value)).toThrow(
      'project audio selection does not match',
    )
  })
})
