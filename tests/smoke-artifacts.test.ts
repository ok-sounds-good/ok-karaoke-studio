import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, sep, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const artifacts = require('../electron/smoke-artifacts.cjs') as {
  ARTIFACT_LIMITS: {
    maxArtifactBytes: number
    maxArtifacts: number
    maxNameLength: number
    maxTotalBytes: number
  }
  normalizeArtifactBuffers(values: Artifact[]): Artifact[]
  normalizeLauncherFailure(value: unknown): { code: string; ok: false }
  outputState(path: string): Promise<{ output: string; state: string }>
  inspectOutputDirectory(
    path: string,
    fsApi?: Record<string, unknown>,
    platform?: string,
  ): Promise<unknown>
  publishArtifactBuffers(
    output: string,
    values: Artifact[],
    options?: Record<string, unknown>,
  ): Promise<string>
  validateFreshOutputPath(path: unknown, pathApi?: typeof win32): string
  writeFreshLauncherFailure(
    output: string,
    value: unknown,
    options?: Record<string, unknown>,
  ): Promise<string>
}
const visualResults = require('../scripts/visual-result-validation.cjs') as {
  STYLE_SESSION_NAMES: readonly string[]
  createResultArtifacts(png: Buffer): { artifacts: Artifact[] }
  validateVisualResultDirectory(path: string): Promise<unknown>
}

interface Artifact {
  bytes: Buffer
  name: string
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'oks-smoke-artifacts-'))
  temporaryDirectories.push(root)
  return root
}

function resultArtifacts(): Artifact[] {
  return [
    { bytes: Buffer.from('png bytes'), name: '01-default.png' },
    { bytes: Buffer.from('{"ok":true}\n'), name: 'result.json' },
  ]
}

function validatedResultArtifacts(): Artifact[] {
  return visualResults.createResultArtifacts(validPng(1280, 720)).artifacts
}

