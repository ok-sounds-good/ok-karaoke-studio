'use strict'

function createProjectAudioResolver({
  linkedAssets,
  makeMediaResult,
  requestSequencer,
  statFile,
}) {
  return async function resolveProjectAudio({ ownerContents, projectPath }) {
    const ownerId = ownerContents.id
    const requestSequence = requestSequencer.begin(ownerId, 'audio')
    const audioPath = linkedAssets.consumeAuthorization(ownerId, projectPath, 'audio')
    if (!requestSequencer.isCurrent(ownerId, 'audio', requestSequence)) {
      return { status: 'stale' }
    }
    if (!audioPath) return { status: 'missing' }
    try {
      const stats = await statFile(audioPath)
      if (!requestSequencer.isCurrent(ownerId, 'audio', requestSequence)) {
        return { status: 'stale' }
      }
      if (!stats.isFile()) return { status: 'missing' }
      return {
        status: 'success',
        media: makeMediaResult(audioPath, ownerContents, 'audio'),
      }
    } catch {
      return requestSequencer.isCurrent(ownerId, 'audio', requestSequence)
        ? { status: 'missing' }
        : { status: 'stale' }
    }
  }
}

module.exports = { createProjectAudioResolver }
