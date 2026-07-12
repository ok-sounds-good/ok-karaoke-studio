'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = Object.freeze({
  openProject: 'studio:open-project',
  saveProject: 'studio:save-project',
  importAudio: 'studio:import-audio',
  resolveAudio: 'studio:resolve-audio',
  importLrc: 'studio:import-lrc',
  exportText: 'studio:export-text',
  menuAction: 'studio:menu-action',
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
  'undo',
  'redo',
])

const studio = Object.freeze({
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  saveProject: (options) => ipcRenderer.invoke(CHANNELS.saveProject, options),
  importAudio: () => ipcRenderer.invoke(CHANNELS.importAudio),
  resolveAudio: (filePath) => ipcRenderer.invoke(CHANNELS.resolveAudio, filePath),
  importLrc: () => ipcRenderer.invoke(CHANNELS.importLrc),
  exportText: (options) => ipcRenderer.invoke(CHANNELS.exportText, options),
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
