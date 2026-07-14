import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProject, serializeProject } from '../src/lib/karaoke'
import { nativeFixturePath } from './support/native-path'

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
    const oldAudioPath = nativeFixturePath('media', 'old.mp3')
    const oldBackgroundPath = nativeFixturePath('media', 'old.png')
    const oldAudio = registry.register(oldAudioPath, ownerId, 'audio')
    const oldBackground = registry.register(oldBackgroundPath, ownerId, 'background')
    const currentPath = nativeFixturePath('projects', 'current.oks')
    const invalidPath = nativeFixturePath('projects', 'invalid.oks')
    expect(opens.grantWrite(
      ownerId,
      currentPath,
      opens.captureWriteGrant(ownerId),
    )).toBe(true)

    const invalidRequest = opens.beginOpen(ownerId)
    expect(() => opens.stageOpen(
      ownerId,
      invalidRequest,
      invalidPath,
      JSON.stringify({ schemaVersion: 4, unknown: true }),
    )).toThrow()
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.canWrite(ownerId, invalidPath)).toBe(false)
    expect(registry.get(oldAudio)).not.toBeNull()
    expect(registry.get(oldBackground)).not.toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(true)

    const declinedRequest = opens.beginOpen(ownerId)
    const declinedPath = nativeFixturePath('projects', 'declined.oks')
    const declinedAudioPath = nativeFixturePath('audio', 'declined.mp3')
    const declinedBackgroundPath = nativeFixturePath('images', 'declined.png')
    const saveStartedBeforeDecline = opens.captureWriteGrant(ownerId)
    opens.stageOpen(
      ownerId,
      declinedRequest,
      declinedPath,
      linkedProject('Declined', declinedAudioPath, declinedBackgroundPath),
    )
    expect(opens.canWrite(ownerId, declinedPath)).toBe(false)
    expect(registry.consumeAuthorization(ownerId, declinedPath, 'audio')).toBeNull()
    expect(opens.settleOpen(ownerId, declinedRequest, false)).toBe(true)
    expect(registry.get(oldAudio)).not.toBeNull()
    expect(registry.get(oldBackground)).not.toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(true)
    expect(opens.grantWrite(
      ownerId,
      nativeFixturePath('projects', 'saved-while-open-was-declined.oks'),
      saveStartedBeforeDecline,
    )).toBe(true)

    const acceptedRequest = opens.beginOpen(ownerId)
    const acceptedPath = nativeFixturePath('projects', 'accepted.oks')
    const acceptedAudioPath = resolve(dirname(acceptedPath), '../audio/accepted.mp3')
    const acceptedBackgroundPath = nativeFixturePath('images', 'accepted.png')
    opens.stageOpen(
      ownerId,
      acceptedRequest,
      acceptedPath,
      linkedProject('Accepted', '../audio/accepted.mp3', acceptedBackgroundPath),
    )
    expect(opens.settleOpen(ownerId, acceptedRequest, true)).toBe(true)
    expect(registry.get(oldAudio)).toBeNull()
    expect(registry.get(oldBackground)).toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(false)
    expect(opens.canWrite(ownerId, acceptedPath)).toBe(true)
    expect(opens.canWrite(999, acceptedPath)).toBe(false)
    expect(registry.consumeAuthorization(ownerId, acceptedPath, 'audio')).toBe(
      acceptedAudioPath,
    )
    expect(registry.consumeAuthorization(ownerId, acceptedPath, 'background')).toBe(
      acceptedBackgroundPath,
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
    const currentPath = nativeFixturePath('projects', 'current.oks')
    const currentAudioPath = nativeFixturePath('audio', 'current.mp3')
    const activeAudio = registry.register(currentAudioPath, ownerId, 'audio')
    expect(opens.grantWrite(
      ownerId,
      currentPath,
      opens.captureWriteGrant(ownerId),
    )).toBe(true)

    const replacedRequest = opens.beginOpen(ownerId)
    const replacedPath = nativeFixturePath('projects', 'replaced.oks')
    opens.stageOpen(
      ownerId,
      replacedRequest,
      replacedPath,
      linkedProject(
        'Replaced',
        nativeFixturePath('audio', 'replaced.mp3'),
        nativeFixturePath('images', 'replaced.png'),
      ),
    )
    const currentRequest = opens.beginOpen(ownerId)
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.settleOpen(ownerId, replacedRequest, true)).toBe(false)
    expect(registry.get(activeAudio)).not.toBeNull()
    expect(opens.canWrite(ownerId, currentPath)).toBe(true)

    const currentSelectionPath = nativeFixturePath('projects', 'current-selection.oks')
    opens.stageOpen(
      ownerId,
      currentRequest,
      currentSelectionPath,
      linkedProject(
        'Current selection',
        nativeFixturePath('audio', 'current-selection.mp3'),
        nativeFixturePath('images', 'current.png'),
      ),
    )
    const saveStartedBeforeRelease = opens.captureWriteGrant(ownerId)
    expect(opens.hasPending(ownerId)).toBe(true)
    opens.releaseOwner(ownerId)
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.settleOpen(ownerId, currentRequest, true)).toBe(false)
    expect(opens.canWrite(ownerId, currentPath)).toBe(false)
    expect(opens.grantWrite(
      ownerId,
      nativeFixturePath('projects', 'stale-after-release.oks'),
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
    const pathA = nativeFixturePath('projects', 'a.oks')
    const openA = opens.beginOpen(ownerId)
    opens.stageOpen(
      ownerId,
      openA,
      pathA,
      linkedProject(
        'A',
        nativeFixturePath('audio', 'a.mp3'),
        nativeFixturePath('images', 'a.png'),
      ),
    )
    expect(opens.settleOpen(ownerId, openA, true)).toBe(true)

    const directSaveA = opens.captureWriteGrant(ownerId)
    const saveAsA = opens.captureWriteGrant(ownerId)
    const saveCompletingWhileBIsOnlyStaged = opens.captureWriteGrant(ownerId)
    const pathB = nativeFixturePath('projects', 'b.oks')
    const openB = opens.beginOpen(ownerId)
    opens.stageOpen(
      ownerId,
      openB,
      pathB,
      linkedProject(
        'B',
        nativeFixturePath('audio', 'b.mp3'),
        nativeFixturePath('images', 'b.png'),
      ),
    )
    const saveBeforeAcceptPath = nativeFixturePath('projects', 'a-before-accept.oks')
    const saveAsAPath = nativeFixturePath('projects', 'a-save-as.oks')
    const saveAsBPath = nativeFixturePath('projects', 'b-save-as.oks')
    expect(opens.grantWrite(
      ownerId,
      saveBeforeAcceptPath,
      saveCompletingWhileBIsOnlyStaged,
    )).toBe(true)

    expect(opens.settleOpen(ownerId, openB, true)).toBe(true)
    expect(opens.grantWrite(ownerId, pathA, directSaveA)).toBe(false)
    expect(opens.grantWrite(ownerId, saveAsAPath, saveAsA)).toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(false)
    expect(opens.canWrite(ownerId, saveBeforeAcceptPath)).toBe(false)
    expect(opens.canWrite(ownerId, saveAsAPath)).toBe(false)
    expect(opens.canWrite(ownerId, pathB)).toBe(true)

    const directSaveB = opens.captureWriteGrant(ownerId)
    const saveAsB = opens.captureWriteGrant(ownerId)
    expect(opens.grantWrite(ownerId, pathB, directSaveB)).toBe(true)
    expect(opens.grantWrite(ownerId, saveAsBPath, saveAsB)).toBe(true)
    expect(opens.canWrite(ownerId, saveAsBPath)).toBe(true)
  })

  it('invalidates deferred save grants when a new-project scope reset is acknowledged', () => {
    const ownerId = 35
    const registry = createLinkedAssetRegistry(new Set(['.mp3']))
    const sequencer = createMediaRequestSequencer()
    const opens = createProjectOpenCoordinator({ linkedAssets: registry, mediaRequests: sequencer })
    const activePath = nativeFixturePath('projects', 'active.oks')
    expect(opens.grantWrite(
      ownerId,
      activePath,
      opens.captureWriteGrant(ownerId),
    )).toBe(true)
    const directSave = opens.captureWriteGrant(ownerId)
    const saveAs = opens.captureWriteGrant(ownerId)

    opens.resetProjectScope(ownerId)

    expect(opens.grantWrite(ownerId, activePath, directSave)).toBe(false)
    expect(opens.grantWrite(
      ownerId,
      nativeFixturePath('projects', 'stale-save-as.oks'),
      saveAs,
    )).toBe(false)
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
    const audioPathA = nativeFixturePath('audio', 'a.mp3')
    const audioPathB = nativeFixturePath('audio', 'b.mp3')
    const backgroundPathA = nativeFixturePath('images', 'a.png')
    const backgroundPathB = nativeFixturePath('images', 'b.png')
    const pathA = nativeFixturePath('projects', 'a.oks')
    const pathB = nativeFixturePath('projects', 'b.oks')
    const produced: Array<{ kind: string; path: string; token: string }> = []
    const makeMediaResult = (filePath: string, owner: { id: number }, kind: string) => {
      const token = registry.register(filePath, owner.id, kind)
      produced.push({ kind, path: filePath, token })
      return { path: filePath, token }
    }
    const resolveAudio = createProjectAudioResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      statFile: (filePath: string) => basename(filePath) === 'a.mp3'
        ? audioA.promise
        : Promise.resolve({ isFile: () => true }),
      makeMediaResult,
    })
    const resolveBackground = createProjectBackgroundResolver({
      linkedAssets: registry,
      requestSequencer: sequencer,
      validateLinkedImage: (filePath: string) => basename(filePath) === 'a.png'
        ? backgroundA.promise
        : Promise.resolve(filePath),
      makeMediaResult,
    })

    const requestA = opens.beginOpen(ownerContents.id)
    opens.stageOpen(
      ownerContents.id,
      requestA,
      pathA,
      linkedProject('A', audioPathA, backgroundPathA),
    )
    expect(opens.settleOpen(ownerContents.id, requestA, true)).toBe(true)
    const restoreAudioA = resolveAudio({ ownerContents, projectPath: pathA })
    const restoreBackgroundA = resolveBackground({ ownerContents, projectPath: pathA })
    const activeAudioA = registry.register(
      nativeFixturePath('audio', 'active-a.mp3'),
      ownerContents.id,
      'audio',
    )
    const activeBackgroundA = registry.register(
      nativeFixturePath('images', 'active-a.png'),
      ownerContents.id,
      'background',
    )

    const requestB = opens.beginOpen(ownerContents.id)
    opens.stageOpen(
      ownerContents.id,
      requestB,
      pathB,
      linkedProject('B', audioPathB, backgroundPathB),
    )
    expect(opens.settleOpen(ownerContents.id, requestB, true)).toBe(true)
    expect(registry.get(activeAudioA)).toBeNull()
    expect(registry.get(activeBackgroundA)).toBeNull()

    await expect(resolveAudio({ ownerContents, projectPath: pathB })).resolves.toMatchObject({
      status: 'success',
      media: { path: audioPathB },
    })
    await expect(resolveBackground({ ownerContents, projectPath: pathB })).resolves.toMatchObject({
      status: 'success',
      media: { path: backgroundPathB },
    })
    audioA.resolve({ isFile: () => true })
    backgroundA.resolve(backgroundPathA)
    await expect(restoreAudioA).resolves.toEqual({ status: 'stale' })
    await expect(restoreBackgroundA).resolves.toEqual({ status: 'stale' })

    expect(registry.activeOwnerPath(ownerContents.id, 'audio')).toBe(audioPathB)
    expect(registry.hasOwnerPath(ownerContents.id, 'background', backgroundPathB)).toBe(true)
    expect(produced.map(({ path }) => path)).toEqual([audioPathB, backgroundPathB])
  })
})
