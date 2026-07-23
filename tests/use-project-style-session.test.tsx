// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectStyleDraft,
  sameStageStyle,
  sameVocalStyle,
  useProjectStyleSession,
  type ProjectStyleCommitResult,
  type ProjectStyleDraft,
  type ProjectStyleOwnerKey,
  type ProjectStyleSession,
  type ProjectStyleSessionOptions,
} from '../src/hooks/useProjectStyleSession'
import {
  cloneStageStyle,
  cloneVocalStyle,
  type FontFaceDescriptor,
  type LyricTextStyle,
  type StageStyle,
  type VocalStyle,
} from '../src/lib/video-style'
import { createVocalTrack } from '../src/lib/model'

function lyricStyle(
  family = 'Studio Sans',
  unsungColor = '#72687D',
  sungColor = '#FF8A2B',
): LyricTextStyle {
  const face: FontFaceDescriptor = {
    fullName: `${family} Regular`,
    style: 'Regular',
    postscriptName: `${family.replaceAll(' ', '')}-Regular`,
    weight: 400,
    slant: 'normal',
  }
  return {
    typeface: { kind: 'local', family, faces: [{ ...face }] },
    fontStyle: { ...face },
    sizePx: 82,
  }
}

function stageStyle(
  family = 'Studio Sans',
  unsungColor = '#72687D',
  sungColor = '#FF8A2B',
): StageStyle {
  const style = cloneStageStyle()
  style.lyrics = lyricStyle(family, unsungColor, sungColor)
  return style
}

function projectStyleDraft(
  family = 'Studio Sans',
  unsungColor = '#72687D',
  sungColor = '#FF8A2B',
): ProjectStyleDraft {
  const vocalStyle = cloneVocalStyle()
  vocalStyle.unsungColor = unsungColor
  vocalStyle.sungColor = sungColor
  return createProjectStyleDraft(stageStyle(family), [
    createVocalTrack({ id: 'lead-a', vocalStyle }),
  ])
}

function visibleTextStyles(style: StageStyle) {
  return [
    style.titleCard.eyebrow,
    style.titleCard.title,
    style.titleCard.artist,
    style.stageFrame.brand,
    style.stageFrame.clock,
    style.stageFrame.footer,
  ]
}

function expectIsolatedClone(actual: ProjectStyleDraft, expected: ProjectStyleDraft) {
  expect(actual).toEqual(expected)
  expect(actual).not.toBe(expected)
  expect(actual.stageStyle).not.toBe(expected.stageStyle)
  expect(actual.singers).not.toBe(expected.singers)
  expect(actual.singers[0]!.vocalStyle).not.toBe(expected.singers[0]!.vocalStyle)
  expect(actual.singers[0]!.vocalStyle.syncAid).not.toBe(expected.singers[0]!.vocalStyle.syncAid)
  expect(actual.singers[0]!.vocalTiming).not.toBe(expected.singers[0]!.vocalTiming)
  const actualStage = actual.stageStyle
  const expectedStage = expected.stageStyle
  expect(actualStage.background).not.toBe(expectedStage.background)
  expect(actualStage.lyrics).not.toBe(expectedStage.lyrics)
  expect(actualStage.lyrics.typeface).not.toBe(expectedStage.lyrics.typeface)
  expect(actualStage.lyrics.typeface.faces[0]).not.toBe(expectedStage.lyrics.typeface.faces[0])
  expect(actualStage.lyrics.fontStyle).not.toBe(expectedStage.lyrics.fontStyle)
  expect(actualStage.titleCard).not.toBe(expectedStage.titleCard)
  expect(actualStage.stageFrame).not.toBe(expectedStage.stageFrame)
  visibleTextStyles(actualStage).forEach((role, index) => {
    const expectedRole = visibleTextStyles(expectedStage)[index]!
    expect(role).not.toBe(expectedRole)
    expect(role.typeface).not.toBe(expectedRole.typeface)
    expect(role.typeface.faces[0]).not.toBe(expectedRole.typeface.faces[0])
    expect(role.fontStyle).not.toBe(expectedRole.fontStyle)
  })
}

function Probe({ options }: { options: ProjectStyleSessionOptions }) {
  currentSession = useProjectStyleSession(options)
  renderSnapshots.push({
    draftFamily: currentSession.draft?.stageStyle.lyrics.typeface.family ?? null,
    isOpen: currentSession.isOpen,
    blocksProjectActions: currentSession.blocksProjectActions,
  })
  return null
}

