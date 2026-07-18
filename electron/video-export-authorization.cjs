'use strict'

const LINKED_IMAGE_EXPORT_WARNING =
  'The linked background image is unavailable, invalid, changed, or no longer authorized. Restore it in Live Preview and try again.'
const LINKED_IMAGE_EXPORT_ERROR_CODE = 'VIDEO_EXPORT_BACKGROUND_INVALID'

function rejectLinkedImageExport() {
  const error = new Error(LINKED_IMAGE_EXPORT_WARNING)
  error.code = LINKED_IMAGE_EXPORT_ERROR_CODE
  throw error
}

function linkedImageExportFailure(error, expectedBackground, scheme = 'studio-media') {
  if (error?.code !== LINKED_IMAGE_EXPORT_ERROR_CODE || expectedBackground?.valid !== true) {
    return null
  }
  return Object.freeze({
    status: 'background-invalid',
    background: Object.freeze({
      activeUrl: expectedBackground.activeToken
        ? `${scheme}://asset/${expectedBackground.activeToken}`
        : null,
      revision: expectedBackground.revision,
    }),
    message: LINKED_IMAGE_EXPORT_WARNING,
  })
}

function throwIfCanceled(signal) {
  if (!signal?.aborted) return
  const error = new Error('Video export canceled')
  error.name = 'AbortError'
  throw error
}

function sameMedia(left, right) {
  return Boolean(
    left &&
    right &&
    left.filePath === right.filePath &&
    left.mime === right.mime &&
    Buffer.isBuffer(left.bytes) &&
    Buffer.isBuffer(right.bytes) &&
    left.bytes.equals(right.bytes),
  )
}

function createVideoExportAuthorizer({ mediaCapabilities, readLinkedImage }) {
  if (!mediaCapabilities || typeof mediaCapabilities.backgroundExportSnapshot !== 'function') {
    throw new TypeError('A media capability registry is required')
  }
  if (typeof readLinkedImage !== 'function') {
    throw new TypeError('A linked image reader is required')
  }

  return async function authorizeVideoExport({ ownerId, project, expectedBackground, signal }) {
    throwIfCanceled(signal)
    if (project.stageStyle.background.mode !== 'image') {
      return Object.freeze({ backgroundImage: null })
    }

    const linkedPath = project.stageStyle.background.imagePath
    const retained = mediaCapabilities.backgroundExportSnapshot(
      ownerId,
      expectedBackground?.revision,
      expectedBackground?.activeToken,
      linkedPath,
    )
    if (!retained) rejectLinkedImageExport()

    let currentImage
    try {
      currentImage = await readLinkedImage(retained.filePath)
    } catch {
      throwIfCanceled(signal)
      rejectLinkedImageExport()
    }
    throwIfCanceled(signal)
    const current = {
      bytes: currentImage.bytes,
      filePath: retained.filePath,
      mime: currentImage.format === 'png' ? 'image/png' : 'image/jpeg',
    }
    const stillRetained = mediaCapabilities.backgroundExportSnapshot(
      ownerId,
      expectedBackground.revision,
      expectedBackground.activeToken,
      linkedPath,
    )
    if (!sameMedia(retained, stillRetained) || !sameMedia(retained, current)) {
      rejectLinkedImageExport()
    }

    return Object.freeze({
      backgroundImage: Object.freeze({
        bytes: Buffer.from(retained.bytes),
        mime: retained.mime,
      }),
    })
  }
}

module.exports = {
  LINKED_IMAGE_EXPORT_ERROR_CODE,
  LINKED_IMAGE_EXPORT_WARNING,
  createVideoExportAuthorizer,
  linkedImageExportFailure,
}
