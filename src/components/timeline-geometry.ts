import type { LyricLine, LyricWord, VocalTrack } from '../lib/model'
import type { ProjectTimingDraft } from '../utils'

const TIMELINE_LABEL_GAP_PX = 4
const TIMELINE_LABEL_LANE_GAP_PX = 4
const TIMELINE_LABEL_ROW_HEIGHT_PX = 20
const TIMELINE_WORD_ZONE_GAP_PX = 5
const TIMELINE_WORD_ROW_GAP_PX = 3
const TIMELINE_EDGE_TOLERANCE_PX = 0.01

/** The DOM budget is deliberately independent from project size. */
export const TIMELINE_WORD_DOM_CAP_PER_TRACK = 96
export const TIMELINE_LABEL_DOM_CAP_PER_TRACK = TIMELINE_WORD_DOM_CAP_PER_TRACK
export const TIMELINE_LABEL_TOP_PX = 3
export const TIMELINE_WORD_HEIGHT_PX = 17
export const TIMELINE_MIN_TRACK_HEIGHT_PX = 62

export interface TimelineWordLayout {
  word: LyricWord
  lineIndex: number
  wordIndex: number
  left: number
  top: number
  width: number
  labelLeft: number
  labelWidth: number
  collisionEnd: number
  /** Precomputed once so viewport and sync updates never transform lyric text. */
  labelText: string
}

export interface TimelineLabelLayout {
  word: TimelineWordLayout
  left: number
  top: number
  width: number
  height: number
}

export interface TimelineLineLayout {
  line: LyricLine
  lineIndex: number
  lane: number
  top: number
  height: number
  labelLeft: number
  labelWidth: number
  intervalStart: number
  intervalEnd: number
  words: TimelineWordLayout[]
}

interface IntervalNode<T> {
  value: T
  maxEnd: number
  left: IntervalNode<T> | null
  right: IntervalNode<T> | null
}

interface TimelineBand<T> {
  top: number
  bottom: number
  values: T[]
}

interface TimelineRectIndex<T> {
  bands: TimelineBand<T>[]
  globalIntervalIndex: IntervalNode<T> | null
}

export interface TimelineIndexStats {
  comparisons: number
  nodes: number
  bands: number
}

export interface TimelineTrackLayout {
  trackId: string
  height: number
  maxRight: number
  lines: TimelineLineLayout[]
  /** Complete non-DOM schedule; all lookups below remain O(1) or logarithmic. */
  words: TimelineWordLayout[]
  wordsByTop: TimelineWordLayout[]
  labels: TimelineLabelLayout[]
  labelByWordId: ReadonlyMap<string, TimelineLabelLayout>
  wordById: ReadonlyMap<string, TimelineWordLayout>
  lineIndexByWordId: ReadonlyMap<string, number>
  lineBySourceIndex: ReadonlyMap<number, TimelineLineLayout>
  wordIdBySource: ReadonlyMap<string, string>
  wordRectIndex: TimelineRectIndex<TimelineWordLayout>
  labelRectIndex: TimelineRectIndex<TimelineLabelLayout>
  lineRectIndex: TimelineRectIndex<TimelineLineLayout>
  indexStats: TimelineIndexStats
}

export interface TimelineSelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface TimelineQueryResult<T> {
  values: T[]
  visited: number
  nodesVisited: number
  truncated: boolean
}

export function timelineWordLabel(word: LyricWord) {
  return word.text.replaceAll('/', '·')
}

function timelineLabelWidth(word: LyricWord) {
  return Math.max(14, Array.from(timelineWordLabel(word)).length * 6 + 4)
}

class MinHeap<T> {
  #items: T[] = []
  constructor(private readonly before: (left: T, right: T) => boolean) {}
  get size() {
    return this.#items.length
  }
  peek() {
    return this.#items[0]
  }
  push(value: T) {
    const items = this.#items
    items.push(value)
    for (let index = items.length - 1; index > 0;) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.before(items[index]!, items[parent]!)) break
      ;[items[index], items[parent]] = [items[parent]!, items[index]!]
      index = parent
    }
  }
  pop() {
    const items = this.#items
    const first = items[0]
    const last = items.pop()
    if (items.length && last !== undefined) {
      items[0] = last
      for (let index = 0; ;) {
        const left = index * 2 + 1
        const right = left + 1
        let next = index
        if (left < items.length && this.before(items[left]!, items[next]!)) next = left
        if (right < items.length && this.before(items[right]!, items[next]!)) next = right
        if (next === index) break
        ;[items[index], items[next]] = [items[next]!, items[index]!]
        index = next
      }
    }
    return first
  }
}

