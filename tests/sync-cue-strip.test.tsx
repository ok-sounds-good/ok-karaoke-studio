// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { SyncCueStrip } from '../src/components/SyncCueStrip'
import { createLyricLine, createLyricWord, createVocalTrack } from '../src/lib/model'
import { SYNC_CUE_MAX_TOKENS, SyncSession } from '../src/lib/sync-session'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function mount(session: SyncSession) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root?.render(<SyncCueStrip session={session} onEditLyrics={() => undefined} />),
  )
}

describe('SyncCueStrip', () => {
  it('shows the exact in-line live target and timed state without duplicating it', async () => {
    const track = createVocalTrack({
      id: 'lead',
      lines: [
        createLyricLine('one two', { id: 'first' }),
        createLyricLine('', { id: 'blank' }),
        createLyricLine('three', { id: 'next' }),
      ],
    })
    const firstWordId = track.lines[0].words[0].id
    const session = new SyncSession(track, 0, 1)
    await mount(session)
    expect(document.querySelectorAll('.sync-cue .is-target')).toHaveLength(1)
    expect(document.querySelector('.sync-cue .is-target')?.textContent).toBe('one')
    expect(document.querySelector('.sync-cue__line.is-next')?.textContent).toContain('three')

    await act(async () => session.start(1_000, false))
    expect(document.querySelector('.sync-cue .is-target')?.textContent).toBe('two')
    expect(
      document
        .querySelector(`[data-sync-word-id="${firstWordId}"]`)
        ?.classList.contains('is-timed'),
    ).toBe(true)
  })

  it('renders a bounded, truthful excerpt for a 5k-word source line', async () => {
    const words = Array.from({ length: 5_000 }, (_, index) =>
      createLyricWord(`w${index}`, { id: `w${index}` }),
    )
    const session = new SyncSession(
      createVocalTrack({
        id: 'dense',
        lines: [createLyricLine('', { id: 'dense-line', words })],
      }),
      2_500,
      2,
    )
    await mount(session)
    expect(document.querySelectorAll('.sync-cue__token')).toHaveLength(SYNC_CUE_MAX_TOKENS)
    expect(document.querySelector('.sync-cue .is-target')?.getAttribute('data-sync-word-id')).toBe(
      'w2500',
    )
    expect(document.querySelector('[aria-label="2496 earlier words"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="2495 later words"]')).not.toBeNull()
  })
})
