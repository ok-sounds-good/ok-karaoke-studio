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
const VIDEO_EXPORT_PHASES = new Set(['preparing', 'frames', 'encoding', 'complete'])

const studio = Object.freeze({
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  settleProjectOpen: async (requestId, accepted) => (
    await ipcRenderer.invoke(CHANNELS.settleProjectOpen, { requestId, accepted })
  ) === true,
  resetProjectScope: async () => (
    await ipcRenderer.invoke(CHANNELS.resetProjectScope)
  ) === true,
  saveProject: (options) => ipcRenderer.invoke(CHANNELS.saveProject, options),
  importAudio: () => ipcRenderer.invoke(CHANNELS.importAudio),
  resolveProjectAudio: (projectPath) => ipcRenderer.invoke(
    CHANNELS.resolveProjectAudio,
    { projectPath },
  ),
  releaseAudio: () => ipcRenderer.invoke(CHANNELS.releaseAudio),
  chooseBackgroundImage: () => ipcRenderer.invoke(CHANNELS.chooseBackgroundImage),
  resolveProjectBackground: (projectPath) => ipcRenderer.invoke(
    CHANNELS.resolveProjectBackground,
    { projectPath },
  ),
  releaseBackground: () => ipcRenderer.invoke(CHANNELS.releaseBackground),
  retainBackground: (url) => ipcRenderer.invoke(CHANNELS.retainBackground, url),
  importLrc: () => ipcRenderer.invoke(CHANNELS.importLrc),
  exportText: (options) => ipcRenderer.invoke(CHANNELS.exportText, options),
  exportVideo: (options) => ipcRenderer.invoke(CHANNELS.exportVideo, options),
  cancelVideoExport: () => ipcRenderer.invoke(CHANNELS.cancelVideoExport),
  resolveWindowClose: async (proceed) => (
    await ipcRenderer.invoke(CHANNELS.resolveWindowClose, proceed)
  ) === true,
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
      ) return
      callback(Object.freeze({
        phase: progress.phase,
        completed: Math.max(0, progress.completed),
        total: Math.max(1, progress.total),
      }))
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
  onLinkedAssetInvalidated: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onLinkedAssetInvalidated requires a callback function')
    }
    const listener = (_event, value) => {
      if (
        value?.kind === 'background' &&
        typeof value.path === 'string' &&
        typeof value.message === 'string'
      ) callback(Object.freeze({ kind: value.kind, path: value.path, message: value.message }))
    }
    ipcRenderer.on(CHANNELS.linkedAssetInvalidated, listener)
    return () => ipcRenderer.removeListener(CHANNELS.linkedAssetInvalidated, listener)
  },
  onWindowCloseRequest: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onWindowCloseRequest requires a callback function')
    }
    const listener = (_event, action) => {
      if (action === 'window' || action === 'app') callback(action)
    }
    ipcRenderer.on(CHANNELS.windowCloseRequest, listener)
    return () => ipcRenderer.removeListener(CHANNELS.windowCloseRequest, listener)
  },
})

contextBridge.exposeInMainWorld('studio', studio)
