import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const bounded = require('../scripts/bounded-child.cjs') as {
  publicChildOutcomeCode(prefix: string, outcome: Record<string, unknown>): string | null
  publicStatusLine(code: string): string
  runBoundedChild(options: Record<string, unknown>): Promise<Record<string, unknown>>
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: string | null = null
  kills: string[] = []
  killBehavior: 'exit-on-kill' | 'return-false' | 'throw' | 'ignore' = 'exit-on-kill'

  kill(signal: string) {
    this.kills.push(signal)
    if (this.killBehavior === 'throw') throw new Error('private kill failure')
    if (this.killBehavior === 'return-false') return false
    if (this.killBehavior === 'exit-on-kill' && signal === 'SIGKILL') {
      this.signalCode = signal
      this.emit('exit', null, signal)
    }
    return true
  }

  confirmSpawn() {
    this.emit('spawn')
  }

  exit(code = 0, signal: string | null = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

function pendingChild(child: FakeChild, overrides: Record<string, unknown> = {}) {
  const parent = new EventEmitter()
  const pending = bounded.runBoundedChild({
    executable: 'electron',
    spawnImpl: () => child,
    processLike: parent,
    timeoutMs: 1_000,
    killGraceMs: 2_000,
    forceSettleMs: 250,
    setTimeoutImpl: setTimeout,
    clearTimeoutImpl: clearTimeout,
    ...overrides,
  })
  child.confirmSpawn()
  return { parent, pending }
}

describe('bounded child lifecycle', () => {
  it('force-kills an uncooperative child and confirms only the observed exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const { parent, pending } = pendingChild(child)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(child.kills).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toMatchObject({
      timedOut: true,
      signal: 'SIGKILL',
      terminationConfirmed: true,
      terminationUnconfirmed: false,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports explicit unconfirmed termination when SIGKILL produces no exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const { parent, pending } = pendingChild(child)

    await vi.advanceTimersByTimeAsync(3_250)
    await expect(pending).resolves.toMatchObject({
      timedOut: true,
      signal: null,
      terminationConfirmed: false,
      terminationUnconfirmed: true,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['throw', 'return-false'] as const)(
    'keeps escalation active when kill attempts %s',
    async (killBehavior) => {
      vi.useFakeTimers()
      const child = new FakeChild()
      child.killBehavior = killBehavior
      const { pending } = pendingChild(child)

      await vi.advanceTimersByTimeAsync(3_250)
      await expect(pending).resolves.toMatchObject({
        killFailed: true,
        signal: null,
        terminationUnconfirmed: true,
      })
      expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('forwards only the first parent signal and does not invent a child exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const { parent, pending } = pendingChild(child, { timeoutMs: 60_000 })

    parent.emit('SIGINT')
    parent.emit('SIGINT')
    parent.emit('SIGTERM')
    expect(child.kills).toEqual(['SIGINT'])
    await vi.advanceTimersByTimeAsync(2_250)
    await expect(pending).resolves.toMatchObject({
      forwardedSignal: 'SIGINT',
      signal: null,
      terminationUnconfirmed: true,
    })
    expect(child.kills).toEqual(['SIGINT', 'SIGKILL'])
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
  })

  it('distinguishes a post-spawn process error from a start failure', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const { pending } = pendingChild(child, { timeoutMs: 60_000 })
    child.emit('error', new Error('private runtime error'))

    await vi.advanceTimersByTimeAsync(2_250)
    const outcome = await pending
    expect(outcome).toMatchObject({
      postSpawnError: true,
      startFailed: false,
      terminationUnconfirmed: true,
    })
    expect(bounded.publicChildOutcomeCode('VISUAL_SMOKE', outcome)).toBe(
      'VISUAL_SMOKE_TERMINATION_UNCONFIRMED',
    )
  })

  it('clears timers and listeners after a normal confirmed exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const { parent, pending } = pendingChild(child)
    child.exit(0)

    await expect(pending).resolves.toMatchObject({
      code: 0,
      terminationConfirmed: true,
    })
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['FONT_SMOKE', 'VISUAL_SMOKE'])(
    'maps secret-bearing %s start failures to fixed public output',
    async (prefix) => {
      const parent = new EventEmitter()
      const secret = 'CodexSecretPath-DoNotLeak'
      const outcome = await bounded.runBoundedChild({
        executable: secret,
        spawnImpl: () => { throw new Error(`cannot launch ${secret}`) },
        processLike: parent,
        timeoutMs: 1_000,
      })
      const code = bounded.publicChildOutcomeCode(prefix, outcome)
      const line = bounded.publicStatusLine(code as string)

      expect(code).toBe(`${prefix}_START_FAILED`)
      expect(line).toBe(`{"code":"${prefix}_START_FAILED","ok":false}`)
      expect(line).not.toContain(secret)
      expect(parent.listenerCount('SIGINT')).toBe(0)
      expect(parent.listenerCount('SIGTERM')).toBe(0)
    },
  )

  it('treats a pre-spawn emitted error as a confirmed start failure', async () => {
    const parent = new EventEmitter()
    const child = new FakeChild()
    const pending = bounded.runBoundedChild({
      executable: 'electron',
      spawnImpl: () => child,
      processLike: parent,
      timeoutMs: 1_000,
    })
    child.emit('error', new Error('private start error'))

    await expect(pending).resolves.toMatchObject({
      startFailed: true,
      terminationConfirmed: true,
    })
  })

  it('rejects arbitrary secret-bearing status codes from public output', () => {
    expect(bounded.publicStatusLine('CodexSecretPath-DoNotLeak')).toBe(
      '{"code":"SMOKE_LAUNCHER_FAILED","ok":false}',
    )
  })
})
