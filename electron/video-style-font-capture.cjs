'use strict'

async function installPublicFontCapture() {
  const STYLE_ID = 'oks-public-font-capture-style'
  const OVERLAY_ID = 'oks-public-font-capture'
  const LIVE_SELECTOR = '.style-workspace > .video-style-editor'
  const EVENT = 'oks:request-public-font-capture'
  const stateKey = '__oksVisualFontPrivacy'

  const addMarker = (markers, value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text && text !== 'System') markers.add(text)
  }
  const collectNodeMarkers = (node, markers) => {
    if (!(node instanceof Element)) return
    const elements = [node, ...node.querySelectorAll('*')]
    elements.forEach((element) => {
      if (element instanceof HTMLOptionElement && String(element.value).startsWith('local:')) {
        addMarker(markers, element.value)
        addMarker(markers, element.textContent)
      }
      if (element instanceof HTMLInputElement && element.closest('.font-search')) {
        addMarker(markers, element.value)
      }
      if (element.classList.contains('font-selector__sample')) {
        const family = element.style.fontFamily
        if (family.includes('oks-local-')) {
          addMarker(markers, family)
          addMarker(markers, element.textContent)
        }
      }
    })
  }
  const editorForMutation = (mutation) => {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement
    return target?.closest?.(LIVE_SELECTOR) || null
  }
  const hidePrivateEditors = (state) => {
    document.querySelectorAll(LIVE_SELECTOR).forEach((editor) => {
      if (editor === state.boundary && editor.dataset.oksPublicFontCapture === 'ready') return
      collectNodeMarkers(editor, state.markers)
      if (editor.getAttribute('aria-hidden') !== 'true') editor.setAttribute('aria-hidden', 'true')
      if (!editor.hasAttribute('inert')) editor.setAttribute('inert', '')
      if (editor.style.getPropertyValue('visibility') !== 'hidden' ||
          editor.style.getPropertyPriority('visibility') !== 'important') {
        editor.style.setProperty('visibility', 'hidden', 'important')
      }
      if (editor.style.getPropertyValue('pointer-events') !== 'none' ||
          editor.style.getPropertyPriority('pointer-events') !== 'important') {
        editor.style.setProperty('pointer-events', 'none', 'important')
      }
    })
  }
  const mutationViolatesBoundary = (mutation, state) => {
    if (!state.ready) return false
    const editor = editorForMutation(mutation)
    if (editor && editor !== state.boundary) return true
    if (mutation.type === 'characterData' && editor) return true
    if (mutation.type === 'attributes' && editor === state.boundary) return true
    if (mutation.type === 'childList') {
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes]
      if (changedNodes.some((node) => (
        node instanceof Element && node !== state.boundary && (
          node.matches(LIVE_SELECTOR) || node.querySelector(LIVE_SELECTOR)
        )
      ))) return true
      if (changedNodes.some((node) => (
        node === state.boundary ||
        (node instanceof Element && node.contains(state.boundary))
      ))) return true
      if (editor === state.boundary) return true
    }
    return false
  }

  let state = window[stateKey]
  if (!state) {
    state = {
      boundary: null,
      markers: new Set(),
      observer: null,
      ready: false,
      violated: false,
    }
    window[stateKey] = state
  }
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = [
      `${LIVE_SELECTOR}:not([data-oks-public-font-capture="ready"]) {`,
      '  visibility: hidden !important; pointer-events: none !important;',
      '}',
      `${LIVE_SELECTOR}[data-oks-public-font-capture="ready"] {`,
      '  visibility: visible !important;',
      '}',
    ].join('\n')
    document.head.append(style)
  }
  hidePrivateEditors(state)

  if (!state.observer) {
    state.inspectMutations = (mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => collectNodeMarkers(node, state.markers))
        if (mutationViolatesBoundary(mutation, state)) state.violated = true
      })
      hidePrivateEditors(state)
      state.observer.takeRecords()
    }
    state.observer = new MutationObserver((mutations) => state.inspectMutations(mutations))
    state.observer.observe(document.body, {
      attributeOldValue: true,
      attributes: true,
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    })
    state.observer.takeRecords()
  }

  if (!state.ready) window.dispatchEvent(new CustomEvent(EVENT))
  const wait = () => new Promise((resolve) => setTimeout(resolve, 20))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const boundary = document.getElementById(OVERLAY_ID)
    if (
      boundary?.dataset.oksPublicFontCapture === 'ready' &&
      boundary.matches(LIVE_SELECTOR) &&
      boundary.querySelector('.font-selector')
    ) {
      await wait()
      await wait()
      if (document.getElementById(OVERLAY_ID) !== boundary) continue
      boundary.removeAttribute('aria-hidden')
      boundary.removeAttribute('inert')
      boundary.style.setProperty('visibility', 'visible', 'important')
      boundary.style.setProperty('pointer-events', 'none', 'important')
      state.boundary = boundary
      state.ready = true
      hidePrivateEditors(state)
      state.observer.takeRecords()
      return {
        installed: !state.violated,
        liveEditorCount: document.querySelectorAll(LIVE_SELECTOR).length,
      }
    }
    await wait()
  }
  state.violated = true
  return { installed: false, liveEditorCount: document.querySelectorAll(LIVE_SELECTOR).length }
}

