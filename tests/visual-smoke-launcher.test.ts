import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const launcher = require('../scripts/video-style-visual-smoke.cjs') as {
  run(options: Record<string, unknown>): Promise<number>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function outputPath() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-launcher-'))
  temporaryDirectories.push(root)
  return join(root, 'evidence')
}

function profile() {
  return {
    identity: {},
    path: '/private/fixed-profile',
    serializedIdentity: 'fixed-identity',
  }
}

function successfulOutcome() {
  return {
    code: 0,
    forwardedSignal: null,
    postSpawnError: false,
    signal: null,
    startFailed: false,
    terminationConfirmed: true,
    terminationUnconfirmed: false,
    timedOut: false,
  }
}

describe('visual smoke outer launcher', () => {
  it('places Chromium scale switches before the Electron application path', async () => {
    const output = await outputPath()
    let args: string[] = []
    const code = await launcher.run({
      createProfile: async () => profile(),
      emitFailure: vi.fn(),
      environment: { OKS_VISUAL_SMOKE_OUTPUT: output },
      runChild: async (options: { args: string[] }) => {
        args = options.args
        return successfulOutcome()
      },
      validateResult: async () => ({}),
      verifyProfile: async () => ({ retained: true }),
    })

    expect(code).toBe(0)
    expect(args).toEqual([
      '--force-device-scale-factor=1',
      '.',
      '--video-style-visual-smoke',
    ])
  })

  it('turns a child zero exit with partial output into a fixed public failure', async () => {
    const output = await outputPath()
    const emitted = vi.fn()
    const code = await launcher.run({
      createProfile: async () => profile(),
      emitFailure: emitted,
      environment: { OKS_VISUAL_SMOKE_OUTPUT: output },
      runChild: async () => {
        await mkdir(output)
        await writeFile(join(output, 'partial-private-file'), 'preserve partial')
        return successfulOutcome()
      },
      verifyProfile: async () => ({ retained: true }),
    })

    expect(code).toBe(1)
    expect(emitted).toHaveBeenCalledWith('VISUAL_SMOKE_RESULT_INVALID')
    expect(await readFile(join(output, 'partial-private-file'), 'utf8')).toBe('preserve partial')
  })

  it('rejects a raw relative output before resolving or creating it in the repository', async () => {
    const relative = `relative-visual-evidence-${Date.now()}`
    const repositoryPath = resolve(relative)
    await rm(repositoryPath, { recursive: true, force: true })
    const runChild = vi.fn()
    const emitted = vi.fn()

    const code = await launcher.run({
      emitFailure: emitted,
      environment: { OKS_VISUAL_SMOKE_OUTPUT: relative },
      runChild,
    })

    expect(code).toBe(1)
    expect(emitted).toHaveBeenCalledWith('VISUAL_SMOKE_OUTPUT_INVALID')
    expect(runChild).not.toHaveBeenCalled()
    await expect(readFile(repositoryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not inspect or retire a profile after unconfirmed child termination', async () => {
    const output = await outputPath()
    const verifyProfile = vi.fn()
    const emitted = vi.fn()
    const code = await launcher.run({
      createProfile: async () => profile(),
      emitFailure: emitted,
      environment: { OKS_VISUAL_SMOKE_OUTPUT: output },
      runChild: async () => ({
        ...successfulOutcome(),
        code: null,
        terminationConfirmed: false,
        terminationUnconfirmed: true,
      }),
      verifyProfile,
    })

    expect(code).toBe(1)
    expect(verifyProfile).not.toHaveBeenCalled()
    expect(emitted).toHaveBeenCalledWith('VISUAL_SMOKE_TERMINATION_UNCONFIRMED')
  })
})
