import { createRequire } from 'node:module'
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'

const require = createRequire(import.meta.url)
const linkedAssets = require('../electron/linked-assets.cjs') as {
  MAX_IMAGE_BYTES: number
  createLinkedAssetRegistry(extensions: Set<string>): {
    activeOwnerPath(ownerId: number, kind: 'audio' | 'background'): string | null
    get(token: string): { filePath: string; ownerId: number; kind: string } | null
    register(filePath: string, ownerId: number, kind: string): string
    retainOwnerToken(ownerId: number, kind: string, token: string): boolean
    authorizeProject(ownerId: number, projectPath: string, contents: string): boolean
    consumeAuthorization(
      ownerId: number,
      projectPath: string,
      kind: 'audio' | 'background',
    ): string | null
    revokeOwner(ownerId: number, kind?: string): void
    releaseOwner(ownerId: number): void
  }
  createLinkedImageValidator(decoder: (image: {
    bytes: Buffer
    mime: string
    path: string
  }) => boolean | Promise<boolean>): {
    validateLinkedImage(path: string): Promise<string>
  }
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('linked media authorization', () => {
  it('keeps audio and image capabilities separate for one renderer owner', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const firstAudio = registry.register('/media/first.mp3', 7, 'audio')
    const image = registry.register('/media/background.png', 7, 'background')
    const secondAudio = registry.register('/media/second.mp3', 7, 'audio')

    expect(registry.get(firstAudio)).toBeNull()
    expect(registry.get(image)?.kind).toBe('background')
    expect(registry.get(secondAudio)?.filePath).toBe('/media/second.mp3')
    expect(registry.activeOwnerPath(7, 'audio')).toBe('/media/second.mp3')
    expect(registry.activeOwnerPath(7, 'background')).toBe('/media/background.png')
    registry.revokeOwner(7, 'background')
    expect(registry.get(image)).toBeNull()
    expect(registry.activeOwnerPath(7, 'background')).toBeNull()
    expect(registry.get(secondAudio)?.kind).toBe('audio')
    registry.releaseOwner(7)
    expect(registry.get(secondAudio)).toBeNull()
  })

  it('keeps dormant background bindings available while activating Cancel or Apply', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const baseline = registry.register('/media/original.png', 12, 'background')
    const replacement = registry.register('/media/replacement.png', 12, 'background')

    expect(registry.get(baseline)?.filePath).toBe('/media/original.png')
    expect(registry.get(replacement)?.filePath).toBe('/media/replacement.png')
    expect(registry.retainOwnerToken(12, 'background', baseline)).toBe(true)
    expect(registry.get(baseline)?.filePath).toBe('/media/original.png')
    expect(registry.get(replacement)?.filePath).toBe('/media/replacement.png')
    expect(registry.activeOwnerPath(12, 'background')).toBe('/media/original.png')

    const applied = registry.register('/media/applied.png', 12, 'background')
    expect(registry.retainOwnerToken(12, 'background', applied)).toBe(true)
    expect(registry.get(baseline)?.filePath).toBe('/media/original.png')
    expect(registry.get(applied)?.filePath).toBe('/media/applied.png')
    expect(registry.activeOwnerPath(12, 'background')).toBe('/media/applied.png')
    registry.revokeOwner(12, 'background')
    expect(registry.get(applied)).toBeNull()
  })

  it('reactivates a reselected baseline without discarding its history binding', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const baseline = registry.register('/media/original.png', 14, 'background')
    const reselected = registry.register('/media/original.png', 14, 'background')

    expect(registry.get(baseline)?.filePath).toBe('/media/original.png')
    expect(registry.get(reselected)?.filePath).toBe('/media/original.png')
    expect(registry.retainOwnerToken(14, 'background', reselected)).toBe(true)
    expect(registry.get(baseline)?.filePath).toBe('/media/original.png')
    expect(registry.get(reselected)?.filePath).toBe('/media/original.png')
    expect(registry.activeOwnerPath(14, 'background')).toBe('/media/original.png')
  })

  it('authorizes only schema-v4 linked project assets', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const project = createProject({
      audioPath: '../audio/song.mp3',
    })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/images/stage.png'
    expect(registry.authorizeProject(
      4,
      '/projects/song.oks',
      serializeProject(project),
    )).toBe(true)

    expect(registry.consumeAuthorization(4, '/projects/song.oks', 'background')).toBe(
      '/images/stage.png',
    )
    expect(registry.consumeAuthorization(4, '/projects/song.oks', 'background')).toBeNull()
    expect(registry.consumeAuthorization(4, '/projects/song.oks', 'audio')).toBe('/audio/song.mp3')
    expect(registry.consumeAuthorization(4, '/projects/song.oks', 'audio')).toBeNull()
    expect(registry.authorizeProject(4, '/projects/old.oks', JSON.stringify({
      schemaVersion: 3,
      audioFile: '/secret/legacy.mp3',
    }))).toBe(false)
    expect(registry.consumeAuthorization(4, '/projects/old.oks', 'audio')).toBeNull()
    expect(registry.consumeAuthorization(4, '/projects/old.oks', 'background')).toBeNull()
  })

  it('clears prior restore grants when the next opened project fails strict decoding', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const project = createProject({ audioPath: '../audio/song.mp3' })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/images/stage.png'
    const valid = serializeProject(project)

    expect(registry.authorizeProject(18, '/projects/valid.oks', valid)).toBe(true)
    expect(registry.authorizeProject(18, '/projects/rejected.oks', JSON.stringify({
      ...JSON.parse(valid),
      unknownRootField: true,
    }))).toBe(false)
    expect(registry.consumeAuthorization(18, '/projects/valid.oks', 'audio')).toBeNull()
    expect(registry.consumeAuthorization(18, '/projects/valid.oks', 'background')).toBeNull()
    expect(registry.consumeAuthorization(18, '/projects/rejected.oks', 'audio')).toBeNull()
    expect(registry.consumeAuthorization(18, '/projects/rejected.oks', 'background')).toBeNull()
  })

  it('revokes unused restore grants by kind and on owner release', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const project = createProject({
      audioPath: '/audio/song.mp3',
    })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/images/stage.png'
    const contents = serializeProject(project)
    registry.authorizeProject(9, '/projects/song.oks', contents)
    registry.revokeOwner(9, 'audio')
    expect(registry.consumeAuthorization(9, '/projects/song.oks', 'audio')).toBeNull()
    expect(registry.consumeAuthorization(9, '/projects/song.oks', 'background')).toBe(
      '/images/stage.png',
    )

    registry.authorizeProject(9, '/projects/song.oks', contents)
    registry.releaseOwner(9)
    expect(registry.consumeAuthorization(9, '/projects/song.oks', 'audio')).toBeNull()
    expect(registry.consumeAuthorization(9, '/projects/song.oks', 'background')).toBeNull()
  })

  it('accepts only regular linked files with supported image extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-linked-image-'))
    temporaryDirectories.push(directory)
    const image = join(directory, 'stage.png')
    const text = join(directory, 'stage.txt')
    await writeFile(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    await writeFile(text, 'fixture')
    const validator = linkedAssets.createLinkedImageValidator(() => true)

    await expect(validator.validateLinkedImage(image)).resolves.toBe(image)
    await expect(validator.validateLinkedImage(text)).rejects.toThrow('supported static')
  })

  it('rejects header-valid corrupt and animated images before capability registration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-corrupt-linked-image-'))
    temporaryDirectories.push(directory)
    const corrupt = join(directory, 'corrupt.png')
    const animated = join(directory, 'animated.png')
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    await writeFile(corrupt, pngHeader)
    await writeFile(animated, Buffer.concat([pngHeader, Buffer.from('acTL', 'ascii')]))
    const validator = linkedAssets.createLinkedImageValidator(() => false)

    await expect(validator.validateLinkedImage(corrupt)).rejects.toThrow(
      `Linked image is invalid or unreadable: ${corrupt}`,
    )
    await expect(validator.validateLinkedImage(animated)).rejects.toThrow('invalid or animated')
  })

  it('rejects linked images larger than 64 MB before decoding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-oversized-linked-image-'))
    temporaryDirectories.push(directory)
    const oversized = join(directory, 'oversized.png')
    await writeFile(oversized, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    await truncate(oversized, linkedAssets.MAX_IMAGE_BYTES + 1)
    const validator = linkedAssets.createLinkedImageValidator(() => true)

    await expect(validator.validateLinkedImage(oversized)).rejects.toThrow(
      'between 1 byte and 64 MB',
    )
  })
})
