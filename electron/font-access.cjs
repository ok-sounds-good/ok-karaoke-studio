'use strict'

const { validateOwnedSmokeProfile } = require('./smoke-profile.cjs')

const LOCAL_FONT_PERMISSION = 'local-fonts'
const POSTSCRIPT_NAME_PATTERN = /^[a-z0-9._+-]{1,300}$/iu

function sameRegisteredRenderer(rawUrl, trustedUrl) {
  try {
    const value = new URL(rawUrl)
    const trusted = new URL(trustedUrl)
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
  details,
  trustedOrigin,
}) {
  if (permission !== LOCAL_FONT_PERMISSION) return false
  if (!mainWindow || mainWindow.isDestroyed() || webContents !== mainWindow.webContents) return false
  if (details?.isMainFrame !== true) return false
  const rendererUrl = webContents.getURL?.()
  if (!sameRegisteredRenderer(rendererUrl, trustedOrigin)) return false
  if (!requestingOrigin || requestingOrigin === 'null') return false
  return sameRegisteredRenderer(requestingOrigin, trustedOrigin)
}

function createLocalFontPermissionPolicy({ getMainWindow, recordDecisions = true, trustedOrigin }) {
  const audit = []
  const decide = (handler, webContents, permission, requestingOrigin, details) => {
    const allowed = mayAccessLocalFonts({
      mainWindow: getMainWindow(),
      webContents,
      permission,
      requestingOrigin,
      details,
      trustedOrigin,
    })
    if (recordDecisions) {
      audit.push({
        allowed,
        handler,
        isMainFrame: details?.isMainFrame === true,
        permission,
        requestingOrigin: requestingOrigin || null,
        requestingUrl: details?.requestingUrl || null,
        webContentsUrl: webContents?.getURL?.() || null,
      })
    }
    return allowed
  }
  return {
    audit,
    check(webContents, permission, requestingOrigin, details) {
      return decide('check', webContents, permission, requestingOrigin, details)
    },
    request(webContents, permission, details) {
      return decide('request', webContents, permission, details?.requestingUrl, details)
    },
  }
}

function isUsableLocalFont(font) {
  return Boolean(
    font &&
    typeof font.postscriptName === 'string' &&
    POSTSCRIPT_NAME_PATTERN.test(font.postscriptName) &&
    typeof font.family === 'string' && font.family.trim() &&
    typeof font.fullName === 'string' && font.fullName.trim() &&
    typeof font.style === 'string' && font.style.trim(),
  )
}

function fontAccessProbeScript() {
  return `(${async function probeLocalFonts() {
    if (typeof queryLocalFonts !== 'function') throw new Error('queryLocalFonts is unavailable')
    const fonts = await queryLocalFonts()
    const usable = fonts.filter((font) => (
      typeof font.postscriptName === 'string' &&
      /^[a-z0-9._+-]{1,300}$/iu.test(font.postscriptName) &&
      typeof font.family === 'string' && Boolean(font.family.trim()) &&
      typeof font.fullName === 'string' && Boolean(font.fullName.trim()) &&
      typeof font.style === 'string' && Boolean(font.style.trim())
    ))
    const weightFromStyle = (style) => {
      const value = style.toLowerCase().replace(/[\s_-]+/gu, '')
      if (value.includes('thin')) return 100
      if (value.includes('extralight') || value.includes('ultralight')) return 200
      if (value.includes('light')) return 300
      if (value.includes('medium')) return 500
      if (value.includes('semibold') || value.includes('demibold')) return 600
      if (value.includes('extrabold') || value.includes('ultrabold')) return 800
      if (value.includes('black') || value.includes('heavy')) return 900
      return value.includes('bold') ? 700 : 400
    }
    const slantFromStyle = (style) => {
      const value = style.toLowerCase()
      if (value.includes('italic')) return 'italic'
      if (value.includes('oblique')) return 'oblique'
      return 'normal'
    }
    let privateFont = null
    for (const font of usable.slice(0, 32)) {
      const face = {
        fullName: font.fullName.slice(0, 300),
        style: font.style.slice(0, 120),
        postscriptName: font.postscriptName,
        weight: weightFromStyle(font.style),
        slant: slantFromStyle(font.style),
      }
      try {
        const alias = `oks-font-smoke-${Math.random().toString(36).slice(2)}`
        const loaded = await new FontFace(alias, `local("${font.postscriptName}")`, {
          style: face.slant,
          weight: String(face.weight),
          display: 'block',
        }).load()
        document.fonts.add(loaded)
        privateFont = { family: font.family.slice(0, 300), face }
        break
      } catch {
        // Continue privately until one installed face proves loadable.
      }
    }
    return {
      focused: document.hasFocus(),
      href: location.href,
      localFontLoaded: privateFont !== null,
      origin: location.origin,
      privateFont,
      rawCount: fonts.length,
      secure: window.isSecureContext,
      topLevel: window === window.top,
      usableCount: usable.length,
      visibility: document.visibilityState,
    }
  }.toString()})()`
}

