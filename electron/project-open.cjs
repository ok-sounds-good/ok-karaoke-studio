'use strict'

const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { parseCurrentProject } = require('./project-schema.cjs')

function createProjectOpenCoordinator({
  linkedAssets,
  mediaRequests,
  decodeProjectJson = parseCurrentProject,
  createRequestId = randomUUID,
}) {
  if (!linkedAssets || !mediaRequests) {
    throw new TypeError('Project-open media dependencies are required')
  }
  const latestRequestByOwner = new Map()
  const pendingByOwner = new Map()
  const writablePathsByOwner = new Map()
  const activeProjectSourceByOwner = new Map()
  const writeGenerationByOwner = new Map()
  const writeGrantByToken = new WeakMap()

  const currentWriteGeneration = (ownerId) => writeGenerationByOwner.get(ownerId) ?? 0
  const invalidateWriteGrants = (ownerId) => {
    writeGenerationByOwner.set(ownerId, currentWriteGeneration(ownerId) + 1)
  }

  const beginOpen = (ownerId) => {
    const requestId = createRequestId()
    latestRequestByOwner.set(ownerId, requestId)
    pendingByOwner.delete(ownerId)
    return requestId
  }

  const stageOpen = (ownerId, requestId, projectPath, contents) => {
    if (latestRequestByOwner.get(ownerId) !== requestId) return null
    decodeProjectJson(contents)
    if (latestRequestByOwner.get(ownerId) !== requestId) return null
    const pending = Object.freeze({
      requestId,
      path: path.resolve(projectPath),
      contents,
    })
    pendingByOwner.set(ownerId, pending)
    return pending
  }

  const settleOpen = (ownerId, requestId, accepted) => {
    const pending = pendingByOwner.get(ownerId)
    if (!pending || pending.requestId !== requestId) return false
    pendingByOwner.delete(ownerId)
    if (!accepted) return true

    mediaRequests.invalidateOwner(ownerId)
    linkedAssets.revokeOwner(ownerId)
    if (linkedAssets.authorizeProject(ownerId, pending.path, pending.contents) !== true) {
      throw new Error('The accepted project could not be authorized')
    }
    invalidateWriteGrants(ownerId)
    // Opening B revokes every save-back capability from A. Save As can grant
    // additional paths again, but an accepted project starts with only its own
    // exact source path writable by this renderer owner.
    writablePathsByOwner.set(ownerId, new Set([pending.path]))
    activeProjectSourceByOwner.set(ownerId, pending.path)
    return true
  }

  const resetProjectScope = (ownerId) => {
    invalidateWriteGrants(ownerId)
    latestRequestByOwner.delete(ownerId)
    pendingByOwner.delete(ownerId)
    writablePathsByOwner.delete(ownerId)
    activeProjectSourceByOwner.delete(ownerId)
  }

  return {
    beginOpen,
    stageOpen,
    settleOpen,
    captureWriteGrant(ownerId) {
      const token = Object.freeze({})
      writeGrantByToken.set(token, {
        ownerId,
        generation: currentWriteGeneration(ownerId),
      })
      return token
    },
    canWrite(ownerId, projectPath) {
      return writablePathsByOwner.get(ownerId)?.has(path.resolve(projectPath)) === true
    },
    projectSourcePath(ownerId) {
      return activeProjectSourceByOwner.get(ownerId) ?? null
    },
    grantWrite(ownerId, projectPath, token) {
      const grant = token && typeof token === 'object' ? writeGrantByToken.get(token) : null
      if (token && typeof token === 'object') writeGrantByToken.delete(token)
      if (
        !grant ||
        grant.ownerId !== ownerId ||
        grant.generation !== currentWriteGeneration(ownerId)
      ) return false
      const writablePaths = writablePathsByOwner.get(ownerId) ?? new Set()
      writablePaths.add(path.resolve(projectPath))
      writablePathsByOwner.set(ownerId, writablePaths)
      return true
    },
    hasPending(ownerId) {
      return pendingByOwner.has(ownerId)
    },
    resetProjectScope,
    releaseOwner(ownerId) {
      resetProjectScope(ownerId)
    },
  }
}

module.exports = { createProjectOpenCoordinator }
