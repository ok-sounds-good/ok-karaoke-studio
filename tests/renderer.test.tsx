import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { lyricTimeAtPlayback } from '../src/App'
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
  it('keeps the complete primary journey actionable inside one guide', () => {
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
    const markup = renderToStaticMarkup(
      <WorkflowGuideDialog
        canStartSync={false}
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

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Add lyrics first')
  })
})
