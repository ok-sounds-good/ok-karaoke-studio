'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, session, shell } = require('electron')
const { createReadStream } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const {
  queueProjectWrite,
  readUtf8FileWithinLimit,
  writeUtf8FileAtomically,
} = require('./project-files.cjs')
const {
  createVideoExportCommitState,
  exportKaraokeVideo,
  MAX_VIDEO_DURATION_MS,
  normalizeVideoSettings,
} = require('./video-export.cjs')
const { ensureFfmpegForExport } = require('./ffmpeg-setup.cjs')
const {
  VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS,
  createVideoExportLifecycleGuard,
} = require('./video-export-lifecycle.cjs')
const {
  EXPORT_FILTERS,
  ensureExportExtension,
  normalizeExportFormat,
} = require('./text-export.cjs')
const {
  PROJECT_OPEN_FILTERS,
  PROJECT_SAVE_FILTERS,
  canonicalSavePath,
  isCanonicalSavePath,
  showCanonicalSaveDialog,
} = require('./save-paths.cjs')
const {
  IMAGE_FILTERS,
  IMAGE_MIME_TYPES,
  createLinkedImageValidator,
  createLinkedAssetRegistry,
} = require('./linked-assets.cjs')
const { createNativeImageDecoder } = require('./native-image-decoder.cjs')
const { createMediaRequestSequencer } = require('./media-request-sequencer.cjs')
const { createProjectBackgroundResolver } = require('./background-restore.cjs')
const { createProjectAudioResolver } = require('./audio-restore.cjs')
const { createProjectOpenCoordinator } = require('./project-open.cjs')
const { parseCurrentProject } = require('./project-schema.cjs')
const { createVideoExportRequestAuthorizer } = require('./video-export-request.cjs')
const {
  createVideoExportBackgroundPreflight,
} = require('./video-export-background-preflight.cjs')
const {
  createLocalFontPermissionPolicy,
  fontAccessProbeScript,
  fontAccessSmokeFailures,
  isolatedFontSmokeProfile,
  publicFontPermissionAudit,
  publicFontSmokeEvidence,
  publicFontSmokeFailure,
} = require('./font-access.cjs')
const { runFontRenderSmoke } = require('./font-render-smoke.cjs')
const { focusSmokeWindow } = require('./smoke-window-focus.cjs')
const {
  CONTENT_SIZE: VISUAL_SMOKE_CONTENT_SIZE,
  isolatedVisualSmokeProfile,
  runVideoStyleVisualSmoke,
} = require('./video-style-visual-smoke.cjs')

