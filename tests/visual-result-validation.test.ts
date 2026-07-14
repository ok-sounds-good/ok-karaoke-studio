import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const validator = require('../scripts/visual-result-validation.cjs') as {
  SCREENSHOT_FILES: string[]
  validateVisualSmokeResult(output: string): Promise<Record<string, unknown>>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function evidenceDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-result-'))
  temporaryDirectories.push(root)
  const output = join(root, 'evidence')
  await mkdir(output)
  const png = validPng(1280, 720)
  const captures = []
  for (const file of validator.SCREENSHOT_FILES) {
    await writeFile(join(output, file), png)
    captures.push({
      durationMs: 10,
      file,
      sha256: createHash('sha256').update(png).digest('hex'),
    })
  }
  const result = {
    captures,
    durationMs: 50,
    font: {
      catalogNonEmpty: true,
      localFontLoaded: true,
      publicCaptureBoundary: true,
      restoredSystem: true,
    },
    ok: true,
    order: [...validator.SCREENSHOT_FILES],
    viewport: { dpr: 1, height: 720, width: 1280 },
  }
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result)}\n`)
  return { output, png, result }
}

describe('visual result manifest validation', () => {
  it('accepts only the complete ordered screenshot set with matching hashes', async () => {
    const { output } = await evidenceDirectory()
    await expect(validator.validateVisualSmokeResult(output)).resolves.toMatchObject({ ok: true })
  })

  it('rejects a zero-exit-style partial manifest', async () => {
    const { output, result } = await evidenceDirectory()
    await rm(join(output, '02-style-background.png'))
    await writeFile(join(output, 'result.json'), `${JSON.stringify(result)}\n`)
    await expect(validator.validateVisualSmokeResult(output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
  })

  it('rejects foreign files and hash mismatches', async () => {
    const foreign = await evidenceDirectory()
    await writeFile(join(foreign.output, 'private-catalog.txt'), 'do not publish')
    await expect(validator.validateVisualSmokeResult(foreign.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )

    const mismatch = await evidenceDirectory()
    await writeFile(join(mismatch.output, '01-default.png'), mismatch.png.subarray(0, -1))
    await expect(validator.validateVisualSmokeResult(mismatch.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
  })

  it('rejects wrong dimensions, malformed PNGs, and symlink entries', async () => {
    const dimensions = await evidenceDirectory()
    await writeFile(join(dimensions.output, '01-default.png'), validPng(1279, 720))
    await expect(validator.validateVisualSmokeResult(dimensions.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )

    const malformed = await evidenceDirectory()
    await writeFile(join(malformed.output, '01-default.png'), Buffer.from('not a png'))
    await expect(validator.validateVisualSmokeResult(malformed.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )

    const linked = await evidenceDirectory()
    const target = join(linked.output, 'target.png')
    await writeFile(target, linked.png)
    await rm(join(linked.output, '01-default.png'))
    await symlink(target, join(linked.output, '01-default.png'))
    await expect(validator.validateVisualSmokeResult(linked.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
  })
})
