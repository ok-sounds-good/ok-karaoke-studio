import { readFileSync } from 'node:fs'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowGuideActions,
  EDITABLE_PROJECT_EXPORT_FORMAT,
  lyricTimeAtPlayback,
} from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { LyricsPanel } from '../src/components/LyricsPanel'
import { timelineTime } from '../src/components/Timeline'
import { WorkflowGuideDialog } from '../src/components/Dialogs'
import { TopBar } from '../src/components/TopBar'
import {
  createLyricLine,
  createProject,
  createVocalTrack,
  retimeLine,
} from '../src/lib/karaoke'

function offsetProject() {
  const line = retimeLine(createLyricLine('Hold'), 1_000, 2_000)
  const track = createVocalTrack({ id: 'lead', lines: [line] })
  return createProject({ offsetMs: 500, tracks: [track] })
}

interface ActionElementProps {
  children?: ReactNode
  disabled?: boolean
  onClick?: () => void
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (!isValidElement<ActionElementProps>(node)) return ''
  return Children.toArray(node.props.children).map(nodeText).join('')
}

function findAction(root: ReactNode, label: string): ReactElement<ActionElementProps> {
  if (!isValidElement<ActionElementProps>(root)) {
    throw new Error(`Could not find action: ${label}`)
  }
  if (root.props.onClick && nodeText(root.props.children).includes(label)) return root
  for (const child of Children.toArray(root.props.children)) {
    try {
      return findAction(child, label)
    } catch {
      // Continue through the declarative child tree until the labeled action is found.
    }
  }
  throw new Error(`Could not find action: ${label}`)
}

describe('offset-aware renderer state', () => {
  it('delays positive offsets and advances negative offsets', () => {
    expect(lyricTimeAtPlayback(1_500, 500)).toBe(1_000)
    expect(lyricTimeAtPlayback(1_500, -500)).toBe(2_000)
    expect(timelineTime(1_000, 500)).toBe(1_500)
    expect(timelineTime(1_000, -500)).toBe(500)
  })

  it('uses lyric time for preview progress while retaining the playback clock', () => {
    const project = offsetProject()
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_000}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('karaoke-stage__time">00:01.500')
    expect(markup).toContain('--word-progress:0%')
  })

  it('uses lyric time for current-word editor highlighting', () => {
    const project = offsetProject()
    const props = {
      tracks: project.tracks,
      activeTrackId: project.tracks[0].id,
      selectedWordIds: new Set<string>(),
      syncWordId: null,
      onSelectTrack: () => undefined,
      onSelectWord: () => undefined,
      onEditLyrics: () => undefined,
    }

    const before = renderToStaticMarkup(<LyricsPanel {...props} lyricMs={999} />)
    const during = renderToStaticMarkup(<LyricsPanel {...props} lyricMs={1_000} />)

    expect(before).not.toContain('is-current')
    expect(during).toContain('is-current')
  })

  it('matches video export by showing only soloed preview tracks', () => {
    const lead = createVocalTrack({
      id: 'lead',
      name: 'Lead',
      lines: [retimeLine(createLyricLine('Hidden lead'), 1_000, 2_000)],
    })
    const solo = createVocalTrack({
      id: 'duet',
      name: 'Solo duet',
      solo: true,
      lines: [retimeLine(createLyricLine('Visible duet'), 1_000, 2_000)],
    })
    const project = createProject({ tracks: [lead, solo] })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('Solo duet')
    expect(markup).not.toContain('>Lead<')
  })
})