const APP_NAME = 'Okay Karaoke Studio'
const APP_SCHEME = 'studio-app'
const APP_HOST = 'app'
const MEDIA_SCHEME = 'studio-media'
const DEVELOPMENT_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const DIST_INDEX = path.resolve(__dirname, '..', 'dist', 'index.html')
const DIST_ROOT = path.dirname(DIST_INDEX)
const PACKAGED_APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`
const FONT_ACCESS_SMOKE = !app.isPackaged && process.argv.includes('--font-access-smoke')
const VIDEO_STYLE_VISUAL_SMOKE = !app.isPackaged &&
  process.argv.includes('--video-style-visual-smoke')
const USES_BUILT_RENDERER = app.isPackaged || FONT_ACCESS_SMOKE || VIDEO_STYLE_VISUAL_SMOKE
const MAX_PROJECT_FILE_BYTES = 32 * 1024 * 1024
const MAX_LRC_FILE_BYTES = 8 * 1024 * 1024

const CHANNELS = Object.freeze({
  openProject: 'studio:open-project',
  settleProjectOpen: 'studio:settle-project-open',
  resetProjectScope: 'studio:reset-project-scope',
  saveProject: 'studio:save-project',
  importAudio: 'studio:import-audio',
  resolveProjectAudio: 'studio:resolve-project-audio',
  releaseAudio: 'studio:release-audio',
  chooseBackgroundImage: 'studio:choose-background-image',
  resolveProjectBackground: 'studio:resolve-project-background',
  releaseBackground: 'studio:release-background',
  retainBackground: 'studio:retain-background',
  importLrc: 'studio:import-lrc',
  exportText: 'studio:export-text',
  exportVideo: 'studio:export-video',
  cancelVideoExport: 'studio:cancel-video-export',
  videoExportProgress: 'studio:video-export-progress',
  linkedAssetInvalidated: 'studio:linked-asset-invalidated',
  menuAction: 'studio:menu-action',
  windowCloseRequest: 'studio:window-close-request',
  resolveWindowClose: 'studio:resolve-window-close',
})

const MENU_ACTIONS = new Set([
  'new',
  'open',
  'save',
  'save-as',
  'import-audio',
  'import-lrc',
  'export',
  'play-toggle',
  'select-all',
  'undo',
  'redo',
])

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
])

const AUDIO_MIME_TYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.aif', 'audio/aiff'],
  ['.aiff', 'audio/aiff'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
])

const APP_MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const AUDIO_FILTERS = [
  {
    name: 'Audio',
    extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)),
  },
  { name: 'All Files', extensions: ['*'] },
]

const LRC_FILTERS = [
  { name: 'LRC Lyrics', extensions: ['lrc'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
]

const VIDEO_FILTERS = [{ name: 'MPEG-4 Karaoke Video', extensions: ['mp4'] }]

const linkedAssets = createLinkedAssetRegistry(AUDIO_EXTENSIONS)
const linkedImages = createLinkedImageValidator(createNativeImageDecoder(nativeImage))
const { readStaticImage, validateLinkedImage } = linkedImages
const mediaRequests = createMediaRequestSequencer()
const projectOpens = createProjectOpenCoordinator({ linkedAssets, mediaRequests })
const authorizeVideoExportRequest = createVideoExportRequestAuthorizer({
  linkedAssets,
  audioExtensions: AUDIO_EXTENSIONS,
  maxDurationMs: MAX_VIDEO_DURATION_MS,
  maxProjectBytes: MAX_PROJECT_FILE_BYTES,
  normalizeVideoSettings,
  projectSourcePath: (ownerId) => projectOpens.projectSourcePath(ownerId),
})

let mainWindow = null
let activeVideoExport = null
let rendererLifecycleRequest = null
let rendererLifecycleApproval = null
const preflightVideoExportBackground = createVideoExportBackgroundPreflight({
  linkedAssets,
  validateLinkedImage,
  notifyInvalidation: (ownerId, invalidation) => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed() &&
      mainWindow.webContents.id === ownerId
    ) mainWindow.webContents.send(CHANNELS.linkedAssetInvalidated, invalidation)
  },
})
const fontPermissions = createLocalFontPermissionPolicy({
  getMainWindow: () => mainWindow,
  recordDecisions: FONT_ACCESS_SMOKE || VIDEO_STYLE_VISUAL_SMOKE,
  trustedOrigin: rendererOrigin(),
})

if (VIDEO_STYLE_VISUAL_SMOKE) {
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
}

if (FONT_ACCESS_SMOKE) {
  try {
    const profilePath = isolatedFontSmokeProfile(
      process.env.OKS_FONT_SMOKE_USER_DATA,
      app.getPath('userData'),
      process.env.OKS_FONT_SMOKE_PROFILE_IDENTITY,
    )
    app.setPath('userData', profilePath)
    app.setPath('sessionData', path.join(profilePath, 'session'))
  } catch {
    process.stderr.write('{"ok":false,"profileValid":false}\n')
    process.exit(1)
  }
}

if (VIDEO_STYLE_VISUAL_SMOKE) {
  try {
    const profilePath = isolatedVisualSmokeProfile(
      process.env.OKS_VISUAL_SMOKE_USER_DATA,
      app.getPath('userData'),
      process.env.OKS_VISUAL_SMOKE_PROFILE_IDENTITY,
    )
    app.setPath('userData', profilePath)
    app.setPath('sessionData', path.join(profilePath, 'session'))
  } catch {
    process.stderr.write('{"code":"VISUAL_PROFILE_INVALID","ok":false}\n')
    process.exit(1)
  }
}

app.setName(APP_NAME)

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
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
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

function textResponse(message, status, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function rendererOrigin() {
  return USES_BUILT_RENDERER
    ? `${APP_SCHEME}://${APP_HOST}`
    : new URL(DEVELOPMENT_URL).origin
}

function appFilePathFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (
      url.protocol !== `${APP_SCHEME}:` ||
      url.hostname !== APP_HOST ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null
    }

    const decodedPath = decodeURIComponent(url.pathname)
    if (decodedPath.includes('\0')) return null
    const relativePath = decodedPath === '/' || decodedPath === ''
      ? 'index.html'
      : decodedPath.replace(/^\/+/, '')
    const filePath = path.resolve(DIST_ROOT, relativePath)
    const pathWithinDist = path.relative(DIST_ROOT, filePath)
    if (
      pathWithinDist === '..' ||
      pathWithinDist.startsWith(`..${path.sep}`) ||
      path.isAbsolute(pathWithinDist)
    ) {
      return null
    }
    return filePath
  } catch {
    return null
  }
}

