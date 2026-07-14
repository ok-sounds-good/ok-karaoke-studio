import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const launcher = require('../scripts/font-access-smoke.cjs') as {
  run(options: Record<string, unknown>): Promise<number>
}

function profile() {
  return {
    identity: {},
    path: '/private/fixed-profile',
    serializedIdentity: 'fixed-identity',
  }
}

function outcome(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    forwardedSignal: null,
    postSpawnError: false,
    signal: null,
    startFailed: false,
    terminationConfirmed: true,
    terminationUnconfirmed: false,
    timedOut: false,
    ...overrides,
  }
}

describe('font smoke outer launcher', () => {
  it('passes the recorded profile identity and verifies retention after confirmed exit', async () => {
    const verifyProfile = vi.fn(async () => ({ retained: true }))
    let childEnvironment: Record<string, string> = {}
    let childArguments: string[] = []
    const code = await launcher.run({
      createProfile: async () => profile(),
      emitFailure: vi.fn(),
      environment: {},
      runChild: async (options: {
        args: string[]
        spawnOptions: { env: Record<string, string> }
      }) => {
        childArguments = options.args
        childEnvironment = options.spawnOptions.env
        return outcome()
      },
      verifyProfile,
    })

    expect(code).toBe(0)
    expect(childArguments).toEqual([
      '--force-device-scale-factor=1',
      '.',
      '--font-access-smoke',
    ])
    expect(childEnvironment).toMatchObject({
      OKS_FONT_SMOKE_PROFILE_IDENTITY: 'fixed-identity',
      OKS_FONT_SMOKE_USER_DATA: '/private/fixed-profile',
    })
    expect(verifyProfile).toHaveBeenCalledOnce()
  })

  it('never inspects or retires the profile when termination is unconfirmed', async () => {
    const verifyProfile = vi.fn()
    const emitFailure = vi.fn()
    const code = await launcher.run({
      createProfile: async () => profile(),
      emitFailure,
      environment: {},
      runChild: async () => outcome({
        code: null,
        terminationConfirmed: false,
        terminationUnconfirmed: true,
      }),
      verifyProfile,
    })

    expect(code).toBe(1)
    expect(verifyProfile).not.toHaveBeenCalled()
    expect(emitFailure).toHaveBeenCalledWith('FONT_SMOKE_TERMINATION_UNCONFIRMED')
  })

  it('reports a fixed identity failure and retains a swapped profile path', async () => {
    const emitFailure = vi.fn()
    const code = await launcher.run({
      createProfile: async () => profile(),
      emitFailure,
      environment: {},
      runChild: async () => outcome(),
      verifyProfile: async () => { throw new Error('/private/racer-path') },
    })

    expect(code).toBe(1)
    expect(emitFailure).toHaveBeenCalledWith('FONT_SMOKE_PROFILE_IDENTITY_FAILED')
    expect(JSON.stringify(emitFailure.mock.calls)).not.toContain('/private/racer-path')
  })
})
