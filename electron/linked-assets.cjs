'use strict'

const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { parseCurrentProject } = require('./project-schema.cjs')

const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp'])
const IMAGE_MIME_TYPES = new Map([
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])
const IMAGE_FILTERS = [{
  name: 'Static Image',
  extensions: ['png', 'jpg', 'jpeg', 'webp'],
}]
const MAX_IMAGE_BYTES = 64 * 1024 * 1024

function imageMatchesType(bytes, extension) {
  if (extension === '.png') {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      !bytes.includes(Buffer.from('acTL', 'ascii'))
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP' &&
    !bytes.includes(Buffer.from('ANIM', 'ascii')) &&
    !bytes.includes(Buffer.from('ANMF', 'ascii'))
}

function linkedImageDecodeError(filePath) {
  return new TypeError(`Linked image is invalid or unreadable: ${filePath}`)
}

async function readStaticImage(filePath, decodeImage) {
  const resolved = path.resolve(filePath)
  const stats = await fs.stat(resolved).catch(() => null)
  const extension = path.extname(resolved).toLowerCase()
  if (!stats?.isFile() || !IMAGE_EXTENSIONS.has(extension)) {
    throw new TypeError('The selected file is not a supported static PNG, JPEG, or WebP image')
  }
  if (stats.size <= 0 || stats.size > MAX_IMAGE_BYTES) {
    throw new RangeError('The linked background image must be between 1 byte and 64 MB')
  }
  const bytes = await fs.readFile(resolved)
  if (!imageMatchesType(bytes, extension)) {
    throw new TypeError(
      'The linked background is invalid or animated; choose a static PNG, JPEG, or WebP image',
    )
  }
  if (typeof decodeImage !== 'function') {
    throw new TypeError('A linked-image decoder is required')
  }
  try {
    const decoded = await decodeImage({ bytes, mime: IMAGE_MIME_TYPES.get(extension), path: resolved })
    if (decoded === false) throw linkedImageDecodeError(resolved)
  } catch {
    throw linkedImageDecodeError(resolved)
  }
  return { bytes, mime: IMAGE_MIME_TYPES.get(extension), path: resolved }
}

function createLinkedImageValidator(decodeImage) {
  if (typeof decodeImage !== 'function') throw new TypeError('decodeImage must be a function')
  const read = (filePath) => readStaticImage(filePath, decodeImage)
  return {
    readStaticImage: read,
    validateLinkedImage: async (filePath) => (await read(filePath)).path,
  }
}

function projectAssetPaths(projectPath, contents, audioExtensions) {
  try {
    const project = parseCurrentProject(contents)
    let audioPath = null
    let backgroundPath = null
    if (typeof project.audioPath === 'string') {
      const candidate = path.isAbsolute(project.audioPath)
        ? path.resolve(project.audioPath)
        : path.resolve(path.dirname(projectPath), project.audioPath)
      if (audioExtensions.has(path.extname(candidate).toLowerCase())) audioPath = candidate
    }
    const background = project.stageStyle.background
    if (
      background &&
      background.mode === 'image' &&
      typeof background.imagePath === 'string' &&
      path.isAbsolute(background.imagePath)
    ) {
      const candidate = path.resolve(background.imagePath)
      if (IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) backgroundPath = candidate
    }
    return { audioPath, backgroundPath }
  } catch {
    return null
  }
}

function createLinkedAssetRegistry(audioExtensions) {
  const assets = new Map()
  const tokensByOwner = new Map()
  const activeTokensByOwner = new Map()
  const restorableByOwner = new Map()

  const activeTokens = (ownerId) => activeTokensByOwner.get(ownerId) ?? null
  const activeToken = (ownerId, kind) => activeTokens(ownerId)?.get(kind) ?? null
  const setActiveToken = (ownerId, kind, token) => {
    const byKind = activeTokens(ownerId) ?? new Map()
    if (token) byKind.set(kind, token)
    else byKind.delete(kind)
    if (byKind.size > 0) activeTokensByOwner.set(ownerId, byKind)
    else activeTokensByOwner.delete(ownerId)
  }

  const revokeToken = (token) => {
    const asset = assets.get(token)
    if (!asset) return
    assets.delete(token)
    const ownerTokens = tokensByOwner.get(asset.ownerId)
    ownerTokens?.delete(token)
    if (ownerTokens?.size === 0) tokensByOwner.delete(asset.ownerId)
    if (activeToken(asset.ownerId, asset.kind) === token) {
      setActiveToken(asset.ownerId, asset.kind, null)
    }
  }

  const clearRestorable = (ownerId, kind) => {
    const authorization = restorableByOwner.get(ownerId)
    if (!authorization) return
    if (!kind) {
      restorableByOwner.delete(ownerId)
      return
    }
    if (kind === 'audio') authorization.audioPath = null
    if (kind === 'background') authorization.backgroundPath = null
    if (!authorization.audioPath && !authorization.backgroundPath) {
      restorableByOwner.delete(ownerId)
    }
  }

  const revokeOwner = (ownerId, kind) => {
    const tokens = tokensByOwner.get(ownerId)
    if (tokens) {
      for (const token of [...tokens]) {
        const asset = assets.get(token)
        if (!kind || asset?.kind === kind) revokeToken(token)
      }
    }
    if (kind) setActiveToken(ownerId, kind, null)
    else activeTokensByOwner.delete(ownerId)
    clearRestorable(ownerId, kind)
  }

  return {
    get: (token) => assets.get(token) ?? null,
    activeOwnerPath(ownerId, kind) {
      const asset = assets.get(activeToken(ownerId, kind))
      return asset?.kind === kind ? asset.filePath : null
    },
    hasOwnerPath(ownerId, kind, filePath) {
      const requestedPath = path.resolve(filePath)
      const tokens = tokensByOwner.get(ownerId)
      if (!tokens) return false
      for (const token of tokens) {
        const asset = assets.get(token)
        if (asset?.kind === kind && asset.filePath === requestedPath) return true
      }
      return false
    },
    revokeToken,
    revokeOwner,
    deactivateOwner(ownerId, kind) {
      setActiveToken(ownerId, kind, null)
      clearRestorable(ownerId, kind)
    },
    retainOwnerToken(ownerId, kind, retainedToken) {
      const retained = assets.get(retainedToken)
      if (!retained || retained.ownerId !== ownerId || retained.kind !== kind) return false
      setActiveToken(ownerId, kind, retainedToken)
      clearRestorable(ownerId, kind)
      return true
    },
    register(filePath, ownerId, kind) {
      if (kind === 'audio') revokeOwner(ownerId, kind)
      else clearRestorable(ownerId, kind)
      const token = randomUUID()
      assets.set(token, { filePath: path.resolve(filePath), ownerId, kind })
      const ownerTokens = tokensByOwner.get(ownerId) ?? new Set()
      ownerTokens.add(token)
      tokensByOwner.set(ownerId, ownerTokens)
      setActiveToken(ownerId, kind, token)
      return token
    },
    authorizeProject(ownerId, projectPath, contents) {
      const authorization = projectAssetPaths(projectPath, contents, audioExtensions)
      if (!authorization) {
        restorableByOwner.delete(ownerId)
        return false
      }
      restorableByOwner.set(ownerId, { projectPath, ...authorization })
      return true
    },
    consumeAuthorization(ownerId, projectPath, kind) {
      const authorization = restorableByOwner.get(ownerId)
      if (authorization?.projectPath !== projectPath) return null
      const filePath = kind === 'audio'
        ? authorization.audioPath
        : kind === 'background' ? authorization.backgroundPath : null
      clearRestorable(ownerId, kind)
      return filePath
    },
    releaseOwner(ownerId) {
      revokeOwner(ownerId)
      restorableByOwner.delete(ownerId)
    },
  }
}

module.exports = {
  IMAGE_EXTENSIONS,
  IMAGE_FILTERS,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  createLinkedImageValidator,
  createLinkedAssetRegistry,
  imageMatchesType,
  readStaticImage,
}