function installApplicationProtocol() {
  let canonicalDistRoot
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, { Allow: 'GET, HEAD' })
    }

    const requestedFilePath = appFilePathFromUrl(request.url)
    if (!requestedFilePath) return textResponse('Not found', 404)

    let filePath
    let fileStats
    try {
      canonicalDistRoot ||= fs.realpath(DIST_ROOT)
      const [distRoot, canonicalFilePath] = await Promise.all([
        canonicalDistRoot,
        fs.realpath(requestedFilePath),
      ])
      const pathWithinDist = path.relative(distRoot, canonicalFilePath)
      if (
        pathWithinDist === '..' ||
        pathWithinDist.startsWith(`..${path.sep}`) ||
        path.isAbsolute(pathWithinDist)
      ) {
        return textResponse('Not found', 404)
      }
      filePath = canonicalFilePath
      fileStats = await fs.stat(filePath)
    } catch {
      return textResponse('Not found', 404)
    }
    if (!fileStats.isFile()) return textResponse('Not found', 404)

    const relativePath = path.relative(DIST_ROOT, filePath)
    const headers = {
      'Cache-Control': relativePath.startsWith(`assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'Content-Length': String(fileStats.size),
      'Content-Type': APP_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    }

    if (request.method === 'HEAD' || fileStats.size === 0) {
      return new Response(null, { status: 200, headers })
    }

    return new Response(Readable.toWeb(createReadStream(filePath)), {
      status: 200,
      headers,
    })
  })
}

function mediaResponseHeaders() {
  return {
    'Access-Control-Allow-Origin': rendererOrigin(),
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Cache-Control': 'no-store',
  }
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

function tokenFromMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'asset') return null

    const token = url.pathname.split('/').filter(Boolean)[0]
    return token && /^[0-9a-f-]{36}$/i.test(token) ? token : null
  } catch {
    return null
  }
}

function installMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, {
        ...mediaResponseHeaders(),
        Allow: 'GET, HEAD',
      })
    }

    const token = tokenFromMediaUrl(request.url)
    const mediaFile = token ? linkedAssets.get(token) : null
    const hasActiveOwner = Boolean(
      mediaFile &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed() &&
      mainWindow.webContents.id === mediaFile.ownerId,
    )
    if (token && mediaFile && !hasActiveOwner) linkedAssets.revokeToken(token)
    const filePath = hasActiveOwner ? mediaFile.filePath : null
    if (!filePath) return textResponse('Media not found', 404, mediaResponseHeaders())

    let fileStats
    try {
      fileStats = await fs.stat(filePath)
    } catch {
      if (token) linkedAssets.revokeToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }

    if (!fileStats.isFile()) {
      if (token) linkedAssets.revokeToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }

    const range = parseByteRange(request.headers.get('range'), fileStats.size)
    if (range === false) {
      return textResponse('Requested range not satisfiable', 416, {
        ...mediaResponseHeaders(),
        'Content-Range': `bytes */${fileStats.size}`,
      })
    }

    const extension = path.extname(filePath).toLowerCase()
    const headers = {
      ...mediaResponseHeaders(),
      'Accept-Ranges': 'bytes',
      'Content-Type': mediaFile.kind === 'background'
        ? IMAGE_MIME_TYPES.get(extension) || 'application/octet-stream'
        : AUDIO_MIME_TYPES.get(extension) || 'application/octet-stream',
    }

    const start = range ? range.start : 0
    const end = range ? range.end : Math.max(0, fileStats.size - 1)
    headers['Content-Length'] = String(range ? end - start + 1 : fileStats.size)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`

    if (request.method === 'HEAD' || fileStats.size === 0) {
      return new Response(null, { status: range ? 206 : 200, headers })
    }

    const stream = createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream), {
      status: range ? 206 : 200,
      headers,
    })
  })
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a string`)
  return value
}

function optionalString(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, fieldName)
}

function safeFileName(value, fallback) {
  const rawName = typeof value === 'string' ? value.replaceAll('\0', '').trim() : ''
  const name = path.basename(rawName)
  return name && name !== '.' && name !== '..' ? name : fallback
}

function documentsPath(fileName) {
  return path.join(app.getPath('documents'), fileName)
}

function requireStringWithinBytes(value, fieldName, maxBytes) {
  const text = requireString(value, fieldName)
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new RangeError(`${fieldName} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`)
  }
  return text
}

function beginMediaRequest(ownerId, kind) {
  return mediaRequests.begin(ownerId, kind)
}

function mediaRequestIsCurrent(ownerId, kind, sequence) {
  return mediaRequests.isCurrent(ownerId, kind, sequence)
}

function assertTrustedSender(event) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const isMainFrame = event.senderFrame && event.senderFrame === event.sender.mainFrame
  if (!mainWindow || owner !== mainWindow || !isMainFrame) {
    throw new Error('Rejected IPC request from an untrusted renderer')
  }
  return owner
}

function normalizeProjectRequest(value) {
  if (!isRecord(value)) throw new TypeError('saveProject requires an options object')

  return {
    path: optionalString(value.path, 'path'),
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
    contents: requireStringWithinBytes(
      value.contents,
      'contents',
      MAX_PROJECT_FILE_BYTES,
    ),
  }
}

function normalizeExportRequest(value) {
  if (!isRecord(value)) throw new TypeError('exportText requires an options object')

  const format = normalizeExportFormat(value.format)

  return {
    format,
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
    contents: requireString(value.contents, 'contents'),
  }
}

function makeMediaResult(filePath, ownerContents, kind) {
  if (!ownerContents || ownerContents.isDestroyed()) {
    throw new Error('Cannot create a media URL for a destroyed renderer')
  }

  const ownerId = ownerContents.id
  const token = linkedAssets.register(filePath, ownerId, kind)

  return {
    path: filePath,
    name: path.basename(filePath),
    url: `${MEDIA_SCHEME}://asset/${token}/${encodeURIComponent(path.basename(filePath))}`,
  }
}

