'use strict'

const { contextBridge, ipcRenderer } = require('electron')

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
  settleBackgroundImage: 'studio:settle-background-image',
  retainBackground: 'studio:retain-background',
  releaseBackground: 'studio:release-background',
  releaseBackgroundSnapshot: 'studio:release-background-snapshot',
  getBackgroundState: 'studio:get-background-state',
  importLrc: 'studio:import-lrc',
  exportText: 'studio:export-text',
  exportVideo: 'studio:export-video',
  cancelVideoExport: 'studio:cancel-video-export',
  videoExportProgress: 'studio:video-export-progress',
  menuAction: 'studio:menu-action',
  windowCloseRequest: 'studio:window-close-request',
  getPendingWindowClose: 'studio:get-pending-window-close',
  resolveWindowClose: 'studio:resolve-window-close',
  listStyleTemplates: 'studio:list-style-templates',
  createStyleTemplate: 'studio:create-style-template',
  renameStyleTemplate: 'studio:rename-style-template',
  deleteStyleTemplate: 'studio:delete-style-template',
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
const VIDEO_EXPORT_PHASES = new Set(['preparing', 'frames', 'encoding', 'complete'])
const WINDOW_CLOSE_ACTIONS = new Set(['window', 'app'])
const WINDOW_CLOSE_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isWindowCloseRequestId(value) {
  return typeof value === 'string' && value.length === 36 && WINDOW_CLOSE_REQUEST_ID.test(value)
}

function normalizeWindowCloseRequest(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !isWindowCloseRequestId(value.requestId) ||
    !WINDOW_CLOSE_ACTIONS.has(value.action)
  ) {
    return null
  }
  return Object.freeze({ requestId: value.requestId, action: value.action })
}

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function normalizeStyleTemplate(value) {
  if (!exactRecord(value, ['id', 'name', 'preferences'])) return null
  if (typeof value.id !== 'string' || !/^[\x21-\x7e]{1,128}$/u.test(value.id)) return null
  if (
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    value.name.length > 80 ||
    value.name !== value.name.trim().replace(/\s+/gu, ' ')
  ) {
    return null
  }
  if (
    !exactRecord(value.preferences, [
      'stageStyle',
      'lyricDisplay',
      'vocalStyle',
      'videoExportDefaults',
    ])
  ) {
    return null
  }
  return value
}

function requireStyleTemplate(value, operation) {
  const template = normalizeStyleTemplate(value)
  if (!template) throw new TypeError(`${operation} returned an invalid style template.`)
  return template
}

function requireStyleTemplateList(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError('listStyleTemplates returned an invalid style template list.')
  }
  return value.map((template) => requireStyleTemplate(template, 'listStyleTemplates'))
}

function requireStyleTemplateCreateRequest(value) {
  if (
    !exactRecord(value, ['name', 'preferences']) ||
    typeof value.name !== 'string' ||
    !exactRecord(value.preferences, [
      'stageStyle',
      'lyricDisplay',
      'vocalStyle',
      'videoExportDefaults',
    ])
  ) {
    throw new TypeError('createStyleTemplate requires valid name and preferences values.')
  }
  return { name: value.name, preferences: value.preferences }
}

function requireStyleTemplateId(value, operation) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,128}$/u.test(value)) {
    throw new TypeError(`${operation} requires a valid style template id.`)
  }
  return value
}

function requireStyleTemplateName(value, operation) {
  if (typeof value !== 'string') {
    throw new TypeError(`${operation} requires a style template name.`)
  }
  return value
}

