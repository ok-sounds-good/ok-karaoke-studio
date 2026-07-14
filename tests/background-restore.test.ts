import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'

const require = createRequire(import.meta.url)
const { createProjectBackgroundResolver } = require('../electron/background-restore.cjs') as {
  createProjectBackgroundResolver(options: Record<string, unknown>): (request: {
    ownerContents: { id: number }
    projectPath: string
  }) => Promise<
    | { status: 'success'; media: { path: string; url: string } }
    | { status: 'missing' | 'stale' }
  >
}
const { createLinkedAssetRegistry, createLinkedImageValidator } = require('../electron/linked-assets.cjs') as {
  createLinkedImageValidator(decoder: () => boolean): {
    validateLinkedImage(filePath: string): Promise<string>
  }
  createLinkedAssetRegistry(extensions: Set<string>): {
    authorizeProject(ownerId: number, projectPath: string, contents: string): void
    consumeAuthorization(ownerId: number, projectPath: string, kind: string): string | null
    get(token: string): { filePath: string } | null
    register(filePath: string, ownerId: number, kind: string): string
    revokeOwner(ownerId: number, kind?: string): void
  }
}
const { createMediaRequestSequencer } = require('../electron/media-request-sequencer.cjs') as {
  createMediaRequestSequencer(): {
    begin(ownerId: number, kind: string): number
    invalidateOwner(ownerId: number): void
    isCurrent(ownerId: number, kind: string, sequence: number): boolean
    releaseOwner(ownerId: number): void
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function projectWithBackground(imagePath: string) {
  const project = createProject()
  project.stageStyle.background.mode = 'image'
  project.stageStyle.background.imagePath = imagePath
  return serializeProject(project)
}

describe('project background restore sequencing', () => {
  it('does not issue a Preview capability for a header-valid image that cannot decode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-corrupt-background-restore-'))
    const imagePath = join(directory, 'stage.png')
    const ownerContents = { id: 29 }
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const makeMediaResult = vi.fn()
    const validator = createLinkedImageValidator(() => false)
    const resolveBackground = createProjectBackgroundResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      validateLinkedImage: validator.validateLinkedImage,
      makeMediaResult,
    })
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    registry.authorizeProject(
      ownerContents.id,
      '/projects/corrupt.oks',
      projectWithBackground(imagePath),
    )

    try {
      await expect(resolveBackground({
        ownerContents,
        projectPath: '/projects/corrupt.oks',
      })).resolves.toEqual({ status: 'missing' })
      expect(makeMediaResult).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('isolates request generations by renderer owner and media kind', () => {
    const sequencer = createMediaRequestSequencer()
    const ownerOneAudio = sequencer.begin(1, 'audio')
    const ownerOneBackground = sequencer.begin(1, 'background')
    const ownerTwoAudio = sequencer.begin(2, 'audio')

    sequencer.begin(1, 'background')
    expect(sequencer.isCurrent(1, 'audio', ownerOneAudio)).toBe(true)
    expect(sequencer.isCurrent(1, 'background', ownerOneBackground)).toBe(false)
    expect(sequencer.isCurrent(2, 'audio', ownerTwoAudio)).toBe(true)

    sequencer.invalidateOwner(1)
    expect(sequencer.isCurrent(1, 'audio', ownerOneAudio)).toBe(false)
    expect(sequencer.isCurrent(2, 'audio', ownerTwoAudio)).toBe(true)
    sequencer.releaseOwner(2)
    expect(sequencer.isCurrent(2, 'audio', ownerTwoAudio)).toBe(false)
  })

  it('revokes the prior token and ignores deferred A after deferred B wins', async () => {
    const ownerContents = { id: 17 }
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const validationA = deferred<string>()
    const validationB = deferred<string>()
    const producedTokens: string[] = []
    const staleToken = registry.register('/images/prior.png', ownerContents.id, 'background')
    const resolveBackground = createProjectBackgroundResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      validateLinkedImage: (filePath: string) => (
        filePath.endsWith('/a.png') ? validationA.promise : validationB.promise
      ),
      makeMediaResult: (filePath: string, owner: { id: number }, kind: string) => {
        const token = registry.register(filePath, owner.id, kind)
        producedTokens.push(token)
        return { path: filePath, url: `studio-media://asset/${token}/stage.png` }
      },
    })

    registry.authorizeProject(
      ownerContents.id,
      '/projects/a.oks',
      projectWithBackground('/images/a.png'),
    )
    const restoreA = resolveBackground({ ownerContents, projectPath: '/projects/a.oks' })
    registry.authorizeProject(
      ownerContents.id,
      '/projects/b.oks',
      projectWithBackground('/images/b.png'),
    )
    const restoreB = resolveBackground({ ownerContents, projectPath: '/projects/b.oks' })

    expect(registry.get(staleToken)).toBeNull()
    validationB.resolve('/images/b.png')
    await expect(restoreB).resolves.toMatchObject({
      status: 'success',
      media: { path: '/images/b.png' },
    })
    validationA.resolve('/images/a.png')
    await expect(restoreA).resolves.toEqual({ status: 'stale' })

    expect(producedTokens).toHaveLength(1)
    expect(registry.get(producedTokens[0])?.filePath).toBe('/images/b.png')
  })

  it('reports stale without revoking a user-chosen B that supersedes deferred restore A', async () => {
    const ownerContents = { id: 31 }
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const validationA = deferred<string>()
    const resolveBackground = createProjectBackgroundResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      validateLinkedImage: () => validationA.promise,
      makeMediaResult: vi.fn(),
    })
    registry.authorizeProject(
      ownerContents.id,
      '/projects/a.oks',
      projectWithBackground('/images/a.png'),
    )
    const restoreA = resolveBackground({ ownerContents, projectPath: '/projects/a.oks' })

    sequencer.begin(ownerContents.id, 'background')
    registry.register('/images/b.png', ownerContents.id, 'background')
    validationA.resolve('/images/a.png')

    await expect(restoreA).resolves.toEqual({ status: 'stale' })
    expect(registry.activeOwnerPath(ownerContents.id, 'background')).toBe('/images/b.png')
  })
})