const resolveProjectBackground = createProjectBackgroundResolver({
  linkedAssets,
  makeMediaResult,
  requestSequencer: mediaRequests,
  validateLinkedImage,
})
const resolveProjectAudio = createProjectAudioResolver({
  linkedAssets,
  makeMediaResult,
  requestSequencer: mediaRequests,
  statFile: fs.stat,
})

function beginVideoExport(ownerId) {
  let resolveFinished
  const operation = {
    ownerId,
    controller: new AbortController(),
    commitState: createVideoExportCommitState(),
    finished: new Promise((resolve) => { resolveFinished = resolve }),
    resolveFinished,
  }
  activeVideoExport = operation
  return operation
}

function canceledVideoExportError() {
  const error = new Error('Video export canceled')
  error.name = 'AbortError'
  return error
}

function finishVideoExport(operation) {
  if (activeVideoExport === operation) activeVideoExport = null
  operation.resolveFinished()
}

function requestRendererLifecycle(action) {
  if (action !== 'window' && action !== 'app') return
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  if (rendererLifecycleRequest) {
    if (action === 'app') rendererLifecycleRequest = 'app'
    return
  }
  rendererLifecycleRequest = action
  mainWindow.webContents.send(CHANNELS.windowCloseRequest, action)
}

function abortActiveVideoExport() {
  const operation = activeVideoExport
  if (!operation) return Promise.resolve()
  if (!operation.commitState.tryBeginCancellation()) {
    const error = new Error('Video export promotion has already begun and cannot be canceled')
    error.code = 'VIDEO_EXPORT_NOT_CANCELLABLE'
    return Promise.reject(error)
  }
  operation.controller.abort()
  return operation.finished
}

async function confirmLifecycleVideoExportCancellation() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const options = {
    ...VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS,
    buttons: [...VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.buttons],
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

const videoExportLifecycleGuard = createVideoExportLifecycleGuard({
  confirmCancellation: confirmLifecycleVideoExportCancellation,
  abortActiveExport: abortActiveVideoExport,
  closeWindow: () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  },
  quitApp: () => app.quit(),
  onError: (error) => {
    if (error?.code !== 'VIDEO_EXPORT_NOT_CANCELLABLE') {
      console.error('Unable to confirm video export cancellation:', error)
    }
  },
})