let currentSession: ProjectStyleSession
let renderSnapshots: Array<{
  draftFamily: string | null
  isOpen: boolean
  blocksProjectActions: boolean
}>

describe('project Style session', () => {
  let container: HTMLDivElement
  let root: Root
  let source: ProjectStyleDraft
  let ownerKey: ProjectStyleOwnerKey
  let allowed: boolean
  let requestFonts: ReturnType<typeof vi.fn>
  let commitDraft: ReturnType<typeof vi.fn>
  let options: ProjectStyleSessionOptions

  const render = async (changes: Partial<ProjectStyleSessionOptions> = {}) => {
    options = { ...options, ...changes }
    await act(async () => root.render(<Probe options={options} />))
  }

  const trigger = () => {
    const button = document.createElement('button')
    button.textContent = 'Style'
    document.body.append(button)
    return button
  }

  const start = async (element = trigger()) => {
    await act(async () => currentSession.start(element))
    return element
  }

  const change = async (next: ProjectStyleDraft) => {
    await act(async () => currentSession.change(next))
  }

  const flushFocus = async () => {
    await act(async () => vi.runOnlyPendingTimers())
  }

  beforeEach(async () => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    source = projectStyleDraft()
    ownerKey = { projectId: 'project-a', lifecycle: 1, trackId: 'lead-a' }
    allowed = true
    requestFonts = vi.fn()
    commitDraft = vi.fn(() => 'applied' as const)
    renderSnapshots = []
    options = {
      ownerKey,
      source,
      canInteract: () => allowed,
      requestFonts,
      commitDraft,
    }
    await render()
  })

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers()
      root.unmount()
    })
    document.querySelectorAll('button').forEach((button) => button.remove())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requests fonts synchronously only after an authorized start', async () => {
    const button = trigger()
    allowed = false
    await act(async () => currentSession.start(button))

    expect(requestFonts).not.toHaveBeenCalled()
    expect(currentSession).toMatchObject({
      draft: null,
      isOpen: false,
      blocksProjectActions: false,
      isDirty: false,
    })

    let insideStart = false
    requestFonts.mockImplementationOnce(() => {
      expect(insideStart).toBe(true)
    })
    allowed = true
    source.stageStyle.lyrics.typeface.faces[0].fullName = 'Changed after render'
    source.stageStyle.lyrics.fontStyle.fullName = 'Changed after render'
    source.stageStyle.background.imagePath = '/changed-after-render.png'
    source.singers[0]!.vocalStyle.syncAid.maxLeadMs = 9_000
    await act(async () => {
      insideStart = true
      currentSession.start(button)
      insideStart = false
    })

    expect(requestFonts).toHaveBeenCalledOnce()
    expect(currentSession).toMatchObject({
      isOpen: true,
      blocksProjectActions: true,
      isDirty: false,
    })
    expect(currentSession.draft?.stageStyle.lyrics.typeface.faces[0].fullName).toBe(
      'Studio Sans Regular',
    )
    expect(currentSession.draft?.stageStyle.lyrics.fontStyle.fullName).toBe('Studio Sans Regular')
    expect(currentSession.draft?.stageStyle.background.imagePath).toBeNull()
    expect(currentSession.draft?.singers[0]!.vocalStyle.syncAid.maxLeadMs).toBe(3_000)
  })

  it('deep-clones the complete source, exposed drafts, values, and updater results', async () => {
    await start()

    expectIsolatedClone(currentSession.draft!, source)

    currentSession.draft!.stageStyle.lyrics.typeface.faces[0].fullName = 'Exposed mutation'
    currentSession.draft!.stageStyle.titleCard.title.typeface.faces[0].fullName =
      'Exposed title mutation'
    currentSession.draft!.stageStyle.background.solidColor = '#010203'
    currentSession.draft!.singers[0]!.vocalStyle.syncAid.enabled = true
    await render()
    expect(currentSession.draft?.stageStyle.lyrics.typeface.faces[0].fullName).toBe(
      'Studio Sans Regular',
    )
    expect(currentSession.draft?.stageStyle.titleCard.title.typeface.faces[0].fullName).not.toBe(
      'Exposed title mutation',
    )
    expect(currentSession.draft?.stageStyle.background.solidColor).not.toBe('#010203')
    expect(currentSession.draft?.singers[0]!.vocalStyle.syncAid.enabled).toBe(false)

    const replacement = projectStyleDraft('Value Sans')
    replacement.stageStyle.background.imagePath = '/replacement.png'
    replacement.singers[0]!.vocalStyle.previewMs = 4_500
    replacement.singers[0]!.vocalTiming.previewMs = '4500'
    await change(replacement)
    replacement.stageStyle.lyrics.typeface.family = 'Mutated after change'
    replacement.stageStyle.lyrics.typeface.faces[0].fullName = 'Mutated after change'
    replacement.stageStyle.lyrics.fontStyle.fullName = 'Mutated after change'
    replacement.stageStyle.background.imagePath = '/mutated.png'
    replacement.singers[0]!.vocalStyle.previewMs = 1
    replacement.singers[0]!.vocalTiming.previewMs = '1'
    expect(currentSession.draft?.stageStyle.lyrics.typeface.family).toBe('Value Sans')
    expect(currentSession.draft?.stageStyle.lyrics.fontStyle.fullName).toBe('Value Sans Regular')
    expect(currentSession.draft?.stageStyle.background.imagePath).toBe('/replacement.png')
    expect(currentSession.draft?.singers[0]!.vocalStyle.previewMs).toBe(4_500)

    let updaterInput: ProjectStyleDraft | null = null
    await act(async () => {
      currentSession.change((draft) => {
        updaterInput = draft
        draft.singers[0]!.vocalStyle.sungColor = '#123456'
        draft.stageStyle.lyrics.typeface.faces[0].fullName = 'Updater result'
        draft.stageStyle.titleCard.title.visible = false
        draft.singers[0]!.vocalStyle.syncAid.minLeadMs = 2_500
        draft.singers[0]!.vocalTiming.minLeadMs = '2500'
        return draft
      })
    })
    updaterInput!.singers[0]!.vocalStyle.sungColor = '#654321'
    updaterInput!.stageStyle.lyrics.typeface.faces[0].fullName = 'Mutated callback result'
    updaterInput!.stageStyle.titleCard.title.visible = true
    updaterInput!.singers[0]!.vocalStyle.syncAid.minLeadMs = 1
    updaterInput!.singers[0]!.vocalTiming.minLeadMs = '1'
    await render()

    expect(currentSession.draft?.singers[0]!.vocalStyle.sungColor).toBe('#123456')
    expect(currentSession.draft?.stageStyle.lyrics.typeface.faces[0].fullName).toBe(
      'Updater result',
    )
    expect(currentSession.draft?.stageStyle.titleCard.title.visible).toBe(false)
    expect(currentSession.draft?.singers[0]!.vocalStyle.syncAid.minLeadMs).toBe(2_500)
    expect(source).toEqual(projectStyleDraft())
  })

  it('freezes guarded changes and apply, then resumes the same draft', async () => {
    await start()
    await change(projectStyleDraft('Studio Sans', '#72687D', '#123456'))
    const heldDraft = structuredClone(currentSession.draft!)

    allowed = false
    await change(projectStyleDraft('Blocked replacement'))
    let settled = true
    await act(async () => {
      settled = currentSession.apply()
    })

    expect(settled).toBe(false)
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.blocksProjectActions).toBe(true)
    expect(commitDraft).not.toHaveBeenCalled()

    allowed = true
    await act(async () => {
      currentSession.change((draft) => ({
        ...draft,
        singers: [
          {
            ...draft.singers[0]!,
            vocalStyle: { ...draft.singers[0]!.vocalStyle, unsungColor: '#ABCDEF' },
          },
        ],
      }))
    })
    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(commitDraft.mock.calls[0]?.[1].singers[0].vocalStyle).toMatchObject({
      sungColor: '#123456',
      unsungColor: '#ABCDEF',
    })
    expect(currentSession.isOpen).toBe(false)
  })

  it.each([
    ['empty', 'previewMs', ''],
    ['fractional', 'minLeadMs', '1000.5'],
    ['unsafe', 'maxLeadMs', '9007199254740992'],
    ['negative', 'minLeadMs', '-1'],
    ['over-limit', 'previewMs', '60001'],
    ['minimum ordering', 'minLeadMs', '3001'],
    ['maximum ordering', 'maxLeadMs', '4001'],
  ] as const)('retains a %s raw timing draft and rejects Apply', async (_case, field, value) => {
    await start()
    await act(async () =>
      currentSession.change((draft) => ({
        ...draft,
        singers: [
          {
            ...draft.singers[0]!,
            vocalTiming: { ...draft.singers[0]!.vocalTiming, [field]: value },
          },
        ],
      })),
    )

    expect(currentSession.draft?.singers[0]!.vocalTiming[field]).toBe(value)
    expect(currentSession.canApply).toBe(false)
    expect(currentSession.applyBlockedReason).toContain('Lead Vocal')
    expect(currentSession.apply()).toBe(false)
    expect(commitDraft).not.toHaveBeenCalled()
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.draft?.singers[0]!.vocalTiming[field]).toBe(value)
  })

  it('names a hidden invalid singer after the user switches to another singer', async () => {
    source = createProjectStyleDraft(stageStyle(), [
      createVocalTrack({ id: 'lead-a', name: 'Lead' }),
      createVocalTrack({ id: 'harmony-b', name: 'Harmony', defaultStyleIndex: 1 }),
    ])
    await render({ source })
    await start()
    await act(async () =>
      currentSession.change((draft) => ({
        ...draft,
        singers: draft.singers.map((singer) =>
          singer.trackId === 'lead-a'
            ? {
                ...singer,
                vocalTiming: { ...singer.vocalTiming, previewMs: '' },
              }
            : singer,
        ),
      })),
    )

    expect(currentSession.canApply).toBe(false)
    expect(currentSession.applyBlockedReason).toContain('Lead')
    expect(currentSession.applyBlockedReason).not.toContain('Harmony')
    expect(currentSession.draft?.singers[1]!.vocalTiming.previewMs).toBe('3000')
  })

  it.each([
    ['all-zero equality', '0', '0', '0'],
    ['maximum boundary', '60000', '0', '60000'],
    ['maximum equality', '60000', '60000', '60000'],
    ['non-step integers', '451', '149', '307'],
  ])(
    'accepts %s timing and passes only canonical integers to commit',
    async (_case, previewMs, minLeadMs, maxLeadMs) => {
      await start()
      await act(async () =>
        currentSession.change((draft) => ({
          ...draft,
          singers: [
            {
              ...draft.singers[0]!,
              vocalTiming: { previewMs, minLeadMs, maxLeadMs },
            },
          ],
        })),
      )

      expect(currentSession.canApply).toBe(true)
      expect(currentSession.applyBlockedReason).toBeNull()
      expect(currentSession.apply()).toBe(true)
      expect(commitDraft).toHaveBeenCalledWith(
        ownerKey,
        expect.objectContaining({
          singers: [
            expect.objectContaining({
              vocalStyle: expect.objectContaining({
                previewMs: Number(previewMs),
                syncAid: expect.objectContaining({
                  minLeadMs: Number(minLeadMs),
                  maxLeadMs: Number(maxLeadMs),
                }),
              }),
            }),
          ],
        }),
      )
    },
  )

  it.each<ProjectStyleCommitResult>(['applied', 'noop'])(
    'closes and restores focus once after a %s acknowledgement',
    async (result) => {
      const button = trigger()
      const focus = vi.spyOn(button, 'focus')
      await start(button)
      if (result === 'applied') {
        const changed = projectStyleDraft()
        changed.stageStyle.lyrics.sizePx = 96
        await change(changed)
      }
      commitDraft.mockImplementationOnce(() => {
        currentSession.apply()
        return result
      })

      let firstResult = false
      let repeatedResult = true
      await act(async () => {
        firstResult = currentSession.apply()
        repeatedResult = currentSession.apply()
      })

      expect(firstResult).toBe(true)
      expect(repeatedResult).toBe(false)
      expect(commitDraft).toHaveBeenCalledOnce()
      expect(commitDraft).toHaveBeenCalledWith(ownerKey, expect.any(Object))
      expect(currentSession).toMatchObject({
        draft: null,
        isOpen: false,
        blocksProjectActions: false,
      })
      expect(focus).not.toHaveBeenCalled()
      await flushFocus()
      expect(focus).toHaveBeenCalledOnce()
    },
  )

  it('retains the exact draft when a blocked callback mutates its copy', async () => {
    const button = await start()
    const focus = vi.spyOn(button, 'focus')
    await change(projectStyleDraft('Held Sans', '#010203', '#A0B0C0'))
    const heldDraft = structuredClone(currentSession.draft!)
    commitDraft.mockImplementationOnce((_key, draft: ProjectStyleDraft) => {
      draft.stageStyle.lyrics.typeface.family = 'Callback mutation'
      draft.stageStyle.lyrics.typeface.faces[0].fullName = 'Callback mutation'
      draft.stageStyle.lyrics.fontStyle.fullName = 'Callback mutation'
      draft.singers[0]!.vocalStyle.sungColor = '#FFFFFF'
      draft.stageStyle.background.imagePath = '/callback-mutation.png'
      draft.singers[0]!.vocalStyle.syncAid.enabled = true
      return 'blocked'
    })

    let settled = true
    await act(async () => {
      settled = currentSession.apply()
    })
    await flushFocus()

    expect(settled).toBe(false)
    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.isDirty).toBe(true)
    expect(focus).not.toHaveBeenCalled()
    expect(source).toEqual(projectStyleDraft())
  })

  it('retains the draft and releases the apply guard when the commit callback throws', async () => {
    await start()
    const changed = projectStyleDraft('Retry Sans')
    changed.stageStyle.background.imagePath = '/latent-retry.png'
    changed.singers[0]!.vocalStyle.previewMs = 7_000
    changed.singers[0]!.vocalTiming.previewMs = '7000'
    await change(changed)
    const heldDraft = structuredClone(currentSession.draft!)
    commitDraft.mockImplementationOnce(() => {
      throw new Error('Commit callback failed')
    })

    expect(() => currentSession.apply()).toThrow('Commit callback failed')
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.isDirty).toBe(true)

    commitDraft.mockReturnValueOnce('applied')
    let settled = false
    await act(async () => {
      settled = currentSession.apply()
    })
    expect(settled).toBe(true)
    expect(commitDraft).toHaveBeenCalledTimes(2)
    expect(currentSession.isOpen).toBe(false)
  })

  it('abandons a stale acknowledgement without restoring focus', async () => {
    const button = await start()
    const focus = vi.spyOn(button, 'focus')
    commitDraft.mockReturnValueOnce('stale')

    let settled = true
    await act(async () => {
      settled = currentSession.apply()
    })
    await flushFocus()

    expect(settled).toBe(false)
    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
    expect(currentSession.draft).toBeNull()
    expect(focus).not.toHaveBeenCalled()
  })

  it('abandons A immediately when lifecycle ownership changes, even for a reused project id', async () => {
    const buttonA = await start()
    const focusA = vi.spyOn(buttonA, 'focus')
    await change(projectStyleDraft('Draft A'))

    const laterRevision = projectStyleDraft('History revision source')
    await render({ source: laterRevision })
    expect(currentSession.draft?.stageStyle.lyrics.typeface.family).toBe('Draft A')
    expect(currentSession.isOpen).toBe(true)

    allowed = false
    const ownerB = { projectId: ownerKey.projectId, lifecycle: 2, trackId: 'lead-b' }
    const firstOwnerBRender = renderSnapshots.length
    await render({ ownerKey: ownerB, source: projectStyleDraft('Project B') })
    expect(renderSnapshots[firstOwnerBRender]).toEqual({
      draftFamily: null,
      isOpen: false,
      blocksProjectActions: false,
    })
    expect(currentSession).toMatchObject({
      draft: null,
      isOpen: false,
      blocksProjectActions: false,
      isDirty: false,
    })

    await act(async () => {
      currentSession.apply()
      currentSession.cancel()
    })
    await flushFocus()
    expect(commitDraft).not.toHaveBeenCalled()
    expect(focusA).not.toHaveBeenCalled()

    const buttonB = trigger()
    await act(async () => currentSession.start(buttonB))
    expect(requestFonts).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)

    allowed = true
    await act(async () => currentSession.start(buttonB))
    expect(requestFonts).toHaveBeenCalledTimes(2)
    expect(currentSession.draft?.stageStyle.lyrics.typeface.family).toBe('Project B')
  })

  it('cancel never commits and focuses only a connected same-owner trigger', async () => {
    const connected = await start()
    const connectedFocus = vi.spyOn(connected, 'focus')
    let canceled = false
    await act(async () => {
      canceled = currentSession.cancel()
    })
    expect(canceled).toBe(true)
    expect(connectedFocus).not.toHaveBeenCalled()
    await flushFocus()
    expect(connectedFocus).toHaveBeenCalledOnce()

    const disconnected = await start()
    const disconnectedFocus = vi.spyOn(disconnected, 'focus')
    disconnected.remove()
    await act(async () => currentSession.cancel())
    await flushFocus()
    expect(disconnectedFocus).not.toHaveBeenCalled()

    const changedOwner = await start()
    const changedOwnerFocus = vi.spyOn(changedOwner, 'focus')
    await act(async () => currentSession.cancel())
    await render({
      ownerKey: { projectId: 'project-b', lifecycle: 2, trackId: 'lead-b' },
      source: projectStyleDraft('Project B'),
    })
    await flushFocus()

    expect(changedOwnerFocus).not.toHaveBeenCalled()
    expect(commitDraft).not.toHaveBeenCalled()
  })

  it('keeps placement edits transactional across Cancel and Apply', async () => {
    const baseline = structuredClone(source)
    await start()
    await act(async () =>
      currentSession.change((draft) => ({
        ...draft,
        stageStyle: {
          ...draft.stageStyle,
          titleCard: {
            ...draft.stageStyle.titleCard,
            title: {
              ...draft.stageStyle.titleCard.title,
              position: { x: 1_500, y: 220 },
            },
          },
        },
        singers: [
          {
            ...draft.singers[0]!,
            vocalStyle: { ...draft.singers[0]!.vocalStyle, position: { x: 420, y: 810 } },
          },
        ],
      })),
    )
    expect(currentSession.isDirty).toBe(true)
    expect(currentSession.cancel()).toBe(true)
    expect(source).toStrictEqual(baseline)
    expect(commitDraft).not.toHaveBeenCalled()

    await start()
    await act(async () =>
      currentSession.change((draft) => ({
        ...draft,
        stageStyle: {
          ...draft.stageStyle,
          titleCard: {
            ...draft.stageStyle.titleCard,
            title: {
              ...draft.stageStyle.titleCard.title,
              position: { x: 1_500, y: 220 },
            },
          },
        },
        singers: [
          {
            ...draft.singers[0]!,
            vocalStyle: { ...draft.singers[0]!.vocalStyle, position: { x: 420, y: 810 } },
          },
        ],
      })),
    )
    expect(currentSession.apply()).toBe(true)
    expect(commitDraft).toHaveBeenCalledWith(
      ownerKey,
      expect.objectContaining({
        stageStyle: expect.objectContaining({
          titleCard: expect.objectContaining({
            title: expect.objectContaining({ position: { x: 1_500, y: 220 } }),
          }),
        }),
        singers: [
          expect.objectContaining({
            vocalStyle: expect.objectContaining({ position: { x: 420, y: 810 } }),
          }),
        ],
      }),
    )
  })

  it('compares every active and latent StageStyle field semantically', () => {
    const mutations: Record<string, (style: StageStyle) => void> = {
      'background mode': (style) => {
        style.background.mode = 'solid'
      },
      'background solid color': (style) => {
        style.background.solidColor = '#000001'
      },
      'background gradient start': (style) => {
        style.background.gradientStartColor = '#000002'
      },
      'background gradient end': (style) => {
        style.background.gradientEndColor = '#000003'
      },
      'background image path': (style) => {
        style.background.imagePath = '/latent-background.png'
      },
      'lyrics typeface': (style) => {
        style.lyrics.typeface.family = 'Changed lyric family'
      },
      'lyrics face': (style) => {
        style.lyrics.fontStyle.fullName = 'Changed lyric face'
      },
      'lyrics size': (style) => {
        style.lyrics.sizePx = 96
      },
      'Stage frame enabled': (style) => {
        style.stageFrame.enabled = !style.stageFrame.enabled
      },
      'Stage frame line color': (style) => {
        style.stageFrame.lineColor = '#000006'
      },
      'Stage frame line width': (style) => {
        style.stageFrame.lineWidthPx += 1
      },
    }
    const roles = {
      'title eyebrow': (style: StageStyle) => style.titleCard.eyebrow,
      'title title': (style: StageStyle) => style.titleCard.title,
      'title artist': (style: StageStyle) => style.titleCard.artist,
      'Stage frame brand': (style: StageStyle) => style.stageFrame.brand,
      'Stage frame clock': (style: StageStyle) => style.stageFrame.clock,
      'Stage frame footer': (style: StageStyle) => style.stageFrame.footer,
    }
    Object.entries(roles).forEach(([name, role]) => {
      mutations[`${name} typeface`] = (style) => {
        role(style).typeface.family = `Changed ${name} family`
      }
      mutations[`${name} face`] = (style) => {
        role(style).fontStyle.fullName = `Changed ${name} face`
      }
      mutations[`${name} size`] = (style) => {
        role(style).sizePx = role(style).sizePx === 96 ? 104 : 96
      }
      mutations[`${name} color`] = (style) => {
        role(style).color = '#000007'
      }
      mutations[`${name} visible`] = (style) => {
        role(style).visible = !role(style).visible
      }
    })
    mutations['title eyebrow position'] = (style) => {
      style.titleCard.eyebrow.position.x += 1
    }
    mutations['title title position'] = (style) => {
      style.titleCard.title.position.y += 1
    }
    mutations['title artist position'] = (style) => {
      style.titleCard.artist.position.x += 1
    }

    Object.entries(mutations).forEach(([name, mutate]) => {
      const changed = cloneStageStyle(source.stageStyle)
      mutate(changed)
      expect(sameStageStyle(source.stageStyle, changed), name).toBe(false)
    })
  })

  it('compares complete singer appearance semantically, including timing fields', () => {
    const baseline = cloneVocalStyle(source.singers[0]!.vocalStyle)
    baseline.sungColor = '#ABCDEF'
    baseline.unsungColor = '#123456'
    const equivalent = cloneVocalStyle(baseline)
    equivalent.sungColor = '#abcdef'
    equivalent.unsungColor = '#123456'
    expect(sameVocalStyle(baseline, equivalent)).toBe(true)

    const mutations: Array<(style: VocalStyle) => void> = [
      (style) => {
        style.sungColor = '#000001'
      },
      (style) => {
        style.unsungColor = '#000002'
      },
      (style) => {
        style.alignment = 'left'
      },
      (style) => {
        style.position.x += 1
      },
      (style) => {
        style.previewMs += 1
      },
      (style) => {
        style.syncAid.enabled = !style.syncAid.enabled
      },
      (style) => {
        style.syncAid.minLeadMs += 1
      },
      (style) => {
        style.syncAid.maxLeadMs += 1
      },
    ]
    mutations.forEach((mutate) => {
      const changed = cloneVocalStyle(baseline)
      mutate(changed)
      expect(sameVocalStyle(baseline, changed)).toBe(false)
    })
  })

  it('normalizes every saved color and preserves semantic font keys for no-op readiness', async () => {
    const caseOnly = structuredClone(source)
    caseOnly.stageStyle.background.solidColor =
      caseOnly.stageStyle.background.solidColor.toLowerCase()
    caseOnly.stageStyle.background.gradientStartColor =
      caseOnly.stageStyle.background.gradientStartColor.toLowerCase()
    caseOnly.stageStyle.background.gradientEndColor =
      caseOnly.stageStyle.background.gradientEndColor.toLowerCase()
    caseOnly.singers[0]!.vocalStyle.unsungColor =
      caseOnly.singers[0]!.vocalStyle.unsungColor.toLowerCase()
    caseOnly.singers[0]!.vocalStyle.sungColor =
      caseOnly.singers[0]!.vocalStyle.sungColor.toLowerCase()
    visibleTextStyles(caseOnly.stageStyle).forEach((role) => {
      role.color = role.color.toLowerCase()
      role.typeface.faces.reverse()
    })
    caseOnly.stageStyle.stageFrame.lineColor =
      caseOnly.stageStyle.stageFrame.lineColor.toLowerCase()
    caseOnly.stageStyle.lyrics.typeface.faces.reverse()
    expect(sameStageStyle(source.stageStyle, caseOnly.stageStyle)).toBe(true)

    await start()
    await change(caseOnly)
    expect(currentSession.isDirty).toBe(false)
    commitDraft.mockReturnValueOnce('noop')

    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
  })
})