function assignRows<
  T extends {
    left: number
    collisionEnd: number
    word: LyricWord
    lineIndex: number
    wordIndex: number
  },
>(values: readonly T[]) {
  const busy = new MinHeap<{ end: number; row: number }>(
    (left, right) => left.end < right.end || (left.end === right.end && left.row < right.row),
  )
  const free = new MinHeap<number>((left, right) => left < right)
  const rows = new Map<string, number>()
  let rowCount = 0
  for (const value of [...values].sort(
    (a, b) => a.left - b.left || a.lineIndex - b.lineIndex || a.wordIndex - b.wordIndex,
  )) {
    while ((busy.peek()?.end ?? Infinity) <= value.left + TIMELINE_EDGE_TOLERANCE_PX) {
      free.push(busy.pop()!.row)
    }
    const row = free.pop() ?? rowCount++
    busy.push({ end: value.collisionEnd, row })
    rows.set(value.word.id, row)
  }
  return { rowCount: Math.max(1, rowCount), rows }
}

function assignLineLanes(lines: TimelineLineLayout[]) {
  const busy = new MinHeap<{ end: number; lane: number }>(
    (left, right) => left.end < right.end || (left.end === right.end && left.lane < right.lane),
  )
  const free = new MinHeap<number>((left, right) => left < right)
  let laneCount = 0
  for (const line of lines) {
    while ((busy.peek()?.end ?? Infinity) + TIMELINE_LABEL_GAP_PX <= line.intervalStart) {
      free.push(busy.pop()!.lane)
    }
    line.lane = free.pop() ?? laneCount++
    busy.push({ end: line.intervalEnd, lane: line.lane })
  }
  return laneCount
}

function buildIntervalIndex<T>(
  values: readonly T[],
  start: (value: T) => number,
  end: (value: T) => number,
  stats: TimelineIndexStats,
): IntervalNode<T> | null {
  const sorted = [...values].sort((left, right) => {
    stats.comparisons += 1
    return start(left) - start(right) || end(left) - end(right)
  })
  const build = (from: number, until: number): IntervalNode<T> | null => {
    if (from >= until) return null
    const middle = from + Math.floor((until - from) / 2)
    const value = sorted[middle]!
    const left = build(from, middle)
    const right = build(middle + 1, until)
    stats.nodes += 1
    return {
      value,
      maxEnd: Math.max(
        end(value),
        left?.maxEnd ?? Number.NEGATIVE_INFINITY,
        right?.maxEnd ?? Number.NEGATIVE_INFINITY,
      ),
      left,
      right,
    }
  }
  return build(0, sorted.length)
}

function queryIntervalIndex<T>(
  node: IntervalNode<T> | null,
  left: number,
  right: number,
  start: (value: T) => number,
  end: (value: T) => number,
  output: T[],
  maximum: number,
  state: { visited: number; nodesVisited: number; truncated: boolean },
): boolean {
  if (!node) return false
  const add = (value: T) => {
    state.visited += 1
    if (output.length >= maximum) {
      state.truncated = true
      return false
    }
    output.push(value)
    return true
  }
  state.nodesVisited += 1
  if (node.maxEnd < left) return false
  if (queryIntervalIndex(node.left, left, right, start, end, output, maximum, state)) return true
  if (start(node.value) > right) return false
  if (end(node.value) >= left && !add(node.value)) return true
  return queryIntervalIndex(node.right, left, right, start, end, output, maximum, state)
}

function sourceOrder(left: TimelineWordLayout, right: TimelineWordLayout) {
  return left.lineIndex - right.lineIndex || left.wordIndex - right.wordIndex
}

function buildRectIndex<T>(
  values: readonly T[],
  left: (value: T) => number,
  right: (value: T) => number,
  top: (value: T) => number,
  bottom: (value: T) => number,
  stats: TimelineIndexStats,
): TimelineRectIndex<T> {
  const grouped = new Map<string, { top: number; bottom: number; values: T[] }>()
  for (const value of values) {
    const valueTop = top(value)
    const valueBottom = bottom(value)
    const key = `${valueTop}\u0000${valueBottom}`
    const group = grouped.get(key) ?? { top: valueTop, bottom: valueBottom, values: [] }
    group.values.push(value)
    grouped.set(key, group)
  }
  const bands = [...grouped.values()]
    .sort((a, b) => {
      stats.comparisons += 1
      return a.top - b.top || a.bottom - b.bottom
    })
    .map((group) => ({
      top: group.top,
      bottom: group.bottom,
      values: group.values.sort((first, second) => {
        stats.comparisons += 1
        return left(first) - left(second) || right(first) - right(second)
      }),
    }))
  stats.bands += bands.length
  return { bands, globalIntervalIndex: buildIntervalIndex(values, left, right, stats) }
}

