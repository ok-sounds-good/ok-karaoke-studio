import { createRequire } from 'node:module'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createLinkedAssetRegistry, createLinkedImageValidator } = require(
  '../electron/linked-assets.cjs',
) as {
  createLinkedAssetRegistry(extensions: Set<string>): any
  createLinkedImageValidator(decoder: () => boolean): {
    validateLinkedImage(filePath: string): Promise<string>
  }
}
const { createVideoExportBackgroundPreflight } = require(
  '../electron/video-export-background-preflight.cjs',
) as {
  createVideoExportBackgroundPreflight(options: Record<string, unknown>): (
    ownerId: number,
    backgroundPath: string | null,
  ) => Promise<string | null>
}

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'oks-background-preflight-'))
  directories.push(directory)
  const imagePath = join(directory, 'stage.png')
  await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return imagePath
}

describe('video export linked-background preflight', () => {
  it.each(['deleted', 'decoder-invalid replacement'] as const)(
    'revokes a stale Preview URL when its file is %s before the destination dialog',
    async (failure) => {
      const imagePath = await fixture()
      let decodes = true
      const images = createLinkedImageValidator(() => decodes)
      await expect(images.validateLinkedImage(imagePath)).resolves.toBe(imagePath)
      const ownerId = 71
      const registry = createLinkedAssetRegistry(new Set(['.mp3']))
      registry.register(imagePath, ownerId, 'background')
      const notifyInvalidation = vi.fn()
      const preflight = createVideoExportBackgroundPreflight({
        linkedAssets: registry,
        notifyInvalidation,
        validateLinkedImage: images.validateLinkedImage,
      })

      if (failure === 'deleted') await unlink(imagePath)
      else decodes = false

      await expect(preflight(ownerId, imagePath)).rejects.toThrow(
        'Linked image is missing or unreadable',
      )
      expect(registry.activeOwnerPath(ownerId, 'background')).toBeNull()
      expect(notifyInvalidation).toHaveBeenCalledWith(ownerId, {
        kind: 'background',
        path: imagePath,
        message: `Linked image is missing or unreadable: ${imagePath}`,
      })
    },
  )
})