function registerIpcHandlers() {
  ipcMain.handle(CHANNELS.resolveWindowClose, async (event, proceed) => {
    assertTrustedSender(event)
    if (typeof proceed !== 'boolean') throw new TypeError('resolveWindowClose requires a boolean')
    const action = rendererLifecycleRequest
    rendererLifecycleRequest = null
    if (!action) return false
    if (!proceed) return true
    rendererLifecycleApproval = action
    if (action === 'app') app.quit()
    else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
    return true
  })

  ipcMain.handle(CHANNELS.openProject, async (event) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const requestId = projectOpens.beginOpen(ownerId)
    const result = await dialog.showOpenDialog(owner, {
      title: 'Open Karaoke Project',
      buttonLabel: 'Open Project',
      properties: ['openFile'],
      filters: PROJECT_OPEN_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const contents = await readUtf8FileWithinLimit(
      filePath,
      MAX_PROJECT_FILE_BYTES,
      'Project file',
    )
    return projectOpens.stageOpen(ownerId, requestId, filePath, contents)
  })

  ipcMain.handle(CHANNELS.settleProjectOpen, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('settleProjectOpen requires an options object')
    const requestId = requireString(value.requestId, 'requestId')
    if (typeof value.accepted !== 'boolean') {
      throw new TypeError('settleProjectOpen.accepted must be a boolean')
    }
    return projectOpens.settleOpen(event.sender.id, requestId, value.accepted)
  })

  ipcMain.handle(CHANNELS.resetProjectScope, async (event) => {
    assertTrustedSender(event)
    const ownerId = event.sender.id
    projectOpens.resetProjectScope(ownerId)
    mediaRequests.invalidateOwner(ownerId)
    linkedAssets.revokeOwner(ownerId)
    return true
  })

  ipcMain.handle(CHANNELS.saveProject, async (event, value) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const writeGrant = projectOpens.captureWriteGrant(ownerId)
    const request = normalizeProjectRequest(value)
    parseCurrentProject(request.contents)
    const requestedPath = request.path ? path.resolve(request.path) : null
    const requestedPathIsWritable = requestedPath
      ? projectOpens.canWrite(event.sender.id, requestedPath)
      : false

    let filePath = requestedPath &&
      isCanonicalSavePath(requestedPath, 'oks') &&
      requestedPathIsWritable
      ? requestedPath
      : null

    if (!filePath) {
      const defaultName = ensureExportExtension(
        safeFileName(request.suggestedName, 'Untitled Karaoke Project.oks'),
        'oks',
      )
      const defaultPath = requestedPath && requestedPathIsWritable
        ? canonicalSavePath(requestedPath, 'oks')
        : documentsPath(defaultName)
      filePath = await showCanonicalSaveDialog(dialog.showSaveDialog.bind(dialog), owner, {
        title: 'Save Karaoke Project',
        buttonLabel: 'Save Project',
        defaultPath,
        filters: PROJECT_SAVE_FILTERS,
      }, 'oks')
      if (!filePath) return null
    }

    await queueProjectWrite(filePath, request.contents)
    projectOpens.grantWrite(ownerId, filePath, writeGrant)
    return { path: filePath }
  })

  ipcMain.handle(CHANNELS.importAudio, async (event) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const requestSequence = beginMediaRequest(ownerId, 'audio')
    const result = await dialog.showOpenDialog(owner, {
      title: 'Import Audio',
      buttonLabel: 'Import Audio',
      properties: ['openFile'],
      filters: AUDIO_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const extension = path.extname(filePath).toLowerCase()
    const fileStats = await fs.stat(filePath)
    if (!fileStats.isFile() || !AUDIO_EXTENSIONS.has(extension)) {
      throw new TypeError('The selected file is not a supported audio file')
    }
    if (!mediaRequestIsCurrent(ownerId, 'audio', requestSequence)) return null

    return makeMediaResult(filePath, event.sender, 'audio')
  })

  ipcMain.handle(CHANNELS.resolveProjectAudio, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('resolveProjectAudio requires an options object')
    const projectPath = path.resolve(requireString(value.projectPath, 'projectPath'))
    return resolveProjectAudio({ ownerContents: event.sender, projectPath })
  })

  ipcMain.handle(CHANNELS.releaseAudio, async (event) => {
    assertTrustedSender(event)
    beginMediaRequest(event.sender.id, 'audio')
    linkedAssets.revokeOwner(event.sender.id, 'audio')
  })

  ipcMain.handle(CHANNELS.chooseBackgroundImage, async (event) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const requestSequence = beginMediaRequest(ownerId, 'background')
    const result = await dialog.showOpenDialog(owner, {
      title: 'Choose Video Background',
      buttonLabel: 'Choose Image',
      properties: ['openFile'],
      filters: IMAGE_FILTERS,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = await validateLinkedImage(result.filePaths[0])
    if (!mediaRequestIsCurrent(ownerId, 'background', requestSequence)) return null
    return makeMediaResult(filePath, event.sender, 'background')
  })

  ipcMain.handle(CHANNELS.resolveProjectBackground, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('resolveProjectBackground requires an options object')
    const projectPath = path.resolve(requireString(value.projectPath, 'projectPath'))
    return resolveProjectBackground({ ownerContents: event.sender, projectPath })
  })

  ipcMain.handle(CHANNELS.releaseBackground, async (event) => {
    assertTrustedSender(event)
    beginMediaRequest(event.sender.id, 'background')
    linkedAssets.revokeOwner(event.sender.id, 'background')
  })

  ipcMain.handle(CHANNELS.retainBackground, async (event, value) => {
    assertTrustedSender(event)
    beginMediaRequest(event.sender.id, 'background')
    if (value === null) {
      linkedAssets.deactivateOwner(event.sender.id, 'background')
      return true
    }
    const token = typeof value === 'string' ? tokenFromMediaUrl(value) : null
    if (token && linkedAssets.retainOwnerToken(event.sender.id, 'background', token)) return true
    linkedAssets.deactivateOwner(event.sender.id, 'background')
    return false
  })

  ipcMain.handle(CHANNELS.importLrc, async (event) => {
    const owner = assertTrustedSender(event)
    const result = await dialog.showOpenDialog(owner, {
      title: 'Import LRC Lyrics',
      buttonLabel: 'Import Lyrics',
      properties: ['openFile'],
      filters: LRC_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const contents = await readUtf8FileWithinLimit(
      filePath,
      MAX_LRC_FILE_BYTES,
      'LRC file',
    )
    return { path: filePath, name: path.basename(filePath), contents }
  })

  ipcMain.handle(CHANNELS.exportText, async (event, value) => {
    const owner = assertTrustedSender(event)
    const request = normalizeExportRequest(value)
    const defaultName = ensureExportExtension(
      safeFileName(request.suggestedName, `lyrics.${request.format}`),
      request.format,
    )
    const filePath = await showCanonicalSaveDialog(dialog.showSaveDialog.bind(dialog), owner, {
      title: `Export ${request.format.toUpperCase()}`,
      buttonLabel: 'Export',
      defaultPath: documentsPath(defaultName),
      filters: EXPORT_FILTERS[request.format],
    }, request.format)

    if (!filePath) return null
    await writeUtf8FileAtomically(filePath, request.contents)
    return { path: filePath }
  })

  ipcMain.handle(CHANNELS.exportVideo, async (event, value) => {
    const owner = assertTrustedSender(event)
    if (activeVideoExport) throw new Error('Another karaoke video export is already running')
    const request = authorizeVideoExportRequest(event.sender.id, value)
    const operation = beginVideoExport(event.sender.id)
    const abortWhenOwnerCloses = () => {
      if (operation.commitState.tryBeginCancellation()) operation.controller.abort()
    }
    event.sender.once('destroyed', abortWhenOwnerCloses)

    try {
      await preflightVideoExportBackground(event.sender.id, request.backgroundPath)
      const defaultName = ensureExportExtension(
        safeFileName(request.suggestedName, 'karaoke-video.mp4'),
        'mp4',
      )
      const selectedOutputPath = await showCanonicalSaveDialog(
        dialog.showSaveDialog.bind(dialog),
        owner,
        {
          title: 'Export Karaoke Video',
          buttonLabel: 'Render Video',
          defaultPath: documentsPath(defaultName),
          filters: VIDEO_FILTERS,
        },
        'mp4',
      )
      if (!selectedOutputPath) return null
      if (operation.controller.signal.aborted) throw canceledVideoExportError()

      const sendProgress = (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(CHANNELS.videoExportProgress, progress)
        }
      }
      return await exportKaraokeVideo({
        BrowserWindow,
        projectJson: request.projectJson,
        durationMs: request.durationMs,
        audioPath: request.audioPath,
        outputPath: path.resolve(selectedOutputPath),
        readLinkedImage: readStaticImage,
        resolveFfmpegPath: async () => ensureFfmpegForExport({
          openExternal: openExternalUrl,
          showMessageBox: (options) => dialog.showMessageBox(owner, options),
          signal: operation.controller.signal,
        }),
        resolution: request.resolution,
        fps: request.fps,
        onProgress: sendProgress,
        onPromotionStart: () => operation.commitState.beginPromotion(),
        onPromotionComplete: () => operation.commitState.finishPromotion(),
        signal: operation.controller.signal,
      })
    } finally {
      event.sender.removeListener('destroyed', abortWhenOwnerCloses)
      finishVideoExport(operation)
    }
  })

  ipcMain.handle(CHANNELS.cancelVideoExport, async (event) => {
    assertTrustedSender(event)
    const operation = activeVideoExport
    if (!operation || operation.ownerId !== event.sender.id) return false
    if (!operation.commitState.tryBeginCancellation()) return false
    operation.controller.abort()
    await operation.finished
    return true
  })
}

