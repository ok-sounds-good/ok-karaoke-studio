import geometry from '../../electron/sync-aid-geometry.json'

export const SYNC_AID_GEOMETRY = Object.freeze(geometry)

export function syncAidPosition(leadingEdgePx: number) {
  const endLeftPx = leadingEdgePx - SYNC_AID_GEOMETRY.gapPx - SYNC_AID_GEOMETRY.cueWidthPx
  const startLeftPx = Math.min(
    -SYNC_AID_GEOMETRY.cueWidthPx - SYNC_AID_GEOMETRY.gapPx,
    endLeftPx - SYNC_AID_GEOMETRY.minimumTravelPx,
  )
  return {
    endLeftPx,
    startLeftPx,
    travelPx: endLeftPx - startLeftPx,
  }
}

export function syncAidBrightness(progress: number) {
  if (progress < 1 / 3) return 0.35
  if (progress < 2 / 3) return 0.65
  return 1
}