function firstIntersectingBand<T>(bands: readonly TimelineBand<T>[], top: number) {
  let low = 0
  let high = bands.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (bands[middle]!.bottom < top) low = middle + 1
    else high = middle
  }
  return low
}

function firstIntersectingValue<T>(values: readonly T[], left: number, end: (value: T) => number) {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (end(values[middle]!) < left) low = middle + 1
    else high = middle
  }
  return low
}

function queryRectIndex<T>(
  index: TimelineRectIndex<T>,
  left: number,
  right: number,
  top: number,
  bottom: number,
  start: (value: T) => number,
  end: (value: T) => number,
  maximum = Number.POSITIVE_INFINITY,
): TimelineQueryResult<T> {
  const values: T[] = []
  const state = { visited: 0, nodesVisited: 0, truncated: false }
  if (!Number.isFinite(top) && !Number.isFinite(bottom)) {
    queryIntervalIndex(index.globalIntervalIndex, left, right, start, end, values, maximum, state)
    return { values, ...state }
  }
  for (
    let bandIndex = firstIntersectingBand(index.bands, top);
    bandIndex < index.bands.length;
    bandIndex += 1
  ) {
    const band = index.bands[bandIndex]!
    if (band.top > bottom) break
    for (
      let valueIndex = firstIntersectingValue(band.values, left, end);
      valueIndex < band.values.length;
      valueIndex += 1
    ) {
      const value = band.values[valueIndex]!
      state.visited += 1
      if (start(value) > right) break
      if (values.length >= maximum) {
        state.truncated = true
        return { values, ...state }
      }
      values.push(value)
    }
  }
  return { values, ...state }
}

export function timelineTime(rawTimingMs: number, offsetMs: number, leadInMs = 0) {
  return leadInMs + rawTimingMs + offsetMs
}

