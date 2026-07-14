'use strict'

const { createHash } = require('node:crypto')
const {
  outputState,
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('./smoke-artifacts.cjs')
const { validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const { parseStrictPng } = require('./png-validation.cjs')
const {
  fontCaptureInstallScript,
  fontCaptureVerifyScript,
} = require('./video-style-font-capture.cjs')

const CONTENT_SIZE = Object.freeze({ width: 1280, height: 720 })
const SCREENSHOTS = Object.freeze([
  Object.freeze({ file: '01-default.png', state: 'default' }),
  Object.freeze({ file: '02-style-background.png', state: 'style-background' }),
  Object.freeze({ file: '03-font-selector.png', state: 'font-selector' }),
])
const KNOWN_FAILURES = new Set([
  'VISUAL_APP_NOT_READY',
  'VISUAL_CLICK_TARGET_MISSING',
  'VISUAL_FONT_CATALOG_EMPTY',
  'VISUAL_FONT_FACE_LOAD_FAILED',
  'VISUAL_FONT_LOAD_FAILED',
  'VISUAL_FONT_PRIVACY_INVALID',
  'VISUAL_FONT_QUERY_RESTORE_FAILED',
  'VISUAL_FONT_SYSTEM_RESTORE_FAILED',
  'VISUAL_GEOMETRY_INVALID',
  'VISUAL_PNG_INVALID',
  'VISUAL_PROFILE_INVALID',
  'VISUAL_OUTPUT_INVALID',
  'VISUAL_OUTPUT_EXISTS',
  'VISUAL_OUTPUT_RACE',
  'VISUAL_SMOKE_FAILED',
  'VISUAL_SMOKE_FOCUS_FAILED',
])

function smokeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function isolatedVisualSmokeProfile(rawPath, defaultUserDataPath, rawIdentity) {
  return validateOwnedSmokeProfile(
    rawPath,
    defaultUserDataPath,
    rawIdentity,
    'VISUAL_PROFILE_INVALID',
  )
}

function parsePngIhdr(bytes) {
  return parseStrictPng(bytes)
}

function rectIsVisible(rect, viewport) {
  return Boolean(
    rect && rect.width > 0 && rect.height > 0 &&
    rect.left >= -0.5 && rect.top >= -0.5 &&
    rect.right <= viewport.width + 0.5 && rect.bottom <= viewport.height + 0.5,
  )
}

function assertVisualGeometry(snapshot, state) {
  const viewport = snapshot?.viewport
  if (
    viewport?.width !== CONTENT_SIZE.width ||
    viewport?.height !== CONTENT_SIZE.height ||
    viewport?.dpr !== 1 ||
    snapshot?.overflow?.documentWidth > CONTENT_SIZE.width ||
    snapshot?.overflow?.documentHeight > CONTENT_SIZE.height ||
    snapshot?.overflow?.bodyWidth > CONTENT_SIZE.width ||
    snapshot?.overflow?.bodyHeight > CONTENT_SIZE.height
  ) throw smokeError('VISUAL_GEOMETRY_INVALID')

  const required = state === 'default'
    ? ['styleButton', 'preview', 'transport']
    : state === 'style-background'
      ? ['editor', 'preview', 'actions', 'transport']
      : ['fontSelector', 'sample', 'preview', 'actions', 'transport']
  if (required.some((key) => !rectIsVisible(snapshot.rects?.[key], viewport))) {
    throw smokeError('VISUAL_GEOMETRY_INVALID')
  }
  if (state !== 'default' && snapshot.rects.editor && snapshot.rects.preview) {
    const editor = snapshot.rects.editor
    const preview = snapshot.rects.preview
    const overlaps = editor.left < preview.right && editor.right > preview.left &&
      editor.top < preview.bottom && editor.bottom > preview.top
    if (overlaps) throw smokeError('VISUAL_GEOMETRY_INVALID')
  }
  return true
}

function geometryScript() {
  return `(${function collectGeometry() {
    const visible = (element) => {
      if (!element) return false
      const style = getComputedStyle(element)
      const value = element.getBoundingClientRect()
      return value.width > 0 && value.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    }
    const firstVisible = (selector) => (
      [...document.querySelectorAll(selector)].find(visible) || null
    )
    const rectFor = (element) => {
      const value = element?.getBoundingClientRect()
      return value ? {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      } : null
    }
    const rect = (selector) => rectFor(firstVisible(selector))
    const stylePreviews = [...document.querySelectorAll('.style-workspace > .preview-panel')]
    const preview = stylePreviews.length > 0
      ? stylePreviews.find(visible) || null
      : firstVisible('.workspace-top .preview-panel')
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      overflow: {
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
      },
      rects: {
        styleButton: rect('.project-style-button'),
        editor: rect('#oks-public-font-capture') || rect('.video-style-editor'),
        fontSelector: rect('#oks-public-font-capture .font-selector') || rect('.font-selector'),
        sample: rect('#oks-public-font-capture .font-selector__sample') ||
          rect('.font-selector__sample'),
        preview: rectFor(preview),
        actions: rect('#oks-public-font-capture .video-style-editor__actions') ||
          rect('.video-style-editor__actions'),
        transport: rect('.transport'),
      },
    }
  }.toString()})()`
}

async function waitFor(window, expression, code, timeoutMs = 10_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (window.isDestroyed()) throw smokeError(code)
    const ready = await window.webContents.executeJavaScript(`Boolean(${expression})`)
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw smokeError(code)
}

async function trustedClick(window, selector) {
  const point = await window.webContents.executeJavaScript(`(${function targetPoint(value) {
    const element = document.querySelector(value)
    const rect = element?.getBoundingClientRect()
    return rect && rect.width > 0 && rect.height > 0
      ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      : null
  }.toString()})(${JSON.stringify(selector)})`)
  if (!point) throw smokeError('VISUAL_CLICK_TARGET_MISSING')
  window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
}

async function selectBackgroundState(window) {
  const selected = await window.webContents.executeJavaScript(`(${function configureBackground() {
    const label = [...document.querySelectorAll('.segmented-field label')]
      .find((candidate) => candidate.textContent?.trim() === 'Solid')
    const radio = label?.querySelector('input')
    if (!radio) return false
    radio.click()
    return true
  }.toString()})()`)
  if (!selected) throw smokeError('VISUAL_APP_NOT_READY')
  await waitFor(
    window,
    `document.querySelector('input[name="background-mode"]:checked')?.parentElement?.textContent?.trim() === 'Solid'`,
    'VISUAL_APP_NOT_READY',
  )
  const changed = await window.webContents.executeJavaScript(`(${function setColor(value) {
    const input = document.querySelector('.style-pane input[type="color"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }.toString()})('#16394F')`)
  if (!changed) throw smokeError('VISUAL_APP_NOT_READY')
  await waitFor(
    window,
    `document.querySelector('.style-pane input[type="color"]')?.value === '#16394f'`,
    'VISUAL_APP_NOT_READY',
  )
}

function privateFontSelectionScript() {
  return `(${async function chooseAndRestoreFont() {
    const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    const select = document.querySelector(
      '.font-selector__columns > label:first-child select',
    )
    const search = document.querySelector('.font-search input')
    const sample = document.querySelector('.font-selector__sample')
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!select || !search || !sample) return { catalogCount: 0, localFontLoaded: false }
    const options = [...select.options]
    const privateOptions = options.filter((option) => option.value.startsWith('local:'))
    let localFontLoaded = false
    for (const option of privateOptions.slice(0, 32)) {
      setValue(select, option.value)
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(50)
        if (sample.style.fontFamily.includes('oks-local-')) {
          localFontLoaded = true
          break
        }
      }
      if (localFontLoaded) break
    }
    const system = options.find((option) => option.value.startsWith('system-ui:'))
    if (system) setValue(select, system.value)
    setValue(search, 'System')
    let restoredSystem = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(50)
      restoredSystem = sample.textContent?.trim() === 'This is System UI' &&
        !sample.style.fontFamily.includes('oks-local-') && search.value === 'System'
      if (restoredSystem) break
    }
    return {
      catalogCount: privateOptions.length,
      localFontLoaded,
      restoredSystem,
      searchIsGeneric: search.value === 'System',
    }
  }.toString()})()`
}

async function captureState(window, state) {
  const started = Date.now()
  await window.webContents.executeJavaScript(
    'new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  )
  const geometry = await window.webContents.executeJavaScript(geometryScript())
  assertVisualGeometry(geometry, state.state)
  if (state.state === 'font-selector') {
    const before = await window.webContents.executeJavaScript(fontCaptureVerifyScript())
    if (!before?.safe) throw smokeError('VISUAL_FONT_PRIVACY_INVALID')
  }
  const png = await window.webContents.capturePage().then((image) => image.toPNG())
  if (state.state === 'font-selector') {
    const after = await window.webContents.executeJavaScript(fontCaptureVerifyScript())
    if (!after?.safe) throw smokeError('VISUAL_FONT_PRIVACY_INVALID')
  }
  const dimensions = parsePngIhdr(png)
  if (dimensions.width !== CONTENT_SIZE.width || dimensions.height !== CONTENT_SIZE.height) {
    throw smokeError('VISUAL_PNG_INVALID')
  }
  return {
    artifact: { name: state.file, bytes: png },
    metadata: {
      file: state.file,
      sha256: createHash('sha256').update(png).digest('hex'),
      durationMs: Date.now() - started,
    },
  }
}

function sanitizedFailure(error, stage, started) {
  const candidate = typeof error?.code === 'string' ? error.code : error?.message
  return {
    code: KNOWN_FAILURES.has(candidate) ? candidate : 'VISUAL_SMOKE_FAILED',
    stage: SCREENSHOTS.some((entry) => entry.state === stage) ? stage : 'startup',
    durationMs: Date.now() - started,
    ok: false,
  }
}

async function runVideoStyleVisualSmoke(window, rawOutputPath) {
  const output = validateFreshOutputPath(rawOutputPath)
  if ((await outputState(output)).state !== 'absent') {
    throw smokeError('VISUAL_OUTPUT_EXISTS')
  }
  const started = Date.now()
  let stage = 'startup'
  const artifacts = []

  try {
    window.setContentSize(CONTENT_SIZE.width, CONTENT_SIZE.height)
    window.show()
    window.focus()
    await waitFor(window, `document.querySelector('.project-style-button') !== null`, 'VISUAL_APP_NOT_READY')
    await waitFor(
      window,
      `innerWidth === ${CONTENT_SIZE.width} && innerHeight === ${CONTENT_SIZE.height} && devicePixelRatio === 1`,
      'VISUAL_GEOMETRY_INVALID',
    )
    const captures = []
    stage = SCREENSHOTS[0].state
    const defaultCapture = await captureState(window, SCREENSHOTS[0])
    captures.push(defaultCapture.metadata)
    artifacts.push(defaultCapture.artifact)

    await trustedClick(window, '.project-style-button')
    await waitFor(
      window,
      `document.querySelector('[data-style-section="background"]') !== null`,
      'VISUAL_APP_NOT_READY',
    )
    await selectBackgroundState(window)
    stage = SCREENSHOTS[1].state
    const backgroundCapture = await captureState(window, SCREENSHOTS[1])
    captures.push(backgroundCapture.metadata)
    artifacts.push(backgroundCapture.artifact)

    stage = SCREENSHOTS[2].state
    await trustedClick(window, '[data-style-section="lyrics"]')
    await waitFor(
      window,
      `document.querySelector('[data-font-target="lyrics"]') !== null`,
      'VISUAL_APP_NOT_READY',
    )
    await trustedClick(window, '[data-font-target="lyrics"]')
    await waitFor(window, `document.querySelector('.font-selector') !== null`, 'VISUAL_APP_NOT_READY')
    await waitFor(
      window,
      `document.querySelectorAll('.font-selector__columns > label:first-child select option').length > 2`,
      'VISUAL_FONT_CATALOG_EMPTY',
      15_000,
    )
    const fontEvidence = await window.webContents.executeJavaScript(privateFontSelectionScript())
    if (!fontEvidence.localFontLoaded) throw smokeError('VISUAL_FONT_FACE_LOAD_FAILED')
    if (!fontEvidence.restoredSystem) throw smokeError('VISUAL_FONT_SYSTEM_RESTORE_FAILED')
    if (!fontEvidence.searchIsGeneric) throw smokeError('VISUAL_FONT_QUERY_RESTORE_FAILED')
    const publicCapture = await window.webContents.executeJavaScript(fontCaptureInstallScript())
    const privacy = await window.webContents.executeJavaScript(fontCaptureVerifyScript())
    if (!publicCapture?.installed || !privacy?.safe) {
      throw smokeError('VISUAL_FONT_PRIVACY_INVALID')
    }
    const fontCapture = await captureState(window, SCREENSHOTS[2])
    captures.push(fontCapture.metadata)
    artifacts.push(fontCapture.artifact)

    const result = {
      ok: true,
      viewport: { ...CONTENT_SIZE, dpr: 1 },
      order: SCREENSHOTS.map((entry) => entry.file),
      captures,
      font: {
        catalogNonEmpty: fontEvidence.catalogCount > 0,
        localFontLoaded: true,
        publicCaptureBoundary: true,
        restoredSystem: true,
      },
      durationMs: Date.now() - started,
    }
    artifacts.push({
      name: 'result.json',
      bytes: Buffer.from(`${JSON.stringify(result, null, 2)}\n`, 'utf8'),
    })
    await publishArtifactBuffers(output, artifacts)
    return result
  } catch (error) {
    const failure = sanitizedFailure(error, stage, started)
    let screenshotIsPrivate = false
    if (stage === 'font-selector') {
      try {
        await window.webContents.executeJavaScript(fontCaptureInstallScript())
        const privacy = await window.webContents.executeJavaScript(fontCaptureVerifyScript())
        screenshotIsPrivate = !privacy?.safe
      } catch {
        screenshotIsPrivate = true
      }
    }
    try {
      if (screenshotIsPrivate) throw smokeError('VISUAL_FONT_LOAD_FAILED')
      const png = await window.webContents.capturePage().then((image) => image.toPNG())
      parsePngIhdr(png)
      artifacts.push({ name: 'failure.png', bytes: png })
    } catch {
      // The JSON artifact remains sufficient when Chromium cannot capture.
    }
    artifacts.push({
      name: 'failure.json',
      bytes: Buffer.from(`${JSON.stringify(failure, null, 2)}\n`, 'utf8'),
    })
    try {
      await publishArtifactBuffers(output, artifacts)
    } catch {
      // Preserve an existing or partially published path without deleting it.
    }
    throw smokeError(failure.code)
  }
}

async function writeLauncherFailureArtifact(rawOutputPath) {
  return writeFreshLauncherFailure(rawOutputPath, {
    code: 'VISUAL_SMOKE_FAILED',
    stage: 'launcher',
    ok: false,
  })
}

module.exports = {
  CONTENT_SIZE,
  SCREENSHOTS,
  assertVisualGeometry,
  geometryScript,
  isolatedVisualSmokeProfile,
  parsePngIhdr,
  runVideoStyleVisualSmoke,
  sanitizedFailure,
  validateOutputPath: validateFreshOutputPath,
  writeLauncherFailureArtifact,
}
