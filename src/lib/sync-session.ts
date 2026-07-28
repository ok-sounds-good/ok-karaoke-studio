import type { LyricWord, VocalTrack } from './model'
import { clampTiming } from './model'
import { flattenTrack } from '../utils'

export interface SyncCueLine {
  id: string
  sourceLineIndex: number
  sourceWordCount: number
  beforeCount: number
  afterCount: number
  tokens: readonly SyncCueToken[]
}

export interface SyncCueToken {
  readonly id: string
  readonly text: string
}

export interface SyncPresentation {
  readonly epoch: number
  readonly cursor: number
  readonly total: number
  readonly hasPending: boolean
  readonly cueTokenCount: number
  readonly targetWordId: string | null
  readonly targetStartMs: number | null
  readonly targetEndMs: number | null
  readonly targetText: string | null
  readonly targetTimed: boolean
  readonly activeWordId: string | null
  readonly activeLine: SyncCueLine | null
  readonly activeTimedWordIds: readonly string[]
  readonly feedback: string
  readonly currentTimedWordIds: readonly string[]
  readonly nextTimedWordIds: readonly string[]
  readonly currentLine: SyncCueLine | null
  readonly nextLine: SyncCueLine | null
}

export interface PendingSyncWord {
  readonly id: string
  readonly text: string
  readonly lineIndex: number
  readonly wordIndex: number
  readonly startMs: number | null
  readonly endMs: number | null
  initiallyTimed: boolean
  readonly changedFromMaterialized: boolean
}

type TimingPatch = Partial<Pick<LyricWord, 'startMs' | 'endMs'>>

interface IndexedWord {
  readonly id: string
  readonly lineId: string
  readonly lineIndex: number
  readonly wordIndex: number
  readonly text: string
  readonly cueToken: SyncCueToken
  initiallyTimed: boolean
  materializedStartMs: number | null
  materializedEndMs: number | null
  startMs: number | null
  endMs: number | null
}

interface IndexedLine {
  readonly id: string
  readonly wordIndexes: readonly number[]
  readonly nextNonEmptyLineIndex: number | null
}

export interface SyncStartResult {
  readonly wordId: string | null
  readonly started: boolean
}

const DEFAULT_DURATION_MS = 100
export const SYNC_CUE_CONTEXT_WORDS = 4
export const SYNC_CUE_MAX_TOKENS = SYNC_CUE_CONTEXT_WORDS * 2 + 1

/** Indexed timing anchors keep predecessor/successor lookup O(log n) as taps
 * turn formerly untimed words into real boundaries. */
class TimingAnchors {
  private readonly tree: Int32Array

  constructor(size: number, timedIndexes: readonly number[]) {
    this.tree = new Int32Array(size + 1)
    for (const index of timedIndexes) this.add(index, 1)
  }

  set(index: number, timed: boolean) {
    const present = this.countThrough(index) - this.countThrough(index - 1)
    const desired = timed ? 1 : 0
    if (present !== desired) this.add(index, desired - present)
  }

  previousBefore(index: number) {
    const count = this.countThrough(index - 1)
    return count ? this.indexAtRank(count) : null
  }

  nextAfter(index: number) {
    const count = this.countThrough(index)
    const total = this.countThrough(this.tree.length - 2)
    return count < total ? this.indexAtRank(count + 1) : null
  }

  private add(index: number, delta: number) {
    for (let cursor = index + 1; cursor < this.tree.length; cursor += cursor & -cursor) {
      this.tree[cursor] += delta
    }
  }

  private countThrough(index: number) {
    let sum = 0
    for (
      let cursor = Math.min(index + 1, this.tree.length - 1);
      cursor > 0;
      cursor -= cursor & -cursor
    ) {
      sum += this.tree[cursor]
    }
    return sum
  }

  private indexAtRank(rank: number) {
    let index = 0
    let bit = 1
    while (bit * 2 < this.tree.length) bit *= 2
    for (; bit; bit >>= 1) {
      const candidate = index + bit
      if (candidate < this.tree.length && this.tree[candidate] < rank) {
        index = candidate
        rank -= this.tree[candidate]
      }
    }
    return index
  }
}

/**
 * A renderer-only, allocation-bounded timing authority.  It deliberately owns
 * copies of the timing scalars, never project objects, so tap input can stay
 * out of React/history/persistence until an explicit boundary asks for patches.
 */
