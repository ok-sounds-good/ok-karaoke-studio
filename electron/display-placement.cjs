'use strict'

function installDisplayPlacement(target = globalThis) {
  const stageWidthPx = 1920
  const stageHeightPx = 1080

  const finiteSize = (value, maximum) =>
    Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0

  const clampDisplayPosition = (position, objectWidthPx = 0, objectHeightPx = 0) => {
    const width = finiteSize(objectWidthPx, stageWidthPx)
    const height = finiteSize(objectHeightPx, stageHeightPx)
    const halfWidth = width / 2
    const halfHeight = height / 2
    const x = Number.isFinite(position?.x) ? position.x : stageWidthPx / 2
    const y = Number.isFinite(position?.y) ? position.y : stageHeightPx / 2
    const minimumX = Math.ceil(halfWidth)
    const maximumX = Math.floor(stageWidthPx - halfWidth)
    const minimumY = Math.ceil(halfHeight)
    const maximumY = Math.floor(stageHeightPx - halfHeight)
    return {
      x: Math.max(minimumX, Math.min(maximumX, Math.round(x))),
      y: Math.max(minimumY, Math.min(maximumY, Math.round(y))),
    }
  }

  const moveDisplayPosition = (position, deltaX, deltaY, objectWidthPx = 0, objectHeightPx = 0) =>
    clampDisplayPosition(
      {
        x: Math.round(position.x + deltaX),
        y: Math.round(position.y + deltaY),
      },
      objectWidthPx,
      objectHeightPx,
    )

  const api = Object.freeze({
    clampDisplayPosition,
    moveDisplayPosition,
    stageHeightPx,
    stageWidthPx,
  })
  const apiKey = Symbol.for('studio.okay-karaoke.display-placement')
  if (target[apiKey] === undefined) {
    Object.defineProperty(target, apiKey, { value: api })
  }
  return target[apiKey]
}

const api = installDisplayPlacement()

module.exports = Object.freeze({
  ...api,
  installDisplayPlacement,
})