function fontAccessSmokeFailures({ audit, evidence, expectedHref, expectedOrigin }) {
  const granted = audit.filter((entry) => entry.allowed)
  const failures = []
  if (evidence.href !== expectedHref) failures.push(`href was ${evidence.href}`)
  if (evidence.origin !== expectedOrigin) failures.push(`origin was ${evidence.origin}`)
  if (!evidence.secure) failures.push('renderer was not a secure context')
  if (!evidence.topLevel) failures.push('renderer was not top-level')
  if (evidence.visibility !== 'visible') failures.push(`visibility was ${evidence.visibility}`)
  if (!evidence.focused) failures.push('renderer was not focused')
  if (evidence.rawCount <= 0 || evidence.usableCount <= 0) {
    failures.push('no usable fonts were returned')
  }
  if (!evidence.localFontLoaded) failures.push('no installed font could be loaded')
  if (!granted.some((entry) => entry.permission === LOCAL_FONT_PERMISSION)) {
    failures.push('local-fonts permission was never granted')
  }
  if (granted.some((entry) => entry.permission !== LOCAL_FONT_PERMISSION)) {
    failures.push('a non-local-fonts permission was granted')
  }
  return failures
}

function publicFontSmokeEvidence(evidence) {
  return {
    focused: evidence?.focused === true,
    localFontLoaded: evidence?.localFontLoaded === true,
    rawCount: Number.isSafeInteger(evidence?.rawCount) ? evidence.rawCount : 0,
    secure: evidence?.secure === true,
    topLevel: evidence?.topLevel === true,
    usableCount: Number.isSafeInteger(evidence?.usableCount) ? evidence.usableCount : 0,
    visible: evidence?.visibility === 'visible',
  }
}

function publicFontPermissionAudit(audit) {
  const entries = Array.isArray(audit) ? audit : []
  const granted = entries.filter((entry) => entry?.allowed === true)
  return {
    decisionCount: entries.length,
    grantedCount: granted.length,
    grantedLocalFontsOnly: granted.every((entry) => entry.permission === LOCAL_FONT_PERMISSION),
    grantedMainFrameOnly: granted.every((entry) => entry.isMainFrame === true),
  }
}

function publicFontSmokeFailure(error) {
  const known = new Set([
    'FONT_ACCESS_SMOKE_FOCUS_FAILED',
    'FONT_RENDER_INPUT_INVALID',
    'FONT_RENDER_FALLBACK',
    'FONT_RENDER_CAPTURE_INVALID',
    'FONT_RENDER_SANDBOX_INVALID',
  ])
  return known.has(error?.message) ? error.message : 'FONT_ACCESS_SMOKE_FAILED'
}

function isolatedFontSmokeProfile(rawPath, defaultUserDataPath, rawIdentity) {
  return validateOwnedSmokeProfile(
    rawPath,
    defaultUserDataPath,
    rawIdentity,
    'FONT_PROFILE_INVALID',
  )
}

module.exports = {
  LOCAL_FONT_PERMISSION,
  createLocalFontPermissionPolicy,
  fontAccessProbeScript,
  fontAccessSmokeFailures,
  isUsableLocalFont,
  isolatedFontSmokeProfile,
  mayAccessLocalFonts,
  publicFontPermissionAudit,
  publicFontSmokeEvidence,
  publicFontSmokeFailure,
  sameRegisteredRenderer,
}