function sendMenuAction(action) {
  if (!MENU_ACTIONS.has(action) || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(CHANNELS.menuAction, action)
}

function applicationMenuTemplate() {
  const macAppMenu = process.platform === 'darwin'
    ? [{
        label: APP_NAME,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
    : []

  return [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CommandOrControl+N', click: () => sendMenuAction('new') },
        { label: 'Open Project…', accelerator: 'CommandOrControl+O', click: () => sendMenuAction('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CommandOrControl+S', click: () => sendMenuAction('save') },
        { label: 'Save As…', accelerator: 'CommandOrControl+Shift+S', click: () => sendMenuAction('save-as') },
        { type: 'separator' },
        { label: 'Import Audio…', accelerator: 'CommandOrControl+Shift+A', click: () => sendMenuAction('import-audio') },
        { label: 'Import LRC…', accelerator: 'CommandOrControl+Shift+L', click: () => sendMenuAction('import-lrc') },
        { label: 'Export Lyrics…', accelerator: 'CommandOrControl+Shift+E', click: () => sendMenuAction('export') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: () => sendMenuAction('undo') },
        { label: 'Redo', accelerator: 'Shift+CommandOrControl+Z', click: () => sendMenuAction('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { label: 'Select All', accelerator: 'CommandOrControl+A', click: () => sendMenuAction('select-all') },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play/Pause',
          accelerator: 'Shift+Space',
          registerAccelerator: false,
          click: () => sendMenuAction('play-toggle'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ]
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()))
}

function isAllowedAppNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl)

    if (!USES_BUILT_RENDERER) {
      return url.origin === new URL(DEVELOPMENT_URL).origin
    }

    return (
      url.protocol === `${APP_SCHEME}:` &&
      url.hostname === APP_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '/index.html')
    )
  } catch {
    return false
  }
}

async function openExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return
    await shell.openExternal(url.toString())
  } catch (error) {
    console.error('Unable to open external URL:', error)
  }
}

