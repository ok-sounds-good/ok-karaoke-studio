import { createRequire } from 'node:module'
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'
import { nativeFixturePath } from './support/native-path'

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
    const firstAudioPath = nativeFixturePath('media', 'first.mp3')
    const imagePath = nativeFixturePath('media', 'background.png')
    const secondAudioPath = nativeFixturePath('media', 'second.mp3')
    const firstAudio = registry.register(firstAudioPath, 7, 'audio')
    const image = registry.register(imagePath, 7, 'background')
    const secondAudio = registry.register(secondAudioPath, 7, 'audio')

    expect(registry.get(firstAudio)).toBeNull()
    expect(registry.get(image)?.kind).toBe('background')
    expect(registry.get(secondAudio)?.filePath).toBe(secondAudioPath)
    expect(registry.activeOwnerPath(7, 'audio')).toBe(secondAudioPath)
    expect(registry.activeOwnerPath(7, 'background')).toBe(imagePath)
    registry.revokeOwner(7, 'background')
    expect(registry.get(image)).toBeNull()
    expect(registry.activeOwnerPath(7, 'background')).toBeNull()
    expect(registry.get(secondAudio)?.kind).toBe('audio')
    registry.releaseOwner(7)
    expect(registry.get(secondAudio)).toBeNull()
  })

  it('keeps dormant background bindings available while activating Cancel or Apply', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const originalPath = nativeFixturePath('media', 'original.png')
    const replacementPath = nativeFixturePath('media', 'replacement.png')
    const appliedPath = nativeFixturePath('media', 'applied.png')
    const baseline = registry.register(originalPath, 12, 'background')
    const replacement = registry.register(replacementPath, 12, 'background')

    expect(registry.get(baseline)?.filePath).toBe(originalPath)
    expect(registry.get(replacement)?.filePath).toBe(replacementPath)
    expect(registry.retainOwnerToken(12, 'background', baseline)).toBe(true)
    expect(registry.get(baseline)?.filePath).toBe(originalPath)
    expect(registry.get(replacement)?.filePath).toBe(replacementPath)
    expect(registry.activeOwnerPath(12, 'background')).toBe(originalPath)

    const applied = registry.register(appliedPath, 12, 'background')
    expect(registry.retainOwnerToken(12, 'background', applied)).toBe(true)
    expect(registry.get(baseline)?.filePath).toBe(originalPath)
    expect(registry.get(applied)?.filePath).toBe(appliedPath)
    expect(registry.activeOwnerPath(12, 'background')).toBe(appliedPath)
    registry.revokeOwner(12, 'background')
    expect(registry.get(applied)).toBeNull()
  })

  it('reactivates a reselected baseline without discarding its history binding', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const originalPath = nativeFixturePath('media', 'original.png')
    const baseline = registry.register(originalPath, 14, 'background')
    const reselected = registry.register(originalPath, 14, 'background')

    expect(registry.get(baseline)?.filePath).toBe(originalPath)
    expect(registry.get(reselected)?.filePath).toBe(originalPath)
    expect(registry.retainOwnerToken(14, 'background', reselected)).toBe(true)
    expect(registry.get(baseline)?.filePath).toBe(originalPath)
    expect(registry.get(reselected)?.filePath).toBe(originalPath)
    expect(registry.activeOwnerPath(14, 'background')).toBe(originalPath)
  })

  it('authorizes only schema-v4 linked project assets', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const projectPath = nativeFixturePath('projects', 'song.oks')
    const oldProjectPath = nativeFixturePath('projects', 'old.oks')
    const backgroundPath = nativeFixturePath('images', 'stage.png')
    const audioPath = resolve(dirname(projectPath), '../audio/song.mp3')
    const project = createProject({
      audioPath: '../audio/song.mp3',
    })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = backgroundPath
    expect(registry.authorizeProject(
      4,
      projectPath,
      serializeProject(project),
    )).toBe(true)

    expect(registry.consumeAuthorization(4, projectPath, 'background')).toBe(
      backgroundPath,
    )
    expect(registry.consumeAuthorization(4, projectPath, 'background')).toBeNull()
    expect(registry.consumeAuthorization(4, projectPath, 'audio')).toBe(audioPath)
    expect(registry.consumeAuthorization(4, projectPath, 'audio')).toBeNull()
    expect(registry.authorizeProject(4, oldProjectPath, JSON.stringify({
      schemaVersion: 3,
      audioFile: nativeFixturePath('secret', 'legacy.mp3'),
    }))).toBe(false)
    expect(registry.consumeAuthorization(4, oldProjectPath, 'audio')).toBeNull()
    expect(registry.consumeAuthorization(4, oldProjectPath, 'background')).toBeNull()
  })

  it('clears prior restore grants when the next opened project fails strict decoding', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const validPath = nativeFixturePath('projects', 'valid.oks')
    const rejectedPath = nativeFixturePath('projects', 'rejected.oks')
    const project = createProject({ audioPath: '../audio/song.mp3' })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = nativeFixturePath('images', 'stage.png')
    const valid = serializeProject(project)

    expect(registry.authorizeProject(18, validPath, valid)).toBe(true)
    expect(registry.authorizeProject(18, rejectedPath, JSON.stringify({
      ...JSON.parse(valid),
      unknownRootField: true,
    }))).toBe(false)
    expect(registry.consumeAuthorization(18, validPath, 'audio')).toBeNull()
    expect(registry.consumeAuthorization(18, validPath, 'background')).toBeNull()
    expect(registry.consumeAuthorization(18, rejectedPath, 'audio')).toBeNull()
    expect(registry.consumeAuthorization(18, rejectedPath, 'background')).toBeNull()
  })

  it('revokes unused restore grants by kind and on owner release', () => {
    const registry = linkedAssets.createLinkedAssetRegistry(new Set(['.mp3']))
    const audioPath = nativeFixturePath('audio', 'song.mp3')
    const backgroundPath = nativeFixturePath('images', 'stage.png')
    const projectPath = nativeFixturePath('projects', 'song.oks')
    const project = createProject({
      audioPath,
    })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = backgroundPath
    const contents = serializeProject(project)
    registry.authorizeProject(9, projectPath, contents)
    registry.revokeOwner(9, 'audio')
    expect(registry.consumeAuthorization(9, projectPath, 'audio')).toBeNull()
    expect(registry.consumeAuthorization(9, projectPath, 'background')).toBe(
      backgroundPath,
    )

    registry.authorizeProject(9, projectPath, contents)
    registry.releaseOwner(9)
    expect(registry.consumeAuthorization(9, projectPath, 'audio')).toBeNull()
    expect(registry.consumeAuthorization(9, projectPath, 'background')).toBeNull()
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
