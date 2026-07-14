import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'

const require = createRequire(import.meta.url)
const { createLinkedAssetRegistry } = require('../electron/linked-assets.cjs') as {
  createLinkedAssetRegistry(extensions: Set<string>): any
}
const { createMediaRequestSequencer } = require('../electron/media-request-sequencer.cjs') as {
  createMediaRequestSequencer(): any
}
const { createProjectOpenCoordinator } = require('../electron/project-open.cjs') as {
  createProjectOpenCoordinator(options: Record<string, unknown>): any
}
const { createProjectAudioResolver } = require('../electron/audio-restore.cjs') as {
  createProjectAudioResolver(options: Record<string, unknown>): (request: {
    ownerContents: { id: number }
    projectPath: string
  }) => Promise<{ path: string; token: string } | null>
}
const { createProjectBackgroundResolver } = require('../electron/background-restore.cjs') as {
  createProjectBackgroundResolver(options: Record<string, unknown>): (request: {
    ownerContents: { id: number }
    projectPath: string
  }) => Promise<{ path: string; token: string } | null>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function linkedProject(title: string, audioPath: string, backgroundPath: string) {
  const project = createProject({ title, audioPath })
  project.stageStyle.background.mode = 'image'
  project.stageStyle.background.imagePath = backgroundPath
  return serializeProject(project)
}

describe('renderer-accepted project open handshake', () => {
  it('keeps current grants on invalid or declined selection and grants save-back only on accept', () => {
    const ownerId = 31
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const requestIds = ['invalid-open', 'declined-open', 'accepted-open']
    const opens = createProjectOpenCoordinator({
      linkedAssets: registry,
      mediaRequests: sequencer,
      createRequestId: () => requestIds.shift(),
    })
    const oldAudio = registry.register('/media/old.mp3', ownerId, 'audio')
    const oldBackground = registry.register('/media/old.png', ownerId, 'background')
    const currentPath = '/projects/current.oks'
    expect(opens.grantWrite(
      ownerId,
      currentPath,
      opens.captureWriteGrant(ownerId),
    )).toBe(true)

    const invalidRequest = opens.beginOpen(ownerId)
    expect(() => opens.stageOpen(
      ownerId,
      invalidRequest,
      '/projects/invalid.oks',
      JSON.stringify({ schemaVersion: 4, unknown: true }),
    )).toThrow()
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.canWrite(ownerId, '/projects/invalid.oks')).toBe(false)
    expect(registry.get(oldAudio)).not.toBeNull()
    expect(registry.get(oldBackground)).not.toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(true)

    const declinedRequest = opens.beginOpen(ownerId)
    const declinedPath = '/projects/declined.oks'
    const saveStartedBeforeDecline = opens.captureWriteGrant(ownerId)
    opens.stageOpen(
      ownerId,
      declinedRequest,
      declinedPath,
      linkedProject('Declined', '/audio/declined.mp3', '/images/declined.png'),
    )
    expect(opens.canWrite(ownerId, declinedPath)).toBe(false)
    expect(registry.consumeAuthorization(ownerId, declinedPath, 'audio')).toBeNull()
    expect(opens.settleOpen(ownerId, declinedRequest, false)).toBe(true)
    expect(registry.get(oldAudio)).not.toBeNull()
    expect(registry.get(oldBackground)).not.toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(true)
    expect(opens.grantWrite(
      ownerId,
      '/projects/saved-while-open-was-declined.oks',
      saveStartedBeforeDecline,
    )).toBe(true)

    const acceptedRequest = opens.beginOpen(ownerId)
    const acceptedPath = '/projects/accepted.oks'
    opens.stageOpen(
      ownerId,
      acceptedRequest,
      acceptedPath,
      linkedProject('Accepted', '../audio/accepted.mp3', '/images/accepted.png'),
    )
    expect(opens.settleOpen(ownerId, acceptedRequest, true)).toBe(true)
    expect(registry.get(oldAudio)).toBeNull()
    expect(registry.get(oldBackground)).toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(false)
    expect(opens.canWrite(ownerId, acceptedPath)).toBe(true)
    expect(opens.canWrite(999, acceptedPath)).toBe(false)
    expect(registry.consumeAuthorization(ownerId, acceptedPath, 'audio')).toBe(
      '/audio/accepted.mp3',
    )
    expect(registry.consumeAuthorization(ownerId, acceptedPath, 'background')).toBe(
      '/images/accepted.png',
    )
  })

  it('clears a replaced or released pending selection without changing current grants', () => {
    const ownerId = 33
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const requestIds = ['replaced-open', 'current-open']
    const opens = createProjectOpenCoordinator({
      linkedAssets: registry,
      mediaRequests: sequencer,
      createRequestId: () => requestIds.shift(),
    })
    const activeAudio = registry.register('/audio/current.mp3', ownerId, 'audio')
    expect(opens.grantWrite(
      ownerId,
      '/projects/current.oks',
      opens.captureWriteGrant(ownerId),
    )).toBe(true)

    const replacedRequest = opens.beginOpen(ownerId)
    opens.stageOpen(
      ownerId,
      replacedRequest,
      '/projects/replaced.oks',
      linkedProject('Replaced', '/audio/replaced.mp3', '/images/replaced.png'),
    )
    const currentRequest = opens.beginOpen(ownerId)
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.settleOpen(ownerId, replacedRequest, true)).toBe(false)
    expect(registry.get(activeAudio)).not.toBeNull()
    expect(opens.canWrite(ownerId, '/projects/current.oks')).toBe(true)

    opens.stageOpen(
      ownerId,
      currentRequest,
      '/projects/current-selection.oks',
      linkedProject('Current selection', '/audio/current-selection.mp3', '/images/current.png'),
    )
    const saveStartedBeforeRelease = opens.captureWriteGrant(ownerId)
    expect(opens.hasPending(ownerId)).toBe(true)
    opens.releaseOwner(ownerId)
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.settleOpen(ownerId, currentRequest, true)).toBe(false)
    expect(opens.canWrite(ownerId, '/projects/current.oks')).toBe(false)
    expect(opens.grantWrite(
      ownerId,
      '/projects/stale-after-release.oks',
      saveStartedBeforeRelease,
    )).toBe(false)
    expect(registry.get(activeAudio)).not.toBeNull()
  })

  it('does not let concurrent A save completions restore grants after B is accepted', () => {
    const ownerId = 34
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const requestIds = ['open-a', 'open-b']
    const opens = createProjectOpenCoordinator({
      linkedAssets: registry,
      mediaRequests: sequencer,
      createRequestId: () => requestIds.shift(),
    })
    const pathA = '/projects/a.oks'
    const openA = opens.beginOpen(ownerId)
    opens.stageOpen(
      ownerId,
      openA,
      pathA,
      linkedProject('A', '/audio/a.mp3', '/images/a.png'),
    )
    expect(opens.settleOpen(ownerId, openA, true)).toBe(true)

    const directSaveA = opens.captureWriteGrant(ownerId)
    const saveAsA = opens.captureWriteGrant(ownerId)
    const saveCompletingWhileBIsOnlyStaged = opens.captureWriteGrant(ownerId)
    const pathB = '/projects/b.oks'
    const openB = opens.beginOpen(ownerId)
    opens.stageOpen(
      ownerId,
      openB,
      pathB,
      linkedProject('B', '/audio/b.mp3', '/images/b.png'),
    )
    expect(opens.grantWrite(
      ownerId,
      '/projects/a-before-accept.oks',
      saveCompletingWhileBIsOnlyStaged,
    )).toBe(true)

    expect(opens.settleOpen(ownerId, openB, true)).toBe(true)
    expect(opens.grantWrite(ownerId, pathA, directSaveA)).toBe(false)
    expect(opens.grantWrite(ownerId, '/projects/a-save-as.oks', saveAsA)).toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(false)
    expect(opens.canWrite(ownerId, '/projects/a-before-accept.oks')).toBe(false)
    expect(opens.canWrite(ownerId, '/projects/a-save-as.oks')).toBe(false)
    expect(opens.canWrite(ownerId, pathB)).toBe(true)

    const directSaveB = opens.captureWriteGrant(ownerId)
    const saveAsB = opens.captureWriteGrant(ownerId)
    expect(opens.grantWrite(ownerId, pathB, directSaveB)).toBe(true)
    expect(opens.grantWrite(ownerId, '/projects/b-save-as.oks', saveAsB)).toBe(true)
    expect(opens.canWrite(ownerId, '/projects/b-save-as.oks')).toBe(true)
  })

  it('invalidates deferred save grants when a new-project scope reset is acknowledged', () => {
    const ownerId = 35
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const opens = createProjectOpenCoordinator({ linkedAssets: registry, mediaRequests: sequencer })
    const activePath = '/projects/active.oks'
    expect(opens.grantWrite(
      ownerId,
      activePath,
      opens.captureWriteGrant(ownerId),
    )).toBe(true)
    const directSave = opens.captureWriteGrant(ownerId)
    const saveAs = opens.captureWriteGrant(ownerId)

    opens.resetProjectScope(ownerId)

    expect(opens.grantWrite(ownerId, activePath, directSave)).toBe(false)
    expect(opens.grantWrite(ownerId, '/projects/stale-save-as.oks', saveAs)).toBe(false)
    expect(opens.canWrite(ownerId, activePath)).toBe(false)
  })

  it('prevents deferred A audio and background completions from registering after B is accepted', async () => {
    const ownerContents = { id: 32 }
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const requestIds = ['open-a', 'open-b']
    const opens = createProjectOpenCoordinator({
      linkedAssets: registry,
      mediaRequests: sequencer,
      createRequestId: () => requestIds.shift(),
    })
    const audioA = deferred<{ isFile(): boolean }>()
    const backgroundA = deferred<string>()
    const produced: Array<{ kind: string; path: string; token: string }> = []
    const makeMediaResult = (filePath: string, owner: { id: number }, kind: string) => {
      const token = registry.register(filePath, owner.id, kind)
      produced.push({ kind, path: filePath, token })
      return { path: filePath, token }
    }
    const resolveAudio = createProjectAudioResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      statFile: (filePath: string) => filePath.endsWith('/a.mp3')
        ? audioA.promise
        : Promise.resolve({ isFile: () => true }),
      makeMediaResult,
    })
    const resolveBackground = createProjectBackgroundResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      validateLinkedImage: (filePath: string) => filePath.endsWith('/a.png')
        ? backgroundA.promise
        : Promise.resolve(filePath),
      makeMediaResult,
    })

    const pathA = '/projects/a.oks'
    const requestA = opens.beginOpen(ownerContents.id)
    opens.stageOpen(
      ownerContents.id,
      requestA,
      pathA,
      linkedProject('A', '/audio/a.mp3', '/images/a.png'),
    )
    expect(opens.settleOpen(ownerContents.id, requestA, true)).toBe(true)
    const restoreAudioA = resolveAudio({ ownerContents, projectPath: pathA })
    const restoreBackgroundA = resolveBackground({ ownerContents, projectPath: pathA })
    const activeAudioA = registry.register('/audio/active-a.mp3', ownerContents.id, 'audio')
    const activeBackgroundA = registry.register(
      '/images/active-a.png',
      ownerContents.id,
      'background',
    )

    const pathB = '/projects/b.oks'
    const requestB = opens.beginOpen(ownerContents.id)
    opens.stageOpen(
      ownerContents.id,
      requestB,
      pathB,
      linkedProject('B', '/audio/b.mp3', '/images/b.png'),
    )
    expect(opens.settleOpen(ownerContents.id, requestB, true)).toBe(true)
    expect(registry.get(activeAudioA)).toBeNull()
    expect(registry.get(activeBackgroundA)).toBeNull()

    await expect(resolveAudio({ ownerContents, projectPath: pathB })).resolves.toMatchObject({
      status: 'success',
      media: { path: '/audio/b.mp3' },
    })
    await expect(resolveBackground({ ownerContents, projectPath: pathB })).resolves.toMatchObject({
      status: 'success',
      media: { path: '/images/b.png' },
    })
    audioA.resolve({ isFile: () => true })
    backgroundA.resolve('/images/a.png')
    await expect(restoreAudioA).resolves.toEqual({ status: 'stale' })
    await expect(restoreBackgroundA).resolves.toEqual({ status: 'stale' })

    expect(registry.activeOwnerPath(ownerContents.id, 'audio')).toBe('/audio/b.mp3')
    expect(registry.hasOwnerPath(ownerContents.id, 'background', '/images/b.png')).toBe(true)
    expect(produced.map(({ path }) => path)).toEqual(['/audio/b.mp3', '/images/b.png'])
  })
})
