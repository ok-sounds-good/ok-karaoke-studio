/**
 * @vitest-environment happy-dom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InspectorPanel } from '../src/components/InspectorPanel'
import { MAX_OPENING_MS } from '../src/components/OpeningTimingControl'
import { createProject } from '../src/lib/karaoke'
import { MAX_PROJECT_DURATION_MS } from '../src/lib/project-validation'

function replaceInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Input value setter is unavailable')
  setter.call(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
}

describe('Opening Timing control in the Inspector', () => {
  let container: HTMLDivElement
  let root: Root
  let onUpdateProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    onUpdateProject = vi.fn()
    act(() =>
      root.render(
        <div onKeyDown={(event) => event.currentTarget.setAttribute('data-last-key', event.key)}>
          <InspectorPanel
            project={createProject({ id: 'opening-control' })}
            activeTrackId="lead"
            onSelectTrack={() => undefined}
            onUpdateProject={onUpdateProject}
            onUpdateTrack={() => undefined}
            onImportAudio={() => undefined}
            onImportLrc={() => undefined}
          />
        </div>,
      ),
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('commits a valid Enter edit while invalid blur and Enter restore the accepted value', () => {
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Opening lead-in seconds"]',
    )!

    act(() => replaceInput(input, '1.2'))
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      ),
    )
    expect(onUpdateProject).toHaveBeenCalledWith({
      opening: { leadInMs: 1_200, titleTiming: { mode: 'until-lyrics' } },
    })

    for (const invalid of ['', '1.23', '-1', String(MAX_OPENING_MS / 1_000 + 0.1)]) {
      act(() => replaceInput(input, invalid))
      act(() => {
        input.focus()
        input.blur()
      })
      expect(input.value).toBe('0')
    }
    act(() => replaceInput(input, '1.23'))
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      ),
    )
    expect(input.value).toBe('0')
    expect(onUpdateProject).toHaveBeenCalledOnce()

    act(() => replaceInput(input, String(MAX_OPENING_MS / 1_000)))
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      ),
    )
    expect(onUpdateProject).toHaveBeenLastCalledWith({
      opening: { leadInMs: MAX_OPENING_MS, titleTiming: { mode: 'until-lyrics' } },
    })
  })

  it('uses tenth-second fixed title timing and describes a zero-length title truthfully', () => {
    const fixed = container.querySelector<HTMLSelectElement>('[aria-label="Title timing mode"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(fixed, 'fixed')
      fixed.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onUpdateProject).toHaveBeenLastCalledWith({
      opening: { leadInMs: 0, titleTiming: { mode: 'fixed', durationMs: 0 } },
    })
  })

  it('does not describe a hidden fixed title as a zero-second interval', () => {
    const project = createProject({
      id: 'hidden-fixed-title',
      opening: { leadInMs: 1_000, titleTiming: { mode: 'fixed', durationMs: 7_000 } },
    })
    project.stageStyle.titleCard.eyebrow.visible = false
    project.stageStyle.titleCard.title.visible = false
    project.stageStyle.titleCard.artist.visible = false
    act(() =>
      root.render(
        <InspectorPanel
          project={project}
          activeTrackId="lead"
          onSelectTrack={() => undefined}
          onUpdateProject={onUpdateProject}
          onUpdateTrack={() => undefined}
          onImportAudio={() => undefined}
          onImportLrc={() => undefined}
        />,
      ),
    )

    const summary = container.querySelector('.opening-timing-control__summary')?.textContent
    expect(summary).toBe('Title is not visible in output.')
    expect(summary).not.toContain('Title 0:00–0.0')
  })

  it('cancels Escape without committing or bubbling and restores the accepted text', () => {
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Opening lead-in seconds"]',
    )!
    const wrapper = container.firstElementChild!
    act(() => replaceInput(input, '2'))
    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    act(() => input.dispatchEvent(escape))

    expect(escape.defaultPrevented).toBe(true)
    expect(wrapper.getAttribute('data-last-key')).toBeNull()
    expect(input.value).toBe('0')
    expect(onUpdateProject).not.toHaveBeenCalled()
  })

  it('uses the project-specific combined duration budget and rejects the next tenth', () => {
    const project = createProject({
      id: 'opening-control-combined-budget',
      durationMs: MAX_PROJECT_DURATION_MS - 1_000,
    })
    act(() =>
      root.render(
        <InspectorPanel
          project={project}
          activeTrackId="lead"
          onSelectTrack={() => undefined}
          onUpdateProject={onUpdateProject}
          onUpdateTrack={() => undefined}
          onImportAudio={() => undefined}
          onImportLrc={() => undefined}
        />,
      ),
    )
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Opening lead-in seconds"]',
    )!

    act(() => replaceInput(input, '1'))
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      ),
    )
    expect(onUpdateProject).toHaveBeenLastCalledWith({
      opening: { leadInMs: 1_000, titleTiming: { mode: 'until-lyrics' } },
    })

    act(() => replaceInput(input, '1.1'))
    act(() => {
      input.focus()
      input.blur()
    })
    expect(input.value).toBe('0')
    expect(onUpdateProject).toHaveBeenCalledOnce()
  })
})
