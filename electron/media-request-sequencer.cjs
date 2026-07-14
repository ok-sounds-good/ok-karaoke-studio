'use strict'

function createMediaRequestSequencer() {
  const sequences = new Map()
  const keyFor = (ownerId, kind) => `${ownerId}:${kind}`
  const begin = (ownerId, kind) => {
    const key = keyFor(ownerId, kind)
    const sequence = (sequences.get(key) || 0) + 1
    sequences.set(key, sequence)
    return sequence
  }

  return {
    begin,
    invalidateOwner(ownerId) {
      for (const kind of ['audio', 'background']) begin(ownerId, kind)
    },
    isCurrent(ownerId, kind, sequence) {
      return sequences.get(keyFor(ownerId, kind)) === sequence
    },
    releaseOwner(ownerId) {
      for (const key of [...sequences.keys()]) {
        if (key.startsWith(`${ownerId}:`)) sequences.delete(key)
      }
    },
  }
}

module.exports = { createMediaRequestSequencer }
