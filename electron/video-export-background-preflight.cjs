'use strict'

function createVideoExportBackgroundPreflight({
  linkedAssets,
  notifyInvalidation,
  validateLinkedImage,
}) {
  if (!linkedAssets || typeof validateLinkedImage !== 'function') {
    throw new TypeError('Background preflight dependencies are required')
  }

  return async function preflightVideoExportBackground(ownerId, backgroundPath) {
    if (!backgroundPath) return null
    try {
      return await validateLinkedImage(backgroundPath)
    } catch {
      linkedAssets.revokeOwner(ownerId, 'background')
      const message = `Linked image is missing or unreadable: ${backgroundPath}`
      notifyInvalidation?.(ownerId, {
        kind: 'background',
        path: backgroundPath,
        message,
      })
      throw new Error(message)
    }
  }
}

module.exports = { createVideoExportBackgroundPreflight }
