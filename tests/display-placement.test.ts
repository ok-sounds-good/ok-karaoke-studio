import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  CENTER_SNAP_THRESHOLD_PX,
  clampDisplayPosition,
  logicalObjectSize,
  moveDisplayPosition,
  snapDisplayPositionToStageCenter,
} from '../src/lib/display-placement'

describe('shared display placement geometry', () => {
  it('installs in a browser-style global without requiring CommonJS globals', () => {
    const source = readFileSync(
      new URL('../electron/display-placement.cjs', import.meta.url),
      'utf8',
    )
    const placement = runInNewContext(
      `${source}\nglobalThis[Symbol.for('studio.okay-karaoke.display-placement')]`,
    ) as {
      clampDisplayPosition(position: { x: number; y: number }): { x: number; y: number }
    }

    expect(placement.clampDisplayPosition({ x: -1, y: 2_000 })).toEqual({ x: 0, y: 1_080 })
  })

  it('clamps center coordinates by the rendered object bounds without collision handling', () => {
    expect(clampDisplayPosition({ x: 0, y: 0 }, 800, 200)).toEqual({ x: 400, y: 100 })
    expect(clampDisplayPosition({ x: 1_920, y: 1_080 }, 800, 200)).toEqual({
      x: 1_520,
      y: 980,
    })
    expect(clampDisplayPosition({ x: 640, y: 480 }, 3_000, 2_000)).toEqual({
      x: 960,
      y: 540,
    })
  })

  it('rounds drag and keyboard deltas to exact logical-stage pixels', () => {
    expect(moveDisplayPosition({ x: 800, y: 600 }, 10.4, -20.6)).toEqual({
      x: 810,
      y: 579,
    })
  })

  it('softly snaps each center axis and releases immediately beyond the logical threshold', () => {
    expect(
      snapDisplayPositionToStageCenter({
        x: 960 + CENTER_SNAP_THRESHOLD_PX,
        y: 540 + CENTER_SNAP_THRESHOLD_PX + 1,
      }),
    ).toEqual({
      axes: { x: true, y: false },
      position: { x: 960, y: 561 },
    })
    expect(
      snapDisplayPositionToStageCenter({
        x: 960 + CENTER_SNAP_THRESHOLD_PX + 1,
        y: 540 - CENTER_SNAP_THRESHOLD_PX,
      }),
    ).toEqual({
      axes: { x: false, y: true },
      position: { x: 981, y: 540 },
    })
  })

  it('bypasses center snapping for precise nearby pointer placement', () => {
    expect(snapDisplayPositionToStageCenter({ x: 970, y: 530 }, true)).toEqual({
      axes: { x: false, y: false },
      position: { x: 970, y: 530 },
    })
  })

  it('converts Preview measurements back to the logical 1920 by 1080 stage', () => {
    expect(logicalObjectSize({ width: 960, height: 540 }, { width: 400, height: 100 })).toEqual({
      width: 800,
      height: 200,
    })
  })
})
