import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const bounded = require('../scripts/bounded-child.cjs')
const lockedJob = require('../scripts/windows-locked-job.cjs')
const roots: string[] = []
const HASH = 'a'.repeat(64)

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))),
)

function options(root: string) {
  return {
    args: ['--probe'],
    executable: join(root, 'candidate.exe'),
    spawnOptions: { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    timeoutMs: 1_000,
  }
}

describe('locked Windows process-tree adapter', () => {
  it('encodes a fixed PowerShell request without changing the bounded-child contract', () => {
    const root = join(tmpdir(), 'locked-job-request')
    const adapted = lockedJob.lockedJobChildOptions(options(root), {
      executableSha256: HASH,
      resource: join(root, 'app.asar'),
      resourceSha256: HASH,
      root,
    })
    const request = JSON.parse(Buffer.from(adapted.args.at(-1), 'base64').toString('utf8'))
    const ancestors: string[] = []
    for (let current = root; ; current = join(current, '..')) {
      const resolved = join(current)
      ancestors.unshift(resolved)
      if (resolved === join(resolved, '..')) break
    }
    expect(adapted).toMatchObject({ executable: lockedJob.POWERSHELL_PATH, timeoutMs: 1_000 })
    expect(request).toEqual({
      arguments: ['--probe'],
      cwd: root,
      directories: ancestors,
      executable: join(root, 'candidate.exe'),
      executableSha256: HASH,
      resource: join(root, 'app.asar'),
      resourceSha256: HASH,
    })
  })

  it('rejects relative paths and malformed hashes before starting PowerShell', () => {
    const root = join(tmpdir(), 'locked-job-invalid')
    expect(() =>
      lockedJob.lockedJobChildOptions(options(root), {
        executableSha256: 'bad',
        resource: 'relative',
        resourceSha256: HASH,
        root: 'relative',
      }),
    ).toThrow('WINDOWS_LOCKED_JOB_INVALID')
  })

  it('uses locked files, a suspended root process, and kill-on-close tree ownership', async () => {
    const source = await readFile(lockedJob.ADAPTER_PATH, 'utf8')
    for (const contract of [
      'FileShare.Read',
      'FILE_FLAG_OPEN_REPARSE_POINT',
      'CREATE_SUSPENDED',
      'EXTENDED_STARTUPINFO_PRESENT',
      'JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION',
      'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE',
      'PROC_THREAD_ATTRIBUTE_JOB_LIST',
      'ActiveProcesses',
    ])
      expect(source).toContain(contract)
    expect(source).not.toContain('AssignProcessToJobObject')
  })

  it.runIf(process.platform === 'win32')(
    'rejects a package reached through a junction above the declared root',
    async () => {
      const container = await mkdtemp(join(tmpdir(), 'oks-locked-job-junction-'))
      roots.push(container)
      const actual = join(container, 'actual')
      const junction = join(container, 'junction')
      const actualRoot = join(actual, 'checkout')
      const packageRoot = join(actualRoot, 'release', 'win-unpacked')
      const resource = join(packageRoot, 'resources', 'app.asar')
      await mkdir(join(packageRoot, 'resources'), { recursive: true })
      await copyFile(process.execPath, join(packageRoot, 'candidate.exe'))
      await writeFile(resource, 'resource')
      await symlink(actual, junction, 'junction')
      const root = join(junction, 'checkout')
      const executable = join(root, 'release', 'win-unpacked', 'candidate.exe')
      const linkedResource = join(root, 'release', 'win-unpacked', 'resources', 'app.asar')
      const digest = async (file: string) =>
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex')
      let stderr = ''
      const adapted = lockedJob.lockedJobChildOptions(
        {
          args: [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(join(actualRoot, 'started'))},'started')`,
          ],
          captureOutput: {
            classify: (_stdout: Buffer, value: Buffer) => {
              stderr = value.toString()
              return true
            },
            maxBytesPerStream: 1_024,
          },
          executable,
          spawnOptions: { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
          timeoutMs: 8_000,
        },
        {
          executableSha256: await digest(executable),
          resource: linkedResource,
          resourceSha256: await digest(linkedResource),
          root,
        },
      )
      await expect(
        bounded.runBoundedChild({ ...adapted, killGraceMs: 1_000 }),
      ).resolves.toMatchObject({ code: 190, terminationConfirmed: true, timedOut: false })
      expect(stderr.trim()).toBe('[oks-windows-package-smoke:fatal]')
      await expect(readFile(join(actualRoot, 'started'))).rejects.toThrow()
    },
    15_000,
  )

  it.runIf(process.platform === 'win32')(
    'rejects either locked-file hash mismatch before the candidate starts',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'oks-locked-job-hash-'))
      roots.push(root)
      const executable = join(root, 'candidate.exe')
      const resource = join(root, 'app.asar')
      await copyFile(process.execPath, executable)
      await writeFile(resource, 'resource')
      const digest = async (file: string) =>
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex')
      const locks = {
        executableSha256: await digest(executable),
        resource,
        resourceSha256: await digest(resource),
        root,
      }

      for (const field of ['executableSha256', 'resourceSha256'] as const) {
        const started = join(root, `${field}.started`)
        let stderr = ''
        const wrongHash = `${locks[field][0] === '0' ? '1' : '0'}${locks[field].slice(1)}`
        const adapted = lockedJob.lockedJobChildOptions(
          {
            args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(started)},'started')`],
            captureOutput: {
              classify: (_stdout: Buffer, value: Buffer) => {
                stderr = value.toString()
                return true
              },
              maxBytesPerStream: 1_024,
            },
            executable,
            spawnOptions: { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
            timeoutMs: 8_000,
          },
          { ...locks, [field]: wrongHash },
        )
        await expect(
          bounded.runBoundedChild({ ...adapted, killGraceMs: 1_000 }),
        ).resolves.toMatchObject({ code: 190, terminationConfirmed: true, timedOut: false })
        expect(stderr.trim()).toBe('[oks-windows-package-smoke:fatal]')
        await expect(readFile(started)).rejects.toThrow()
      }
    },
    25_000,
  )

  it.runIf(process.platform === 'win32')(
    'kills a detached stdio-ignored descendant on timeout',
    async () => {
      const container = await mkdtemp(join(tmpdir(), 'oks-locked-job-live-'))
      roots.push(container)
      const root = join(container, 'checkout')
      const packageRoot = join(root, 'release', 'win-unpacked')
      const resources = join(packageRoot, 'resources')
      const executable = join(packageRoot, 'candidate.exe')
      const resource = join(resources, 'app.asar')
      const pidFile = join(root, 'descendant.pid')
      await mkdir(resources, { recursive: true })
      await copyFile(process.execPath, executable)
      await writeFile(resource, 'resource')
      const digest = async (file: string) =>
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex')
      const locks = {
        executableSha256: await digest(executable),
        resource,
        resourceSha256: await digest(resource),
        root,
      }
      let captured = { stderr: '', stdout: '' }
      const diagnostic = lockedJob.lockedJobChildOptions(
        {
          args: [
            '-e',
            "process.stdout.write('[candidate-stdout]');process.stderr.write('[candidate-stderr]')",
          ],
          captureOutput: {
            classify: (stdout: Buffer, stderr: Buffer) => {
              captured = { stderr: stderr.toString(), stdout: stdout.toString() }
              return (
                captured.stdout === '[candidate-stdout]' && captured.stderr === '[candidate-stderr]'
              )
            },
            maxBytesPerStream: 1_024,
          },
          executable,
          spawnOptions: { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
          timeoutMs: 8_000,
        },
        locks,
      )
      const diagnosticOutcome = await bounded.runBoundedChild({
        ...diagnostic,
        killGraceMs: 1_000,
      })
      expect(diagnosticOutcome).toMatchObject({
        code: 0,
        diagnostics: { fatal: true, overflow: false },
        terminationConfirmed: true,
        timedOut: false,
      })
      expect(captured).toEqual({
        stderr: '[candidate-stderr]',
        stdout: '[candidate-stdout]',
      })

      const pauseMarker = join(root, 'post-create.pid')
      const paused = {
        ...diagnostic,
        spawnOptions: {
          ...diagnostic.spawnOptions,
          env: {
            ...process.env,
            OKS_LOCKED_JOB_TEST_POST_CREATE_PAUSE_MARKER: pauseMarker,
          },
        },
        timeoutMs: 10_000,
      }
      const pausedOutcome = await bounded.runBoundedChild({ ...paused, killGraceMs: 1_000 })
      expect(pausedOutcome).toMatchObject({ terminationConfirmed: true, timedOut: true })
      const suspendedPid = Number(await readFile(pauseMarker, 'utf8'))
      await vi.waitFor(() => expect(() => process.kill(suspendedPid, 0)).toThrow(), {
        timeout: 5_000,
      })
      const releasedExecutable = `${executable}.released`
      await rename(executable, releasedExecutable)
      await rename(releasedExecutable, executable)

      const script = `const {spawn}=require('node:child_process'),{writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref()`
      const adapted = lockedJob.lockedJobChildOptions(
        {
          args: ['-e', script],
          captureOutput: { classify: () => false, maxBytesPerStream: 1_024 },
          executable,
          spawnOptions: { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
          timeoutMs: 8_000,
        },
        locks,
      )
      let pid = 0
      try {
        const faulted = {
          ...diagnostic,
          spawnOptions: {
            ...diagnostic.spawnOptions,
            env: { ...process.env, OKS_LOCKED_JOB_TEST_POST_CREATE_FAILURE: '1' },
          },
        }
        const faultOutcome = await bounded.runBoundedChild({ ...faulted, killGraceMs: 1_000 })
        expect(faultOutcome).toMatchObject({
          code: 190,
          terminationConfirmed: true,
          timedOut: false,
        })
        expect(captured.stderr.trim()).toBe('[oks-windows-package-smoke:fatal]')
        expect(captured.stderr).not.toContain(root)
        expect(captured.stdout).toBe('')
        await expect(readFile(pidFile)).rejects.toThrow()

        const drainFaulted = {
          ...adapted,
          spawnOptions: {
            ...adapted.spawnOptions,
            env: { ...process.env, OKS_LOCKED_JOB_TEST_DRAIN_FAILURE: '1' },
          },
        }
        const drainFaultOutcome = await bounded.runBoundedChild({
          ...drainFaulted,
          killGraceMs: 1_000,
        })
        expect(drainFaultOutcome).toMatchObject({
          code: 190,
          terminationConfirmed: true,
          timedOut: false,
        })
        pid = Number(await readFile(pidFile, 'utf8'))
        await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 })
        await rm(pidFile)
        pid = 0

        const pending = bounded.runBoundedChild({ ...adapted, killGraceMs: 1_000 })
        await vi.waitFor(async () => expect(await readFile(pidFile, 'utf8')).toMatch(/^\d+$/u), {
          timeout: 7_000,
        })
        await expect(writeFile(resource, 'swap')).rejects.toThrow()
        const swap = async (target: string, replacement: string) => {
          const original = `${target}.original`
          await rename(target, original)
          await rename(replacement, target)
          await rename(target, replacement)
          await rename(original, target)
        }
        const executableReplacement = `${executable}.replacement`
        const resourceReplacement = `${resource}.replacement`
        await copyFile(process.execPath, executableReplacement)
        await writeFile(resourceReplacement, 'replacement')
        await expect(swap(executable, executableReplacement)).rejects.toThrow()
        await expect(swap(resource, resourceReplacement)).rejects.toThrow()
        const renameRoundTrip = async (directory: string) => {
          const moved = `${directory}.moved`
          await rename(directory, moved)
          await rename(moved, directory)
        }
        await expect(renameRoundTrip(resources)).rejects.toThrow()
        await expect(renameRoundTrip(container)).rejects.toThrow()
        const outcome = await pending
        expect(outcome).toMatchObject({ terminationConfirmed: true, timedOut: true })
        pid = Number(await readFile(pidFile, 'utf8'))
        await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 })
        await swap(executable, executableReplacement)
        await swap(resource, resourceReplacement)
        await renameRoundTrip(resources)
        await renameRoundTrip(container)
        await writeFile(resource, 'released')
      } finally {
        try {
          if (pid) process.kill(pid, 'SIGKILL')
        } catch {}
      }
    },
    45_000,
  )
})