function verifyPublicFontCapture() {
  const STYLE_ID = 'oks-public-font-capture-style'
  const OVERLAY_ID = 'oks-public-font-capture'
  const LIVE_SELECTOR = '.style-workspace > .video-style-editor'
  const PUBLIC_TYPEFACES = new Set([
    'system-ui:System UI:',
    'system-monospace:System Monospace:',
  ])
  const PUBLIC_STYLES = new Set([
    'Regular:400:normal',
    'Italic:400:italic',
    'Semi Bold:600:normal',
    'Bold:700:normal',
    'Extra Bold:800:normal',
  ])
  const state = window.__oksVisualFontPrivacy
  const boundary = document.getElementById(OVERLAY_ID)
  const style = document.getElementById(STYLE_ID)
  const liveEditors = [...document.querySelectorAll(LIVE_SELECTOR)]
  const privateEditors = liveEditors.filter((editor) => editor !== boundary)
  const forbiddenPatterns = [/local:/iu, /oks-local-/iu, /local\s*\(/iu]
  const markers = [...(state?.markers || [])]
    .filter((marker) => typeof marker === 'string' && marker)
  const valuesFor = (element) => [
    element.textContent,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('value'),
    element.getAttribute('label'),
    element.getAttribute('style'),
    'value' in element ? String(element.value) : null,
  ].filter(Boolean).join('\n')
  const isVisible = (element) => {
    if (!element || element.hidden) return false
    const computed = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return computed.display !== 'none' && computed.visibility !== 'hidden' &&
      computed.opacity !== '0' && rect.width > 0 && rect.height > 0
  }
  const isPublic = (value) => !forbiddenPatterns.some((pattern) => pattern.test(value)) &&
    markers.every((marker) => !value.includes(marker))
  const privateWasHidden = privateEditors.every((editor) => (
    editor.getAttribute('aria-hidden') === 'true' &&
    editor.hasAttribute('inert') &&
    getComputedStyle(editor).visibility === 'hidden'
  ))
  if (!privateWasHidden && state) state.violated = true
  if (state?.observer && state.inspectMutations) {
    state.inspectMutations(state.observer.takeRecords())
  }
  privateEditors.forEach((editor) => {
    editor.setAttribute('aria-hidden', 'true')
    editor.setAttribute('inert', '')
    editor.style.setProperty('visibility', 'hidden', 'important')
    editor.style.setProperty('pointer-events', 'none', 'important')
  })
  state?.observer?.takeRecords?.()
  const privateHidden = privateEditors.every((editor) => (
    editor.getAttribute('aria-hidden') === 'true' &&
    editor.hasAttribute('inert') &&
    getComputedStyle(editor).visibility === 'hidden'
  ))
  const typefaceValues = boundary
    ? [...boundary.querySelectorAll('.font-selector__columns label:nth-child(1) select option')]
      .map((option) => option.value)
    : []
  const styleValues = boundary
    ? [...boundary.querySelectorAll('.font-selector__columns label:nth-child(2) select option')]
      .map((option) => option.value)
    : []
  const boundaryValues = boundary
    ? [...boundary.querySelectorAll('*'), boundary].map(valuesFor).join('\n')
    : ''
  const sample = boundary?.querySelector('.font-selector__sample')
  const search = boundary?.querySelector('.font-search input')
  const size = boundary?.querySelector('.font-size-field input')
  const sampleFamily = sample ? getComputedStyle(sample).fontFamily : ''
  const publicSample = Boolean(sample) && sample.textContent?.trim() === 'This is System UI' &&
    /system-ui|sans-serif/iu.test(sampleFamily) && isPublic(sampleFamily)

  return {
    safe: Boolean(
      state?.ready && !state.violated && state.observer &&
      state.boundary === boundary && boundary?.isConnected &&
      boundary.dataset.oksPublicFontCapture === 'ready' &&
      !boundary.hasAttribute('inert') && boundary.getAttribute('aria-hidden') !== 'true' &&
      style?.isConnected && isVisible(boundary) && privateHidden &&
      typefaceValues.length === PUBLIC_TYPEFACES.size &&
      typefaceValues.every((value) => PUBLIC_TYPEFACES.has(value)) &&
      styleValues.length === PUBLIC_STYLES.size &&
      styleValues.every((value) => PUBLIC_STYLES.has(value)) &&
      search?.value === 'System' && size?.value === '82' &&
      isPublic(boundaryValues) && publicSample
    ),
    liveEditorCount: liveEditors.length,
    publicTypefaceCount: typefaceValues.length,
    publicStyleCount: styleValues.length,
    checks: {
      boundaryIdentity: state?.boundary === boundary,
      boundaryVisible: isVisible(boundary),
      privateHidden,
      publicSample,
      publicValues: isPublic(boundaryValues),
      ready: state?.ready === true,
      stable: state?.violated === false,
    },
  }
}

function fontCaptureInstallScript() {
  return `(${installPublicFontCapture.toString()})()`
}

function fontCaptureVerifyScript() {
  return `(${verifyPublicFontCapture.toString()})()`
}

module.exports = {
  fontCaptureInstallScript,
  fontCaptureVerifyScript,
  installPublicFontCapture,
  verifyPublicFontCapture,
}