const studio = Object.freeze({
  listStyleTemplates: async () =>
    requireStyleTemplateList(await ipcRenderer.invoke(CHANNELS.listStyleTemplates)),
  createStyleTemplate: async (options) =>
    requireStyleTemplate(
      await ipcRenderer.invoke(
        CHANNELS.createStyleTemplate,
        requireStyleTemplateCreateRequest(options),
      ),
      'createStyleTemplate',
    ),
  renameStyleTemplate: async (id, name) =>
    requireStyleTemplate(
      await ipcRenderer.invoke(CHANNELS.renameStyleTemplate, {
        id: requireStyleTemplateId(id, 'renameStyleTemplate'),
        name: requireStyleTemplateName(name, 'renameStyleTemplate'),
      }),
      'renameStyleTemplate',
    ),
  deleteStyleTemplate: async (id) => {
    const deleted = await ipcRenderer.invoke(CHANNELS.deleteStyleTemplate, {
      id: requireStyleTemplateId(id, 'deleteStyleTemplate'),
    })
    if (deleted !== true) throw new TypeError('deleteStyleTemplate returned an invalid result.')
    return true
  },
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  settleProjectOpen: async (requestId, accepted) =>
    (await ipcRenderer.invoke(CHANNELS.settleProjectOpen, { requestId, accepted })) === true,
  resetProjectScope: async () => (await ipcRenderer.invoke(CHANNELS.resetProjectScope)) === true,
  saveProject: (options) => ipcRenderer.invoke(CHANNELS.saveProject, options),
  importAudio: () => ipcRenderer.invoke(CHANNELS.importAudio),
  resolveProjectAudio: (projectPath) =>
    ipcRenderer.invoke(CHANNELS.resolveProjectAudio, { projectPath }),
  releaseAudio: () => ipcRenderer.invoke(CHANNELS.releaseAudio),
  getBackgroundState: () => ipcRenderer.invoke(CHANNELS.getBackgroundState),
  chooseBackgroundImage: () => ipcRenderer.invoke(CHANNELS.chooseBackgroundImage),
  resolveProjectBackground: (projectPath) =>
    ipcRenderer.invoke(CHANNELS.resolveProjectBackground, { projectPath }),
  settleBackgroundImage: (url, accepted) =>
    ipcRenderer.invoke(CHANNELS.settleBackgroundImage, { url, accepted }),
  retainBackground: (expected, url) =>
    ipcRenderer.invoke(CHANNELS.retainBackground, { expected, url }),
  releaseBackground: (expected) => ipcRenderer.invoke(CHANNELS.releaseBackground, { expected }),
  releaseBackgroundSnapshot: (expected, url) =>
    ipcRenderer.invoke(CHANNELS.releaseBackgroundSnapshot, { expected, url }),
  importLrc: () => ipcRenderer.invoke(CHANNELS.importLrc),
  exportText: (options) => ipcRenderer.invoke(CHANNELS.exportText, options),
  exportVideo: (options) => ipcRenderer.invoke(CHANNELS.exportVideo, options),
  cancelVideoExport: () => ipcRenderer.invoke(CHANNELS.cancelVideoExport),
  getPendingWindowClose: async () =>
    normalizeWindowCloseRequest(await ipcRenderer.invoke(CHANNELS.getPendingWindowClose)),
  resolveWindowClose: async (requestId, proceed) => {
    if (!isWindowCloseRequestId(requestId)) {
      throw new TypeError('resolveWindowClose requires a UUID requestId')
    }
    if (typeof proceed !== 'boolean') {
      throw new TypeError('resolveWindowClose requires a boolean decision')
    }
    return (await ipcRenderer.invoke(CHANNELS.resolveWindowClose, { requestId, proceed })) === true
  },
  onWindowCloseRequest: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onWindowCloseRequest requires a callback function')
    }
    const listener = (_event, value) => {
      const request = normalizeWindowCloseRequest(value)
      if (request) callback(request)
    }
    ipcRenderer.on(CHANNELS.windowCloseRequest, listener)
    return () => ipcRenderer.removeListener(CHANNELS.windowCloseRequest, listener)
  },
  onVideoExportProgress: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onVideoExportProgress requires a callback function')
    }

    const listener = (_event, progress) => {
      if (
        !progress ||
        typeof progress !== 'object' ||
        !VIDEO_EXPORT_PHASES.has(progress.phase) ||
        !Number.isFinite(progress.completed) ||
        !Number.isFinite(progress.total)
      )
        return
      callback(
        Object.freeze({
          phase: progress.phase,
          completed: Math.max(0, progress.completed),
          total: Math.max(1, progress.total),
        }),
      )
    }

    ipcRenderer.on(CHANNELS.videoExportProgress, listener)
    return () => ipcRenderer.removeListener(CHANNELS.videoExportProgress, listener)
  },
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onMenuAction requires a callback function')
    }

    const listener = (_event, action) => {
      if (MENU_ACTIONS.has(action)) callback(action)
    }

    ipcRenderer.on(CHANNELS.menuAction, listener)
    return () => ipcRenderer.removeListener(CHANNELS.menuAction, listener)
  },
})

contextBridge.exposeInMainWorld('studio', studio)
