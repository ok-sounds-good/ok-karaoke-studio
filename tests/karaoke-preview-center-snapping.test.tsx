// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { createProject } from '../src/lib/model'
import { cloneVocalStyle } from '../src/lib/video-style'

describe('Karaoke Preview center snapping', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  async function renderMovableLyrics(onPositionChange: ReturnType<typeof vi.fn>) {
    const project = createProject()
    await act(async () =>
      root.render(
        <KaraokePreview
          project={project}
          playbackMs={0}
          lyricMs={0}
          selectedWordIds={new Set()}
          designMode={{
            target: 'lead-vocal',
            stageStyle: project.stageStyle,
            vocalStyle: cloneVocalStyle(),
            timingValid: true,
            onPositionChange,
          }}
        />,
      ),
    )
    const stage = host.querySelector<HTMLElement>('[data-stage-canvas]')!
    const object = host.querySelector<HTMLElement>('[data-display-object-selected="true"]')!
    Object.defineProperty(object, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 480, height: 100 }),
    })
    Object.defineProperty(object, 'setPointerCapture', { value: vi.fn() })
    Object.defineProperty(object, 'releasePointerCapture', { value: vi.fn() })
    return { object, stage }
  }

  it.each([960, 1_440])(
    'snaps and releases each axis consistently on a %i-pixel-wide Preview',
    async (stageWidth) => {
      const onPositionChange = vi.fn()
      const { object, stage } = await renderMovableLyrics(onPositionChange)
      const stageHeight = (stageWidth / 16) * 9
      const scale = stageWidth / 1_920
      Object.defineProperty(stage, 'getBoundingClientRect', {
        value: () => DOMRect.fromRect({ width: stageWidth, height: stageHeight }),
      })

      await act(async () =>
        object.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 100,
            clientY: 100,
            pointerId: 17,
          }),
        ),
      )
      await act(async () =>
        object.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: 100 + 20 * scale,
            clientY: 100 + 30 * scale,
            pointerId: 17,
          }),
        ),
      )

      expect(object.dataset.displayPositionX).toBe('960')
      expect(object.dataset.displayPositionY).toBe('580')
      expect(host.querySelector('.karaoke-stage__center-guide--x')).not.toBeNull()
      expect(host.querySelector('.karaoke-stage__center-guide--y')).toBeNull()

      await act(async () =>
        object.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: 100 + 21 * scale,
            clientY: 100 - 10 * scale,
            pointerId: 17,
          }),
        ),
      )

      expect(object.dataset.displayPositionX).toBe('981')
      expect(object.dataset.displayPositionY).toBe('540')
      expect(host.querySelector('.karaoke-stage__center-guide--x')).toBeNull()
      expect(host.querySelector('.karaoke-stage__center-guide--y')).not.toBeNull()

      await act(async () =>
        object.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 17 })),
      )
      expect(onPositionChange).toHaveBeenCalledTimes(1)
      expect(onPositionChange).toHaveBeenCalledWith({ x: 981, y: 540 })
      expect(host.querySelector('.karaoke-stage__center-guides')).toBeNull()
    },
  )

  it('allows Option or Alt to bypass snapping without changing deterministic keyboard movement', async () => {
    const onPositionChange = vi.fn()
    const { object, stage } = await renderMovableLyrics(onPositionChange)
    const scale = 1_280 / 1_920
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 1_280, height: 720 }),
    })

    await act(async () => {
      object.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
          pointerId: 18,
        }),
      )
      object.dispatchEvent(
        new PointerEvent('pointermove', {
          altKey: true,
          bubbles: true,
          clientX: 100 + 10 * scale,
          clientY: 100 - 20 * scale,
          pointerId: 18,
        }),
      )
      object.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 18 }))
    })

    expect(onPositionChange).toHaveBeenCalledWith({ x: 970, y: 530 })
    expect(host.querySelector('.karaoke-stage__center-guides')).toBeNull()
    expect(object.title).toContain('Option or Alt')

    onPositionChange.mockClear()
    await act(async () =>
      object.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })),
    )
    expect(onPositionChange).toHaveBeenCalledWith({ x: 959, y: 550 })
  })

  it('clears an active guide when Auto replaces the dragged Title object with Song', async () => {
    const project = createProject()
    const track = project.tracks[0]!
    track.lines = [
      {
        id: 'handoff-line',
        text: 'Auto handoff',
        startMs: 10_000,
        endMs: 12_000,
        words: [
          {
            id: 'handoff-word',
            text: 'Auto handoff',
            startMs: 10_000,
            endMs: 12_000,
          },
        ],
      },
    ]
    const renderAt = async (playbackMs: number) =>
      act(async () =>
        root.render(
          <KaraokePreview
            activeVocalTrackId={track.id}
            project={project}
            playbackMs={playbackMs}
            lyricMs={playbackMs}
            selectedWordIds={new Set()}
            onTitlePositionChange={vi.fn()}
            onVocalPositionChange={vi.fn()}
          />,
        ),
      )

    await renderAt(0)
    const stage = host.querySelector<HTMLElement>('[data-stage-canvas]')!
    const title = host.querySelector<HTMLElement>('[data-title-card-role="title"]')!
    Object.defineProperty(stage, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 960, height: 540 }),
    })
    Object.defineProperty(title, 'getBoundingClientRect', {
      value: () => DOMRect.fromRect({ width: 480, height: 100 }),
    })
    Object.defineProperty(title, 'setPointerCapture', { value: vi.fn() })

    await act(async () => {
      title.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
          pointerId: 19,
        }),
      )
      title.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 110,
          clientY: 115,
          pointerId: 19,
        }),
      )
    })
    expect(host.querySelector('.karaoke-stage__center-guide--x')).not.toBeNull()

    await renderAt(11_000)

    expect(host.querySelector('[data-title-card-role="title"]')).toBeNull()
    expect(host.querySelector('[data-lyric-object-line-count]')).not.toBeNull()
    expect(host.querySelector('.karaoke-stage__center-guides')).toBeNull()
  })
})