describe('smoke artifact ownership and publication', () => {
  it('claims a fresh leaf, snapshots buffers, and publishes the marker last', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const values = resultArtifacts()
    const order: string[] = []
    let privateMarker = ''

    await expect(
      artifacts.publishArtifactBuffers(output, values, {
        beforeMarkerCleanup: async (claimed: string, tempName: string, marker: string) => {
          privateMarker = join(claimed, tempName)
          const temporary = await lstat(privateMarker, { bigint: true })
          const published = await lstat(join(claimed, marker), { bigint: true })
          expect({ dev: temporary.dev, ino: temporary.ino }).toEqual({
            dev: published.dev,
            ino: published.ino,
          })
        },
        beforeWrite: async (_claimed: string, name: string) => {
          order.push(name)
          if (name === '01-default.png') values[0].bytes.fill(120)
          if (name === 'result.json') {
            expect(await readFile(join(output, '01-default.png'), 'utf8')).toBe('png bytes')
          }
        },
      }),
    ).resolves.toBe(output)

    expect(order).toEqual(['01-default.png', 'result.json'])
    await expect(lstat(privateMarker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await artifacts.outputState(output)).toEqual({ output, state: 'marker-present' })
  })

  it('keeps the completion marker private until its closed bytes are published', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    let releaseWrite = () => undefined
    let reportPrivate = (_value: { tempName: string; marker: string }) => undefined
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const privateReady = new Promise<{ tempName: string; marker: string }>((resolve) => {
      reportPrivate = resolve
    })
    const publishing = artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeMarkerWrite: async (_claimed: string, tempName: string, marker: string) => {
        reportPrivate({ marker, tempName })
        await writeReleased
      },
    })

    const { marker, tempName } = await privateReady
    expect((await lstat(join(output, tempName))).isFile()).toBe(true)
    await expect(lstat(join(output, marker))).rejects.toMatchObject({ code: 'ENOENT' })
    releaseWrite()
    await expect(publishing).resolves.toBe(output)
    await expect(lstat(join(output, tempName))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects existing files, directories, and symlinks without changing them', async () => {
    const root = await temporaryRoot()
    const file = join(root, 'file')
    await writeFile(file, 'caller sentinel')
    await expect(artifacts.publishArtifactBuffers(file, resultArtifacts())).rejects.toThrow(
      'VISUAL_OUTPUT_EXISTS',
    )
    expect(await readFile(file, 'utf8')).toBe('caller sentinel')

    const directory = join(root, 'directory')
    await mkdir(directory)
    await writeFile(join(directory, 'sentinel'), 'caller directory')
    await expect(artifacts.publishArtifactBuffers(directory, resultArtifacts())).rejects.toThrow(
      'VISUAL_OUTPUT_EXISTS',
    )
    expect(await readFile(join(directory, 'sentinel'), 'utf8')).toBe('caller directory')

    const target = join(root, 'target')
    const linked = join(root, 'linked')
    await mkdir(target)
    await writeFile(join(target, 'sentinel'), 'caller target')
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(artifacts.publishArtifactBuffers(linked, resultArtifacts())).rejects.toThrow(
      'VISUAL_OUTPUT_EXISTS',
    )
    expect(await readFile(join(target, 'sentinel'), 'utf8')).toBe('caller target')
  })

  it('uses POSIX modes only on POSIX and accepts normal Windows stat semantics', async () => {
    const root = await temporaryRoot()
    await chmod(root, 0o755)
    await expect(artifacts.inspectOutputDirectory(root, undefined, 'linux')).rejects.toThrow(
      'VISUAL_OUTPUT_RACE',
    )
    await expect(artifacts.inspectOutputDirectory(root, undefined, 'win32')).resolves.toBeDefined()
  })

  it('loses claim, directory-swap, and exclusive-file races without overwriting', async () => {
    const root = await temporaryRoot()
    const claimedByOther = join(root, 'other-claim')
    await expect(
      artifacts.publishArtifactBuffers(claimedByOther, resultArtifacts(), {
        beforeClaim: async () => {
          await mkdir(claimedByOther)
          await writeFile(join(claimedByOther, 'winner'), 'preserve winner')
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_EXISTS')
    expect(await readFile(join(claimedByOther, 'winner'), 'utf8')).toBe('preserve winner')

    const swapped = join(root, 'swapped')
    const displaced = join(root, 'displaced')
    await expect(
      artifacts.publishArtifactBuffers(swapped, resultArtifacts(), {
        beforeWrite: async () => {
          await rename(swapped, displaced)
          await mkdir(swapped)
          await writeFile(join(swapped, 'racer'), 'preserve racer')
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(join(swapped, 'racer'), 'utf8')).toBe('preserve racer')

    const fileRace = join(root, 'file-race')
    await expect(
      artifacts.publishArtifactBuffers(fileRace, resultArtifacts(), {
        beforeWrite: async (output: string, name: string) => {
          if (name === '01-default.png') await mkdir(join(output, name))
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect((await lstat(join(fileRace, '01-default.png'))).isDirectory()).toBe(true)
  })

  it('detects a regular artifact swapped after its exclusive handle closes', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const displaced = join(root, 'displaced-file')

    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts(), {
        afterWrite: async (claimed: string, name: string) => {
          if (name !== '01-default.png') return
          await rename(join(claimed, name), displaced)
          await mkdir(join(claimed, name))
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(displaced, 'utf8')).toBe('png bytes')
    expect((await lstat(join(output, '01-default.png'))).isDirectory()).toBe(true)
  })

  it('fails closed when the claimed destination parent is replaced during publication', async () => {
    const root = await temporaryRoot()
    const parent = join(root, 'parent')
    const displaced = join(root, 'displaced-parent')
    await mkdir(parent)
    const output = join(parent, 'evidence')
    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts(), {
        beforeWrite: async () => {
          await rename(parent, displaced)
          await mkdir(parent)
          await mkdir(join(parent, 'evidence'))
          await writeFile(join(parent, 'evidence', 'racer'), 'retain replacement')
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(join(parent, 'evidence', 'racer'), 'utf8')).toBe('retain replacement')
  })

  it('rejects a late hard link to an ordinary artifact before it can publish completion', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts(), {
        afterWrite: async (claimed: string, name: string) => {
          if (name === '01-default.png') {
            await link(join(claimed, name), join(claimed, 'late-link'))
          }
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    await expect(lstat(join(output, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an unexpected entry before completion publication', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts(), {
        afterWrite: async (claimed: string, name: string) => {
          if (name === '01-default.png') await writeFile(join(claimed, 'unexpected'), 'retain')
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    await expect(lstat(join(output, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses exactly two links only while atomically publishing the marker, then restores one', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    let sawTwoLinks = false
    await artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeMarkerCleanup: async (claimed: string, tempName: string, marker: string) => {
        expect((await lstat(join(claimed, tempName), { bigint: true })).nlink).toBe(2n)
        expect((await lstat(join(claimed, marker), { bigint: true })).nlink).toBe(2n)
        sawTwoLinks = true
      },
    })
    expect(sawTwoLinks).toBe(true)
    expect((await lstat(join(output, 'result.json'), { bigint: true })).nlink).toBe(1n)
  })

  it.each(['after-link', 'temporary-unlink', 'final-verification'])(
    'rolls back an owned public marker after %s failure',
    async (phase) => {
      const root = await temporaryRoot()
      const output = join(root, 'evidence')
      const options: Record<string, unknown> = {}
      if (phase === 'after-link') {
        options.afterWrite = async (_claimed: string, name: string) => {
          if (name === 'result.json') throw new Error('after-link')
        }
      }
      if (phase === 'temporary-unlink') {
        options.fsApi = {
          ...fs,
          unlink: async (filePath: string) => {
            if (filePath.includes('.oks-marker-')) throw new Error('temporary-unlink')
            return fs.unlink(filePath)
          },
        }
      }
      if (phase === 'final-verification') {
        options.beforeFinalVerification = async () => {
          throw new Error('final-verification')
        }
      }

      await expect(
        artifacts.publishArtifactBuffers(output, validatedResultArtifacts(), options),
      ).rejects.toBeDefined()
      await expect(lstat(join(output, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(visualResults.validateVisualResultDirectory(output)).rejects.toBeDefined()
    },
  )

  it('keeps a private marker when metadata fails immediately before the final transition', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const values = validatedResultArtifacts()
    await expect(
      artifacts.publishArtifactBuffers(output, values, {
        beforeFinalVerification: async () => {
          await chmod(join(output, values[0].name), 0o640)
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    await expect(visualResults.validateVisualResultDirectory(output)).rejects.toBeDefined()
  })

  it('retains a racer-owned result marker and displaced owned evidence after post-link replacement', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const values = validatedResultArtifacts()
    const marker = values.at(-1)
    if (!marker) throw new Error('missing marker fixture')
    const displaced = join(root, 'displaced-marker')

    await expect(
      artifacts.publishArtifactBuffers(output, values, {
        afterWrite: async (claimed: string, name: string) => {
          if (name !== marker.name) return
          await rename(join(claimed, name), displaced)
          await writeFile(join(claimed, name), marker.bytes, { mode: 0o600 })
          throw new Error('force rejection after replacement')
        },
      }),
    ).rejects.toBeDefined()
    expect(await readFile(join(output, marker.name))).toEqual(marker.bytes)
    expect(await readFile(displaced)).toEqual(marker.bytes)
    expect((await lstat(join(output, marker.name), { bigint: true })).ino).not.toBe(
      (await lstat(displaced, { bigint: true })).ino,
    )
    await expect(visualResults.validateVisualResultDirectory(output)).rejects.toBeDefined()
  })

  it('never replaces a completion marker raced in before hard-link publication', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts(), {
        beforeMarkerPublish: async (claimed: string, _tempName: string, marker: string) => {
          await writeFile(join(claimed, marker), 'racer marker')
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(join(output, 'result.json'), 'utf8')).toBe('racer marker')
    expect((await readdir(output)).some((name) => name.startsWith('.oks-marker-'))).toBe(true)
  })

  it('retains a replacement temp leaf instead of deleting an unowned cleanup race', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const displaced = join(root, 'owned-private-marker')
    let racedTemp = ''
    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts(), {
        beforeMarkerCleanup: async (claimed: string, tempName: string) => {
          racedTemp = join(claimed, tempName)
          await rename(racedTemp, displaced)
          await writeFile(racedTemp, 'racer-owned bytes')
        },
      }),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(racedTemp, 'utf8')).toBe('racer-owned bytes')
    expect(await readFile(displaced, 'utf8')).toBe('{"ok":true}\n')
    expect(await readFile(join(output, 'result.json'), 'utf8')).toBe('{"ok":true}\n')
  })

  it('rejects traversal, ambiguous basenames, duplicates, and invalid marker layouts', () => {
    const marker = { bytes: Buffer.from('{}'), name: 'result.json' }
    for (const name of [
      '../private',
      'nested/private',
      'nested\\private',
      '.hidden',
      'name.',
      'con.png',
      'A.png',
      'a'.repeat(artifacts.ARTIFACT_LIMITS.maxNameLength + 1),
    ]) {
      expect(() =>
        artifacts.normalizeArtifactBuffers([{ bytes: Buffer.from('x'), name }, marker]),
      ).toThrow('VISUAL_ARTIFACTS_INVALID')
    }
    for (const values of [
      [marker, { bytes: Buffer.from('png'), name: '01.png' }],
      [marker, { bytes: Buffer.from('{}'), name: 'failure.json' }],
      [
        { bytes: Buffer.from('a'), name: '01.png' },
        { bytes: Buffer.from('b'), name: '01.png' },
        marker,
      ],
    ])
      expect(() => artifacts.normalizeArtifactBuffers(values)).toThrow('VISUAL_ARTIFACTS_INVALID')
  })

  it('enforces inclusive count, per-artifact, and aggregate byte limits', () => {
    const { maxArtifactBytes, maxArtifacts, maxTotalBytes } = artifacts.ARTIFACT_LIMITS
    expect(maxArtifacts).toBe(18)
    expect(visualResults.STYLE_SESSION_NAMES.length + 1).toBe(maxArtifacts)
    const marker = { bytes: Buffer.from('x'), name: 'result.json' }
    const atCount = Array.from({ length: maxArtifacts - 1 }, (_, index) => ({
      bytes: Buffer.from('x'),
      name: `${index}.png`,
    }))
    expect(artifacts.normalizeArtifactBuffers([...atCount, marker])).toHaveLength(maxArtifacts)
    expect(() =>
      artifacts.normalizeArtifactBuffers([
        ...atCount,
        { bytes: Buffer.from('x'), name: 'overflow.png' },
        marker,
      ]),
    ).toThrow('VISUAL_ARTIFACTS_INVALID')

    const full = Buffer.alloc(maxArtifactBytes)
    const exactTotal = [0, 1, 2].map((index) => ({ bytes: full, name: `${index}-full.png` }))
    exactTotal.push({ bytes: full.subarray(0, maxArtifactBytes - 1), name: '3-full.png' })
    expect(maxTotalBytes).toBe(maxArtifactBytes * 4)
    expect(artifacts.normalizeArtifactBuffers([...exactTotal, marker])).toHaveLength(5)
    expect(() =>
      artifacts.normalizeArtifactBuffers([
        ...exactTotal.slice(0, 3),
        { bytes: full, name: '3-full.png' },
        marker,
      ]),
    ).toThrow('VISUAL_ARTIFACTS_INVALID')
    expect(() =>
      artifacts.normalizeArtifactBuffers([
        { bytes: Buffer.alloc(maxArtifactBytes + 1), name: 'large.png' },
        marker,
      ]),
    ).toThrow('VISUAL_ARTIFACTS_INVALID')
  })

  it('publishes only the fixed launcher-failure schema and never raw errors', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'failure')
    const failure = { code: 'VISUAL_SMOKE_FAILED', ok: false }

    await expect(artifacts.writeFreshLauncherFailure(output, failure)).resolves.toBe('created')
    expect(await readFile(join(output, 'failure.json'), 'utf8')).toBe(
      '{"code":"VISUAL_SMOKE_FAILED","ok":false}\n',
    )
    await expect(artifacts.writeFreshLauncherFailure(output, failure)).rejects.toThrow(
      'VISUAL_OUTPUT_EXISTS',
    )

    const rejected = join(root, 'rejected')
    const secret = 'private-path-do-not-publish'
    for (const value of [
      new Error(secret),
      { code: 'VISUAL_SMOKE_FAILED', detail: secret, ok: false },
      { code: secret, ok: false },
      Object.defineProperties(
        {},
        {
          code: { enumerable: true, get: () => 'VISUAL_SMOKE_FAILED' },
          ok: { enumerable: true, value: false },
        },
      ),
      'VISUAL_SMOKE_FAILED',
    ]) {
      expect(() => artifacts.normalizeLauncherFailure(value)).toThrow('VISUAL_FAILURE_INVALID')
      await expect(artifacts.writeFreshLauncherFailure(rejected, value)).rejects.toThrow(
        'VISUAL_FAILURE_INVALID',
      )
    }
    await expect(lstat(rejected)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(() =>
      artifacts.normalizeLauncherFailure({ code: 'NATIVE_SYNC_TRACE_START_FAILED', ok: false }),
    ).toThrow('VISUAL_FAILURE_INVALID')
  })

  it('claims the failure parent before checking output absence', async () => {
    const root = await temporaryRoot()
    const parent = join(root, 'parent')
    const displaced = join(root, 'displaced')
    await mkdir(parent)
    const output = join(parent, 'failure')
    await expect(
      artifacts.writeFreshLauncherFailure(
        output,
        { code: 'VISUAL_SMOKE_FAILED', ok: false },
        {
          beforeClaim: async () => {
            await rename(parent, displaced)
            await mkdir(parent)
          },
        },
      ),
    ).rejects.toThrow('VISUAL_OUTPUT_RACE')
    await expect(lstat(join(parent, 'failure'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects every existing failure output without trusting or changing markers', async () => {
    const root = await temporaryRoot()
    const oversized = Buffer.alloc(artifacts.ARTIFACT_LIMITS.maxArtifactBytes + 1, 120)
    const cases: Array<[string, Array<[string, Buffer]>]> = [
      ['empty-directory', []],
      ['empty-marker', [['failure.json', Buffer.alloc(0)]]],
      ['malformed-marker', [['failure.json', Buffer.from('{')]]],
      ['oversized-marker', [['failure.json', oversized]]],
      [
        'dual-markers',
        [
          ['failure.json', Buffer.from('{}')],
          ['result.json', Buffer.from('{}')],
        ],
      ],
      [
        'extra-field',
        [
          [
            'failure.json',
            Buffer.from('{"code":"VISUAL_SMOKE_FAILED","detail":"private","ok":false}\n'),
          ],
        ],
      ],
      [
        'valid-looking',
        [['failure.json', Buffer.from('{"code":"VISUAL_SMOKE_FAILED","ok":false}\n')]],
      ],
    ]

    for (const [name, files] of cases) {
      const output = join(root, name)
      await mkdir(output)
      for (const [file, bytes] of files) await writeFile(join(output, file), bytes)
      await expect(
        artifacts.writeFreshLauncherFailure(output, {
          code: 'VISUAL_SMOKE_FAILED',
          ok: false,
        }),
      ).rejects.toThrow('VISUAL_OUTPUT_EXISTS')
      expect(await readdir(output)).toEqual(files.map(([file]) => file).sort())
      for (const [file, bytes] of files) {
        expect((await readFile(join(output, file))).equals(bytes)).toBe(true)
      }
    }
  })

  it('rejects relative, root, and non-normalized output paths', async () => {
    const root = await temporaryRoot()
    for (const value of [
      'relative/evidence',
      parse(process.cwd()).root,
      `${root}${sep}nested${sep}..${sep}evidence`,
      `${join(root, 'evidence')}${sep}`,
      `${join(root, 'bad')}\0leaf`,
      join(root, 'con'),
    ])
      expect(() => artifacts.validateFreshOutputPath(value)).toThrow('VISUAL_OUTPUT_INVALID')
  })

  it('validates Windows drive and UNC paths without using the host platform', () => {
    const drive = String.raw`C:\Users\Singer\AppData\Local\Okay Karaoke\evidence`
    const unc = String.raw`\\studio-server\evidence-share\Okay Karaoke\evidence`
    expect(artifacts.validateFreshOutputPath(drive, win32)).toBe(drive)
    expect(artifacts.validateFreshOutputPath(unc, win32)).toBe(unc)

    const devices = [
      'aux',
      'clock$',
      'con',
      'conin$',
      'conout$',
      'nul',
      'prn',
      ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
      ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
      'COM¹',
      'COM²',
      'COM³',
      'LPT¹',
      'LPT²',
      'LPT³',
      'ＣＯＮ',
    ]
    for (const device of devices) {
      const value = `C:\\safe\\${device}.evidence`
      expect(() => artifacts.validateFreshOutputPath(value, win32)).toThrow('VISUAL_OUTPUT_INVALID')
    }

    for (const value of [
      String.raw`\\?\C:\safe\evidence`,
      String.raw`\\.\pipe\evidence`,
      String.raw`\??\C:\safe\evidence`,
      String.raw`\\??\C:\safe\evidence`,
      String.raw`\Device\HarddiskVolume1\evidence`,
      String.raw`C:\safe:stream\evidence`,
      String.raw`C:\safe\evidence:stream`,
      String.raw`C:\bad?parent\evidence`,
      String.raw`C:\con\evidence`,
      String.raw`C:\bad.\evidence`,
      String.raw`C:\bad \evidence`,
      `C:\\bad${String.fromCharCode(1)}parent\\evidence`,
      `C:\\safe\\bad${String.fromCharCode(2)}leaf`,
      String.raw`C:\safe\bad<leaf`,
      String.raw`C:\safe\evidence.`,
      String.raw`C:\safe\evidence `,
      String.raw`\root-relative\evidence`,
    ])
      expect(() => artifacts.validateFreshOutputPath(value, win32)).toThrow('VISUAL_OUTPUT_INVALID')
  })
})
