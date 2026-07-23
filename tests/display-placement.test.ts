import { describe, expect, it } from 'vitest'
import {
  clampDisplayPosition,
  logicalObjectSize,
  moveDisplayPosition,
} from '../src/lib/display-placement'

describe('shared display placement geometry', () => {
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

  it('converts Preview measurements back to the logical 1920 by 1080 stage', () => {
    expect(logicalObjectSize({ width: 960, height: 540 }, { width: 400, height: 100 })).toEqual({
      width: 800,
      height: 200,
    })
  })
})