export function buildTimelineTrackLayout(
  track: VocalTrack,
  offsetMs: number,
  pixelsPerSecond: number,
  timingDraft: ProjectTimingDraft | null = null,
  leadInMs = 0,
): TimelineTrackLayout {
  const candidates: TimelineLineLayout[] = []
  for (const [lineIndex, line] of track.lines.entries()) {
    const words: TimelineWordLayout[] = []
    for (const [wordIndex, word] of line.words.entries()) {
      if (word.startMs === null) continue
      const endMs = word.endMs ?? word.startMs + 360
      const draftTiming = timingDraft?.get(word.id)
      const adjustedStart = timelineTime(draftTiming?.startMs ?? word.startMs, offsetMs, leadInMs)
      const adjustedEnd = timelineTime(draftTiming?.endMs ?? endMs, offsetMs, leadInMs)
      if (adjustedEnd <= 0) continue
      const visibleStart = Math.max(0, adjustedStart)
      const left = (visibleStart / 1000) * pixelsPerSecond
      const timingWidth = Math.max(0, ((adjustedEnd - visibleStart) / 1000) * pixelsPerSecond)
      words.push({
        word,
        lineIndex,
        wordIndex,
        left,
        top: 0,
        labelLeft: left,
        width: Math.max(1, timingWidth),
        labelWidth: timelineLabelWidth(word),
        collisionEnd: left + timingWidth,
        labelText: timelineWordLabel(word),
      })
    }
    if (!words.length) continue
    let labelLeft = Number.POSITIVE_INFINITY
    let labelWidth = Math.max(0, words.length - 1) * TIMELINE_LABEL_GAP_PX
    for (const word of words) {
      labelLeft = Math.min(labelLeft, word.left)
      labelWidth += word.labelWidth
    }
    let nextLabelLeft = labelLeft
    for (const word of words) {
      word.labelLeft = nextLabelLeft
      nextLabelLeft += word.labelWidth + TIMELINE_LABEL_GAP_PX
    }
    candidates.push({
      line,
      lineIndex,
      lane: 0,
      top: 0,
      height: TIMELINE_LABEL_ROW_HEIGHT_PX,
      labelLeft,
      labelWidth,
      intervalStart: labelLeft,
      intervalEnd: labelLeft + labelWidth,
      words,
    })
  }
  candidates.sort((a, b) => a.intervalStart - b.intervalStart || a.lineIndex - b.lineIndex)
  const laneCount = assignLineLanes(candidates)
  const labelZoneEnd = laneCount
    ? 2 + laneCount * (TIMELINE_LABEL_ROW_HEIGHT_PX + TIMELINE_LABEL_LANE_GAP_PX)
    : 2
  const words = candidates.flatMap((line) => line.words)
  const { rowCount, rows } = assignRows(words)
  const wordZoneTop = labelZoneEnd + TIMELINE_WORD_ZONE_GAP_PX
  for (const line of candidates) {
    line.top = 2 + line.lane * (TIMELINE_LABEL_ROW_HEIGHT_PX + TIMELINE_LABEL_LANE_GAP_PX)
    for (const word of line.words)
      word.top =
        wordZoneTop +
        (rows.get(word.word.id) ?? 0) * (TIMELINE_WORD_HEIGHT_PX + TIMELINE_WORD_ROW_GAP_PX)
  }
  const trackHeight =
    wordZoneTop +
    rowCount * TIMELINE_WORD_HEIGHT_PX +
    Math.max(0, rowCount - 1) * TIMELINE_WORD_ROW_GAP_PX +
    6
  const sortedLines = [...candidates].sort((a, b) => a.lineIndex - b.lineIndex)
  const lineBySourceIndex = new Map(sortedLines.map((line) => [line.lineIndex, line]))
  const indexStats: TimelineIndexStats = { comparisons: 0, nodes: 0, bands: 0 }
  const labels = words.map((word) => ({
    word,
    left: word.labelLeft,
    top: lineBySourceIndex.get(word.lineIndex)?.top ?? 0,
    width: word.labelWidth,
    height: TIMELINE_LABEL_ROW_HEIGHT_PX,
  }))
  return {
    trackId: track.id,
    height: Math.max(TIMELINE_MIN_TRACK_HEIGHT_PX, trackHeight),
    maxRight: candidates.reduce((maximum, line) => {
      let nextMaximum = Math.max(maximum, line.intervalEnd)
      for (const word of line.words) nextMaximum = Math.max(nextMaximum, word.left + word.width)
      return nextMaximum
    }, 0),
    lines: sortedLines,
    words,
    labels,
    labelByWordId: new Map(labels.map((label) => [label.word.word.id, label])),
    wordsByTop: [...words].sort(
      (leftWord, rightWord) =>
        leftWord.top - rightWord.top ||
        leftWord.lineIndex - rightWord.lineIndex ||
        leftWord.wordIndex - rightWord.wordIndex,
    ),
    wordById: new Map(words.map((word) => [word.word.id, word])),
    lineIndexByWordId: new Map(words.map((word) => [word.word.id, word.lineIndex])),
    lineBySourceIndex,
    wordIdBySource: new Map(
      words.map((word) => [`${word.lineIndex}\u0000${word.wordIndex}`, word.word.id]),
    ),
    wordRectIndex: buildRectIndex(
      words,
      (word) => word.left,
      (word) => word.left + word.width,
      (word) => word.top,
      (word) => word.top + TIMELINE_WORD_HEIGHT_PX,
      indexStats,
    ),
    labelRectIndex: buildRectIndex(
      labels,
      (label) => label.left,
      (label) => label.left + label.width,
      (label) => label.top,
      (label) => label.top + label.height,
      indexStats,
    ),
    lineRectIndex: buildRectIndex(
      sortedLines,
      (line) => line.intervalStart,
      (line) => line.intervalEnd,
      (line) => line.top,
      (line) => line.top + line.height,
      indexStats,
    ),
    indexStats,
  }
}

export function timelineWordsInViewport(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  maximum = Number.POSITIVE_INFINITY,
): TimelineQueryResult<TimelineWordLayout> {
  const query = queryRectIndex(
    layout.wordRectIndex,
    left,
    right,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    (word) => word.left,
    (word) => word.left + word.width,
    maximum,
  )
  query.values.sort(sourceOrder)
  return query
}

export function timelineLinesInViewport(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  maximum = Number.POSITIVE_INFINITY,
): TimelineQueryResult<TimelineLineLayout> {
  return queryRectIndex(
    layout.lineRectIndex,
    left,
    right,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    (line) => line.intervalStart,
    (line) => line.intervalEnd,
    maximum,
  )
}

export function timelineWordsInRect(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  top: number,
  bottom: number,
  maximum = Number.POSITIVE_INFINITY,
): TimelineQueryResult<TimelineWordLayout> {
  const query = queryRectIndex(
    layout.wordRectIndex,
    left,
    right,
    top,
    bottom,
    (word) => word.left,
    (word) => word.left + word.width,
    maximum,
  )
  query.values.sort(sourceOrder)
  return query
}

