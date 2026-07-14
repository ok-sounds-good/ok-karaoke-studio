import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const smokeProfiles = require('../electron/smoke-profile.cjs') as {
  createOwnedSmokeProfile(prefix: string): Promise<{
    path: string
    serializedIdentity: string
  }>
}
const visualSmoke = require('../electron/video-style-visual-smoke.cjs') as {
  SCREENSHOTS: Array<{ file: string; state: string }>
  assertVisualGeometry(snapshot: unknown, state: string): true
  geometryScript(): string
  isolatedVisualSmokeProfile(value: unknown, defaultPath: string, identity: unknown): string
  parsePngIhdr(bytes: Buffer): { width: number; height: number }
  sanitizedFailure(error: unknown, stage: string, started: number): Record<string, unknown>
  validateOutputPath(value: unknown): string
  writeLauncherFailureArtifact(path: string): Promise<string>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

function rectangle(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height }
}

function geometry() {
  return {
    viewport: { width: 1280, height: 720, dpr: 1 },
    overflow: { documentWidth: 1280, documentHeight: 720, bodyWidth: 1280, bodyHeight: 720 },
    rects: {
      styleButton: rectangle(100, 20, 100, 32),
      editor: rectangle(10, 75, 480, 555),
      fontSelector: rectangle(20, 85, 450, 480),
      sample: rectangle(30, 450, 420, 92),
      preview: rectangle(500, 75, 770, 555),
      actions: rectangle(10, 575, 480, 55),
      transport: rectangle(0, 642, 1280, 78),
    },
  }
}

describe('video-style visual smoke evidence', () => {
  it('freezes the ordered visual states and exact PNG viewport', () => {
    expect(visualSmoke.SCREENSHOTS).toEqual([
      { file: '01-default.png', state: 'default' },
      { file: '02-style-background.png', state: 'style-background' },
      { file: '03-font-selector.png', state: 'font-selector' },
    ])
    expect(visualSmoke.parsePngIhdr(validPng(1280, 720))).toEqual({ width: 1280, height: 720 })
    expect(() => visualSmoke.parsePngIhdr(Buffer.from('not a png'))).toThrow('VISUAL_PNG_INVALID')
  })

  it('prefers a visible style-workspace preview and falls back only when absent', () => {
    const script = visualSmoke.geometryScript()
    expect(script).toContain("querySelectorAll('.style-workspace > .preview-panel')")
    expect(script).toContain('stylePreviews.length > 0')
    expect(script).toContain("firstVisible('.workspace-top .preview-panel')")
  })

  it.each(['default', 'style-background', 'font-selector'])(
    'requires visible non-overlapping critical geometry for %s',
    (state) => expect(visualSmoke.assertVisualGeometry(geometry(), state)).toBe(true),
  )

  it('rejects global overflow and editor/preview overlap', () => {
    const overflowing = geometry()
    overflowing.overflow.documentWidth = 1281
    expect(() => visualSmoke.assertVisualGeometry(overflowing, 'default')).toThrow()

    const overlapping = geometry()
    overlapping.rects.preview = rectangle(450, 75, 820, 555)
    expect(() => visualSmoke.assertVisualGeometry(overlapping, 'style-background')).toThrow(
      'VISUAL_GEOMETRY_INVALID',
    )
  })

  it('never places arbitrary error text or private font names in failure metadata', () => {
    const secret = 'CodexSecretTypeface-DoNotLeak'
    const failure = visualSmoke.sanitizedFailure(
      new Error(`Renderer failed while loading ${secret}`),
      'font-selector',
      Date.now(),
    )

    expect(failure).toMatchObject({ code: 'VISUAL_SMOKE_FAILED', stage: 'font-selector' })
    expect(JSON.stringify(failure)).not.toContain(secret)
  })

  it('writes a sanitized launcher artifact only when the child produced none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oks-visual-output-test-'))
    temporaryDirectories.push(root)
    const output = join(root, 'evidence')

    await visualSmoke.writeLauncherFailureArtifact(output)
    const failure = await readFile(join(output, 'failure.json'), 'utf8')
    expect(failure).toContain('VISUAL_SMOKE_FAILED')

    await expect(visualSmoke.writeLauncherFailureArtifact(output)).resolves.toBe(
      'existing-complete',
    )
    expect(await readFile(join(output, 'failure.json'), 'utf8')).toBe(failure)
    expect(() => visualSmoke.validateOutputPath('relative/evidence')).toThrow(
      'VISUAL_OUTPUT_INVALID',
    )
  })

  it('rejects a configured existing output without deleting it or exposing its path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oks-visual-launcher-test-'))
    temporaryDirectories.push(root)
    const output = join(root, 'CodexSecretEvidencePath-DoNotLeak')
    await mkdir(join(output, '.git'), { recursive: true })
    await writeFile(join(output, '.git', 'HEAD'), 'caller branch')

    const launched = spawnSync(process.execPath, [
      resolve('scripts/video-style-visual-smoke.cjs'),
    ], {
      encoding: 'utf8',
      env: { ...process.env, OKS_VISUAL_SMOKE_OUTPUT: output },
    })

    expect(launched.status).toBe(1)
    expect(launched.stdout).toBe('')
    expect(launched.stderr.trim()).toBe(
      '{"code":"VISUAL_SMOKE_OUTPUT_EXISTS","ok":false}',
    )
    expect(launched.stderr).not.toContain(output)
    expect(await readFile(join(output, '.git', 'HEAD'), 'utf8')).toBe('caller branch')
  })

  it('requires the exact owned profile identity isolated from Electron defaults', async () => {
    const defaultProfile = await mkdtemp(join(tmpdir(), 'oks-visual-default-'))
    const profile = await smokeProfiles.createOwnedSmokeProfile('oks-visual-profile-')
    temporaryDirectories.push(defaultProfile, profile.path)

    expect(visualSmoke.isolatedVisualSmokeProfile(
      profile.path,
      defaultProfile,
      profile.serializedIdentity,
    )).toBe(profile.path)
    expect(() => visualSmoke.isolatedVisualSmokeProfile(
      profile.path,
      defaultProfile,
      'invalid-identity',
    )).toThrow(
      'VISUAL_PROFILE_INVALID',
    )
  })
})
