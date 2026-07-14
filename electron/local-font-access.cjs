'use strict'

const LOCAL_FONT_PERMISSION = 'local-fonts'

function sameRegisteredRenderer(rawUrl, trustedOrigin) {
  try {
    const value = new URL(rawUrl)
    const trusted = new URL(trustedOrigin)
    if (value.protocol !== trusted.protocol) return false
    if (value.hostname !== trusted.hostname || value.port !== trusted.port) return false
    if (value.username || value.password || trusted.username || trusted.password) return false
    if (trusted.protocol === 'http:' || trusted.protocol === 'https:') {
      return value.origin === trusted.origin
    }
    return Boolean(trusted.hostname)
  } catch {
    return false
  }
}

function mayAccessLocalFonts({
  mainWindow,
  webContents,
  permission,
  requestingOrigin,
  requestingUrl,
  isMainFrame,
  trustedOrigin,
}) {
  if (permission !== LOCAL_FONT_PERMISSION || isMainFrame !== true) return false
  if (!mainWindow || mainWindow.isDestroyed() || webContents !== mainWindow.webContents) {
    return false
  }
  if (!sameRegisteredRenderer(webContents.getURL?.(), trustedOrigin)) return false
  if (!sameRegisteredRenderer(requestingOrigin, trustedOrigin)) return false
  return !requestingUrl || sameRegisteredRenderer(requestingUrl, trustedOrigin)
}

function createLocalFontPermissionPolicy({ getMainWindow, trustedOrigin }) {
  return {
    check(webContents, permission, requestingOrigin, details) {
      return mayAccessLocalFonts({
        mainWindow: getMainWindow(),
        webContents,
        permission,
        requestingOrigin,
        requestingUrl: details?.requestingUrl,
        isMainFrame: details?.isMainFrame,
        trustedOrigin,
      })
    },
    request(webContents, permission, details) {
      return mayAccessLocalFonts({
        mainWindow: getMainWindow(),
        webContents,
        permission,
        requestingOrigin: details?.requestingUrl,
        requestingUrl: details?.requestingUrl,
        isMainFrame: details?.isMainFrame,
        trustedOrigin,
      })
    },
  }
}

module.exports = {
  LOCAL_FONT_PERMISSION,
  createLocalFontPermissionPolicy,
  mayAccessLocalFonts,
  sameRegisteredRenderer,
}
