import { createRequire } from 'node:module'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const artifacts = require('../electron/smoke-artifacts.cjs') as {
  outputState(path: string): Promise<{ state: string }>
  publishArtifactBuffers(
    output: string,
    values: Array<{ name: string; bytes: Buffer }>,
    options?: Record<string, unknown>,
  ): Promise<string>
  validateFreshOutputPath(path: unknown): string
  writeFreshLauncherFailure(
    output: string,
    value: Record<string, unknown>,
  ): Promise<string>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'oks-smoke-artifacts-'))
  temporaryDirectories.push(root)
  return root
}

function resultArtifacts() {
  return [
    { name: '01-default.png', bytes: Buffer.from('png bytes') },
    { name: 'result.json', bytes: Buffer.from('{"ok":true}\n') },
  ]
}

describe('smoke artifact ownership', () => {
  it('claims an absent directory and publishes direct buffers with the marker last', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const order: string[] = []

    await expect(artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeWrite: (_claimed: string, name: string) => { order.push(name) },
    })).resolves.toBe(output)
    expect(order).toEqual(['01-default.png', 'result.json'])
    expect(await readFile(join(output, '01-default.png'), 'utf8')).toBe('png bytes')
    expect(await artifacts.outputState(output)).toEqual({ output, state: 'complete' })
  })

  it.each(['empty-directory', 'nonempty-directory', 'file'])(
    'rejects and preserves an existing %s output',
    async (kind) => {
      const root = await temporaryRoot()
      const output = join(root, 'evidence')
      if (kind === 'file') await writeFile(output, 'caller sentinel')
      else {
        await mkdir(output)
        if (kind === 'nonempty-directory') {
          await mkdir(join(output, '.git'))
          await writeFile(join(output, '.git', 'HEAD'), 'caller branch')
        }
      }

      await expect(
        artifacts.publishArtifactBuffers(output, resultArtifacts()),
      ).rejects.toThrow('VISUAL_OUTPUT_EXISTS')
      if (kind === 'file') expect(await readFile(output, 'utf8')).toBe('caller sentinel')
      else expect((await lstat(output)).isDirectory()).toBe(true)
      if (kind === 'nonempty-directory') {
        expect(await readFile(join(output, '.git', 'HEAD'), 'utf8')).toBe('caller branch')
      }
    },
  )

  it('rejects and preserves an existing symlink without following it', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'caller-target')
    const output = join(root, 'evidence')
    await mkdir(target)
    await writeFile(join(target, 'sentinel'), 'caller data')
    await symlink(target, output, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(
      artifacts.publishArtifactBuffers(output, resultArtifacts()),
    ).rejects.toThrow('VISUAL_OUTPUT_EXISTS')
    expect((await lstat(output)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(target, 'sentinel'), 'utf8')).toBe('caller data')
  })

  it('loses an output-claim race without replacing the winner', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')

    await expect(artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeClaim: async () => {
        await mkdir(output)
        await writeFile(join(output, 'winner'), 'caller won')
      },
    })).rejects.toThrow('VISUAL_OUTPUT_EXISTS')
    expect(await readFile(join(output, 'winner'), 'utf8')).toBe('caller won')
  })

  it('preserves a racer directory swapped into the claimed output path', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const displaced = join(root, 'displaced-owned-directory')

    await expect(artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeWrite: async (_claimed: string, name: string) => {
        if (name !== '01-default.png') return
        await rename(output, displaced)
        await mkdir(output)
        await writeFile(join(output, 'racer-sentinel'), 'preserve racer')
      },
    })).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(join(output, 'racer-sentinel'), 'utf8')).toBe('preserve racer')
    expect(await lstat(displaced)).toEqual(expect.objectContaining({}))
  })

  it('preserves a symlink and its target swapped into the claimed output path', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const displaced = join(root, 'displaced-owned-directory')
    const target = join(root, 'racer-target')
    await mkdir(target)
    await writeFile(join(target, 'sentinel'), 'preserve target')

    await expect(artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeWrite: async (_claimed: string, name: string) => {
        if (name !== '01-default.png') return
        await rename(output, displaced)
        await symlink(target, output, process.platform === 'win32' ? 'junction' : 'dir')
      },
    })).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect((await lstat(output)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(target, 'sentinel'), 'utf8')).toBe('preserve target')
  })

  it('never overwrites a file raced into its exclusively claimed directory', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')

    await expect(artifacts.publishArtifactBuffers(output, resultArtifacts(), {
      beforeWrite: async (claimed: string, name: string) => {
        if (name === '01-default.png') await writeFile(join(claimed, name), 'caller raced')
      },
    })).rejects.toThrow('VISUAL_OUTPUT_RACE')
    expect(await readFile(join(output, '01-default.png'), 'utf8')).toBe('caller raced')
  })

  it('requires exactly one completion marker in final position', async () => {
    const root = await temporaryRoot()
    await expect(artifacts.publishArtifactBuffers(join(root, 'bad-order'), [
      { name: 'result.json', bytes: Buffer.from('{}') },
      { name: '01-default.png', bytes: Buffer.from('png') },
    ])).rejects.toThrow('VISUAL_ARTIFACTS_INVALID')
  })

  it('creates failure evidence only for an absent output and respects markers', async () => {
    const root = await temporaryRoot()
    const output = join(root, 'evidence')
    const failure = { code: 'VISUAL_SMOKE_FAILED', ok: false }

    await expect(artifacts.writeFreshLauncherFailure(output, failure)).resolves.toBe('created')
    await expect(artifacts.writeFreshLauncherFailure(output, failure)).resolves.toBe(
      'existing-complete',
    )
    expect(await readFile(join(output, 'failure.json'), 'utf8')).toContain('VISUAL_SMOKE_FAILED')

    const unknown = join(root, 'unknown')
    await mkdir(unknown)
    await writeFile(join(unknown, 'sentinel'), 'preserve me')
    await expect(artifacts.writeFreshLauncherFailure(unknown, failure)).rejects.toThrow(
      'VISUAL_OUTPUT_EXISTS',
    )
    expect(await readFile(join(unknown, 'sentinel'), 'utf8')).toBe('preserve me')
  })

  it('rejects relative and filesystem-root destinations', () => {
    expect(() => artifacts.validateFreshOutputPath('relative/evidence')).toThrow(
      'VISUAL_OUTPUT_INVALID',
    )
    expect(() => artifacts.validateFreshOutputPath(parse(process.cwd()).root)).toThrow(
      'VISUAL_OUTPUT_INVALID',
    )
  })
})
