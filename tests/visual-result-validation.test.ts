import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const results = require('../scripts/visual-result-validation.cjs')
const { publishArtifactBuffers } = require('../electron/smoke-artifacts.cjs')
const roots: string[] = []

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  ),
)

async function freshResult() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-result-'))
  roots.push(root)
  const output = join(root, 'evidence')
  const created = results.createResultArtifacts(validPng(1280, 720))
  await publishArtifactBuffers(output, created.artifacts)
  return { output, root }
}

describe('visual result validation', () => {
  it('accepts only the exact hashed 1280 by 720 baseline contract', async () => {
    const { output } = await freshResult()
    await expect(results.validateVisualResultDirectory(output)).resolves.toMatchObject({
      artifacts: [{ height: 720, name: '01-baseline.png', width: 1280 }],
      ok: true,
      schemaVersion: 1,
    })
  })

  it.each(['hash', 'dimensions'])('rejects a manifest-valid %s mismatch', async (kind) => {
    const { output } = await freshResult()
    const png = kind === 'dimensions' ? validPng(1, 1) : validPng(1280, 720)
    const manifest = {
      artifacts: [
        {
          bytes: png.length,
          height: 720,
          name: '01-baseline.png',
          sha256: kind === 'hash' ? '0'.repeat(64) : createHash('sha256').update(png).digest('hex'),
          width: 1280,
        },
      ],
      ok: true,
      schemaVersion: 1,
    }
    await writeFile(join(output, '01-baseline.png'), png)
    await writeFile(join(output, 'result.json'), results.serializeManifest(manifest))
    await expect(results.validateVisualResultDirectory(output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
  })

  it('rejects extra, symlinked, and nonregular evidence leaves', async () => {
    const extra = await freshResult()
    await writeFile(join(extra.output, 'secret.txt'), 'must not upload')
    await expect(results.validateVisualResultDirectory(extra.output)).rejects.toThrow()

    const linked = await freshResult()
    const displaced = join(linked.root, 'baseline.png')
    await rename(join(linked.output, '01-baseline.png'), displaced)
    await symlink(displaced, join(linked.output, '01-baseline.png'))
    await expect(results.validateVisualResultDirectory(linked.output)).rejects.toThrow()

    const nonregular = await freshResult()
    await rm(join(nonregular.output, '01-baseline.png'))
    await mkdir(join(nonregular.output, '01-baseline.png'))
    await expect(results.validateVisualResultDirectory(nonregular.output)).rejects.toThrow()
  })

  it('rejects a directory identity swap during consumption', async () => {
    const { output, root } = await freshResult()
    await expect(
      results.validateVisualResultDirectory(output, {
        beforeRead: async (_claimed: string, name: string) => {
          if (name !== 'result.json') return
          await rename(output, join(root, 'displaced'))
          await mkdir(output)
        },
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })
})
