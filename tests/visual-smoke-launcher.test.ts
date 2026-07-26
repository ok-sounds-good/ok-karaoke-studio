import { createRequire } from 'node:module'
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const launcher = require('../scripts/video-style-visual-smoke.cjs')
const smoke = require('../electron/video-style-visual-smoke.cjs')
const layoutProfiles = require('../electron/visual-smoke-layout-profiles.cjs')
const smokeProfiles = require('../electron/smoke-profile.cjs')
const visualResults = require('../scripts/visual-result-validation.cjs')
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

async function outputPath() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-launcher-'))
  roots.push(root)
  return join(root, 'evidence')
}

function profile(prefix: string) {
  return { path: `/profiles/${prefix}`, serializedIdentity: `${prefix}-identity` }
}

function profileObservation(name: string, overrides: Record<string, unknown> = {}) {
  const profile = layoutProfiles.layoutSmokeProfile(name)
  if (!profile) throw new Error('missing layout profile')
  return {
    browserZoom: profile.browserZoom,
    contentHeight: profile.contentHeight,
    contentWidth: profile.contentWidth,
    cssHeight: profile.cssViewport.height,
    cssWidth: profile.cssViewport.width,
    devicePixelRatio: profile.deviceScale * profile.browserZoom,
    deviceScale: profile.deviceScale,
    name: profile.name,
    ...overrides,
  }
}

function requestedProfileName(args: string[]) {
  const option = args.find((argument) => argument.startsWith(smoke.OPTIONS.profile))
  if (!option) throw new Error('missing profile')
  return option.slice(smoke.OPTIONS.profile.length)
}

function validatedArtifacts(scenario = smoke.BASELINE_SCENARIO) {
  const names =
    scenario === smoke.STYLE_SESSION_SCENARIO
      ? visualResults.STYLE_SESSION_NAMES
      : [visualResults.BASELINE_NAME]
  return [
    ...names.map((name: string) => ({ bytes: Buffer.from(`png:${name}`), name })),
    { bytes: Buffer.from('{"ok":true}\n'), name: 'result.json' },
  ]
}

function rawWorkspace(output: string, events: string[] = []) {
  const claim = { path: join(dirname(output), 'private-raw') }
  return {
    claim,
    createRawRoot: vi.fn(async () => claim),
    verifyRawRoot: vi.fn(async () => {
      events.push('retention')
      return { retained: true }
    }),
  }
}

