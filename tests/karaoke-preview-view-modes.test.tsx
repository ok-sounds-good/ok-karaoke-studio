// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KaraokePreview } from '../src/components/KaraokePreview'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  type KaraokeProject,
} from '../src/lib/model'

function untimedProject() {
  return createProject({
    id: 'untimed-project',
    title: 'Untimed Song',
    artist: 'Studio Singer',
    tracks: [
      createVocalTrack({
        id: 'internal-lead-id',
        name: 'Lead Vocal',
        lines: [
          createLyricLine('These words are not timed'),
          createLyricLine('But they still belong here'),
        ],
      }),
    ],
  })
}

function timedProject() {
  return createProject({
    id: 'timed-project',
    tracks: [
      createVocalTrack({
        id: 'timed-lead',
        name: 'Timed Lead',
        lines: [
          createLyricLine('Wait for the handoff', {
            id: 'timed-line',
            startMs: 5_000,
            endMs: 6_000,
            words: [
              createLyricWord('Wait', { startMs: 5_000, endMs: 5_500 }),
              createLyricWord('here', { startMs: 5_500, endMs: 6_000 }),
            ],
          }),
        ],
      }),
    ],
  })
}

describe('Karaoke Preview viewer modes', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function renderPreview(
    project: KaraokeProject,
    options: {
      activeVocalTrackId?: string
      playbackMs?: number
      onEditLyrics?: () => void
      onTitlePositionChange?: Parameters<typeof KaraokePreview>[0]['onTitlePositionChange']
      onVocalPositionChange?: Parameters<typeof KaraokePreview>[0]['onVocalPositionChange']
    } = {},
  ) {
    const playbackMs = options.playbackMs ?? 0
    await act(async () =>
      root.render(
        <KaraokePreview
          activeVocalTrackId={options.activeVocalTrackId}
          project={project}
          playbackMs={playbackMs}
          lyricMs={playbackMs - project.offsetMs}
          selectedWordIds={new Set()}
          onEditLyrics={options.onEditLyrics}
          onTitlePositionChange={options.onTitlePositionChange}
          onVocalPositionChange={options.onVocalPositionChange}
        />,
      ),
    )
  }

  async function selectView(value: 'auto' | 'title' | 'song') {
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Preview content"]')!
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('starts faithful to the title layer without a phantom lyric object', async () => {
    const project = createProject({ id: 'empty-project' })
    const onEditLyrics = vi.fn()
    await renderPreview(project, {
      activeVocalTrackId: project.tracks[0]!.id,
      onEditLyrics,
      onTitlePositionChange: vi.fn(),
      onVocalPositionChange: vi.fn(),
    })

    const preview = container.querySelector<HTMLElement>('[aria-label="Karaoke preview"]')!
    expect(preview.dataset.previewViewMode).toBe('auto')
    expect(preview.dataset.previewContent).toBe('title')
    expect(preview.querySelector('.title-card')).not.toBeNull()
    expect(preview.querySelector('[data-lyric-object-line-count]')).toBeNull()
    expect(
      preview.querySelector('[data-display-object-selected="true"]')?.getAttribute('aria-label'),
    ).toContain('Song title position 960, 550')
    expect(preview.querySelector('[aria-label="Movable title element"]')).not.toBeNull()
    expect(preview.querySelector('[aria-label="Visible lyric lines"]')).toBeNull()
    expect(preview.textContent).toContain('Edit text')
    expect(preview.textContent).toContain('Live')
  })

  it('pins real untimed lyrics for the active singer and exposes song controls', async () => {
    const project = untimedProject()
    const onVocalPositionChange = vi.fn()
    await renderPreview(project, {
      activeVocalTrackId: 'internal-lead-id',
      onEditLyrics: vi.fn(),
      onVocalPositionChange,
    })

    await selectView('song')

    const preview = container.querySelector<HTMLElement>('[aria-label="Karaoke preview"]')!
    const lyricObject = preview.querySelector<HTMLElement>(
      '[data-lyric-object-line-count][data-display-object-selected="true"]',
    )!
    expect(preview.dataset.previewContent).toBe('song')
    expect(preview.querySelector('.title-card')).toBeNull()
    expect(lyricObject.textContent).toContain('These words are not timed')
    expect(lyricObject.textContent).toContain('But they still belong here')
    expect(lyricObject.getAttribute('aria-label')).toContain('Lead Vocal lyric block')
    expect(lyricObject.getAttribute('aria-label')).not.toContain('internal-lead-id')
    expect(preview.querySelector('[aria-label="Movable title element"]')).toBeNull()
    expect(preview.querySelector('[aria-label="Visible lyric lines"]')).not.toBeNull()
    expect(preview.querySelector('[aria-label="Lyric line advance mode"]')).not.toBeNull()
    expect(preview.textContent).not.toContain('Live')

    const stage = preview.querySelector<HTMLElement>('[data-stage-canvas]')!
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 1_920, height: 1_080 }),
    })
    Object.defineProperty(lyricObject, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 960, height: 300 }),
    })
    await act(async () =>
      lyricObject.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowRight',
        }),
      ),
    )
    expect(onVocalPositionChange).toHaveBeenCalledWith('internal-lead-id', { x: 961, y: 550 })
  })

  it('lets pointer or keyboard focus choose the visible title element being moved', async () => {
    const project = untimedProject()
    const onTitlePositionChange = vi.fn()
    await renderPreview(project, {
      activeVocalTrackId: 'internal-lead-id',
      onTitlePositionChange,
    })

    const artist = container.querySelector<HTMLElement>('[data-title-card-role="artist"]')!
    expect(artist.dataset.displayObjectInteractive).toBe('true')
    expect(artist.getAttribute('aria-label')).toBe('Artist. Select to move.')
    await act(async () => artist.focus())
    expect(artist.dataset.displayObjectSelected).toBe('true')
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Movable title element"]')?.value,
    ).toBe('artist')

    const stage = container.querySelector<HTMLElement>('[data-stage-canvas]')!
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 1_920, height: 1_080 }),
    })
    Object.defineProperty(artist, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 300, height: 80 }),
    })
    await act(async () =>
      artist.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowUp',
          shiftKey: true,
        }),
      ),
    )
    expect(onTitlePositionChange).toHaveBeenCalledWith('artist', { x: 960, y: 640 })
  })

  it.each([
    {
      name: 'a muted active singer',
      activeMuted: true,
      visibleSolo: false,
    },
    {
      name: 'a non-solo active singer while another singer is soloed',
      activeMuted: false,
      visibleSolo: true,
    },
  ])('moves only the exported singer in Auto with $name', async ({ activeMuted, visibleSolo }) => {
    const activeLine = createLyricLine('Hidden active lyric', {
      id: 'active-line',
      startMs: 1_000,
      endMs: 2_000,
      words: [createLyricWord('Hidden', { startMs: 1_000, endMs: 2_000 })],
    })
    const visibleLine = createLyricLine('Visible harmony lyric', {
      id: 'visible-line',
      startMs: 1_000,
      endMs: 2_000,
      words: [createLyricWord('Visible', { startMs: 1_000, endMs: 2_000 })],
    })
    const project = createProject({
      id: `visibility-project-${activeMuted}-${visibleSolo}`,
      tracks: [
        createVocalTrack({
          id: 'active-hidden',
          name: 'Hidden Lead',
          muted: activeMuted,
          lines: [activeLine],
        }),
        createVocalTrack({
          id: 'visible-harmony',
          name: 'Visible Harmony',
          solo: visibleSolo,
          lines: [visibleLine],
        }),
      ],
    })
    const onVocalPositionChange = vi.fn()
    await renderPreview(project, {
      activeVocalTrackId: 'active-hidden',
      playbackMs: 1_500,
      onVocalPositionChange,
    })

    const lyricObjects = [
      ...container.querySelectorAll<HTMLElement>('[data-lyric-object-line-count]'),
    ]
    expect(lyricObjects).toHaveLength(1)
    const selected = lyricObjects[0]!
    expect(selected.textContent).toContain('Visible')
    expect(selected.textContent).not.toContain('Hidden')
    expect(selected.getAttribute('aria-label')).toContain('Visible Harmony lyric block')

    const stage = container.querySelector<HTMLElement>('[data-stage-canvas]')!
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 1_920, height: 1_080 }),
    })
    Object.defineProperty(selected, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 960, height: 300 }),
    })
    await act(async () =>
      selected.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowRight',
        }),
      ),
    )
    expect(onVocalPositionChange).toHaveBeenCalledWith('visible-harmony', { x: 961, y: 550 })

    await renderPreview(project, {
      activeVocalTrackId: 'active-hidden',
      playbackMs: 3_000,
      onVocalPositionChange,
    })
    expect(container.querySelector('[data-display-object-selected="true"]')).toBeNull()
    expect(container.textContent).not.toContain('Add lyrics to preview the Song view.')

    await selectView('song')
    expect(
      container.querySelector('[data-display-object-selected="true"]')?.getAttribute('aria-label'),
    ).toContain('Hidden Lead lyric block')
    expect(container.textContent).toContain('Hidden')
  })

  it('distinguishes faithful Auto from pinned layers and resets the viewer for a new project', async () => {
    const project = timedProject()
    await renderPreview(project, {
      activeVocalTrackId: 'timed-lead',
      playbackMs: 0,
      onTitlePositionChange: vi.fn(),
      onVocalPositionChange: vi.fn(),
    })
    expect(container.querySelector('[data-preview-content="title"] .title-card')).not.toBeNull()

    await selectView('song')
    expect(container.querySelector('[data-preview-content="song"] .title-card')).toBeNull()
    expect(container.textContent).toContain('Wait here')

    await selectView('title')
    await renderPreview(project, {
      activeVocalTrackId: 'timed-lead',
      playbackMs: 5_250,
      onTitlePositionChange: vi.fn(),
      onVocalPositionChange: vi.fn(),
    })
    expect(container.querySelector('[data-preview-content="title"] .title-card')).not.toBeNull()
    expect(container.textContent).not.toContain('Live')

    await selectView('auto')
    expect(container.querySelector('[data-preview-content="song"] .title-card')).toBeNull()
    expect(container.textContent).toContain('Live')

    const replacement = createProject({ id: 'replacement-project' })
    await renderPreview(replacement, {
      activeVocalTrackId: replacement.tracks[0]!.id,
      playbackMs: 0,
      onTitlePositionChange: vi.fn(),
      onVocalPositionChange: vi.fn(),
    })
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Preview content"]')?.value,
    ).toBe('auto')
    expect(container.querySelector('[data-preview-content="title"] .title-card')).not.toBeNull()

    await selectView('song')
    expect(container.querySelector('.title-card')).toBeNull()
    expect(container.querySelector('[data-display-object-selected="true"]')).toBeNull()
    expect(container.textContent).toContain('Add lyrics to preview the Song view.')
  })
})
