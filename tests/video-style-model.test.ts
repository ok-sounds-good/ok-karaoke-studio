import { describe, expect, it } from 'vitest'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  parseProject,
  planLyricDisplay,
  planSyncAid,
  serializeProject,
  titleHandoffPlaybackMs,
} from '../src/lib/karaoke'
import {
  createVideoStyleDraft,
  isVideoStyleDraftValid,
  projectWithVideoStyleDraft,
  validateVideoStyleDraft,
  videoStyleDraftEqualsProject,
} from '../src/lib/style-session'
import {
  cloneFontFace,
  cloneTypeface,
  cloneVocalStyle,
  backgroundReadiness,
  DEFAULT_STAGE_COLORS,
  DEFAULT_STAGE_STYLE,
  DEFAULT_VOCAL_STYLE,
  normalizeStyleInteger,
  resolveVocalStyle,
  SYSTEM_MONOSPACE_TYPEFACE,
  SYSTEM_UI_TYPEFACE,
  genericFontFace,
} from '../src/lib/video-style'

function sectionTrack() {
  const style = cloneVocalStyle(DEFAULT_VOCAL_STYLE)
  style.syncAid.enabled = true
  const first = createLyricLine('First phrase', {
    id: 'first-line',
    startMs: 5_000,
    endMs: 6_000,
    words: [createLyricWord('First', { startMs: 5_000, endMs: 6_000 })],
  })
  const second = createLyricLine('Same phrase', {
    id: 'second-line',
    startMs: 6_000,
    endMs: 7_000,
    words: [createLyricWord('Same', { startMs: 6_000, endMs: 7_000 })],
  })
  return createVocalTrack({
    id: 'lead',
    vocalStyle: style,
    lines: [first, second],
  })
}