describe('visual smoke launcher', () => {
  it('passes only the fixed production-smoke arguments to a bounded child', async () => {
    const output = await outputPath()
    const events: string[] = []
    const authoritative = validatedArtifacts()
    const runChild = vi.fn(async () => ({
      code: 0,
      diagnostics: { fatal: false, overflow: false },
      signal: null,
    }))
    const validateResult = vi.fn(async () => ({ ok: true, publishedArtifacts: authoritative }))
    const publish = vi.fn(async () => {
      events.push('publish')
    })
    const raw = rawWorkspace(output, events)
    const rawOutput = join(raw.claim.path, 'evidence-100')
    const created = Array.from({ length: 4 }, () => [profile('user'), profile('session')]).flat()
    const outcome = await launcher.runLauncher(
      {
        environment: { OKS_VISUAL_EVIDENCE_DIR: output },
        executable: '/electron',
      },
      {
        ...raw,
        createProfile: vi.fn(async () => created.shift()),
        outputState: vi.fn(async () => ({ output, state: 'absent' })),
        publish,
        runChild,
        validateResult,
        verifyProfile: vi.fn(async () => ({ retained: true })),
      },
    )
    expect(outcome).toEqual({ ok: true })
    expect(runChild).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: '/electron',
        spawnOptions: {
          cwd: launcher.REPOSITORY_ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      }),
    )
    expect(runChild.mock.calls[0][0].captureOutput.maxBytesPerStream).toBe(
      launcher.MAX_DIAGNOSTIC_BYTES,
    )
    const args = runChild.mock.calls[0][0].args
    expect(args).toEqual([
      '--force-device-scale-factor=1',
      launcher.REPOSITORY_ROOT,
      smoke.TRIGGER,
      `${smoke.OPTIONS.output}${rawOutput}`,
      `${smoke.OPTIONS.profile}100`,
      `${smoke.OPTIONS.scenario}${smoke.BASELINE_SCENARIO}`,
      `${smoke.OPTIONS.userData}/profiles/user`,
      `${smoke.OPTIONS.userIdentity}user-identity`,
      `${smoke.OPTIONS.sessionData}/profiles/session`,
      `${smoke.OPTIONS.sessionIdentity}session-identity`,
    ])
    expect(runChild).toHaveBeenCalledTimes(4)
    expect(
      runChild.mock.calls.map(([call]) =>
        call.args.find((argument: string) => argument.startsWith(smoke.OPTIONS.profile)),
      ),
    ).toEqual([
      `${smoke.OPTIONS.profile}100`,
      `${smoke.OPTIONS.profile}125`,
      `${smoke.OPTIONS.profile}150`,
      `${smoke.OPTIONS.profile}dpr2`,
    ])
    expect(validateResult.mock.calls.map(([, options]) => options.expectedProfile.name)).toEqual([
      '100',
      '125',
      '150',
      'dpr2',
    ])
    expect(
      runChild.mock.calls.map(([call]) =>
        call.args.find((argument: string) => argument.startsWith('--force-device-scale-factor=')),
      ),
    ).toEqual([
      '--force-device-scale-factor=1',
      '--force-device-scale-factor=1',
      '--force-device-scale-factor=1',
      '--force-device-scale-factor=2',
    ])
    expect(raw.verifyRawRoot).toHaveBeenCalledWith(raw.claim)
    expect(publish).toHaveBeenCalledWith(output, authoritative)
    expect(events).toEqual(['retention', 'publish'])
  })

  it('places the device-scale switch before the source application argument for a development child', () => {
    const args = launcher.childArguments(
      '/raw',
      smoke.BASELINE_SCENARIO,
      profile('user'),
      profile('session'),
      layoutProfiles.layoutSmokeProfile('dpr2'),
    )
    expect(args.slice(0, 3)).toEqual([
      '--force-device-scale-factor=2',
      launcher.REPOSITORY_ROOT,
      smoke.TRIGGER,
    ])
  })

  it('places the device-scale switch before the trigger for a packaged child', () => {
    const args = launcher.childArguments(
      '/raw',
      smoke.BASELINE_SCENARIO,
      profile('user'),
      profile('session'),
      true,
    )
    expect(args.slice(0, 2)).toEqual(['--force-device-scale-factor=1', smoke.TRIGGER])
  })

  it('publishes only validated bytes after retaining the verified real private workspace', async () => {
    const output = await outputPath()
    const created = Array.from({ length: 4 }, () => [profile('user'), profile('session')]).flat()
    let rawOutput = ''
    const runChild = vi.fn(async ({ args }: { args: string[] }) => {
      const rawArgument = args.find((argument) => argument.startsWith(smoke.OPTIONS.output))
      if (!rawArgument) throw new Error('missing raw output argument')
      rawOutput = rawArgument.slice(smoke.OPTIONS.output.length)
      const artifacts = visualResults.createResultArtifacts(
        validPng(1280, 720),
        profileObservation(requestedProfileName(args)),
      ).artifacts
      await publishArtifactBuffers(rawOutput, artifacts)
      return {
        code: 0,
        diagnostics: { fatal: false, overflow: false },
        signal: null,
      }
    })

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi.fn(async () => created.shift()),
          runChild,
          verifyProfile: vi.fn(async () => ({ retained: true })),
        },
      ),
    ).resolves.toEqual({ ok: true })
    await expect(visualResults.validateVisualResultDirectory(output)).resolves.toMatchObject({
      ok: true,
      schemaVersion: 1,
    })
    const retainedRoot = dirname(rawOutput)
    roots.push(retainedRoot)
    expect((await lstat(retainedRoot)).isDirectory()).toBe(true)
    expect((await readdir(output)).sort()).toEqual(['01-baseline.png', 'result.json'])
    expect(await readFile(join(retainedRoot, smokeProfiles.OWNER_FILE), 'utf8')).toContain('token')
  })

  it.each([
    ['missing profile observation', undefined],
    ['profile name', profileObservation('100', { name: '125' })],
    ['browser zoom', profileObservation('100', { browserZoom: 1.25 })],
    ['content width', profileObservation('100', { contentWidth: 1279 })],
    ['content height', profileObservation('100', { contentHeight: 719 })],
    ['CSS width', profileObservation('100', { cssWidth: 1279 })],
    ['CSS height', profileObservation('100', { cssHeight: 719 })],
    ['native device scale', profileObservation('100', { deviceScale: 2 })],
    ['post-zoom device pixel ratio', profileObservation('100', { devicePixelRatio: 2 })],
  ])('withholds public publication for a %s', async (_label, observation) => {
    const output = await outputPath()
    const created = [profile('user'), profile('session')]
    const publish = vi.fn()
    const runChild = vi.fn(async ({ args }: { args: string[] }) => {
      const rawArgument = args.find((argument) => argument.startsWith(smoke.OPTIONS.output))
      if (!rawArgument) throw new Error('missing raw output argument')
      await publishArtifactBuffers(
        rawArgument.slice(smoke.OPTIONS.output.length),
        visualResults.createResultArtifacts(validPng(1280, 720), observation).artifacts,
      )
      return { code: 0, diagnostics: { fatal: false, overflow: false }, signal: null }
    })

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi.fn(async () => created.shift()),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          publish,
          runChild,
          verifyProfile: vi.fn(async () => ({ retained: true })),
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_RESULT_INVALID', ok: false })

    expect(publish).not.toHaveBeenCalled()
    expect(runChild).toHaveBeenCalledOnce()
  })

  it('allowlists the Style-session scenario before creating profiles or a child', async () => {
    const output = await outputPath()
    const events: string[] = []
    const authoritative = validatedArtifacts(smoke.STYLE_SESSION_SCENARIO)
    const runChild = vi.fn(async () => ({
      code: 0,
      diagnostics: { fatal: false, overflow: false },
      signal: null,
    }))
    const validateResult = vi.fn(async () => ({ ok: true, publishedArtifacts: authoritative }))
    const publish = vi.fn(async () => {
      events.push('publish')
    })
    const raw = rawWorkspace(output, events)
    const rawOutput = join(raw.claim.path, 'evidence-100')
    const created = Array.from({ length: 4 }, () => [profile('user'), profile('session')]).flat()
    await expect(
      launcher.runLauncher(
        {
          argv: [`${launcher.SCENARIO_ARGUMENT}${smoke.STYLE_SESSION_SCENARIO}`, output],
          executable: '/electron',
        },
        {
          ...raw,
          createProfile: vi.fn(async () => created.shift()),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          publish,
          runChild,
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
        },
      ),
    ).resolves.toEqual({ ok: true })
    expect(runChild.mock.calls[0][0].args).toContain(
      `${smoke.OPTIONS.scenario}${smoke.STYLE_SESSION_SCENARIO}`,
    )
    expect(runChild.mock.calls[0][0].args).toContain(`${smoke.OPTIONS.output}${rawOutput}`)
    expect(runChild).toHaveBeenCalledTimes(4)
    expect(publish).toHaveBeenCalledWith(output, authoritative)
    expect(events).toEqual(['retention', 'publish'])
  })

  it.each([
    '--scenario',
    '--scenario=',
    '--scenario=baseline',
    '--scenario=project-typography',
    '--scenario=unknown',
    '--scenario-style-session',
  ])(
    'rejects malformed or unallowlisted scenario argument %s before side effects',
    async (flag) => {
      const output = await outputPath()
      const createRawRoot = vi.fn()
      const createProfile = vi.fn()
      const outputState = vi.fn()
      const runChild = vi.fn()
      await expect(
        launcher.runLauncher(
          { argv: [flag, output] },
          {
            createRawRoot,
            createProfile,
            outputState,
            runChild,
          },
        ),
      ).resolves.toEqual({ code: 'VISUAL_SMOKE_SCENARIO_INVALID', ok: false })
      expect(createRawRoot).not.toHaveBeenCalled()
      expect(createProfile).not.toHaveBeenCalled()
      expect(outputState).not.toHaveBeenCalled()
      expect(runChild).not.toHaveBeenCalled()
    },
  )

  it('rejects duplicate allowlisted scenario arguments before side effects', async () => {
    const output = await outputPath()
    const scenario = `${launcher.SCENARIO_ARGUMENT}${smoke.STYLE_SESSION_SCENARIO}`
    const createRawRoot = vi.fn()
    const createProfile = vi.fn()
    const runChild = vi.fn()
    await expect(
      launcher.runLauncher(
        { argv: [scenario, scenario, output] },
        { createRawRoot, createProfile, runChild },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_SCENARIO_INVALID', ok: false })
    expect(createRawRoot).not.toHaveBeenCalled()
    expect(createProfile).not.toHaveBeenCalled()
    expect(runChild).not.toHaveBeenCalled()
  })

  it('maps child failures to one sanitized fresh failure artifact', async () => {
    const output = await outputPath()
    const events: string[] = []
    const raw = rawWorkspace(output, events)
    const writeFailure = vi.fn(async () => {
      events.push('failure')
      return 'created'
    })
    const outcome = await launcher.runLauncher(
      {
        argv: [output],
        executable: '/private/electron',
      },
      {
        ...raw,
        createProfile: vi
          .fn()
          .mockResolvedValueOnce(profile('user'))
          .mockResolvedValueOnce(profile('session')),
        outputState: vi.fn(async () => ({ output, state: 'absent' })),
        runChild: vi.fn(async () => ({ code: 9, signal: null })),
        verifyProfile: vi.fn(async () => ({ retained: true })),
        writeFailure,
      },
    )
    expect(outcome).toEqual({ code: 'VISUAL_SMOKE_CHILD_FAILED', ok: false })
    expect(writeFailure).toHaveBeenCalledWith(output, {
      code: 'VISUAL_SMOKE_CHILD_FAILED',
      ok: false,
    })
    expect(events).toEqual(['retention', 'failure'])
    expect(JSON.stringify(writeFailure.mock.calls)).not.toContain('/private/electron')
  })

  it.each([
    'TypeError: Object has been destroyed at /private/project/main.cjs:1',
    'Uncaught TypeError: renderer failure at /private/project/renderer.js:1',
    'Uncaught (in promise) TypeError: renderer rejection at /private/project/renderer.js:2',
  ])(
    'rejects a zero-exit child with captured fatal diagnostics without leaking %s',
    async (secret) => {
      const output = await outputPath()
      const raw = rawWorkspace(output)
      const writeFailure = vi.fn(async () => 'created')
      const validateResult = vi.fn()
      const outcome = await launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          ...raw,
          createProfile: vi
            .fn()
            .mockResolvedValueOnce(profile('user'))
            .mockResolvedValueOnce(profile('session')),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          runChild: vi.fn(async ({ captureOutput }) => ({
            code: 0,
            diagnostics: {
              fatal: captureOutput.classify(Buffer.alloc(0), Buffer.from(secret)),
              overflow: false,
            },
            signal: null,
          })),
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
          writeFailure,
        },
      )
      expect(outcome).toEqual({ code: 'VISUAL_SMOKE_CHILD_FAILED', ok: false })
      expect(validateResult).not.toHaveBeenCalled()
      expect(JSON.stringify(writeFailure.mock.calls)).not.toContain(secret)
    },
  )

  it('rejects capture overflow even when the child otherwise exits cleanly', async () => {
    const output = await outputPath()
    const raw = rawWorkspace(output)
    const validateResult = vi.fn()
    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          ...raw,
          createProfile: vi
            .fn()
            .mockResolvedValueOnce(profile('user'))
            .mockResolvedValueOnce(profile('session')),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          runChild: vi.fn(async () => ({
            code: 0,
            diagnostics: { fatal: false, overflow: true },
            signal: null,
          })),
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
          writeFailure: vi.fn(async () => 'created'),
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_CHILD_FAILED', ok: false })
    expect(validateResult).not.toHaveBeenCalled()
  })

  it('confirms private child-output retention before publishing a validation failure', async () => {
    const output = await outputPath()
    const events: string[] = []
    const raw = rawWorkspace(output, events)
    const rawOutput = join(raw.claim.path, 'evidence-100')
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => {
      events.push('failure')
      return 'created'
    })
    const validateResult = vi.fn(async () => {
      throw new Error('invalid private child output')
    })

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          ...raw,
          createProfile: vi
            .fn()
            .mockResolvedValueOnce(profile('user'))
            .mockResolvedValueOnce(profile('session')),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          publish,
          runChild: vi.fn(async () => ({
            code: 0,
            diagnostics: { fatal: false, overflow: false },
            signal: null,
          })),
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
          writeFailure,
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_RESULT_INVALID', ok: false })
    expect(validateResult).toHaveBeenCalledWith(rawOutput, {
      expectedProfile: layoutProfiles.layoutSmokeProfile('100'),
      scenario: smoke.BASELINE_SCENARIO,
    })
    expect(publish).not.toHaveBeenCalled()
    expect(events).toEqual(['retention', 'failure'])
  })

  it('leaves requested output unpublished when private-output retention is uncertain', async () => {
    const output = await outputPath()
    const authoritative = validatedArtifacts()
    const outputState = vi.fn(async () => ({ output, state: 'absent' }))
    const publish = vi.fn()
    const raw = rawWorkspace(output)
    const verifyRawRoot = vi.fn(async () => {
      throw new Error('retention uncertain')
    })
    const writeFailure = vi.fn()

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi
            .fn()
            .mockResolvedValueOnce(profile('user'))
            .mockResolvedValueOnce(profile('session')),
          createRawRoot: raw.createRawRoot,
          outputState,
          publish,
          runChild: vi.fn(async () => ({
            code: 0,
            diagnostics: { fatal: false, overflow: false },
            signal: null,
          })),
          validateResult: vi.fn(async () => ({ publishedArtifacts: authoritative })),
          verifyProfile: vi.fn(async () => ({ retained: true })),
          verifyRawRoot,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_OUTPUT_INVALID', ok: false })
    expect(outputState).toHaveBeenCalledTimes(1)
    expect(verifyRawRoot).toHaveBeenCalledWith(raw.claim)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).not.toHaveBeenCalled()
  })

  it('rejects an existing output before creating profiles or starting Electron', async () => {
    const output = await outputPath()
    const createRawRoot = vi.fn()
    const createProfile = vi.fn()
    const runChild = vi.fn()
    await expect(
      launcher.runLauncher(
        { argv: [output] },
        {
          createRawRoot,
          createProfile,
          outputState: vi.fn(async () => ({ output, state: 'marker-present' })),
          runChild,
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_OUTPUT_EXISTS', ok: false })
    expect(createRawRoot).not.toHaveBeenCalled()
    expect(createProfile).not.toHaveBeenCalled()
    expect(runChild).not.toHaveBeenCalled()
  })
})
