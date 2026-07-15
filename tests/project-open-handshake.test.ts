import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProject, serializeProject, UNSUPPORTED_PROJECT_FORMAT_ERROR } from '../src/lib/model'

const require = createRequire(import.meta.url)
const { createProjectOpenCoordinator } = require('../electron/project-open.cjs') as {
  createProjectOpenCoordinator(options?: Record<string, unknown>): any
}
const { queueProjectWrite, readUtf8FileWithinLimit } = require('../electron/project-files.cjs') as {
  queueProjectWrite(
    filePath: string,
    contents: string,
    acquirePromotion?: () => Promise<(() => void) | null>,
  ): Promise<void>
  readUtf8FileWithinLimit(filePath: string, maxBytes: number, label: string): Promise<string>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function project(title: string, audioPath: string | null = null) {
  return serializeProject(createProject({ title, audioPath }))
}

function requestIds(...ids: string[]) {
  return () => {
    const id = ids.shift()
    if (!id) throw new Error('Test request IDs exhausted')
    return id
  }
}

async function accept(
  opens: any,
  ownerId: number,
  requestId: string,
  filePath: string,
  contents: string,
) {
  expect(opens.beginOpen(ownerId)).toBe(requestId)
  expect(opens.stageOpen(ownerId, requestId, filePath, contents)).toEqual({
    requestId,
    path: resolve(filePath),
    contents,
  })
  expect(await opens.settleOpen(ownerId, requestId, true)).toBe(true)
}

describe('project-open authority coordinator', () => {
  it('stages strict current-v0 data without granting malformed or unsupported selections', async () => {
    const ownerId = 41
    const commits = vi.fn(() => true)
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'unsupported-b', 'malformed-b'),
      commitScope: commits,
    })
    const pathA = '/projects/a.oks'
    await accept(opens, ownerId, 'open-a', pathA, project('A'))

    const unsupported = JSON.parse(project('Unsupported'))
    unsupported.schemaVersion = '0'
    const unsupportedRequest = opens.beginOpen(ownerId)
    expect(() =>
      opens.stageOpen(
        ownerId,
        unsupportedRequest,
        '/projects/unsupported.oks',
        JSON.stringify(unsupported),
      ),
    ).toThrow(UNSUPPORTED_PROJECT_FORMAT_ERROR)

    const malformedRequest = opens.beginOpen(ownerId)
    expect(() =>
      opens.stageOpen(ownerId, malformedRequest, '/projects/malformed.oks', '{oops'),
    ).toThrow('Invalid project JSON')

    expect(commits).toHaveBeenCalledTimes(1)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.canWrite(ownerId, '/projects/unsupported.oks')).toBe(false)
    expect(opens.canWrite(ownerId, '/projects/malformed.oks')).toBe(false)
    expect(opens.hasPending(ownerId)).toBe(false)
  })

  it('declines B without changing A paths, scope hooks, or write generations', async () => {
    const ownerId = 42
    const commits = vi.fn(() => true)
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'open-b'),
      commitScope: commits,
    })
    const pathA = '/projects/a.oks'
    const pathB = '/projects/b.oks'
    await accept(opens, ownerId, 'open-a', pathA, project('A'))
    const saveStartedForA = opens.captureWriteGrant(ownerId)

    const requestB = opens.beginOpen(ownerId)
    expect(opens.stageOpen(ownerId, requestB, pathB, project('B'))).not.toBeNull()
    expect(opens.canWrite(ownerId, pathB)).toBe(false)
    expect(opens.writeGrantIsCurrent(ownerId, saveStartedForA)).toBe(true)
    expect(await opens.settleOpen(ownerId, requestB, false)).toBe(true)

    const saveAsA = '/projects/a-save-as.oks'
    expect(opens.grantWrite(ownerId, saveAsA, saveStartedForA)).toBe(true)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.canWrite(ownerId, saveAsA)).toBe(true)
    expect(opens.canWrite(ownerId, pathB)).toBe(false)
    expect(commits).toHaveBeenCalledTimes(1)
  })

  it('accepts B as an owner-isolated replacement and rejects every stale A grant', async () => {
    const ownerA = 43
    const ownerB = 44
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('owner-a-open-a', 'owner-b-open', 'owner-a-open-b'),
    })
    const pathA = '/projects/a.oks'
    const pathB = '/projects/b.oks'
    const otherPath = '/projects/other.oks'
    await accept(opens, ownerA, 'owner-a-open-a', pathA, project('A'))
    await accept(opens, ownerB, 'owner-b-open', otherPath, project('Other'))
    const directSaveA = opens.captureWriteGrant(ownerA)
    const saveAsA = opens.captureWriteGrant(ownerA)

    await accept(opens, ownerA, 'owner-a-open-b', pathB, project('B'))

    expect(opens.grantWrite(ownerA, pathA, directSaveA)).toBe(false)
    expect(opens.grantWrite(ownerA, '/projects/stale-save-as.oks', saveAsA)).toBe(false)
    expect(opens.canWrite(ownerA, pathA)).toBe(false)
    expect(opens.canWrite(ownerA, pathB)).toBe(true)
    expect(opens.canWrite(ownerB, pathB)).toBe(false)
    expect(opens.canWrite(ownerB, otherPath)).toBe(true)
  })

  it('waits for an acquired A promotion to finish before committing B', async () => {
    const ownerId = 52
    const commits: string[] = []
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'open-b'),
      prepareScope: (_ownerId: number, scope: { path: string }) => scope.path,
      commitScope: (_ownerId: number, projectPath: string) => {
        commits.push(projectPath)
        return true
      },
    })
    await accept(opens, ownerId, 'open-a', '/projects/a.oks', project('A'))
    const saveA = opens.captureWriteGrant(ownerId)
    const releasePromotion = await opens.acquireWritePromotion(ownerId, saveA)
    expect(releasePromotion).toBeTypeOf('function')

    const requestB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, requestB, '/projects/b.oks', project('B'))
    let settlementFinished = false
    const settlement = opens.settleOpen(ownerId, requestB, true).then((result: boolean) => {
      settlementFinished = true
      return result
    })
    await Promise.resolve()
    expect(settlementFinished).toBe(false)
    expect(commits).toEqual([resolve('/projects/a.oks')])

    releasePromotion()
    await expect(settlement).resolves.toBe(true)
    expect(commits).toEqual([resolve('/projects/a.oks'), resolve('/projects/b.oks')])
  })

  it('allows only the newest concurrent selection and rejects stale settlements', async () => {
    const ownerId = 45
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('older', 'newer'),
    })
    const older = opens.beginOpen(ownerId)
    expect(opens.stageOpen(ownerId, older, '/projects/older.oks', project('Older'))).not.toBeNull()
    const newer = opens.beginOpen(ownerId)

    expect(opens.hasPending(ownerId)).toBe(false)
    expect(await opens.settleOpen(ownerId, older, true)).toBe(false)
    expect(opens.stageOpen(ownerId, older, '/projects/older.oks', project('Older'))).toBeNull()
    expect(opens.stageOpen(ownerId, newer, '/projects/newer.oks', project('Newer'))).not.toBeNull()
    expect(await opens.settleOpen(ownerId, newer, true)).toBe(true)
    expect(await opens.settleOpen(ownerId, newer, false)).toBe(false)
    expect(opens.canWrite(ownerId, '/projects/newer.oks')).toBe(true)
  })

  it('preserves A and cancels B when the prepared scope cannot commit', async () => {
    const ownerId = 46
    let failure: 'none' | 'false' | 'throw' = 'none'
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'false-b', 'throw-b'),
      prepareScope: (_ownerId: number, scope: { path: string }) => ({ path: scope.path }),
      commitScope: () => {
        if (failure === 'false') return false
        if (failure === 'throw') throw new Error('injected commit failure')
        return true
      },
    })
    const pathA = '/projects/a.oks'
    await accept(opens, ownerId, 'open-a', pathA, project('A'))
    const writeForA = opens.captureWriteGrant(ownerId)

    failure = 'false'
    const falseB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, falseB, '/projects/false-b.oks', project('B'))
    expect(await opens.settleOpen(ownerId, falseB, true)).toBe(false)
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.writeGrantIsCurrent(ownerId, writeForA)).toBe(true)

    failure = 'throw'
    const throwB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, throwB, '/projects/throw-b.oks', project('B'))
    await expect(opens.settleOpen(ownerId, throwB, true)).rejects.toThrow('injected commit failure')
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.writeGrantIsCurrent(ownerId, writeForA)).toBe(true)
  })

  it('makes reset failure-atomic, then clears pending, writes, and media scope on success', async () => {
    const ownerId = 47
    let allowReset = false
    let mediaGeneration = 0
    let activeToken: string | null = 'audio-a'
    let restorationPath: string | null = '/projects/a.oks'
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'pending-b'),
      resetScope: () => {
        if (!allowReset) return false
        mediaGeneration += 1
        activeToken = null
        restorationPath = null
        return true
      },
    })
    const pathA = '/projects/a.oks'
    await accept(opens, ownerId, 'open-a', pathA, project('A'))
    const staleWrite = opens.captureWriteGrant(ownerId)
    const staleAudioGeneration = mediaGeneration
    const pendingB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, pendingB, '/projects/b.oks', project('B'))

    expect(await opens.resetProjectScope(ownerId)).toBe(false)
    expect(opens.hasPending(ownerId)).toBe(true)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(activeToken).toBe('audio-a')
    expect(restorationPath).toBe(pathA)

    allowReset = true
    expect(await opens.resetProjectScope(ownerId)).toBe(true)
    expect(opens.hasPending(ownerId)).toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(false)
    expect(opens.writeGrantIsCurrent(ownerId, staleWrite)).toBe(false)
    expect(mediaGeneration).toBeGreaterThan(staleAudioGeneration)
    expect(activeToken).toBeNull()
    expect(restorationPath).toBeNull()
    expect(await opens.settleOpen(ownerId, pendingB, true)).toBe(false)
  })

  it('invalidates a pending A audio request when B replaces the media scope', async () => {
    const ownerId = 48
    let mediaGeneration = 0
    let activeToken: string | null = 'active-a'
    let restorationPath: string | null = null
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'open-b'),
      prepareScope: (_ownerId: number, scope: { path: string }) => ({
        projectPath: scope.path,
      }),
      commitScope: (_ownerId: number, scope: { projectPath: string }) => {
        mediaGeneration += 1
        activeToken = null
        restorationPath = scope.projectPath
        return true
      },
    })
    await accept(opens, ownerId, 'open-a', '/projects/a.oks', project('A', 'a.mp3'))
    const audioRequestGeneration = mediaGeneration

    await accept(opens, ownerId, 'open-b', '/projects/b.oks', project('B', 'b.mp3'))
    const staleAudioCanRegister = audioRequestGeneration === mediaGeneration

    expect(staleAudioCanRegister).toBe(false)
    expect(activeToken).toBeNull()
    expect(restorationPath).toBe(resolve('/projects/b.oks'))
  })

  it('rejects invalid settlement data without mutating the active scope', async () => {
    const ownerId = 49
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'pending-b'),
    })
    const pathA = '/projects/a.oks'
    await accept(opens, ownerId, 'open-a', pathA, project('A'))
    const pendingB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, pendingB, '/projects/b.oks', project('B'))

    await expect(opens.settleOpen(ownerId, pendingB, 'yes')).rejects.toThrow(
      'accepted must be a boolean',
    )
    await expect(opens.settleOpen(ownerId, '', false)).rejects.toThrow(
      'requestId must be a non-empty string',
    )
    expect(opens.hasPending(ownerId)).toBe(true)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
  })
})