export function timelineLabelsInRect(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  top: number,
  bottom: number,
  maximum = TIMELINE_LABEL_DOM_CAP_PER_TRACK,
): TimelineQueryResult<TimelineLabelLayout> {
  const query = queryRectIndex(
    layout.labelRectIndex,
    left,
    right,
    top,
    bottom,
    (label) => label.left,
    (label) => label.left + label.width,
    maximum,
  )
  query.values.sort((leftLabel, rightLabel) => sourceOrder(leftLabel.word, rightLabel.word))
  return query
}

export function timelineLineRegionsInRect(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  top: number,
  bottom: number,
  maximum = TIMELINE_LABEL_DOM_CAP_PER_TRACK,
): TimelineQueryResult<TimelineLineLayout> {
  return queryRectIndex(
    layout.lineRectIndex,
    left,
    right,
    top,
    bottom,
    (line) => line.intervalStart,
    (line) => line.intervalEnd,
    maximum,
  )
}

/** Sync and focus labels are rendered even outside the ordinary bounded slice. */
export function timelineMountedLabels(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  top: number,
  bottom: number,
  forcedWordIds: ReadonlySet<string> = new Set(),
  cap = TIMELINE_LABEL_DOM_CAP_PER_TRACK,
) {
  const forced = [...forcedWordIds]
    .flatMap((wordId) => {
      const label = layout.labelByWordId.get(wordId)
      return label ? [label] : []
    })
    .slice(0, cap)
  const forcedIds = new Set(forced.map((label) => label.word.word.id))
  const ordinary = timelineLabelsInRect(layout, left, right, top, bottom, cap).values.filter(
    (label) => !forcedIds.has(label.word.word.id),
  )
  return [...forced, ...ordinary]
    .slice(0, cap)
    .sort((leftLabel, rightLabel) => sourceOrder(leftLabel.word, rightLabel.word))
}

function lowerBoundByTop(words: readonly TimelineWordLayout[], top: number) {
  let low = 0
  let high = words.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (words[middle]!.top + TIMELINE_WORD_HEIGHT_PX < top) low = middle + 1
    else high = middle
  }
  return low
}

export function timelineWordsInVerticalViewport(
  layout: TimelineTrackLayout,
  top: number,
  bottom: number,
  maximum = Number.POSITIVE_INFINITY,
): TimelineQueryResult<TimelineWordLayout> {
  const values: TimelineWordLayout[] = []
  let visited = 0
  for (
    let index = lowerBoundByTop(layout.wordsByTop, top);
    index < layout.wordsByTop.length;
    index += 1
  ) {
    const word = layout.wordsByTop[index]!
    if (word.top > bottom) break
    visited += 1
    if (values.length >= maximum) return { values, visited, nodesVisited: 0, truncated: true }
    values.push(word)
  }
  return { values, visited, nodesVisited: 0, truncated: false }
}

/** Forced records (focus, capture, and sync) displace the farthest ordinary records. */
export function timelineMountedWords(
  layout: TimelineTrackLayout,
  left: number,
  right: number,
  forcedWordIds: ReadonlySet<string> = new Set(),
  cap = TIMELINE_WORD_DOM_CAP_PER_TRACK,
  top = Number.NEGATIVE_INFINITY,
  bottom = Number.POSITIVE_INFINITY,
) {
  const center = (left + right) / 2
  const forced = [...forcedWordIds].flatMap((wordId) => {
    const word = layout.wordById.get(wordId)
    return word ? [word] : []
  })
  const forcedIds = new Set(forced.map((word) => word.word.id))
  const ordinarySource = timelineWordsInRect(layout, left, right, top, bottom, cap)
  const ordinary = ordinarySource.values
    .filter((word) => !forcedIds.has(word.word.id))
    .sort(
      (a, b) =>
        Math.abs(a.left + a.width / 2 - center) - Math.abs(b.left + b.width / 2 - center) ||
        sourceOrder(a, b),
    )
  const mounted = [
    ...forced.slice(0, cap),
    ...ordinary.slice(0, Math.max(0, cap - forced.length)),
  ].sort((leftWord, rightWord) =>
    leftWord.lineIndex === rightWord.lineIndex
      ? leftWord.wordIndex - rightWord.wordIndex
      : leftWord.lineIndex - rightWord.lineIndex,
  )
  return {
    words: mounted,
    omittedCount:
      ordinarySource.truncated || ordinary.length > Math.max(0, cap - forced.length) ? 1 : 0,
  }
}

export function timelineWordIdsInRect(layout: TimelineTrackLayout, rect: TimelineSelectionRect) {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  return new Set(
    timelineWordsInRect(layout, left, right, top, bottom).values.map((word) => word.word.id),
  )
}
