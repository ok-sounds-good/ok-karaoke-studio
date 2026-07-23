import '../../electron/display-placement.cjs'
import type { DisplayPosition } from './video-style'

interface DisplayPlacementApi {
  readonly stageHeightPx: number
  readonly stageWidthPx: number
  clampDisplayPosition(
    position: DisplayPosition,
    objectWidthPx?: number,
    objectHeightPx?: number,
  ): DisplayPosition
  moveDisplayPosition(
    position: DisplayPosition,
    deltaX: number,
    deltaY: number,
    objectWidthPx?: number,
    objectHeightPx?: number,
  ): DisplayPosition
}

const placement = Reflect.get(globalThis, Symbol.for('studio.okay-karaoke.display-placement')) as
  DisplayPlacementApi | undefined

if (!placement || !Object.isFrozen(placement)) {
  throw new Error('Shared display placement geometry was not installed.')
}
const installedPlacement = placement

export const clampDisplayPosition = installedPlacement.clampDisplayPosition
export const moveDisplayPosition = installedPlacement.moveDisplayPosition

export function logicalObjectSize(
  stage: Pick<DOMRect, 'width' | 'height'>,
  object: Pick<DOMRect, 'width' | 'height'>,
) {
  if (stage.width <= 0 || stage.height <= 0) return { width: 0, height: 0 }
  return {
    width: (object.width / stage.width) * installedPlacement.stageWidthPx,
    height: (object.height / stage.height) * installedPlacement.stageHeightPx,
  }
}
