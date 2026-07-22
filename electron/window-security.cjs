'use strict'

function isAllowedAppNavigation(rawUrl, { appHost, appScheme, developmentUrl, useBuiltRenderer }) {
  try {
    const url = new URL(rawUrl)
    if (!useBuiltRenderer()) return url.origin === new URL(developmentUrl).origin
    return (
      url.protocol === `${appScheme}:` &&
      url.hostname === appHost &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '/index.html')
    )
  } catch {
    return false
  }
}

function createExternalUrlOpener({ openExternal, logger = console.error }) {
  return async function openExternalUrl(rawUrl) {
    try {
      const url = new URL(rawUrl)
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return
      await openExternal(url.toString())
    } catch (error) {
      logger('Unable to open external URL:', error)
    }
  }
}

function createMainWindowOptions({ appName, preloadPath, visualSmokeConfig, visualSmokeViewport }) {
  const contentSize = visualSmokeConfig ? visualSmokeViewport : { height: 900, width: 1440 }
  return {
    title: appName,
    width: contentSize.width,
    height: contentSize.height,
    minWidth: 1080,
    minHeight: 680,
    enableLargerThanScreen: visualSmokeConfig !== null,
    show: false,
    backgroundColor: '#f8f6fb',
    useContentSize: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  }
}

function secureWebContents(
  contents,
  {
    BrowserWindow,
    clearNativeCloseOwnership,
    dialog,
    isAllowedNavigation,
    openExternalUrl,
    releaseOwner,
  },
) {
  const ownerId = contents.id
  const releaseRendererScope = () => releaseOwner(ownerId)
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return
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
      detail: 'Your latest lyric and timing edits have not been saved.',
    }
    const choice = owner
      ? dialog.showMessageBoxSync(owner, options)
      : dialog.showMessageBoxSync(options)
    if (choice === 0) event.preventDefault()
  })
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      clearNativeCloseOwnership(ownerId)
      releaseRendererScope()
    }
  })
  let terminalScopeReleased = false
  const releaseTerminalScope = () => {
    if (terminalScopeReleased) return
    terminalScopeReleased = true
    clearNativeCloseOwnership(ownerId)
    releaseRendererScope()
  }
  contents.once('render-process-gone', releaseTerminalScope)
  contents.once('destroyed', releaseTerminalScope)
}

module.exports = {
  createExternalUrlOpener,
  createMainWindowOptions,
  isAllowedAppNavigation,
  secureWebContents,
}