describe('first-time workflow', () => {
  it('describes the complete primary journey inside one guide', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGuideDialog
        canStartSync
        onClose={() => undefined}
        onNew={() => undefined}
        onOpen={() => undefined}
        onAttachAudio={() => undefined}
        onEditLyrics={() => undefined}
        onImportLrc={() => undefined}
        onStartSync={() => undefined}
        onSave={() => undefined}
        onExport={() => undefined}
      />,
    )

    expect(markup).toContain('One-window workflow')
    expect(markup).toContain('Start a project')
    expect(markup).toContain('Attach the backing track')
    expect(markup).toContain('Add the lyrics')
    expect(markup).toContain('Time each word')
    expect(markup).toContain('Correct the TimeBoard')
    expect(markup).toContain('Preview continuously')
    expect(markup).toContain('Save and export')
    expect(markup).toContain('system file pickers only appear when you choose a file or destination')
  })

  it('routes every guide button to its assigned interaction handler', () => {
    const calls: string[] = []
    const guide = WorkflowGuideDialog({
      canStartSync: true,
      onClose: () => calls.push('close'),
      onNew: () => calls.push('new'),
      onOpen: () => calls.push('open'),
      onAttachAudio: () => calls.push('audio'),
      onEditLyrics: () => calls.push('lyrics'),
      onImportLrc: () => calls.push('lrc'),
      onStartSync: () => calls.push('sync'),
      onSave: () => calls.push('save'),
      onExport: () => calls.push('export'),
    })

    for (const label of [
      'Open .oks',
      'New project',
      'Attach audio',
      'Import LRC',
      'Edit lyrics',
      'Arm tap sync',
      'Show TimeBoard',
      'Show preview',
      'Save .oks',
      'Choose export',
    ]) {
      findAction(guide, label).props.onClick?.()
    }

    expect(calls).toEqual([
      'open',
      'new',
      'audio',
      'lrc',
      'lyrics',
      'sync',
      'close',
      'close',
      'save',
      'export',
    ])
  })

  it('uses the App action coordinator to close the guide before each workflow transition', () => {
    const close = vi.fn()
    const transitions = {
      startNew: vi.fn(),
      open: vi.fn(),
      attachAudio: vi.fn(),
      editLyrics: vi.fn(),
      importLrc: vi.fn(),
      startSync: vi.fn(),
      save: vi.fn(),
      exportProject: vi.fn(),
    }
    const actions = createWorkflowGuideActions({ canStartSync: true, close, ...transitions })

    actions.onNew()
    actions.onOpen()
    actions.onAttachAudio()
    actions.onEditLyrics()
    actions.onImportLrc()
    actions.onStartSync()
    actions.onSave()
    actions.onExport()

    expect(close).toHaveBeenCalledTimes(8)
    Object.values(transitions).forEach((transition) => expect(transition).toHaveBeenCalledOnce())
    expect(EDITABLE_PROJECT_EXPORT_FORMAT).toBe('oks')
  })

  it('keeps the workflow guide discoverable from the main toolbar', () => {
    const markup = renderToStaticMarkup(
      <TopBar
        title="First song"
        dirty={false}
        canUndo={false}
        canRedo={false}
        issueCount={0}
        onNew={() => undefined}
        onOpen={() => undefined}
        onSave={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onShowWorkflow={() => undefined}
        onValidate={() => undefined}
        onExport={() => undefined}
      />,
    )

    expect(markup).toContain('Workflow')
    expect(markup).toContain('aria-label="Project actions"')
  })

  it('prevents tap sync from being launched before lyrics exist', () => {
    const close = vi.fn()
    const startSync = vi.fn()
    const actions = createWorkflowGuideActions({
      canStartSync: false,
      close,
      startSync,
      startNew: vi.fn(),
      open: vi.fn(),
      attachAudio: vi.fn(),
      editLyrics: vi.fn(),
      importLrc: vi.fn(),
      save: vi.fn(),
      exportProject: vi.fn(),
    })
    const guide = WorkflowGuideDialog(actions)
    const syncButton = findAction(guide, 'Add lyrics first')

    expect(syncButton.props.disabled).toBe(true)
    actions.onStartSync()
    expect(close).not.toHaveBeenCalled()
    expect(startSync).not.toHaveBeenCalled()
  })

  it('enforces a scroll-safe workflow layout at the 1280 by 720 contract', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const minimumWindow = electronMain.match(/minWidth:\s*(\d+),\s*\n\s*minHeight:\s*(\d+)/)

    expect(minimumWindow).not.toBeNull()
    expect(Number(minimumWindow?.[1])).toBeLessThanOrEqual(1280)
    expect(Number(minimumWindow?.[2])).toBeLessThanOrEqual(720)
    expect(styles).toMatch(
      /\.modal__body\s*\{[\s\S]*?max-height:\s*calc\(100vh - 190px\);[\s\S]*?overflow:\s*auto;/,
    )
    expect(styles).toMatch(
      /@media \(max-height: 720px\)\s*\{[\s\S]*?\.workflow-guide > li\s*\{[\s\S]*?min-height:\s*52px;/,
    )
  })
})
