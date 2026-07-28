import { describe, expect, it } from 'vitest'

import { createLyricLine, createLyricWord, createVocalTrack } from '../src/lib/model'
import { SYNC_CUE_MAX_TOKENS, SyncSession } from '../src/lib/sync-session'

function track() {
  return createVocalTrack({
    id: 'lead',
    name: 'Lead',
    lines: [
      createLyricLine('first second', { id: 'line-one' }),
      createLyricLine('third', { id: 'line-two' }),
    ],
  })
}

describe('SyncSession', () => {
  it('publishes pre-indexed real line context and coalesces timing without project writes', () => {
    const source = track()
    const [first, second] = source.lines[0].words
    const session = new SyncSession(source, 0, 7)
    const initial = session.getSnapshot()
    expect(initial).toMatchObject({
      epoch: 7,
      cursor: 0,
      total: 3,
      targetWordId: first.id,
    })
    expect(initial.currentLine?.tokens.map((token) => token.text)).toEqual(['first', 'second'])
    expect(initial.nextLine?.tokens.map((token) => token.text)).toEqual(['third'])

    expect(session.start(1_000, false)).toEqual({ wordId: first.id, started: true })
    expect(session.getSnapshot()).toMatchObject({ cursor: 1, targetWordId: second.id })
    expect(session.hasPending).toBe(true)
    expect(session.drainPatches()).toEqual(new Map([[first.id, { startMs: 1_000, endMs: 1_100 }]]))
    expect(session.hasPending).toBe(false)
  })

  it('keeps held final-word release and explicit end ordered', () => {
    const source = track()
    const second = source.lines[0].words[1]
    const third = source.lines[1].words[0]
    const session = new SyncSession(source, 1, 3)
    session.start(2_000, true)
    session.release(2_450)
    expect(session.getSnapshot()).toMatchObject({ cursor: 2, targetWordId: third.id })
    expect(session.drainPatches().get(second.id)).toEqual({ startMs: 2_000, endMs: 2_450 })

    session.start(3_000, true)
    expect(session.end(3_125)).toBe(true)
    expect(session.getSnapshot()).toMatchObject({ cursor: 3, targetWordId: null })
    expect(session.drainPatches().get(third.id)).toEqual({ startMs: 3_000, endMs: 3_125 })
  })

  it('publishes drained and acknowledged pending state so all consumers agree', () => {
    const source = track()
    const session = new SyncSession(source, 0, 11)
    const published: boolean[] = []
    const unsubscribe = session.subscribe(() => published.push(session.getSnapshot().hasPending))

    session.start(1_000, false)
    expect(session.getSnapshot().hasPending).toBe(true)
    const patches = session.drainPatches()
    expect(session.getSnapshot().hasPending).toBe(false)
    session.acknowledgeMaterialized(patches)
    expect(session.getSnapshot().hasPending).toBe(false)
    expect(published).toEqual([true, true, false, false])
    unsubscribe()
  })

  it('closes completion input without dropping the final pending timing', () => {
    const source = createVocalTrack({
      id: 'one-word',
      lines: [createLyricLine('last', { id: 'last-line' })],
    })
    const session = new SyncSession(source, 0, 12)

    expect(session.start(1_000, false).started).toBe(true)
    expect(session.getSnapshot()).toMatchObject({ cursor: 1, targetWordId: null, hasPending: true })
    session.closeInput()
    expect(session.isClosed).toBe(true)
    expect(session.start(2_000, false)).toEqual({ wordId: null, started: false })
    expect(session.drainPatches()).toEqual(
      new Map([[source.lines[0].words[0].id, { startMs: 1_000, endMs: 1_100 }]]),
    )
  })

  it('uses newly timed words as dynamic successor boundaries', () => {
    const source = createVocalTrack({
      id: 'anchors',
      name: 'Anchors',
      lines: [
        createLyricLine('', {
          id: 'anchors-line',
          words: [
            createLyricWord('one', { id: 'one', startMs: 0, endMs: 100 }),
            createLyricWord('two', { id: 'two' }),
            createLyricWord('three', { id: 'three' }),
            createLyricWord('four', { id: 'four', startMs: 1_000, endMs: 1_100 }),
          ],
        }),
      ],
    })
    const session = new SyncSession(source, 2, 1)

    expect(session.start(500, false)).toMatchObject({ wordId: 'three', started: true })
    expect(session.select('two')).toBe(true)
    expect(session.start(700, false)).toEqual({ wordId: 'two', started: false })
  })

  it('keeps maximum accepted aggregate-density taps bounded and presentation limited', () => {
    const activeWordCount = 5_000
    const wordsPerLine = 5
    const sessions = Array.from({ length: 8 }, (_, singer) => {
      const words = Array.from({ length: singer === 0 ? activeWordCount : 0 }, (_, index) =>
        createLyricWord('x', { id: `s${singer}-w${index}` }),
      )
      return new SyncSession(
        createVocalTrack({
          id: `singer-${singer}`,
          lines: Array.from({ length: words.length / wordsPerLine }, (_, line) =>
            createLyricLine('', {
              id: `line-${singer}-${line}`,
              words: words.slice(line * wordsPerLine, line * wordsPerLine + wordsPerLine),
            }),
          ),
        }),
        0,
        singer,
      )
    })
    const session = sessions[0]
    const timings: number[] = []
    for (let index = 0; index < 80; index += 1) {
      const started = performance.now()
      expect(session.start(index * 120, false).started).toBe(true)
      timings.push(performance.now() - started)
    }
    expect(Math.max(...timings)).toBeLessThan(16.7)
    expect(session.getSnapshot()).toMatchObject({ cursor: 80, total: activeWordCount })
    expect(session.getPendingWords()).toHaveLength(64)
    expect(sessions.reduce((total, candidate) => total + candidate.getSnapshot().total, 0)).toBe(
      activeWordCount,
    )
  })

  it('publishes a truthful constant-size excerpt for a 5k-word single line', () => {
    const wordCount = 5_000
    const words = Array.from({ length: wordCount }, (_, index) =>
      createLyricWord(`word-${index}`, { id: `word-${index}` }),
    )
    const session = new SyncSession(
      createVocalTrack({
        id: 'single-line',
        lines: [createLyricLine('', { id: 'single-line', words })],
      }),
      2_500,
      9,
    )
    const initial = session.getSnapshot()
    expect(initial).toMatchObject({
      total: wordCount,
      cursor: 2_500,
      targetWordId: 'word-2500',
      cueTokenCount: SYNC_CUE_MAX_TOKENS,
    })
    expect(initial.currentLine).toMatchObject({
      id: 'single-line',
      sourceLineIndex: 0,
      sourceWordCount: wordCount,
      beforeCount: 2_496,
      afterCount: 2_495,
    })
    expect(initial.currentLine?.tokens.map((token) => token.id)).toEqual([
      'word-2496',
      'word-2497',
      'word-2498',
      'word-2499',
      'word-2500',
      'word-2501',
      'word-2502',
      'word-2503',
      'word-2504',
    ])
    expect(session.start(1_000, false).started).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      cursor: 2_501,
      targetWordId: 'word-2501',
      cueTokenCount: SYNC_CUE_MAX_TOKENS,
    })
  })
})
