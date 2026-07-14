'use strict'

function createProjectBackgroundResolver({
  linkedAssets,
  makeMediaResult,
  requestSequencer,
  validateLinkedImage,
}) {
  return async function resolveProjectBackground({ ownerContents, projectPath }) {
    const ownerId = ownerContents.id
    const requestSequence = requestSequencer.begin(ownerId, 'background')
    const backgroundPath = linkedAssets.consumeAuthorization(
      ownerId,
      projectPath,
      'background',
    )

    // A project restore supersedes every background capability from the prior
    // project. Consume the new grant first because revokeOwner also clears
    // unconsumed grants of the same kind.
    if (!requestSequencer.isCurrent(ownerId, 'background', requestSequence)) {
      return { status: 'stale' }
    }
    linkedAssets.revokeOwner(ownerId, 'background')
    if (!backgroundPath) return { status: 'missing' }

    try {
      const filePath = await validateLinkedImage(backgroundPath)
      if (!requestSequencer.isCurrent(ownerId, 'background', requestSequence)) {
        return { status: 'stale' }
      }
      return {
        status: 'success',
        media: makeMediaResult(filePath, ownerContents, 'background'),
      }
    } catch {
      return requestSequencer.isCurrent(ownerId, 'background', requestSequence)
        ? { status: 'missing' }
        : { status: 'stale' }
    }
  }
}

module.exports = { createProjectBackgroundResolver }