function secureWebContents(contents) {
  const ownerId = contents.id
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    void openExternalUrl(url)
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('will-prevent-unload', (event) => {
    const owner = BrowserWindow.fromWebContents(contents)
    const options = {
      type: 'warning',
      buttons: ['Discard Changes', 'Keep Editing'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Unsaved karaoke project',
      message: 'Discard the unsaved changes?',
      detail: 'Your latest project changes have not been saved.',
    }
    const choice = owner
      ? dialog.showMessageBoxSync(owner, options)
      : dialog.showMessageBoxSync(options)
    // Electron prevents the unload by default. Preventing this event allows
    // the renderer-requested unload to continue after explicit confirmation.
    if (choice === 0) event.preventDefault()
  })
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      projectOpens.releaseOwner(ownerId)
      mediaRequests.invalidateOwner(ownerId)
      linkedAssets.revokeOwner(ownerId)
    }
  })
  contents.once('destroyed', () => {
    projectOpens.releaseOwner(ownerId)
    mediaRequests.invalidateOwner(ownerId)
    linkedAssets.releaseOwner(ownerId)
    mediaRequests.releaseOwner(ownerId)
  })
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const window = new BrowserWindow({
    title: APP_NAME,
    width: VIDEO_STYLE_VISUAL_SMOKE ? VISUAL_SMOKE_CONTENT_SIZE.width : 1440,
    height: VIDEO_STYLE_VISUAL_SMOKE ? VISUAL_SMOKE_CONTENT_SIZE.height : 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#f8f6fb',
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  })

  mainWindow = window
  secureWebContents(window.webContents)

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
      if (FONT_ACCESS_SMOKE || VIDEO_STYLE_VISUAL_SMOKE) window.focus()
    }
  })
  window.on('close', (event) => {
    if (rendererLifecycleApproval === 'window' || rendererLifecycleApproval === 'app') {
      rendererLifecycleApproval = null
      return
    }
    event.preventDefault()
    if (activeVideoExport) void videoExportLifecycleGuard.requestWindowClose()
    else requestRendererLifecycle('window')
  })
  window.on('closed', () => {
    rendererLifecycleRequest = null
    rendererLifecycleApproval = null
    if (mainWindow === window) mainWindow = null
  })

  if (USES_BUILT_RENDERER) {
    await window.loadURL(PACKAGED_APP_URL)
  } else {
    await window.loadURL(DEVELOPMENT_URL)
  }

  return window
}

