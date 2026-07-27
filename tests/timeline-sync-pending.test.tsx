// @vitest-environment happy-dom

import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  Timeline,
  indexTimelineLinesBySourceIndex,
  pendingLineLayoutAt,
} from '../src/components/Timeline'
import type { TimelineLineLayout, TimelineTrackLayout } from '../src/components/timeline-geometry'
import { createDemoProject, createLyricLine, createVocalTrack } from '../src/lib/model'
import { SyncSession } from '../src/lib/sync-session'
import { resolveVocalSungColor } from '../src/lib/video-style'

let root: Root | null = null

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function renderPending(activeTrackId = 'duet') {
  const lead = createVocalTrack({
    id: 'lead',
    name: 'Lead',
    lines: [createLyricLine('lead', { id: 'lead-line' })],
  })
  const duet = createVocalTrack({
    id: 'duet',
    name: 'Duet',
    lines: [
      createLyricLine('', {
        id: 'duet-line',
        words: [
          { id: 'duet-word', text: 'duet', startMs: 1_000, endMs: 1_100 },
          { id: 'duet-next', text: 'next', startMs: 2_000, endMs: 2_100 },
        ],
      }),
    ],
  })
  const project = { ...createDemoProject(), tracks: [lead, duet] }
  const session = new SyncSession(duet, 0, 1)
  session.start(1_500, false)
  const onSelectWords = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={10_000}
        currentMs={0}
        zoom={1}
        activeTrackId={activeTrackId}
        selectedWordIds={new Set()}
        syncWordId={null}
        syncSession={session}
        syncMode
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={onSelectWords}
        onShiftWords={() => undefined}
        onResizeWord={() => undefined}
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />,
    ),
  )
  return { duet, onSelectWords, project }
}

function renderSyncTarget(
  project: ReturnType<typeof createDemoProject>,
  session: SyncSession | null,
  activeTrackId: string,
  currentMs = 0,
  selectedWordIds = new Set<string>(),
  syncOwnerScope = session
    ? `${project.id}\0sync-owner\0${session.trackId}\0${session.epoch}`
    : null,
  strictMode = false,
) {
  const timeline = (
    <Timeline
      project={project}
      peaks={[]}
      isAnalyzing={false}
      durationMs={10_000}
      currentMs={currentMs}
      zoom={1}
      activeTrackId={activeTrackId}
      selectedWordIds={selectedWordIds}
      syncWordId={null}
      syncSession={session}
      syncOwnerScope={syncOwnerScope}
      syncMode={session !== null}
      onSeek={() => undefined}
      onZoom={() => undefined}
      onSelectWord={() => undefined}
      onSelectWords={() => undefined}
      onShiftWords={() => undefined}
      onResizeWord={() => undefined}
      onTimingDraftChange={() => undefined}
      onToggleSync={() => undefined}
      onClearTiming={() => undefined}
      onClearTimingAfterCursor={() => undefined}
    />
  )
  act(() => root?.render(strictMode ? <StrictMode>{timeline}</StrictMode> : timeline))
}

