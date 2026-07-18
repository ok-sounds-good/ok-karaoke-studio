import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

import { createProject } from '../src/lib/model'

const require = createRequire(import.meta.url)
const { createMediaCapabilityRegistry } = require('../electron/media-capabilities.cjs')
const {
  LINKED_IMAGE_EXPORT_ERROR_CODE,
  LINKED_IMAGE_EXPORT_WARNING,
  createVideoExportAuthorizer,
  linkedImageExportFailure,
} = require('../electron/video-export-authorization.cjs')

function ids() {
  let next = 1
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
}

function imageProject(imagePath = '/media/background.png') {
  const project = createProject({ id: 'image-export-project' })
  project.stageStyle.background.mode = 'image'
  project.stageStyle.background.imagePath = imagePath
  return project
}

function retainedImage(registry: any, ownerId: number, imagePath: string, bytes: Buffer) {
  const sequence = registry.beginRequest(ownerId, 'background')
  const token = registry.registerBackgroundCandidate(
    ownerId,
    imagePath,
    { bytes, mime: 'image/png' },
    sequence,
  )
  expect(registry.settleBackgroundCandidate(ownerId, token, true)).toBe(true)
  const state = registry.backgroundState(ownerId)
  return { activeToken: token, revision: state.revision }
}

describe('linked-image video export authorization', () => {
  it('maps only a typed parity error to the exact opaque attempted state', () => {
    const error = Object.assign(new Error('private detail'), {
      code: LINKED_IMAGE_EXPORT_ERROR_CODE,
    })
    const expected = {
      activeToken: '00000000-0000-4000-8000-000000000060',
      revision: '00000000-0000-4000-8000-000000000061',
      valid: true,
    }

    expect(linkedImageExportFailure(error, expected)).toEqual({
      status: 'background-invalid',
      background: {
        activeUrl: 'studio-media://asset/00000000-0000-4000-8000-000000000060',
        revision: expected.revision,
      },
      message: LINKED_IMAGE_EXPORT_WARNING,
    })
    expect(linkedImageExportFailure(new Error('other'), expected)).toBeNull()
    expect(linkedImageExportFailure(error, { ...expected, valid: false })).toBeNull()
  })

  it('returns an isolated immutable active snapshot after current-file parity validation', async () => {
    const registry = createMediaCapabilityRegistry({ createRevision: ids(), createToken: ids() })
    const bytes = Buffer.from([1, 2, 3])
    const expectedBackground = retainedImage(registry, 7, '/media/background.png', bytes)
    const readLinkedImage = vi.fn(async () => ({ bytes: Buffer.from(bytes), format: 'png' }))
    const authorize = createVideoExportAuthorizer({ mediaCapabilities: registry, readLinkedImage })

    const authorization = await authorize({
      ownerId: 7,
      project: imageProject(),
      expectedBackground,
    })

    expect(readLinkedImage).toHaveBeenCalledExactlyOnceWith('/media/background.png')
    expect(authorization.backgroundImage).toMatchObject({ mime: 'image/png' })
    expect(authorization.backgroundImage.bytes).toEqual(bytes)
    authorization.backgroundImage.bytes.fill(9)
    expect(
      registry.backgroundExportSnapshot(
        7,
        expectedBackground.revision,
        expectedBackground.activeToken,
        '/media/background.png',
      ).bytes,
    ).toEqual(bytes)
  })

  it.each([
    [
      'missing',
      async () => {
        throw new Error('ENOENT /private/path')
      },
    ],
    [
      'corrupt',
      async () => {
        throw new Error('decoder detail')
      },
    ],
    ['changed', async () => ({ bytes: Buffer.from([1, 2, 4]), format: 'png' })],
  ])(
    'publishes the same non-sensitive warning when the current file is %s',
    async (_label, read) => {
      const registry = createMediaCapabilityRegistry({ createRevision: ids(), createToken: ids() })
      const expectedBackground = retainedImage(
        registry,
        8,
        '/private/song-art.png',
        Buffer.from([1, 2, 3]),
      )
      const authorize = createVideoExportAuthorizer({
        mediaCapabilities: registry,
        readLinkedImage: read,
      })

      await expect(
        authorize({
          ownerId: 8,
          project: imageProject('/private/song-art.png'),
          expectedBackground,
        }),
      ).rejects.toMatchObject({
        code: LINKED_IMAGE_EXPORT_ERROR_CODE,
        message: LINKED_IMAGE_EXPORT_WARNING,
      })
    },
  )

  it('rejects wrong owner, path, revision, token, and a capability rotated during validation', async () => {
    const attempts = ['owner', 'path', 'revision', 'token'] as const
    for (const attempt of attempts) {
      const registry = createMediaCapabilityRegistry({ createRevision: ids(), createToken: ids() })
      const expected = retainedImage(registry, 9, '/media/current.png', Buffer.from([4, 5, 6]))
      const authorize = createVideoExportAuthorizer({
        mediaCapabilities: registry,
        readLinkedImage: vi.fn(async () => ({ bytes: Buffer.from([4, 5, 6]), format: 'png' })),
      })
      const ownerId = attempt === 'owner' ? 10 : 9
      const project = imageProject(attempt === 'path' ? '/media/other.png' : '/media/current.png')
      const expectedBackground = {
        activeToken:
          attempt === 'token' ? '00000000-0000-4000-8000-000000000999' : expected.activeToken,
        revision:
          attempt === 'revision' ? '00000000-0000-4000-8000-000000000998' : expected.revision,
      }
      await expect(authorize({ ownerId, project, expectedBackground })).rejects.toThrow(
        LINKED_IMAGE_EXPORT_WARNING,
      )
    }

    const registry = createMediaCapabilityRegistry({ createRevision: ids(), createToken: ids() })
    const expectedBackground = retainedImage(
      registry,
      11,
      '/media/current.png',
      Buffer.from([7, 8, 9]),
    )
    const authorize = createVideoExportAuthorizer({
      mediaCapabilities: registry,
      readLinkedImage: vi.fn(async () => {
        registry.resetKind(11, 'background')
        return { bytes: Buffer.from([7, 8, 9]), format: 'png' }
      }),
    })
    await expect(
      authorize({ ownerId: 11, project: imageProject('/media/current.png'), expectedBackground }),
    ).rejects.toThrow(LINKED_IMAGE_EXPORT_WARNING)
  })

  it('reports cancellation instead of a parity warning when aborted during current-file read', async () => {
    const registry = createMediaCapabilityRegistry({ createRevision: ids(), createToken: ids() })
    const expectedBackground = retainedImage(
      registry,
      12,
      '/media/cancel.png',
      Buffer.from([1, 2, 3]),
    )
    const controller = new AbortController()
    const authorize = createVideoExportAuthorizer({
      mediaCapabilities: registry,
      readLinkedImage: vi.fn(async () => {
        controller.abort()
        return { bytes: Buffer.from([1, 2, 3]), format: 'png' }
      }),
    })

    await expect(
      authorize({
        ownerId: 12,
        project: imageProject('/media/cancel.png'),
        expectedBackground,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
