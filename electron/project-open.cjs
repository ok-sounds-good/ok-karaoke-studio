'use strict'

const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { parseProjectJson } = require('./project-schema.cjs')

function prepareIdentity(_ownerId, scope) {
  return scope
}

function commitSuccessfully() {
  return true
}

function createProjectOpenCoordinator({
  decodeProjectJson = parseProjectJson,
  createRequestId = randomUUID,
  prepareScope = prepareIdentity,
  validateScope = commitSuccessfully,
  commitScope = commitSuccessfully,
  resetScope = commitSuccessfully,
} = {}) {
  if (typeof decodeProjectJson !== 'function') {
    throw new TypeError('decodeProjectJson must be a function')
  }
  if (typeof createRequestId !== 'function') {
    throw new TypeError('createRequestId must be a function')
  }
  if (
    typeof prepareScope !== 'function' ||
    typeof validateScope !== 'function' ||
    typeof commitScope !== 'function' ||
    typeof resetScope !== 'function'
  ) {
    throw new TypeError('Project scope hooks must be functions')
  }

  const latestRequestByOwner = new Map()
  const pendingByOwner = new Map()
  const writablePathsByOwner = new Map()
  const writeGenerationByOwner = new Map()
  const writeGrantByToken = new WeakMap()
  const ownerOperationTail = new Map()

  const currentWriteGeneration = (ownerId) => writeGenerationByOwner.get(ownerId) ?? 0
  const invalidateWriteGrants = (ownerId) => {
    writeGenerationByOwner.set(ownerId, currentWriteGeneration(ownerId) + 1)
  }

  const acquireOwnerOperation = async (ownerId) => {
    const previous = ownerOperationTail.get(ownerId) ?? Promise.resolve()
    let releaseGate
    const gate = new Promise((resolve) => {
      releaseGate = resolve
    })
    const tail = previous.catch(() => {}).then(() => gate)
    ownerOperationTail.set(ownerId, tail)
    await previous.catch(() => {})

    let released = false
    return () => {
      if (released) return
      released = true
      releaseGate()
      if (ownerOperationTail.get(ownerId) === tail) ownerOperationTail.delete(ownerId)
    }
  }

  const beginOpen = (ownerId) => {
    const requestId = createRequestId()
    if (typeof requestId !== 'string' || !requestId) {
      throw new TypeError('createRequestId must return a non-empty string')
    }
    latestRequestByOwner.set(ownerId, requestId)
    pendingByOwner.delete(ownerId)
    return requestId
  }

  const stageOpen = (ownerId, requestId, projectPath, contents) => {
    if (latestRequestByOwner.get(ownerId) !== requestId) return null

    const project = decodeProjectJson(contents)
    if (latestRequestByOwner.get(ownerId) !== requestId) return null
    const resolvedPath = path.resolve(projectPath)
    const preparedScope = prepareScope(
      ownerId,
      Object.freeze({
        path: resolvedPath,
        contents,
        project,
      }),
    )
    if (latestRequestByOwner.get(ownerId) !== requestId) return null

    const pending = Object.freeze({
      requestId,
      path: resolvedPath,
      contents,
      project,
      preparedScope,
    })
    pendingByOwner.set(ownerId, pending)
    return Object.freeze({ requestId, path: pending.path, contents })
  }

  const settleOpen = async (ownerId, requestId, accepted) => {
    if (typeof requestId !== 'string' || !requestId) {
      throw new TypeError('requestId must be a non-empty string')
    }
    if (typeof accepted !== 'boolean') {
      throw new TypeError('accepted must be a boolean')
    }

    let pending = pendingByOwner.get(ownerId)
    if (
      latestRequestByOwner.get(ownerId) !== requestId ||
      !pending ||
      pending.requestId !== requestId
    )
      return false

    if (!accepted) {
      pendingByOwner.delete(ownerId)
      latestRequestByOwner.delete(ownerId)
      return true
    }

    const releaseOperation = await acquireOwnerOperation(ownerId)
    try {
      pending = pendingByOwner.get(ownerId)
      if (
        latestRequestByOwner.get(ownerId) !== requestId ||
        !pending ||
        pending.requestId !== requestId
      )
        return false

      let scopeIsCurrent = false
      try {
        scopeIsCurrent =
          (await validateScope(
            ownerId,
            Object.freeze({
              path: pending.path,
              contents: pending.contents,
              project: pending.project,
            }),
            pending.preparedScope,
          )) === true
      } catch {
        scopeIsCurrent = false
      }

      const currentPending = pendingByOwner.get(ownerId)
      if (
        latestRequestByOwner.get(ownerId) !== requestId ||
        !currentPending ||
        currentPending.requestId !== requestId ||
        currentPending !== pending
      )
        return false

      pendingByOwner.delete(ownerId)
      latestRequestByOwner.delete(ownerId)
      if (!scopeIsCurrent) return false
      if (commitScope(ownerId, pending.preparedScope) !== true) return false
      invalidateWriteGrants(ownerId)
      writablePathsByOwner.set(ownerId, new Set([pending.path]))
      return true
    } finally {
      releaseOperation()
    }
  }

  const resetProjectScope = async (ownerId) => {
    const releaseOperation = await acquireOwnerOperation(ownerId)
    try {
      if (resetScope(ownerId) !== true) return false
      invalidateWriteGrants(ownerId)
      latestRequestByOwner.delete(ownerId)
      pendingByOwner.delete(ownerId)
      writablePathsByOwner.delete(ownerId)
      return true
    } finally {
      releaseOperation()
    }
  }

  return Object.freeze({
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
    writeGrantIsCurrent(ownerId, token) {
      const grant = token && typeof token === 'object' ? writeGrantByToken.get(token) : null
      return Boolean(
        grant && grant.ownerId === ownerId && grant.generation === currentWriteGeneration(ownerId),
      )
    },
    async acquireWritePromotion(ownerId, token) {
      const releaseOperation = await acquireOwnerOperation(ownerId)
      const grant = token && typeof token === 'object' ? writeGrantByToken.get(token) : null
      if (
        !grant ||
        grant.ownerId !== ownerId ||
        grant.generation !== currentWriteGeneration(ownerId)
      ) {
        releaseOperation()
        return null
      }
      return releaseOperation
    },
    grantWrite(ownerId, projectPath, token) {
      const grant = token && typeof token === 'object' ? writeGrantByToken.get(token) : null
      if (token && typeof token === 'object') writeGrantByToken.delete(token)
      if (
        !grant ||
        grant.ownerId !== ownerId ||
        grant.generation !== currentWriteGeneration(ownerId)
      )
        return false

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
      return resetProjectScope(ownerId)
    },
  })
}

module.exports = { createProjectOpenCoordinator }