export class SyncSession {
  readonly epoch: number
  readonly trackId: string
  private readonly words: IndexedWord[]
  private readonly lines: IndexedLine[]
  private readonly ordinalByWordId = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private readonly patches = new Map<string, TimingPatch>()
  private readonly recentPatchIds: string[] = []
  private readonly timingAnchors: TimingAnchors
  private cursor: number
  private held: {
    wordIndex: number
    startMs: number
    finalInLine: boolean
    advanceOnRelease: boolean
  } | null = null
  private explicitlyEnded = new Set<string>()
  private presentation: SyncPresentation
  private feedback = ''
  private closed = false

  constructor(track: VocalTrack, cursor: number, epoch: number) {
    this.epoch = epoch
    this.trackId = track.id
    const flattened = flattenTrack(track)
    this.timingAnchors = new TimingAnchors(
      flattened.length,
      flattened.flatMap((item, index) => (item.word.startMs === null ? [] : [index])),
    )
    this.words = flattened.map((item, index) => ({
      id: item.word.id,
      lineId: item.line.id,
      lineIndex: item.lineIndex,
      wordIndex: item.wordIndex,
      text: item.word.text,
      cueToken: Object.freeze({ id: item.word.id, text: item.word.text.replaceAll('/', '·') }),
      initiallyTimed: item.word.startMs !== null,
      materializedStartMs: item.word.startMs,
      materializedEndMs: item.word.endMs,
      startMs: item.word.startMs,
      endMs: item.word.endMs,
    }))
    this.lines = track.lines.map((line) => ({
      id: line.id,
      wordIndexes: [],
      nextNonEmptyLineIndex: null,
    }))
    for (let index = 0; index < this.words.length; index += 1) {
      this.ordinalByWordId.set(this.words[index].id, index)
      ;(this.lines[this.words[index].lineIndex].wordIndexes as number[]).push(index)
    }
    let nextNonEmpty: number | null = null
    for (let index = this.lines.length - 1; index >= 0; index -= 1) {
      this.lines[index] = { ...this.lines[index], nextNonEmptyLineIndex: nextNonEmpty }
      if (this.lines[index].wordIndexes.length) nextNonEmpty = index
    }
    this.cursor = Math.min(Math.max(0, cursor), this.words.length)
    this.presentation = this.makePresentation()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.presentation

  get hasPending() {
    return this.patches.size > 0
  }

  get isClosed() {
    return this.closed
  }

  getPendingWords(): readonly PendingSyncWord[] {
    return this.recentPatchIds.map((id) => {
      const word = this.words[this.ordinalByWordId.get(id)!]
      return {
        id: word.id,
        text: word.text,
        lineIndex: word.lineIndex,
        wordIndex: word.wordIndex,
        startMs: word.startMs,
        endMs: word.endMs,
        initiallyTimed: word.initiallyTimed,
        changedFromMaterialized:
          word.startMs !== word.materializedStartMs || word.endMs !== word.materializedEndMs,
      }
    })
  }

  get currentWordId() {
    return this.words[this.cursor]?.id ?? null
  }

  select(wordId: string) {
    if (this.closed) return false
    const index = this.ordinalByWordId.get(wordId) ?? -1
    if (index < 0) return false
    this.cursor = index
    this.held = null
    this.feedback = ''
    this.publish()
    return true
  }

  start(sampledLyricMs: number, advanceOnRelease: boolean): SyncStartResult {
    if (this.closed || sampledLyricMs < 0) return { wordId: null, started: false }
    const item = this.words[this.cursor]
    if (!item) return { wordId: null, started: false }
    const previous = this.words[this.cursor - 1]
    const previousTimedIndex = this.timingAnchors.previousBefore(this.cursor)
    const nextTimedIndex = this.timingAnchors.nextAfter(this.cursor)
    const previousTimed = previousTimedIndex === null ? null : this.words[previousTimedIndex]
    const nextTimed = nextTimedIndex === null ? null : this.words[nextTimedIndex]
    const nearestPrevious = previous?.startMs !== null ? previous : previousTimed
    const previousEnd =
      nearestPrevious && nearestPrevious.startMs !== null
        ? Math.max(
            nearestPrevious.startMs + 1,
            nearestPrevious.endMs ?? nearestPrevious.startMs + DEFAULT_DURATION_MS,
          )
        : null
    const nextStart = nextTimed?.startMs ?? null
    const startMs = Math.max(Math.round(sampledLyricMs), previousEnd ?? 0)
    if (nextStart !== null && startMs >= nextStart) return { wordId: item.id, started: false }
    this.explicitlyEnded.delete(item.id)
    if (
      previous &&
      previous.lineId === item.lineId &&
      previous.startMs !== null &&
      !this.explicitlyEnded.has(previous.id)
    ) {
      this.patch(previous, { endMs: startMs }, false)
    }
    this.patch(
      item,
      clampTiming(startMs, startMs + DEFAULT_DURATION_MS, {
        minMs: startMs,
        maxMs: nextStart ?? Number.POSITIVE_INFINITY,
        minimumDurationMs: DEFAULT_DURATION_MS,
      }),
      false,
    )
    this.held = {
      wordIndex: this.cursor,
      startMs,
      finalInLine: item.wordIndex === this.lines[item.lineIndex].wordIndexes.length - 1,
      advanceOnRelease,
    }
    if (!advanceOnRelease) {
      this.cursor += 1
      const next = this.words[this.cursor]
      this.feedback = next
        ? `Started ${item.cueToken.text}. Next target: ${next.cueToken.text}.`
        : `Started ${item.cueToken.text}. No next target remains; press Down to end the active word.`
    } else {
      this.feedback = `Started ${item.cueToken.text}. Release Space to finish it.`
    }
    this.publish()
    return { wordId: item.id, started: true }
  }

  end(sampledLyricMs: number) {
    const held = this.held
    if (this.closed || !held || sampledLyricMs < 0) return false
    const item = this.words[held.wordIndex]
    const nextTimedIndex = this.timingAnchors.nextAfter(held.wordIndex)
    const nextTimed = nextTimedIndex === null ? null : this.words[nextTimedIndex]
    this.patch(
      item,
      clampTiming(held.startMs, sampledLyricMs, {
        minMs: held.startMs,
        maxMs: nextTimed?.startMs ?? Number.POSITIVE_INFINITY,
        minimumDurationMs: 1,
      }),
      false,
    )
    this.explicitlyEnded.add(item.id)
    this.held = null
    if (held.advanceOnRelease) this.cursor += 1
    const next = this.words[this.cursor]
    this.feedback = next
      ? `Ended ${item.cueToken.text}. Next target: ${next.cueToken.text}.`
      : `Ended ${item.cueToken.text}. No next target remains.`
    this.publish()
    return true
  }

  release(sampledLyricMs: number) {
    const held = this.held
    if (this.closed || !held) return false
    const item = this.words[held.wordIndex]
    if (held.finalInLine && sampledLyricMs >= 0) {
      const nextTimedIndex = this.timingAnchors.nextAfter(held.wordIndex)
      const nextTimed = nextTimedIndex === null ? null : this.words[nextTimedIndex]
      this.patch(
        item,
        clampTiming(held.startMs, sampledLyricMs, {
          minMs: held.startMs,
          maxMs: nextTimed?.startMs ?? Number.POSITIVE_INFINITY,
          minimumDurationMs: DEFAULT_DURATION_MS,
        }),
        false,
      )
    }
    this.held = null
    this.cursor += 1
    const next = this.words[this.cursor]
    this.feedback = next
      ? `Finished ${item.cueToken.text}. Next target: ${next.cueToken.text}.`
      : `Finished ${item.cueToken.text}. No next target remains.`
    this.publish()
    return true
  }

  abandonHeld() {
    if (!this.held) return false
    this.held = null
    this.feedback = ''
    this.publish()
    return true
  }

  drainPatches() {
    const result = new Map(this.patches)
    this.patches.clear()
    this.recentPatchIds.length = 0
    this.publish()
    return result
  }

  restorePatches(patches: ReadonlyMap<string, TimingPatch>) {
    for (const [id, patch] of patches) {
      const index = this.ordinalByWordId.get(id)
      if (index !== undefined) this.patch(this.words[index], patch, false)
    }
    this.publish()
  }

  acknowledgeMaterialized(patches: ReadonlyMap<string, TimingPatch>) {
    for (const id of patches.keys()) {
      const index = this.ordinalByWordId.get(id)
      if (index !== undefined) {
        const word = this.words[index]
        word.initiallyTimed = word.startMs !== null
        word.materializedStartMs = word.startMs
        word.materializedEndMs = word.endMs
      }
    }
    this.publish()
  }

  closeInput() {
    if (this.closed) return
    const hadActiveWord = this.held !== null
    this.closed = true
    this.held = null
    if (hadActiveWord) {
      this.feedback = ''
      this.publish()
    }
  }

  close() {
    this.closeInput()
    this.listeners.clear()
  }

  private patch(item: IndexedWord, patch: TimingPatch, publish = true) {
    const wasTimed = item.startMs !== null
    if (patch.startMs !== undefined) item.startMs = patch.startMs
    if (patch.endMs !== undefined) item.endMs = patch.endMs
    if ((item.startMs !== null) !== wasTimed) {
      this.timingAnchors.set(this.ordinalByWordId.get(item.id)!, item.startMs !== null)
    }
    if (!this.patches.has(item.id)) {
      this.recentPatchIds.push(item.id)
      if (this.recentPatchIds.length > 64) this.recentPatchIds.shift()
    }
    const current = this.patches.get(item.id) ?? {}
    this.patches.set(item.id, { ...current, ...patch })
    if (publish) this.publish()
  }

  private advance(clearHeld = true) {
    this.cursor += 1
    if (clearHeld) this.held = null
    this.publish()
  }

  private makePresentation(): SyncPresentation {
    const item = this.words[this.cursor] ?? null
    const active = this.held === null ? null : this.words[this.held.wordIndex]
    const currentLine = item ? this.lines[item.lineIndex] : null
    const nextLine = currentLine?.nextNonEmptyLineIndex
    const currentCue = currentLine ? this.cueLine(item!.lineIndex, this.cursor) : null
    const nextCue =
      nextLine === null || nextLine === undefined
        ? null
        : this.cueLine(nextLine, this.lines[nextLine].wordIndexes[0])
    const activeCue = active ? this.cueLine(active.lineIndex, this.held!.wordIndex) : null
    return {
      epoch: this.epoch,
      cursor: this.cursor,
      total: this.words.length,
      hasPending: this.patches.size > 0,
      cueTokenCount: (currentCue?.line.tokens.length ?? 0) + (nextCue?.line.tokens.length ?? 0),
      targetWordId: item?.id ?? null,
      targetStartMs: item?.startMs ?? null,
      targetEndMs: item?.endMs ?? null,
      targetText: item?.text.replaceAll('/', '·') ?? null,
      targetTimed: item?.startMs !== null,
      activeWordId: active?.id ?? null,
      activeLine: activeCue?.line ?? null,
      activeTimedWordIds: activeCue?.timedWordIds ?? [],
      feedback: this.feedback,
      currentTimedWordIds: currentCue?.timedWordIds ?? [],
      nextTimedWordIds: nextCue?.timedWordIds ?? [],
      currentLine: currentCue?.line ?? null,
      nextLine: nextCue?.line ?? null,
    }
  }

  private publish() {
    this.presentation = this.makePresentation()
    for (const listener of this.listeners) listener()
  }

  private cueLine(lineIndex: number, focusWordIndex: number) {
    const line = this.lines[lineIndex]
    const focusPosition = this.words[focusWordIndex]?.wordIndex ?? 0
    const start = Math.max(0, focusPosition - SYNC_CUE_CONTEXT_WORDS)
    const end = Math.min(line.wordIndexes.length, focusPosition + SYNC_CUE_CONTEXT_WORDS + 1)
    const wordIndexes = line.wordIndexes.slice(start, end)
    return {
      line: {
        id: line.id,
        sourceLineIndex: lineIndex,
        sourceWordCount: line.wordIndexes.length,
        beforeCount: start,
        afterCount: line.wordIndexes.length - end,
        tokens: wordIndexes.map((index) => this.words[index].cueToken),
      },
      timedWordIds: wordIndexes
        .filter((index) => this.words[index].startMs !== null)
        .map((index) => this.words[index].id),
    }
  }
}

export function indexedSyncCursor(track: VocalTrack, wordId: string) {
  const flattened = flattenTrack(track)
  return flattened.findIndex((item) => item.word.id === wordId)
}