describe('Timeline pending sync blocks', () => {
  it('uses one indexed tail lookup for a 20,000-line layout', () => {
    const lines = Array.from(
      { length: 20_000 },
      (_, lineIndex) => ({ lineIndex, words: [] }) as TimelineLineLayout,
    )
    const indexed = indexTimelineLinesBySourceIndex({
      trackId: 'large',
      height: 62,
      maxRight: 0,
      lines,
    } as TimelineTrackLayout)
    let lookups = 0
    const observed = {
      get(lineIndex: number) {
        lookups += 1
        return indexed.get(lineIndex)
      },
    }

    expect(pendingLineLayoutAt(observed, 19_999)?.lineIndex).toBe(19_999)
    expect(lookups).toBe(1)
  })

  it('keeps a pending block inert and owned by the active non-first track lane', () => {
    const { duet, onSelectWords, project } = renderPending()
    const pending = document.querySelector<HTMLElement>('[data-sync-pending-word-id="duet-word"]')
    const duetLane = document.querySelector<HTMLElement>('[data-track-id="duet"]')
    const leadLane = document.querySelector<HTMLElement>('[data-track-id="lead"]')
    if (!pending || !duetLane || !leadLane) throw new Error('Expected mounted timing lanes')

    expect(pending.tagName).toBe('SPAN')
    expect(pending.getAttribute('aria-hidden')).toBe('true')
    expect(pending.getAttribute('tabindex')).toBeNull()
    expect(pending.closest('[data-track-id]')).toBe(duetLane)
    expect(leadLane.contains(pending)).toBe(false)
    expect(pending.style.getPropertyValue('--track-color')).toBe(
      resolveVocalSungColor(project.stageStyle, duet.vocalStyle),
    )
    expect(getComputedStyle(pending).cursor).toBe('default')

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
    act(() => pending.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    expect(onSelectWords).not.toHaveBeenCalled()
    expect(document.querySelector('.timeline-marquee')).toBeNull()
  })

  it('does not render the session pending block in an inactive lane', () => {
    renderPending('lead')
    expect(document.querySelector('[data-sync-pending-word-id="duet-word"]')).toBeNull()
  })

  it('clears target styling when the active track leaves the session scope', () => {
    const { project, duet } = renderPending()
    const session = new SyncSession(duet, 0, 2)
    session.start(1_500, false)
    renderSyncTarget(project, session, 'duet')

    expect(document.querySelectorAll('.is-sync-target')).toHaveLength(2)

    renderSyncTarget(project, session, 'lead')
    expect(document.querySelector('.is-sync-target')).toBeNull()
  })

  it('clears target styling when the sync session ends', () => {
    const { project, duet } = renderPending()
    const session = new SyncSession(duet, 0, 4)
    session.start(1_500, false)
    renderSyncTarget(project, session, 'duet')

    const previousTargets = [...document.querySelectorAll<HTMLElement>('.is-sync-target')]
    expect(previousTargets).toHaveLength(2)

    renderSyncTarget(project, null, 'duet')
    expect(document.querySelector('.is-sync-target')).toBeNull()
    expect(previousTargets.every((target) => !target.classList.contains('is-sync-target'))).toBe(
      true,
    )
  })

  it('keeps StrictMode sync target refs attached across current-time and selection render churn', () => {
    const { project, duet } = renderPending()
    const session = new SyncSession(duet, 0, 3)
    session.start(1_500, false)
    renderSyncTarget(project, session, 'duet', 0, new Set(), undefined, true)

    const targets = [...document.querySelectorAll<HTMLElement>('.is-sync-target')]
    expect(targets).toHaveLength(2)
    const classListPrototype = Object.getPrototypeOf(targets[0].classList) as {
      add: (...tokens: string[]) => void
      remove: (...tokens: string[]) => void
    }
    const originalAdd = classListPrototype.add
    const originalRemove = classListPrototype.remove
    let targetRegistryOperations = 0
    classListPrototype.add = function (this: DOMTokenList, ...tokens: string[]) {
      if (tokens.includes('is-sync-target')) targetRegistryOperations += 1
      return originalAdd.apply(this, tokens)
    }
    classListPrototype.remove = function (this: DOMTokenList, ...tokens: string[]) {
      if (tokens.includes('is-sync-target')) targetRegistryOperations += 1
      return originalRemove.apply(this, tokens)
    }

    try {
      renderSyncTarget(project, session, 'duet', 500, new Set(), undefined, true)
      renderSyncTarget(project, session, 'duet', 500, new Set(['duet-word']), undefined, true)
    } finally {
      classListPrototype.add = originalAdd
      classListPrototype.remove = originalRemove
    }

    expect(targetRegistryOperations).toBe(0)
    expect(targets.every((target) => target.classList.contains('is-sync-target'))).toBe(true)
    expect(document.querySelectorAll('.is-sync-target')).toHaveLength(2)

    renderSyncTarget(project, session, 'lead', 500, new Set(['duet-word']), undefined, true)
    expect(document.querySelector('.is-sync-target')).toBeNull()
    expect(targets.every((target) => !target.classList.contains('is-sync-target'))).toBe(true)
  })

  it('removes target styling from detached nodes when the Timeline unmounts', () => {
    renderPending()
    const detached = document.querySelector<HTMLElement>(
      '.timeline-line-label__word.is-sync-target',
    )
    if (!detached) throw new Error('Expected an active sync target')

    act(() => root?.render(<div />))
    expect(detached.isConnected).toBe(false)
    expect(detached.classList.contains('is-sync-target')).toBe(false)
  })
})
