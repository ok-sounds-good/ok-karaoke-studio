'use strict'

function createNativeImageDecoder(nativeImage) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new TypeError('Electron nativeImage.createFromBuffer is required')
  }
  return ({ bytes }) => {
    const decoded = nativeImage.createFromBuffer(bytes)
    if (!decoded || typeof decoded.isEmpty !== 'function' || decoded.isEmpty()) return false
    if (typeof decoded.getSize !== 'function') return false
    const size = decoded.getSize()
    return Boolean(
      size &&
      Number.isSafeInteger(size.width) &&
      Number.isSafeInteger(size.height) &&
      size.width > 0 &&
      size.height > 0,
    )
  }
}

module.exports = { createNativeImageDecoder }