describe('project write promotion authority', () => {
  it('rejects B when an acquired A promotion changes its staged file before settlement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-open-reread-'))
    temporaryDirectories.push(directory)
    const ownerId = 53
    const pathA = join(directory, 'a.oks')
    const pathB = join(directory, 'b.oks')
    const missingPath = join(directory, 'missing.oks')
    const contentsA = project('Project A')
    const contentsB = project('Staged Project B')
    const promotedA = project('Project A Save As')
    await writeFile(pathA, contentsA, 'utf8')
    await writeFile(pathB, contentsB, 'utf8')
    const commits: string[] = []
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'open-b', 'missing-c'),
      prepareScope: (_ownerId: number, scope: { path: string }) => scope.path,
      validateScope: async (_ownerId: number, scope: { path: string; contents: string }) => {
        try {
          return (await readFile(scope.path, 'utf8')) === scope.contents
        } catch {
          return false
        }
      },
      commitScope: (_ownerId: number, projectPath: string) => {
        commits.push(projectPath)
        return true
      },
    })
    await accept(opens, ownerId, 'open-a', pathA, contentsA)
    const saveAsA = opens.captureWriteGrant(ownerId)
    const releasePromotion = await opens.acquireWritePromotion(ownerId, saveAsA)
    expect(releasePromotion).toBeTypeOf('function')

    const requestB = opens.beginOpen(ownerId)
    const stagedB = await readFile(pathB, 'utf8')
    opens.stageOpen(ownerId, requestB, pathB, stagedB)
    let settlementFinished = false
    const settlement = opens.settleOpen(ownerId, requestB, true).then((result: boolean) => {
      settlementFinished = true
      return result
    })
    await Promise.resolve()
    expect(settlementFinished).toBe(false)

    await writeFile(pathB, promotedA, 'utf8')
    releasePromotion()
    await expect(settlement).resolves.toBe(false)
    expect(await readFile(pathB, 'utf8')).toBe(promotedA)
    expect(commits).toEqual([resolve(pathA)])
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.canWrite(ownerId, pathB)).toBe(false)
    expect(opens.writeGrantIsCurrent(ownerId, saveAsA)).toBe(true)

    expect(opens.grantWrite(ownerId, pathB, saveAsA)).toBe(true)
    const missingRequest = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, missingRequest, missingPath, project('Missing C'))
    await expect(opens.settleOpen(ownerId, missingRequest, true)).resolves.toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.canWrite(ownerId, pathB)).toBe(true)
    expect(opens.canWrite(ownerId, missingPath)).toBe(false)
    expect(commits).toEqual([resolve(pathA)])
  })

  it('rejects an oversized staged-file reread without replacing A', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-open-oversized-reread-'))
    temporaryDirectories.push(directory)
    const ownerId = 54
    const pathA = join(directory, 'a.oks')
    const pathB = join(directory, 'b.oks')
    const contentsA = project('Project A')
    const contentsB = project('Staged Project B')
    const maxBytes = Math.max(Buffer.byteLength(contentsA), Buffer.byteLength(contentsB)) + 16
    await writeFile(pathA, contentsA, 'utf8')
    await writeFile(pathB, contentsB, 'utf8')
    let validationError: unknown = null
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'oversized-b'),
      validateScope: async (_ownerId: number, scope: { path: string; contents: string }) => {
        try {
          return (
            (await readUtf8FileWithinLimit(scope.path, maxBytes, 'Project file')) === scope.contents
          )
        } catch (error) {
          validationError = error
          return false
        }
      },
    })
    await accept(opens, ownerId, 'open-a', pathA, contentsA)
    const writeForA = opens.captureWriteGrant(ownerId)

    const requestB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, requestB, pathB, contentsB)
    await writeFile(pathB, `${contentsB}${' '.repeat(maxBytes)}`, 'utf8')

    await expect(opens.settleOpen(ownerId, requestB, true)).resolves.toBe(false)
    expect(validationError).toBeInstanceOf(RangeError)
    expect((validationError as Error).message).toContain('Project file exceeds')
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.canWrite(ownerId, pathB)).toBe(false)
    expect(opens.writeGrantIsCurrent(ownerId, writeForA)).toBe(true)
  })

  it('releases the owner mutex after validateScope throws', async () => {
    const ownerId = 55
    const pathA = '/projects/a.oks'
    const pathB = '/projects/throwing-b.oks'
    const pathC = '/projects/c.oks'
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'throwing-b', 'open-c'),
      validateScope: (_ownerId: number, scope: { path: string }) => {
        if (scope.path === resolve(pathB)) throw new Error('injected validation failure')
        return true
      },
    })
    await accept(opens, ownerId, 'open-a', pathA, project('A'))

    const requestB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, requestB, pathB, project('B'))
    await expect(opens.settleOpen(ownerId, requestB, true)).resolves.toBe(false)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)

    await accept(opens, ownerId, 'open-c', pathC, project('C'))
    expect(opens.canWrite(ownerId, pathA)).toBe(false)
    expect(opens.canWrite(ownerId, pathC)).toBe(true)
  })

  it('does not let a late A Save As overwrite B after B is accepted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-open-handshake-'))
    temporaryDirectories.push(directory)
    const ownerId = 50
    const pathA = join(directory, 'a.oks')
    const pathB = join(directory, 'b.oks')
    const contentsA = project('Project A')
    const contentsB = project('Project B')
    await writeFile(pathB, contentsB, 'utf8')
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'open-b'),
    })
    await accept(opens, ownerId, 'open-a', pathA, contentsA)
    const saveAsA = opens.captureWriteGrant(ownerId)

    const lateWrite = queueProjectWrite(pathB, contentsA, () =>
      opens.acquireWritePromotion(ownerId, saveAsA),
    )
    await accept(opens, ownerId, 'open-b', pathB, contentsB)

    await expect(lateWrite).resolves.toBeUndefined()
    expect(opens.writeGrantIsCurrent(ownerId, saveAsA)).toBe(false)
    expect(opens.grantWrite(ownerId, pathB, saveAsA)).toBe(false)
    expect(await readFile(pathB, 'utf8')).toBe(contentsB)
    expect(opens.canWrite(ownerId, pathA)).toBe(false)
    expect(opens.canWrite(ownerId, pathB)).toBe(true)
  })

  it('lets an A write promote and grant while B is only staged or declined', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-open-decline-'))
    temporaryDirectories.push(directory)
    const ownerId = 51
    const pathA = join(directory, 'a.oks')
    const saveAsPath = join(directory, 'a-save-as.oks')
    const opens = createProjectOpenCoordinator({
      createRequestId: requestIds('open-a', 'open-b'),
    })
    await accept(opens, ownerId, 'open-a', pathA, project('A'))
    const saveAsA = opens.captureWriteGrant(ownerId)
    const requestB = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, requestB, join(directory, 'b.oks'), project('B'))

    await expect(
      queueProjectWrite(saveAsPath, project('A saved while B staged'), () =>
        opens.acquireWritePromotion(ownerId, saveAsA),
      ),
    ).resolves.toBeUndefined()
    expect(opens.writeGrantIsCurrent(ownerId, saveAsA)).toBe(true)
    expect(opens.grantWrite(ownerId, saveAsPath, saveAsA)).toBe(true)
    expect(await opens.settleOpen(ownerId, requestB, false)).toBe(true)
    expect(opens.canWrite(ownerId, pathA)).toBe(true)
    expect(opens.canWrite(ownerId, saveAsPath)).toBe(true)
  })
})
