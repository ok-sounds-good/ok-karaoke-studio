// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KaraokePreview } from '../src/components/KaraokePreview'
import type { BackgroundImagePreviewSource } from '../src/hooks/useProjectBackgroundImage'
import { createProject, type KaraokeProject } from '../src/lib/model'

class ControlledImage {
  static instances: ControlledImage[] = []

  onerror: ((event: Event) => void) | null = null
  onload: ((event: Event) => void) | null = null
  src = ''

  constructor() {
    ControlledImage.instances.push(this)
  }
}

function imageProject(): KaraokeProject {
  const project = createProject({ id: 'image-preview-project' })
  project.stageStyle.background = {
    ...project.stageStyle.background,
    gradientStartColor: '#123456',
    gradientEndColor: '#654321',
    imagePath: '/private/media/never-render-this-path.png',
    mode: 'image',
  }
  return project
}

describe('Karaoke Preview linked background loading', () => {
  let container: HTMLDivElement
  let root: Root
  let project: KaraokeProject

  const render = async (backgroundImage?: BackgroundImagePreviewSource) => {
    await act(async () => {
      root.render(
        <KaraokePreview
          project={project}
          playbackMs={0}
          lyricMs={0}
          selectedWordIds={new Set()}
          backgroundImage={backgroundImage}
        />,
      )
      await Promise.resolve()
    })
  }

  const stage = () => container.querySelector<HTMLElement>('.karaoke-stage')!
  const warning = () => container.querySelector<HTMLElement>('.stage-resource-warning')

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    ControlledImage.instances = []
    vi.stubGlobal('Image', ControlledImage)
    project = imageProject()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the gradient until the immutable capability URL finishes loading', async () => {
    const source = {
      url: 'studio-media://asset/immutable-a',
      resolutionStatus: 'available' as const,
    }
    await render(source)

    expect(ControlledImage.instances).toHaveLength(1)
    expect(ControlledImage.instances[0]?.src).toBe(source.url)
    expect(stage().dataset.backgroundImageReady).toBe('false')
    expect(stage().style.backgroundImage).toContain('linear-gradient')
    expect(stage().style.backgroundImage).not.toContain(source.url)
    expect(warning()?.textContent).toContain('Loading linked background')

    await act(async () => ControlledImage.instances[0]?.onload?.(new Event('load')))
    expect(stage().dataset.backgroundImageReady).toBe('true')
    expect(stage().style.backgroundImage).toContain(source.url)
    expect(stage().style.backgroundPosition).toBe('center center')
    expect(stage().style.backgroundRepeat).toBe('no-repeat')
    expect(stage().style.backgroundSize).toBe('cover')
    expect(warning()).toBeNull()
  })

  it('ignores an older URL load after a newer capability becomes current', async () => {
    await render({
      url: 'studio-media://asset/old',
      resolutionStatus: 'available',
    })
    const staleLoad = ControlledImage.instances[0]?.onload
    await render({
      url: 'studio-media://asset/new',
      resolutionStatus: 'available',
    })

    await act(async () => staleLoad?.(new Event('load')))
    expect(stage().dataset.backgroundImageReady).toBe('false')
    expect(stage().style.backgroundImage).not.toContain('studio-media://asset/old')
    expect(stage().style.backgroundImage).not.toContain('studio-media://asset/new')

    await act(async () => ControlledImage.instances[1]?.onload?.(new Event('load')))
    expect(stage().dataset.backgroundImageReady).toBe('true')
    expect(stage().style.backgroundImage).toContain('studio-media://asset/new')
  })

  it('shows a fixed load failure with a local retry and never exposes the linked path', async () => {
    const source = {
      url: 'studio-media://asset/retry',
      resolutionStatus: 'available' as const,
    }
    await render(source)
    await act(async () => ControlledImage.instances[0]?.onerror?.(new Event('error')))

    expect(stage().style.backgroundImage).toContain('linear-gradient')
    expect(warning()?.textContent).toContain(
      'Linked background could not be displayed; using the gradient fallback.',
    )
    expect(warning()?.textContent).not.toContain('/private/media')

    await act(async () => warning()?.querySelector('button')?.click())
    expect(ControlledImage.instances).toHaveLength(2)
    await act(async () => ControlledImage.instances[1]?.onload?.(new Event('load')))
    expect(stage().dataset.backgroundImageReady).toBe('true')
  })

  it('offers an exact relink retry for a fixed missing-state fallback', async () => {
    const onRetryResolution = vi.fn()
    await render({
      url: null,
      resolutionStatus: 'missing',
      onRetryResolution,
    })

    expect(ControlledImage.instances).toHaveLength(0)
    expect(stage().style.backgroundImage).toContain('linear-gradient')
    expect(warning()?.textContent).toContain(
      'Linked background is missing; using the gradient fallback.',
    )
    expect(warning()?.textContent).not.toContain(project.stageStyle.background.imagePath!)
    await act(async () => warning()?.querySelector('button')?.click())
    expect(onRetryResolution).toHaveBeenCalledOnce()
  })
})