function focusMainWindow() {
  if (!app.isReady()) {
    app.once('ready', focusMainWindow)
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow().catch((error) => console.error('Unable to create the main window:', error))
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function installLocalFontPermissions() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => (
      fontPermissions.check(webContents, permission, requestingOrigin, details)
    ),
  )
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => callback(
      fontPermissions.request(webContents, permission, details),
    ),
  )
}

async function initializeDesktop() {
  if (USES_BUILT_RENDERER) installApplicationProtocol()
  installMediaProtocol()
  registerIpcHandlers()
  installLocalFontPermissions()
  if (!FONT_ACCESS_SMOKE && !VIDEO_STYLE_VISUAL_SMOKE) {
    installApplicationMenu()
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
    })
  }
  return createMainWindow()
}

async function runFontAccessSmoke(window) {
  await focusSmokeWindow({ app, window })
  let timeoutId
  const evidence = await Promise.race([
    window.webContents.executeJavaScript(fontAccessProbeScript(), true),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Font access smoke timed out')), 20_000)
    }),
  ]).finally(() => clearTimeout(timeoutId))
  const privateFont = evidence.privateFont
  const publicEvidence = publicFontSmokeEvidence(evidence)
  const failures = fontAccessSmokeFailures({
    audit: fontPermissions.audit,
    evidence,
    expectedHref: PACKAGED_APP_URL,
    expectedOrigin: `${APP_SCHEME}://${APP_HOST}`,
  })
  let render = null
  if (failures.length === 0) {
    render = await runFontRenderSmoke(BrowserWindow, privateFont)
  }
  const result = {
    audit: publicFontPermissionAudit(fontPermissions.audit),
    evidence: publicEvidence,
    render,
    ok: failures.length === 0 && render?.localFontLoaded === true,
  }
  if (failures.length) throw Object.assign(new Error(failures.join('; ')), { result })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function failFontAccessSmoke(error) {
  const result = error?.result || {
    audit: publicFontPermissionAudit(fontPermissions.audit),
    error: publicFontSmokeFailure(error),
    ok: false,
  }
  process.stderr.write(`${JSON.stringify(result)}\n`)
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
  app.exit(1)
}

if (FONT_ACCESS_SMOKE) {
  app.whenReady().then(async () => {
    const window = await initializeDesktop()
    await runFontAccessSmoke(window)
    if (!window.isDestroyed()) window.destroy()
    app.exit(0)
  }).catch(failFontAccessSmoke)
} else if (VIDEO_STYLE_VISUAL_SMOKE) {
  app.whenReady().then(async () => {
    const window = await initializeDesktop()
    await focusSmokeWindow({
      app,
      window,
      errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
    })
    const result = await runVideoStyleVisualSmoke(
      window,
      process.env.OKS_VISUAL_SMOKE_OUTPUT,
    )
    process.stdout.write(`${JSON.stringify({
      captureCount: result.captures.length,
      ok: true,
    })}\n`)
    if (!window.isDestroyed()) window.destroy()
    app.exit(0)
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      code: typeof error?.code === 'string' ? error.code : 'VISUAL_SMOKE_FAILED',
      ok: false,
    })}\n`)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
    app.exit(1)
  })
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    app.quit()
  } else {
    app.on('second-instance', focusMainWindow)
    app.on('before-quit', (event) => {
      if (rendererLifecycleApproval === 'app') return
      if (!mainWindow || mainWindow.isDestroyed()) return
      event.preventDefault()
      if (activeVideoExport) void videoExportLifecycleGuard.requestAppQuit()
      else requestRendererLifecycle('app')
    })
    app.whenReady().then(initializeDesktop).catch((error) => {
      console.error('Failed to start Okay Karaoke Studio:', error)
      dialog.showErrorBox('Unable to start Okay Karaoke Studio', String(error?.message || error))
      app.quit()
    })
    app.on('activate', focusMainWindow)
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })
  }
}
