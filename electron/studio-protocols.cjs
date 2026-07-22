'use strict'

const { createReadStream: defaultCreateReadStream } = require('node:fs')
const defaultFs = require('node:fs/promises')
const defaultPath = require('node:path')
const { Readable: DefaultReadable } = require('node:stream')

function registerStudioSchemes({ protocol, appScheme, mediaScheme }) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
    {
      scheme: mediaScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

function parseByteRange(value, size) {
  if (!value) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size === 0 || (!match[1] && !match[2])) return false

  let start
  let end

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false
    if (start >= size || end < start) return false
    end = Math.min(end, size - 1)
  }

  return { start, end }
}

function pathIsWithin(root, candidate, path) {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function createStudioProtocolHandlers({
  appHost,
  appMimeTypes,
  appScheme,
  audioMimeTypes,
  createReadStream = defaultCreateReadStream,
  distRoot,
  fs = defaultFs,
  getMainWindow,
  getRendererOrigin,
  mediaCapabilities,
  mediaScheme,
  mediaTokenFromUrl,
  path = defaultPath,
  Readable = DefaultReadable,
  Response: ResponseConstructor = Response,
}) {
  function textResponse(message, status, extraHeaders = {}) {
    return new ResponseConstructor(message, {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
      },
    })
  }

  function mediaResponseHeaders() {
    return {
      'Access-Control-Allow-Origin': getRendererOrigin(),
      'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
  }

  function appFilePathFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl)
      if (
        url.protocol !== `${appScheme}:` ||
        url.hostname !== appHost ||
        url.port ||
        url.username ||
        url.password
      ) {
        return null
      }

      const decodedPath = decodeURIComponent(url.pathname)
      if (decodedPath.includes('\0')) return null
      const relativePath =
        decodedPath === '/' || decodedPath === '' ? 'index.html' : decodedPath.replace(/^\/+/, '')
      const filePath = path.resolve(distRoot, relativePath)
      return pathIsWithin(distRoot, filePath, path) ? filePath : null
    } catch {
      return null
    }
  }

  let canonicalDistRoot
  async function handleApplicationRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, { Allow: 'GET, HEAD' })
    }

    const requestedFilePath = appFilePathFromUrl(request.url)
    if (!requestedFilePath) return textResponse('Not found', 404)

    let filePath
    let fileStats
    try {
      canonicalDistRoot ||= fs.realpath(distRoot)
      const [canonicalRoot, canonicalFilePath] = await Promise.all([
        canonicalDistRoot,
        fs.realpath(requestedFilePath),
      ])
      if (!pathIsWithin(canonicalRoot, canonicalFilePath, path))
        return textResponse('Not found', 404)
      filePath = canonicalFilePath
      fileStats = await fs.stat(filePath)
    } catch {
      return textResponse('Not found', 404)
    }
    if (!fileStats.isFile()) return textResponse('Not found', 404)

    const relativePath = path.relative(distRoot, filePath)
    const headers = {
      'Cache-Control': relativePath.startsWith(`assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'Content-Length': String(fileStats.size),
      'Content-Type':
        appMimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    }

    if (request.method === 'HEAD' || fileStats.size === 0) {
      return new ResponseConstructor(null, { status: 200, headers })
    }
    return new ResponseConstructor(Readable.toWeb(createReadStream(filePath)), {
      status: 200,
      headers,
    })
  }

  async function handleMediaRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, {
        ...mediaResponseHeaders(),
        Allow: 'GET, HEAD',
      })
    }

    const token = mediaTokenFromUrl(request.url, mediaScheme)
    const mediaFile = token ? mediaCapabilities.get(token) : null
    const owner = getMainWindow()
    const hasActiveOwner = Boolean(
      mediaFile &&
      owner &&
      !owner.isDestroyed() &&
      !owner.webContents.isDestroyed() &&
      owner.webContents.id === mediaFile.ownerId,
    )
    const knownKind = mediaFile?.kind === 'audio' || mediaFile?.kind === 'background'
    if (token && mediaFile && (!hasActiveOwner || !knownKind)) mediaCapabilities.revokeToken(token)
    if (!hasActiveOwner || !knownKind)
      return textResponse('Media not found', 404, mediaResponseHeaders())

    if (mediaFile.kind === 'background') {
      const size = mediaFile.bytes.length
      const range = parseByteRange(request.headers.get('range'), size)
      if (range === false) {
        return textResponse('Requested range not satisfiable', 416, {
          ...mediaResponseHeaders(),
          'Content-Range': `bytes */${size}`,
        })
      }
      const start = range ? range.start : 0
      const end = range ? range.end : size - 1
      const headers = {
        ...mediaResponseHeaders(),
        'Accept-Ranges': 'bytes',
        'Content-Length': String(range ? end - start + 1 : size),
        'Content-Type': mediaFile.mime,
      }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      const body =
        request.method === 'HEAD' ? null : Buffer.from(mediaFile.bytes.subarray(start, end + 1))
      return new ResponseConstructor(body, { status: range ? 206 : 200, headers })
    }

    let fileStats
    try {
      fileStats = await fs.stat(mediaFile.filePath)
    } catch {
      if (token) mediaCapabilities.revokeToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }
    if (!fileStats.isFile()) {
      if (token) mediaCapabilities.revokeToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }

    const range = parseByteRange(request.headers.get('range'), fileStats.size)
    if (range === false) {
      return textResponse('Requested range not satisfiable', 416, {
        ...mediaResponseHeaders(),
        'Content-Range': `bytes */${fileStats.size}`,
      })
    }

    const start = range ? range.start : 0
    const end = range ? range.end : Math.max(0, fileStats.size - 1)
    const headers = {
      ...mediaResponseHeaders(),
      'Accept-Ranges': 'bytes',
      'Content-Length': String(range ? end - start + 1 : fileStats.size),
      'Content-Type':
        audioMimeTypes.get(path.extname(mediaFile.filePath).toLowerCase()) ||
        'application/octet-stream',
    }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`
    if (request.method === 'HEAD' || fileStats.size === 0) {
      return new ResponseConstructor(null, { status: range ? 206 : 200, headers })
    }
    return new ResponseConstructor(
      Readable.toWeb(createReadStream(mediaFile.filePath, { start, end })),
      {
        status: range ? 206 : 200,
        headers,
      },
    )
  }

  return Object.freeze({
    appFilePathFromUrl,
    handleApplicationRequest,
    handleMediaRequest,
  })
}

function installStudioProtocolHandlers({
  protocol,
  handlers,
  appScheme,
  mediaScheme,
  installApplication = true,
}) {
  if (installApplication) protocol.handle(appScheme, handlers.handleApplicationRequest)
  protocol.handle(mediaScheme, handlers.handleMediaRequest)
}

module.exports = {
  createStudioProtocolHandlers,
  installStudioProtocolHandlers,
  parseByteRange,
  registerStudioSchemes,
}