describe('video style project model', () => {
  it('normalizes numeric editor values to bounded integers', () => {
    expect(normalizeStyleInteger('12.6', 0, 32)).toBe(13)
    expect(normalizeStyleInteger('-10', 0, 32)).toBe(0)
    expect(normalizeStyleInteger('900', 8, 400)).toBe(400)
  })

  it('validates every numeric draft field before it can become canonical', () => {
    const project = createProject()
    const draft = createVideoStyleDraft(project)
    const trackId = project.tracks[0].id
    draft.stageStyle.stageFrame.lineWidthPx = 2.5
    draft.stageStyle.lyrics.sizePx = 401
    draft.vocalStyles[trackId].previewMs = 2_000.5

    expect(isVideoStyleDraftValid(draft)).toBe(false)
    expect(validateVideoStyleDraft(draft).map(({ path }) => path)).toEqual([
      'stageStyle',
      `project.tracks[${trackId}].vocalStyle`,
    ])
    expect(() => serializeProject(projectWithVideoStyleDraft(project, draft))).toThrow(
      'previewMs must be a safe integer',
    )
  })
  it('centralizes the canonical stage and vocal defaults', () => {
    const project = createProject()

    expect(project.stageStyle).toEqual(DEFAULT_STAGE_STYLE)
    expect(project.stageStyle).not.toBe(DEFAULT_STAGE_STYLE)
    expect(project.stageStyle.background).toEqual({
      mode: 'gradient',
      solidColor: '#21182D',
      gradientStartColor: '#322242',
      gradientEndColor: '#1E1629',
      imagePath: null,
    })
    expect(DEFAULT_STAGE_COLORS).toEqual({
      backgroundSolid: '#21182D',
      backgroundGradientStart: '#322242',
      backgroundGradientEnd: '#1E1629',
      lyricsUnsung: '#72687D',
      lyricsSung: '#FF8A2B',
      titleEyebrow: '#FFAD69',
      title: '#FBF9FD',
      titleArtist: '#B4ACBD',
      frameLine: '#473C54',
      frameBrand: '#C1BBC7',
      frameClock: '#BBB7C0',
      frameFooter: '#B2AEB8',
    })
    expect(JSON.stringify(project.stageStyle)).not.toMatch(
      /#(?:173126|07100D|7B817D|22D3EE|D7FA4A|F7F8EE|AEB6B0|31443A|789083|9AA69F|7B8780)/iu,
    )
    expect(project.tracks[0].vocalStyle).toEqual(DEFAULT_VOCAL_STYLE)
    expect(project.stageStyle.lyrics.fontStyle).toMatchObject({ style: 'Extra Bold', weight: 800 })
    expect(project.stageStyle.titleCard.eyebrow.fontStyle.style).toBe('Extra Bold')
    expect(project.stageStyle.titleCard.title.fontStyle.style).toBe('Extra Bold')
    expect(project.stageStyle.titleCard.artist.fontStyle.style).toBe('Semi Bold')
    expect(project.stageStyle.stageFrame.brand).toMatchObject({
      typeface: { kind: 'system-monospace' },
      fontStyle: { style: 'Bold' },
    })
    expect(project.stageStyle.stageFrame.clock.fontStyle.style).toBe('Semi Bold')
    expect(project.stageStyle.stageFrame.footer.fontStyle.style).toBe('Bold')
    expect(SYSTEM_UI_TYPEFACE.faces.map(({ style }) => style)).toEqual([
      'Regular', 'Italic', 'Semi Bold', 'Bold', 'Extra Bold',
    ])
    expect(SYSTEM_MONOSPACE_TYPEFACE.faces.map(({ style }) => style)).toEqual([
      'Regular', 'Italic', 'Semi Bold', 'Bold', 'Extra Bold',
    ])
  })

  it('round-trips v4 style data and rejects unknown legacy style fields', () => {
    const project = createProject()
    project.stageStyle.background.mode = 'solid'
    project.stageStyle.background.solidColor = '#102030'
    project.tracks[0].vocalStyle.sungColor = '#ABCDEF'

    expect(parseProject(serializeProject(project))).toEqual(project)

    const stale = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const [track] = stale.tracks as Array<Record<string, unknown>>
    track.color = '#ABCDEF'
    expect(() => parseProject(JSON.stringify(stale))).toThrow('vocalStyle.sungColor only')
  })

  it('round-trips a real local typeface catalog and independent vocal font fields exactly', () => {
    const project = createProject()
    const localTypeface = {
      kind: 'local' as const,
      family: 'Example Sans',
      faces: [
        {
          fullName: 'Example Sans Regular',
          style: 'Regular',
          postscriptName: 'ExampleSans-Regular',
          weight: 400,
          slant: 'normal' as const,
        },
        {
          fullName: 'Example Sans Bold Italic',
          style: 'Bold Italic',
          postscriptName: 'ExampleSans-BoldItalic',
          weight: 700,
          slant: 'italic' as const,
        },
      ],
    }
    project.stageStyle.lyrics.typeface = cloneTypeface(localTypeface)
    project.stageStyle.lyrics.fontStyle = cloneFontFace(localTypeface.faces[1])
    project.tracks[0].vocalStyle.typeface = cloneTypeface(SYSTEM_MONOSPACE_TYPEFACE)
    project.tracks[0].vocalStyle.fontStyle = cloneFontFace(localTypeface.faces[0])
    project.tracks[0].vocalStyle.sizePx = null

    const decoded = parseProject(serializeProject(project))
    expect(decoded.stageStyle.lyrics.typeface).toEqual(localTypeface)
    expect(decoded.stageStyle.lyrics.fontStyle).toEqual(localTypeface.faces[1])
    expect(decoded.tracks[0].vocalStyle).toMatchObject({
      typeface: SYSTEM_MONOSPACE_TYPEFACE,
      fontStyle: localTypeface.faces[0],
      sizePx: null,
    })
  })

  it('requires a persistent absolute linked path whenever image mode is saved', () => {
    const project = createProject()
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = 'background.png'

    expect(() => serializeProject(project)).toThrow('absolute path')
    project.stageStyle.background.imagePath = null
    expect(() => serializeProject(project)).toThrow('required in image mode')
  })

  it('uses one canonical linked-background readiness rule', () => {
    const project = createProject()
    expect(backgroundReadiness(project.stageStyle.background, null, 'stale error')).toEqual({
      ready: true,
      reason: null,
    })
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/images/stage.png'
    expect(backgroundReadiness(
      project.stageStyle.background,
      'studio-media://background/stage',
      'Linked image is missing or unreadable',
    )).toEqual({
      ready: false,
      reason: 'Linked image is missing or unreadable',
    })
    expect(backgroundReadiness(project.stageStyle.background, null)).toMatchObject({ ready: false })
    expect(backgroundReadiness(
      project.stageStyle.background,
      'studio-media://background/stage',
    )).toEqual({ ready: true, reason: null })
  })

  it('inherits each vocal font and color field independently', () => {
    const project = createProject()
    const vocal = cloneVocalStyle(DEFAULT_VOCAL_STYLE)
    vocal.sizePx = 64
    vocal.sungColor = '#112233'

    expect(resolveVocalStyle(project.stageStyle.lyrics, vocal)).toMatchObject({
      typeface: project.stageStyle.lyrics.typeface,
      fontStyle: project.stageStyle.lyrics.fontStyle,
      sizePx: 64,
      unsungColor: project.stageStyle.lyrics.unsungColor,
      sungColor: '#112233',
    })

    vocal.typeface = cloneTypeface(SYSTEM_MONOSPACE_TYPEFACE)
    const inheritedStyle = resolveVocalStyle(project.stageStyle.lyrics, vocal)
    expect(inheritedStyle.typeface.family).toBe('System Monospace')
    expect(inheritedStyle.fontStyle.style).toBe('Extra Bold')

    vocal.typeface = null
    vocal.fontStyle = cloneFontFace(genericFontFace(SYSTEM_UI_TYPEFACE, 'Italic'))
    const overriddenStyle = resolveVocalStyle(project.stageStyle.lyrics, vocal)
    expect(overriddenStyle.typeface.family).toBe('System UI')
    expect(overriddenStyle.fontStyle.style).toBe('Italic')
  })

  it('applies only the style slice over concurrent canonical project edits', () => {
    const original = createProject({ title: 'Before', offsetMs: 0 })
    const draft = createVideoStyleDraft(original)
    draft.stageStyle.background.mode = 'solid'
    draft.stageStyle.background.solidColor = '#123456'
    const concurrentlyEdited = { ...original, title: 'After', offsetMs: 250 }
    const applied = projectWithVideoStyleDraft(concurrentlyEdited, draft)

    expect(applied.title).toBe('After')
    expect(applied.offsetMs).toBe(250)
    expect(applied.stageStyle.background.solidColor).toBe('#123456')
    expect(videoStyleDraftEqualsProject(draft, applied)).toBe(true)
  })
})

describe('preview and sync-aid planning', () => {
  it('uses preview eligibility and the configured sync-aid D rule', () => {
    const track = sectionTrack()
    const display = { lineCount: 2, advanceMode: 'clear' as const }
    const before = planLyricDisplay(track, 1_999, display)
    const atVisibility = planLyricDisplay(track, 2_000, display)

    expect(before).toEqual([])
    expect(atVisibility.map(({ line }) => line.id)).toEqual(['first-line', 'second-line'])
    expect(atVisibility[0].visibleAtMs).toBe(2_000)
    expect(planSyncAid(track, atVisibility, 1_999)).toBeNull()
    expect(planSyncAid(track, atVisibility, 2_000)).toMatchObject({
      lineId: 'first-line',
      startMs: 2_000,
      endMs: 5_000,
      durationMs: 3_000,
      progress: 0,
    })
    expect(planSyncAid(track, atVisibility, 4_999)?.progress).toBeCloseTo(0.9997, 3)
    expect(planSyncAid(track, atVisibility, 5_000)).toBeNull()
  })

  it('cues only the first literal line in a blank-row-separated section', () => {
    const track = sectionTrack()
    const onlySecond = planLyricDisplay(track, 6_500, {
      lineCount: 1,
      advanceMode: 'scroll',
    })

    expect(onlySecond[0].line.id).toBe('second-line')
    expect(planSyncAid(track, onlySecond, 6_500)).toBeNull()
  })

  it('never transfers a section cue from an invalid literal first word to a later timed word', () => {
    const track = sectionTrack()
    track.lines[0].words = [
      createLyricWord('Untimed', { startMs: null, endMs: null }),
      createLyricWord('Later', { startMs: 5_000, endMs: 6_000 }),
    ]
    const planned = planLyricDisplay(track, 2_000, { lineCount: 2, advanceMode: 'clear' })

    expect(planned[0].line.id).toBe('first-line')
    expect(planSyncAid(track, planned, 2_000)).toBeNull()

    track.lines[0].words[0] = createLyricWord('Broken', { startMs: 4_800, endMs: null })
    expect(planSyncAid(track, planned, 2_000)).toBeNull()
  })

  it('hands the title off at first-word playback time minus Preview', () => {
    const track = sectionTrack()
    const project = createProject({ offsetMs: 800, tracks: [track] })

    expect(titleHandoffPlaybackMs(project)).toBe(2_800)
  })

  it('ignores non-solo tracks when calculating the title handoff', () => {
    const early = sectionTrack()
    const late = sectionTrack()
    late.id = 'solo'
    late.solo = true
    late.lines = late.lines.map((line) => ({
      ...line,
      id: `solo-${line.id}`,
      startMs: line.startMs === null ? null : line.startMs + 4_000,
      endMs: line.endMs === null ? null : line.endMs + 4_000,
      words: line.words.map((word) => ({
        ...word,
        id: `solo-${word.id}`,
        startMs: word.startMs === null ? null : word.startMs + 4_000,
        endMs: word.endMs === null ? null : word.endMs + 4_000,
      })),
    }))
    const project = createProject({ tracks: [early, late] })

    expect(titleHandoffPlaybackMs(project)).toBe(6_000)
  })
})
