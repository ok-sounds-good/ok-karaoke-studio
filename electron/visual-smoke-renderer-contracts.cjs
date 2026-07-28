'use strict'

// Acceptance-only renderer evaluation scripts and fail-closed result contracts.
// Production startup, preload, and renderer code never import this module.
const { VIEWPORT } = require('../scripts/visual-result-validation.cjs')

const PACKAGED_APP_URL = 'studio-app://app/index.html'
const STYLE_SESSION_READINESS_TIMEOUT_MS = 10_000
const STYLE_TEMPLATE_NAME = 'Smoke 158'
const TIMELINE_DENSITY_TITLE = 'Timeline Density 5000'
const TIMELINE_DENSITY_TRACK_COUNT = 8
const TIMELINE_DENSITY_WORDS_PER_TRACK = 625
const TIMELINE_DENSITY_WORD_COUNT = TIMELINE_DENSITY_TRACK_COUNT * TIMELINE_DENSITY_WORDS_PER_TRACK
const TIMELINE_DENSITY_DOM_CAP_PER_TRACK = 96
const TIMELINE_DENSITY_OPEN_MARKER = 'oksTimelineDensityTrustedOpen'
const STYLE_DESTINATION_STATE_SCRIPT = `(() => {
  const selected = document.querySelector('[role="tab"][aria-selected="true"][data-style-destination]')
  const destination = selected?.getAttribute('data-style-destination')
  return destination === 'lyrics' || destination === 'stage-frame' ? destination : null
})()`
const STYLE_KEY_SEQUENCE = Object.freeze([
  'Tab',
  'Tab',
  'Shift+Tab',
  'Tab',
  'Left',
  'Shift+Tab',
  'Tab',
  'Up',
  'Shift+Tab',
  'Tab',
  'Right',
  'Right',
  'Up',
  'Down',
  'Tab',
  'Tab',
  'Escape',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
])
const LAYOUT_REACHABILITY_SELECTORS = Object.freeze({
  base: Object.freeze([
    {
      name: 'style',
      selector: 'button.style-button[aria-label="Edit project Style"]',
      required: true,
      requiredInViewport: true,
      focusScroll: false,
    },
    {
      name: 'newProject',
      selector: 'button[aria-label="New project"]',
      required: true,
      requiredInViewport: true,
      focusScroll: true,
    },
    {
      name: 'openProject',
      selector: 'button[aria-label="Open project"]',
      required: true,
      requiredInViewport: true,
      focusScroll: true,
    },
    {
      name: 'saveProject',
      selector: 'button[aria-label="Save project"]',
      required: true,
      requiredInViewport: true,
      focusScroll: true,
    },
    {
      name: 'workflow',
      selector: 'button.workflow-button',
      required: true,
      requiredInViewport: true,
      focusScroll: true,
    },
    {
      name: 'export',
      selector: 'button',
      text: 'Export',
      required: true,
      requiredInViewport: true,
      focusScroll: true,
    },
    {
      name: 'play',
      selector: 'button.play-button',
      required: true,
      requiredInViewport: true,
    },
    {
      name: 'playbackSpeed',
      selector: 'select[aria-label="Playback speed"]',
      required: true,
      requiredInViewport: true,
    },
    {
      name: 'volume',
      selector: 'input[aria-label="Volume"]',
      required: true,
      requiredInViewport: true,
    },
    {
      name: 'timelineZoom',
      selector: 'input[aria-label="Timeline zoom"]',
      required: true,
      requiredInViewport: false,
      focusScroll: true,
    },
    {
      name: 'lyricTiming',
      selector: 'section.timeline-panel[aria-label="Lyric Timing"]',
      required: true,
      requiredInViewport: true,
      focusScroll: false,
    },
    {
      name: 'preview',
      selector: '[aria-label="Karaoke preview"]',
      required: true,
      requiredInViewport: true,
      focusScroll: false,
    },
    {
      name: 'openingTiming',
      selector: 'aside[aria-label="Project inspector"] [aria-label="Opening lead-in seconds"]',
      required: true,
      requiredInViewport: true,
      focusScroll: false,
    },
  ]),
  style: Object.freeze([
    {
      name: 'styleSession',
      selector: '.style-workspace[role="dialog"]',
      required: true,
      requiredInViewport: true,
      focusScroll: false,
    },
    {
      name: 'stylePreview',
      selector: '[aria-label$=" design preview"]',
      required: true,
      requiredInViewport: true,
      focusScroll: false,
    },
    {
      name: 'previewTime',
      selector: '[aria-label$=" Preview Time"]',
      optional: true,
      requiredInViewport: false,
      focusScroll: true,
    },
    {
      name: 'syncAidMinimumLead',
      selector: '[aria-label$=" Sync Aid Minimum lead"]',
      optional: true,
      requiredInViewport: false,
      focusScroll: true,
    },
    {
      name: 'syncAidMaximumLead',
      selector: '[aria-label$=" Sync Aid Maximum lead"]',
      optional: true,
      requiredInViewport: false,
      focusScroll: true,
    },
  ]),
})

function selectLayoutReachabilityTargets(includeStyle) {
  return includeStyle
    ? [...LAYOUT_REACHABILITY_SELECTORS.style]
    : [...LAYOUT_REACHABILITY_SELECTORS.base]
}

function layoutReachabilityScript(viewport, includeStyleTargets = false) {
  const layoutTargets = selectLayoutReachabilityTargets(includeStyleTargets)
  return `(() => {
    const expected = ${JSON.stringify({
      width: viewport.width,
      height: viewport.height,
      targets: layoutTargets,
    })}
    const viewport = { width: expected.width, height: expected.height }
    if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) ||
      viewport.width <= 0 || viewport.height <= 0)
      return { valid: false, profile: 'layout-reachability', message: 'invalid viewport' }
    if (document.documentElement.clientWidth < viewport.width ||
      document.documentElement.clientHeight < viewport.height) return {
      valid: false,
      profile: 'layout-reachability',
      message: 'viewport mismatch',
    }
    const controls = {}
    const findByText = (selector) => {
      const root = selector.parentSelector ? document.querySelector(selector.parentSelector) : document
      const tag = selector.tagName ?? 'button'
      const target = (root?.querySelectorAll?.(tag) ?? [])
      for (const candidate of target) {
        if (candidate instanceof HTMLElement && candidate.textContent?.trim() === selector.text) return candidate
      }
      return null
    }
    const resolveTarget = (definition) => {
      if (definition.text) return findByText(definition)
      const target = document.querySelector(definition.selector)
      return target instanceof HTMLElement ? target : null
    }
    const containmentTolerance = 1
    const inRect = (rect, container) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= container.left - containmentTolerance &&
      rect.top >= container.top - containmentTolerance &&
      rect.right <= container.right + containmentTolerance &&
      rect.bottom <= container.bottom + containmentTolerance
    const viewportRect = Object.freeze({ left: 0, top: 0, right: viewport.width, bottom: viewport.height })
    const overflowModes = Object.freeze(['auto', 'scroll', 'hidden', 'clip', 'overlay'])
    const scrollModes = Object.freeze(['auto', 'scroll', 'overlay'])
    const scrollportState = (node) => {
      if (!node || !(node instanceof HTMLElement)) return null
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        className: typeof node.className === 'string' ? node.className : '',
        overflowX: style.overflowX || style.overflow,
        overflowY: style.overflowY || style.overflow,
        rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top },
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
        tagName: node.tagName.toLowerCase(),
      }
    }
    const collectReachability = (node, definition) => {
      const initialRect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      const visibility = style.visibility === 'visible' && style.display !== 'none'
      const visible = initialRect.width > 0 && initialRect.height > 0 && visibility
      let nearestScrollport = null
      const overflowState = (rect) => {
        let ancestor = node.parentElement
        let clipped = false
        while (ancestor && ancestor instanceof Element && ancestor !== document.documentElement) {
          const ancestorStyle = getComputedStyle(ancestor)
          const overflowX = ancestorStyle.overflowX || ancestorStyle.overflow
          const overflowY = ancestorStyle.overflowY || ancestorStyle.overflow
          const overflowAncestor = overflowModes.includes(overflowX) || overflowModes.includes(overflowY)
          if (overflowAncestor) {
            const ancestorRect = ancestor.getBoundingClientRect()
            if (
              rect.left < ancestorRect.left - containmentTolerance ||
              rect.right > ancestorRect.right + containmentTolerance ||
              rect.top < ancestorRect.top - containmentTolerance ||
              rect.bottom > ancestorRect.bottom + containmentTolerance
            )
              clipped = true
            if (!nearestScrollport && (scrollModes.includes(overflowX) || scrollModes.includes(overflowY)))
              nearestScrollport = ancestor
          }
          if (ancestor === document.body) break
          ancestor = ancestor.parentElement
        }
        return clipped
      }
      const clippedByOverflow = overflowState(initialRect)
      let focused = false
      let focusedInViewport = false
      let focusedInScrollport = false
      let focusChangedScroll = false
      let clippedByOverflowAfterFocus = clippedByOverflow
      let scrollportAfter = null
      const scrollportBefore = scrollportState(nearestScrollport)
      if (definition.focusScroll) {
        try {
          node.focus({ preventScroll: false })
        } catch {}
        focused = document.activeElement === node
        const afterRect = node.getBoundingClientRect()
        clippedByOverflowAfterFocus = overflowState(afterRect)
        focusedInViewport = focused && inRect(afterRect, viewportRect)
        scrollportAfter = scrollportState(nearestScrollport)
        focusedInScrollport = !scrollportAfter || (focused && inRect(afterRect, scrollportAfter.rect))
        focusChangedScroll = Boolean(
          scrollportBefore &&
            scrollportAfter &&
            (scrollportBefore.scrollLeft !== scrollportAfter.scrollLeft ||
              scrollportBefore.scrollTop !== scrollportAfter.scrollTop),
        )
        if (nearestScrollport && scrollportBefore) {
          nearestScrollport.scrollLeft = scrollportBefore.scrollLeft
          nearestScrollport.scrollTop = scrollportBefore.scrollTop
        }
      }
      const inView = inRect(initialRect, viewportRect)
      return {
        clippedByOverflow,
        clippedByOverflowAfterFocus,
        exists: true,
        focusScroll: definition.focusScroll === true,
        focusChangedScroll,
        focused,
        focusedInViewport,
        focusedInScrollport,
        focusedInitially: inView && visible && !clippedByOverflow,
        inViewport: inView && visible,
        name: definition.name,
        selector: definition.selector ?? null,
        scrollportAfter,
        scrollportBefore,
        visible,
      }
    }
    for (const definition of expected.targets) {
      const element = resolveTarget(definition)
      if (!element) {
        controls[definition.name] = { exists: false, required: definition.required === true, optional: definition.optional === true }
        continue
      }
      controls[definition.name] = collectReachability(element, definition)
    }
    const workspace = document.querySelector('.unified-workspace')
    const stage = document.querySelector('#workspace-stage-region')
    const divider = document.querySelector('[role="separator"][aria-label="Stage Monitor and Lyric Timing height"]')
    const timingRegion = document.querySelector('#workspace-timing-region')
    const timing = document.querySelector('section.timeline-panel[aria-label="Lyric Timing"]')
    const timelineViewport = timing?.querySelector('.timeline-viewport')
    const workspaceStyle = workspace instanceof HTMLElement ? getComputedStyle(workspace) : null
    const timingStyle = timing instanceof HTMLElement ? getComputedStyle(timing) : null
    const viewportStyle = timelineViewport instanceof HTMLElement ? getComputedStyle(timelineViewport) : null
    const workspaceScrollModes = ['auto', 'scroll', 'overlay']
    const ariaNumber = (attribute) => {
      const raw = divider instanceof HTMLElement ? divider.getAttribute(attribute) : null
      if (typeof raw !== 'string' || raw.trim() === '') return { raw, value: null }
      const value = Number(raw)
      return { raw, value: Number.isFinite(value) ? value : null }
    }
    const dividerMinimum = ariaNumber('aria-valuemin')
    const dividerMaximum = ariaNumber('aria-valuemax')
    const dividerValue = ariaNumber('aria-valuenow')
    const bounds = (node) => node instanceof HTMLElement ? node.getBoundingClientRect() : null
    const workspaceBounds = bounds(workspace)
    const stageBounds = bounds(stage)
    const dividerBounds = bounds(divider)
    const timingBounds = bounds(timing)
    const cssNumber = (property) => {
      const value = Number.parseFloat(workspaceStyle?.getPropertyValue(property) || '')
      return Number.isFinite(value) ? value : 0
    }
    const workspaceGeometry = workspace instanceof HTMLElement && stageBounds
      ? {
          dividerSize: cssNumber('--workspace-divider-size'),
          paddingBottom: cssNumber('padding-bottom'),
          paddingTop: cssNumber('padding-top'),
          rootHeight: workspace.clientHeight,
          stageHeight: stageBounds.height,
          stageMinimum: cssNumber('--workspace-top-min'),
          timingMinimum: cssNumber('--workspace-timing-min'),
        }
      : null
    const verticallyContained = (rect) =>
      rect && workspaceBounds && rect.top >= workspaceBounds.top && rect.bottom <= workspaceBounds.bottom
    const workspaceContract = {
      dividerValue: dividerValue.value,
      dividerValueRaw: dividerValue.raw,
      maximum: dividerMaximum.value,
      maximumRaw: dividerMaximum.raw,
      minimum: dividerMinimum.value,
      minimumRaw: dividerMinimum.raw,
      geometry: workspaceGeometry,
      ordered: stage?.nextElementSibling === divider && divider?.nextElementSibling === timingRegion,
      orientation: divider?.getAttribute('aria-orientation') === 'horizontal',
      present: workspace instanceof HTMLElement &&
        stage instanceof HTMLElement &&
        divider instanceof HTMLElement &&
        timingRegion instanceof HTMLElement &&
        timing instanceof HTMLElement,
      timingBounded: verticallyContained(timingBounds) && !workspaceScrollModes.includes(timingStyle?.overflowY),
      timingViewportScrolls: timelineViewport instanceof HTMLElement &&
        (workspaceScrollModes.includes(viewportStyle?.overflowX) || workspaceScrollModes.includes(viewportStyle?.overflowY)),
      unclipped: verticallyContained(stageBounds) && verticallyContained(dividerBounds) && verticallyContained(timingBounds) &&
        !workspaceScrollModes.includes(workspaceStyle?.overflowY),
      valueText: divider instanceof HTMLElement ? divider.getAttribute('aria-valuetext') : null,
    }
    return {
      controlNames: expected.targets.map((control) => control.name),
      controls,
      viewport,
      valid: true,
      windowHeight: document.documentElement.clientHeight,
      windowWidth: document.documentElement.clientWidth,
      workspace: workspaceContract,
    }
  })()`
}

function validLayoutReachabilityState(value, viewport, options = {}) {
  const includeStyleTargets = options.includeStyleTargets === true
  const expectedTargets = selectLayoutReachabilityTargets(includeStyleTargets)
  if (
    !value ||
    value.valid !== true ||
    value.windowWidth !== viewport.width ||
    value.windowHeight !== viewport.height ||
    !Number.isSafeInteger(viewport.width) ||
    !Number.isSafeInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    typeof value.controls !== 'object' ||
    value.controls === null ||
    (!includeStyleTargets && !validWorkspaceReachabilityState(value.workspace)) ||
    !Array.isArray(value.controlNames) ||
    value.controlNames.length !== expectedTargets.length
  )
    return false
  for (const target of expectedTargets) {
    const sample = value.controls[target.name]
    if (!sample) return false
    if (target.required && sample.exists !== true) return false
    if (sample.exists !== true && sample.optional !== true) return false
    if (!sample.exists) continue
    if (sample.visible !== true) return false
    if (target.requiredInViewport && options.requireInitialViewport !== false) {
      if (sample.inViewport !== true || sample.clippedByOverflow !== false) return false
    }
    if (typeof sample.inViewport !== 'boolean' || typeof sample.exists !== 'boolean') return false
    if (typeof sample.clippedByOverflow !== 'boolean') return false
    if (
      target.focusScroll &&
      (sample.focusScroll !== true ||
        sample.focused !== true ||
        sample.focusedInViewport !== true ||
        sample.focusedInScrollport !== true ||
        sample.clippedByOverflowAfterFocus !== false)
    )
      return false
    if (!target.focusScroll && sample.clippedByOverflow !== false) return false
    if (
      target.focusScroll &&
      requiresLocalScrollport(target) &&
      !sample.scrollportBefore &&
      !sample.scrollportAfter
    )
      return false
    if (target.focusScroll && sample.scrollportBefore) {
      if (!scrollportSample(sample.scrollportBefore) || !scrollportSample(sample.scrollportAfter))
        return false
      if (
        !scrollMode(sample.scrollportBefore.overflowX) &&
        !scrollMode(sample.scrollportBefore.overflowY)
      )
        return false
    }
  }
  return true
}

function validWorkspaceReachabilityState(workspace) {
  if (
    !workspace ||
    workspace.present !== true ||
    workspace.ordered !== true ||
    workspace.orientation !== true ||
    workspace.timingBounded !== true ||
    workspace.timingViewportScrolls !== true ||
    workspace.unclipped !== true
  )
    return false
  const values = [
    ['minimum', 'minimumRaw'],
    ['maximum', 'maximumRaw'],
    ['dividerValue', 'dividerValueRaw'],
  ]
  for (const [valueKey, rawKey] of values) {
    const raw = workspace[rawKey]
    if (typeof raw !== 'string' || raw.trim() === '') return false
    const numericRaw = Number(raw)
    if (
      !Number.isFinite(numericRaw) ||
      !Number.isFinite(workspace[valueKey]) ||
      numericRaw !== workspace[valueKey]
    )
      return false
  }
  const expected = workspaceDividerValues(workspace.geometry)
  if (
    !expected ||
    workspace.minimum !== expected.minimum ||
    workspace.maximum !== expected.maximum ||
    workspace.dividerValue !== expected.dividerValue ||
    workspace.valueText !== expected.valueText
  )
    return false
  return (
    workspace.minimum >= 0 &&
    workspace.maximum <= 100 &&
    workspace.minimum < workspace.maximum &&
    workspace.minimum <= workspace.dividerValue &&
    workspace.dividerValue <= workspace.maximum
  )
}

function workspaceDividerValues(geometry) {
  if (!geometry || typeof geometry !== 'object') return null
  const keys = [
    'dividerSize',
    'paddingBottom',
    'paddingTop',
    'rootHeight',
    'stageHeight',
    'stageMinimum',
    'timingMinimum',
  ]
  if (keys.some((key) => !Number.isFinite(geometry[key]) || geometry[key] < 0)) return null
  const contentHeight = geometry.rootHeight - geometry.paddingTop - geometry.paddingBottom
  const availableHeight = Math.max(0, contentHeight - geometry.dividerSize)
  const maximumHeight = Math.max(0, availableHeight - geometry.timingMinimum)
  const minimumHeight = Math.min(geometry.stageMinimum, maximumHeight)
  const ratioForHeight = (height) =>
    availableHeight <= 0 ? 0 : Math.min(1, Math.max(0, height / availableHeight))
  const minimum = Math.round(ratioForHeight(minimumHeight) * 100)
  const maximum = Math.round(ratioForHeight(maximumHeight) * 100)
  const dividerValue = Math.round(ratioForHeight(geometry.stageHeight) * 100)
  return {
    dividerValue,
    maximum,
    minimum,
    valueText: `${dividerValue}% Stage Monitor height; ${100 - dividerValue}% Lyric Timing height`,
  }
}

function requiresLocalScrollport(target) {
  return ['newProject', 'openProject', 'saveProject'].includes(target.name)
}

function scrollMode(value) {
  return value === 'auto' || value === 'scroll' || value === 'overlay'
}

function scrollportSample(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.overflowX === 'string' &&
    typeof value.overflowY === 'string' &&
    Number.isFinite(value.scrollLeft) &&
    Number.isFinite(value.scrollTop) &&
    value.rect &&
    ['left', 'top', 'right', 'bottom'].every((key) => Number.isFinite(value.rect[key])),
  )
}
const STYLE_KEY_FOCUS = Object.freeze([
  'master',
  'role:brand',
  'master',
  'role:brand',
  'role:footer',
  'master',
  'role:footer',
  'role:clock',
  'master',
  'role:clock',
  'role:footer',
  'role:brand',
  'role:footer',
  'role:brand',
  'visibility',
  'typeface',
  'face:Regular',
  'face:Italic',
  'face:Semi Bold',
  'face:Bold',
  'face:Extra Bold',
  'size',
  'color',
])
const STYLE_KEY_CHANGES = Object.freeze(['footer', 'clock', 'footer', 'brand', 'footer', 'brand'])
const STUDIO_BRIDGE_KEYS = Object.freeze(
  'cancelVideoExport,chooseBackgroundImage,createStyleTemplate,deleteStyleTemplate,exportText,exportVideo,getBackgroundState,getPendingWindowClose,importAudio,importLrc,listStyleTemplates,onMenuAction,onVideoExportProgress,onWindowCloseRequest,openProject,releaseAudio,releaseBackground,releaseBackgroundSnapshot,renameStyleTemplate,resetProjectScope,resolveProjectAudio,resolveProjectBackground,resolveStyleTemplateBackground,resolveWindowClose,retainBackground,saveProject,settleBackgroundImage,settleProjectOpen'.split(
    ',',
  ),
)

const STABLE_RENDERER_SCRIPT = `(() => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const sample = () => {
    const root = document.getElementById('root')
    const bounds = root?.getBoundingClientRect()
    return {
      bodyHeight: document.body?.scrollHeight ?? -1,
      bodyWidth: document.body?.scrollWidth ?? -1,
      rootChildren: root?.childElementCount ?? 0,
      rootHeight: bounds?.height ?? -1,
      rootWidth: bounds?.width ?? -1,
    }
  }
  return (async () => {
    await document.fonts?.ready
    await Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return Promise.resolve()
      return image.decode?.().catch(() => undefined) ?? Promise.resolve()
    }))
    await frame()
    await frame()
    const first = sample()
    await delay(120)
    await frame()
    await frame()
    const second = sample()
    const bridge = window.studio
    const bridgeKeys = bridge && typeof bridge === 'object' ? Object.keys(bridge).sort() : []
    const bridgeFunctions = bridgeKeys.every((key) => typeof bridge[key] === 'function')
    let ipcReady = false
    try {
      ipcReady = (await bridge?.getPendingWindowClose?.()) === null
    } catch {}
    return {
      bridgeFrozen: Object.isFrozen(bridge),
      bridgeFunctions,
      bridgeKeys,
      devicePixelRatio: window.devicePixelRatio,
      height: document.documentElement.clientHeight,
      href: window.location.href,
      ipcReady,
      nodeAccess: typeof window.process !== 'undefined' || typeof window.require !== 'undefined',
      readyState: document.readyState,
      rootChildren: second.rootChildren,
      stable: JSON.stringify(first) === JSON.stringify(second),
      width: document.documentElement.clientWidth,
    }
  })()
})()`

const STYLE_TARGET_SCRIPT = `(() => new Promise((resolve) => {
  const mutationObserver = new MutationObserver(() => check())
  const resizeObserver = new ResizeObserver(() => check())
  let checking = false
  let finished = false
  const sample = () => {
    const root = document.getElementById('root')
    const workspace = document.querySelector('.style-workspace[role="dialog"]')
    const target = document.querySelector(
      'button.style-button[aria-label="Edit project Style"]',
    )
    if (workspace || !(target instanceof HTMLButtonElement) || !root?.childElementCount) return null
    const bounds = target.getBoundingClientRect()
    const style = getComputedStyle(target)
    if (
      target.disabled ||
      target.getAttribute('aria-disabled') === 'true' ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      style.display === 'none' ||
      style.pointerEvents === 'none' ||
      style.visibility !== 'visible'
    ) return null
    return {
      boundsHeight: bounds.height,
      boundsWidth: bounds.width,
      height: document.documentElement.clientHeight,
      href: window.location.href,
      readyState: document.readyState,
      width: document.documentElement.clientWidth,
      x: Math.round(bounds.left + bounds.width / 2),
      y: Math.round(bounds.top + bounds.height / 2),
    }
  }
  const finish = (value) => {
    if (finished) return
    finished = true
    mutationObserver.disconnect()
    resizeObserver.disconnect()
    resolve(value)
  }
  function check() {
    if (checking || finished) return
    checking = true
    requestAnimationFrame(() => requestAnimationFrame(() => {
      checking = false
      const first = sample()
      requestAnimationFrame(() => {
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      })
    }))
  }
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  })
  resizeObserver.observe(document.documentElement)
  check()
}))()`

const STYLE_KEY_RECORDER_SCRIPT = `(() => {
  const storage = '__oksStyleKeyboardRecorder'
  if (globalThis[storage]) return false
  const focus = []
  const changes = []
  const describe = (target) => {
    if (!(target instanceof HTMLElement)) return null
    if (target.matches('[aria-label="Show Stage frame in output"]')) return 'master'
    if (target.matches('input[type="radio"]')) return 'role:' + target.value
    const label = target.getAttribute('aria-label')
    if (label === 'Show Brand in output') return 'visibility'
    if (label === 'Brand typeface') return 'typeface'
    if (label?.startsWith('Brand face ')) return 'face:' + label.slice(11)
    if (label === 'Brand font size') return 'size'
    if (label === 'Brand color') return 'color'
    return target.dataset.styleAction ?? null
  }
  const onFocus = (event) => {
    const value = describe(event.target)
    if (value) focus.push(value)
  }
  const onChange = (event) => {
    const target = event.target
    const roles = [...document.querySelectorAll(
      '[aria-label="Stage frame role"] input[type="radio"]',
    )]
    if (target instanceof HTMLInputElement && roles.includes(target)) changes.push({
      active: document.activeElement === target,
      checked: target.checked,
      checkedCount: roles.filter((role) => role.checked).length,
      role: target.value,
    })
  }
  document.addEventListener('focusin', onFocus, true)
  document.addEventListener('change', onChange, true)
  globalThis[storage] = { changes, focus, dispose() {
    document.removeEventListener('focusin', onFocus, true)
    document.removeEventListener('change', onChange, true)
  } }
  return true
})()`

const STYLE_DESTINATION_SCROLL_TOPS = Object.freeze({
  'title-card': 91,
  templates: 0,
})

function styleDestinationLayoutScript(destination, expectedScrollTop = 0, setScrollTop = false) {
  if (
    !Object.hasOwn(STYLE_DESTINATION_SCROLL_TOPS, destination) ||
    !Number.isSafeInteger(expectedScrollTop) ||
    expectedScrollTop < 0 ||
    expectedScrollTop > 10_000 ||
    typeof setScrollTop !== 'boolean'
  )
    throw readinessError()
  return `(() => {
    const destination = ${JSON.stringify(destination)}
    const expectedScrollTop = ${expectedScrollTop}
    const setScrollTop = ${setScrollTop}
    const workspace = document.querySelector('.style-workspace[role="dialog"]')
    const tab = workspace?.querySelector('[role="tab"][data-style-destination="' + destination + '"]')
    const panelId = tab?.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null
    const panels = [...(workspace?.querySelectorAll('[role="tabpanel"]') ?? [])]
    const activeElement = document.activeElement
    const panelRect = panel?.getBoundingClientRect()
    const heading = panel?.querySelector('.style-destination-heading')
    const headingRect = heading?.getBoundingClientRect()
    if (setScrollTop && panel instanceof HTMLElement) panel.scrollTop = expectedScrollTop
    const bounds = (rect) =>
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth &&
      rect.bottom <= window.innerHeight
    const activePanel = panels.find((candidate) => !candidate.hidden)
    const focusInHiddenPanel = panels.some(
      (candidate) => candidate.hidden && candidate.contains(activeElement),
    )
    const activeTab = workspace?.querySelector('[role="tab"][aria-selected="true"]')
    return {
      activePanel: activePanel?.id ?? null,
      activeTab: activeTab?.getAttribute('data-style-destination') ?? null,
      clientHeight: panel?.clientHeight ?? 0,
      contentBounded:
        panel instanceof HTMLElement && panel.scrollWidth <= panel.clientWidth,
      focusOwnsDestination: activeElement === tab,
      headingBounded: bounds(headingRect),
      hiddenPanelFocus: focusInHiddenPanel,
      panelBounded: bounds(panelRect),
      scrollHeight: panel?.scrollHeight ?? 0,
      scrollTop: panel?.scrollTop ?? -1,
      selected: tab?.getAttribute('aria-selected') === 'true',
    }
  })()`
}

const STYLE_KEY_RESULT_SCRIPT = `(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const storage = '__oksStyleKeyboardRecorder'
    const recorder = globalThis[storage]
    const undo = document.querySelector('[aria-label="Undo"]')
    const redo = document.querySelector('[aria-label="Redo"]')
    const result = recorder ? { changes: [...recorder.changes], focus: [...recorder.focus],
      closed: !document.querySelector('.style-workspace[role="dialog"]'),
      clean: !document.querySelector('[title="Unsaved changes"]'),
      redoDisabled: redo instanceof HTMLButtonElement && redo.disabled,
      undoDisabled: undo instanceof HTMLButtonElement && undo.disabled } : null
    recorder?.dispose()
    delete globalThis[storage]
    resolve(result)
  }))
}))()`

function projectLyricsReadinessScript(viewport, contract = { kind: 'project-lyrics' }) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const contract = ${JSON.stringify(contract)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    let checking = false
    let finished = false
    let rerun = false
    const resizeObserver = new ResizeObserver(() => schedule())
    const mutationObserver = new MutationObserver(() => schedule())
    const fontSet = document.fonts
    const fitFixture = document.createElement('div')
    fitFixture.className = 'style-destination-tabs'
    fitFixture.setAttribute('aria-hidden', 'true')
    fitFixture.style.cssText = 'position:fixed;left:0;top:0;width:330px;visibility:hidden;pointer-events:none'
    fitFixture.style.setProperty('--style-destination-count', '5')
    for (const label of ['Lyrics', 'Background', 'Title card', 'Stage frame', 'Templates']) {
      const button = document.createElement('button')
      button.textContent = label
      fitFixture.append(button)
    }
    document.body.append(fitFixture)

    const sixDestinationsFit = () => {
      const fixtureBounds = fitFixture.getBoundingClientRect()
      const buttons = [...fitFixture.querySelectorAll('button')]
      const bounds = buttons.map((button) => button.getBoundingClientRect())
      const rowTops = new Set(bounds.map((box) => box.top))
      return fixtureBounds.width === 330 && fitFixture.scrollWidth <= fitFixture.clientWidth &&
        bounds.length === 5 && rowTops.size === 2 && bounds.every((box) =>
          box.left >= fixtureBounds.left && box.right <= fixtureBounds.right) &&
        buttons.every((button) => button.scrollWidth <= button.clientWidth)
    }

    const sampleBackground = () => {
      const applied = contract.applied === true
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-background-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="background"]')
      const preview = document.querySelector(
        applied ? '[aria-label="Karaoke preview"]' : '[aria-label="Lyrics design preview"]',
      )
      const stage = preview?.querySelector('.karaoke-stage')
      const mode = stage?.getAttribute('data-background-mode')
      const colors = {
        gradientEndColor: stage?.getAttribute('data-background-gradient-end-color'),
        gradientStartColor: stage?.getAttribute('data-background-gradient-start-color'),
        solidColor: stage?.getAttribute('data-background-solid-color'),
      }
      if (
        !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
        mode !== contract.mode || Object.values(colors).some((color) => !/^#[0-9a-f]{6}$/iu.test(color)) ||
        (contract.colors && Object.entries(contract.colors).some(([key, value]) => colors[key] !== value)) ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning')
      ) return null
      if (applied) {
        const trigger = document.querySelector('button.style-button[aria-label="Edit project Style"]')
        if (workspace || !(trigger instanceof HTMLButtonElement) || stage.classList.contains('is-designing')) return null
      } else {
        const radios = panel?.querySelectorAll('input[type="radio"]') ?? []
        const colorLabels = [...(panel?.querySelectorAll('input[type="color"]') ?? [])]
          .map((input) => input.getAttribute('aria-label'))
        const expectedLabels = mode === 'solid'
          ? ['Background solid color']
          : ['Background gradient start color', 'Background gradient end color']
        if (
          !(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          radios.length !== 3 || colorLabels.join('|') !== expectedLabels.join('|')
        ) return null
      }
      const hexRgb = (hex) => {
        const value = Number.parseInt(hex.slice(1), 16)
        return 'rgb(' + ((value >> 16) & 255) + ', ' + ((value >> 8) & 255) + ', ' +
          (value & 255) + ')'
      }
      const style = getComputedStyle(stage)
      const css = mode === 'solid' ? style.backgroundColor : style.backgroundImage
      const expectedCss = mode === 'solid'
        ? hexRgb(colors.solidColor)
        : 'linear-gradient(145deg, ' + hexRgb(colors.gradientStartColor) + ', ' +
          hexRgb(colors.gradientEndColor) + ')'
      const bounds = stage.getBoundingClientRect()
      const actions = applied ? [] : [
        panel.querySelector('fieldset'),
        workspace.querySelector('[data-style-action="cancel"]'),
        workspace.querySelector('[data-style-action="apply"]'),
      ]
      if (
        css.replace(/\s/gu, '') !== expectedCss.replace(/\s/gu, '') ||
        bounds.width <= 0 || bounds.height <= 0 || Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        actions.some((element) => {
          const box = element?.getBoundingClientRect()
          return !box || box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 ||
            box.right > expected.width || box.bottom > expected.height
        })
      ) return null
      return { applied, ...colors, css, height: expected.height, mode, resourcesReady: true,
        stageHeight: bounds.height, stageWidth: bounds.width, width: expected.width }
    }

    const sampleTitleCard = () => {
      const applied = contract.applied === true
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-title-card-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="title-card"]')
      const preview = document.querySelector(
        applied ? '[aria-label="Karaoke preview"]' : '[aria-label="Title card design preview"]',
      )
      const stage = preview?.querySelector('.karaoke-stage')
      const card = stage?.querySelector('.title-card')
      const role = card?.querySelector('[data-title-card-design-role="' + contract.role + '"]')
      const status = card?.querySelector('.title-card-design-status')
      const eyebrow = card?.querySelector('[data-title-card-role="eyebrow"]')
      const title = card?.querySelector('[data-title-card-role="title"]')
      const artist = card?.querySelector('[data-title-card-role="artist"]')
      const bounds = stage?.getBoundingClientRect()
      if (!(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
        !(card instanceof HTMLElement) || !(title instanceof HTMLElement) ||
        !bounds || bounds.width <= 0 || Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        stage.querySelector('.active-lines, .sync-aid')) return null
      if (applied) {
        if (workspace || stage.classList.contains('is-designing') || eyebrow || artist || status) return null
      } else {
        const selected = panel?.querySelector('input[value="' + contract.role + '"]')
        const visibility = panel?.querySelector('[aria-label="Show ' +
          contract.role[0].toUpperCase() + contract.role.slice(1) + ' in output"]')
        const hidden = contract.role === 'eyebrow' ? contract.eyebrowHidden : contract.artistHidden
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(selected instanceof HTMLInputElement) || !selected.checked ||
          !(visibility instanceof HTMLInputElement) || visibility.checked === hidden ||
          !(role instanceof HTMLElement) || (hidden !== (role.dataset.hiddenOutput === 'true')) ||
          (hidden !== (status?.textContent === 'Hidden in output')) ||
          (contract.eyebrowHidden && contract.role !== 'eyebrow' ? Boolean(eyebrow) : !eyebrow) ||
          (contract.artistHidden && contract.role !== 'artist' ? Boolean(artist) : !artist) ||
          workspace.querySelectorAll('.style-editor__body').length !== 1 || !sixDestinationsFit()) return null
      }
      return { applied, height: expected.height,
        position: role instanceof HTMLElement ? role.getAttribute('aria-label') : null,
        resourcesReady: true, role: contract.role, stageHeight: bounds.height,
        stageWidth: bounds.width, width: expected.width }
    }

    const sampleStageFrame = () => {
      const applied = contract.applied === true
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-stage-frame-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="stage-frame"]')
      const preview = document.querySelector(
        applied ? '[aria-label="Karaoke preview"]' : '[aria-label="Stage frame design preview"]',
      )
      const stage = preview?.querySelector('.karaoke-stage')
      const line = stage?.querySelector('[data-stage-frame-line]')
      const brand = stage?.querySelector('[data-stage-frame-role="brand"]')
      const clock = stage?.querySelector('[data-stage-frame-role="clock"]')
      const footer = stage?.querySelector('[data-stage-frame-role="footer"]')
      const status = preview?.querySelectorAll('[data-stage-frame-output-status]') ?? []
      const bounds = stage?.getBoundingClientRect()
      const lineColor = stage?.style.getPropertyValue('--stage-frame-color')
      const lineWidth = stage?.style.getPropertyValue('--stage-frame-width')
      const brandStyle = brand?.getAttribute('style')
      const clockStyle = clock?.getAttribute('style')
      const clockWeight = clock instanceof HTMLElement ? getComputedStyle(clock).fontWeight : null
      if (!(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
        !bounds || bounds.width <= 0 || Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        !(line instanceof HTMLElement) || !(brand instanceof HTMLElement) ||
        !(clock instanceof HTMLElement) || brand.textContent !== 'OKAY / STUDIO' ||
        !/^\\d{2}:\\d{2}\\.\\d{3}$/u.test(clock.textContent ?? '') ||
        (footer && footer.textContent !== 'Unknown Artist · Untitled Song') ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        (contract.lineColor && lineColor !== contract.lineColor) ||
        (contract.lineWidth && lineWidth !== contract.lineWidth) ||
        (contract.brandStyle && brandStyle !== contract.brandStyle) ||
        (contract.clockStyle && clockStyle !== contract.clockStyle) ||
        (contract.clockWeight && clockWeight !== contract.clockWeight)) return null
      const stageCenterX = bounds.left + bounds.width / 2
      const stageCenterY = bounds.top + bounds.height / 2
      const brandBounds = brand.getBoundingClientRect()
      const clockBounds = clock.getBoundingClientRect()
      const footerBounds = footer?.getBoundingClientRect()
      if (brandBounds.left >= stageCenterX || brandBounds.top >= stageCenterY ||
        clockBounds.right <= stageCenterX || clockBounds.top >= stageCenterY ||
        (footerBounds && footerBounds.bottom <= stageCenterY)) return null
      if (applied) {
        if (workspace || stage.classList.contains('is-designing') || status.length || footer ||
          stage.querySelector('[data-stage-frame-design-role], [data-design-only]')) return null
      } else {
        const master = panel?.querySelector('[aria-label="Show Stage frame in output"]')
        const selected = panel?.querySelector('input[value="' + contract.role + '"]')
        const visibility = panel?.querySelector('[aria-label="Show ' +
          contract.role[0].toUpperCase() + contract.role.slice(1) + ' in output"]')
        const target = stage.querySelector('[data-stage-frame-design-role="' + contract.role + '"]')
        const controls = [...(panel?.querySelectorAll('input, button, select') ?? [])]
        const body = workspace?.querySelector('.style-editor__body')
        const bodyBounds = body?.getBoundingClientRect()
        const initialControls = [master, panel?.querySelector('[role="radiogroup"]'),
          panel?.querySelector('.visible-text-role-editor > h3'), visibility,
          panel?.querySelector('[role="combobox"]')]
        const expectedStatus = contract.enabled
          ? (contract.roleVisible ? null : contract.role[0].toUpperCase() + contract.role.slice(1) + ' hidden in output')
          : 'Stage frame off in output'
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(master instanceof HTMLInputElement) || master.checked !== contract.enabled ||
          !(selected instanceof HTMLInputElement) || !selected.checked ||
          !(visibility instanceof HTMLInputElement) || visibility.checked !== contract.roleVisible ||
          !(target instanceof HTMLElement) || getComputedStyle(target).outlineStyle === 'none' ||
          controls.some((control) => control.disabled || getComputedStyle(control).visibility !== 'visible') ||
          !bodyBounds || initialControls.some((control) => {
            const box = control?.getBoundingClientRect()
            return !box || box.top < bodyBounds.top || box.bottom > bodyBounds.bottom
          }) || workspace.querySelectorAll('.style-editor__body').length !== 1 || !sixDestinationsFit() ||
          status.length !== (expectedStatus ? 1 : 0) ||
          (expectedStatus && status[0]?.getAttribute('aria-label') !== expectedStatus) ||
          (status[0] && status[0].nextElementSibling?.textContent !== 'Fixed 1920 × 1080 stage')) return null
        const opacityFor = (role) => {
          const element = role === 'footer' ? footer?.closest('.karaoke-stage__footer') :
            role === 'brand' ? brand : clock
          return element instanceof HTMLElement ? Number(getComputedStyle(element).opacity) : null
        }
        if (Number(getComputedStyle(target).opacity) !== 1 ||
          Number(getComputedStyle(line).opacity) !== (contract.enabled ? 1 : .45) ||
          (!contract.enabled && ['brand', 'clock', 'footer'].some((role) =>
            role !== contract.role && opacityFor(role) !== .45))) return null
      }
      return { applied, brandStyle, clockStyle, clockWeight, height: expected.height,
        lineColor, lineWidth, resourcesReady: true, role: contract.role,
        stageHeight: bounds.height, stageWidth: bounds.width, width: expected.width }
    }

    const sample = () => {
      if (contract.kind === 'background') return sampleBackground()
      if (contract.kind === 'title-card') return sampleTitleCard()
      if (contract.kind === 'stage-frame') return sampleStageFrame()
      if (contract.kind === 'lead-vocal') {
        const workspace = document.querySelector('.style-workspace[role="dialog"]')
        const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-lyrics-tab"]')
        const tab = document.querySelector('[role="tab"][data-style-destination="lyrics"]')
        const preview = document.querySelector('[aria-label="Lyrics design preview"]')
        const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
        const line = stage?.querySelector(
          '[data-design-preview="lead-vocal"] [data-lyric-object-content] .stage-line',
        )
        const wordProgress = line instanceof HTMLElement
          ? [...line.querySelectorAll('.stage-word')]
            .map((word) => word.style.getPropertyValue('--word-progress'))
          : []
        const enabled = panel?.querySelector('[aria-label="Enable Lead Vocal Sync Aid"]')
        const timing = [...(panel?.querySelectorAll('.vocal-timing-field input[type="number"]') ?? [])]
        const bounds = stage?.getBoundingClientRect()
        const text = panel?.textContent ?? ''
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
          !(line instanceof HTMLElement) || !bounds || bounds.width <= 0 || bounds.height <= 0 ||
          Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
          panel.querySelectorAll('.style-override-toggle').length !== 0 ||
          panel.querySelectorAll('input[type="color"]').length !== 2 ||
          !(enabled instanceof HTMLInputElement) || !enabled.checked || timing.length !== 3 ||
          timing.some((input) => !(input instanceof HTMLInputElement) || input.step !== 'any' ||
            input.dataset.stepMs !== '100' || input.min !== '0' || input.max !== '60000' ||
            getComputedStyle(input).appearance !== 'textfield' ||
            input.validity.stepMismatch || !input.checkValidity() || !input.value) ||
          !text.includes('Sung') || !text.includes('Unsung') || !text.includes('Preview Time') ||
          !text.includes('Sync Aid') || !text.includes('Minimum lead') || !text.includes('Maximum lead') ||
          !text.includes('Arrow Up or Arrow Down adjusts by 100 ms') ||
          JSON.stringify(wordProgress) !==
            JSON.stringify(['100%', '50%', '0%', '0%', '0%', '0%', '0%', '0%']) ||
          stage.querySelector('.sync-aid') ||
          !/^stage-line stage-line--(?:left|center|right)$/u.test(line.className) ||
          !line.getAttribute('data-stage-font-size') || document.readyState !== 'complete' ||
          fontSet?.status !== 'loaded' || document.documentElement.clientWidth !== expected.width ||
          document.documentElement.clientHeight !== expected.height ||
          document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
          window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
          !sixDestinationsFit()) return null
        return { controls: timing.length + 1, height: expected.height,
          resourcesReady: true, stageHeight: bounds.height, stageWidth: bounds.width,
          width: expected.width, wordProgress }
      }
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const typeface = document.querySelector('[role="combobox"][aria-label="Global lyric typeface"]')
      const preview = document.querySelector('[aria-label="Lyrics design preview"]')
      const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
      const designLine = stage?.querySelector('[data-design-preview="lead-vocal"] .stage-line')
      const blockers = workspace?.querySelector('.font-access-message, .stage-resource-warning')
      if (
        !(workspace instanceof HTMLElement) ||
        !(typeface instanceof HTMLInputElement) ||
        !(preview instanceof HTMLElement) ||
        !(stage instanceof HTMLElement) ||
        !(designLine instanceof HTMLElement) ||
        blockers ||
        !typeface.value.trim() ||
        document.readyState !== 'complete' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        window.location.href !== '${PACKAGED_APP_URL}' ||
        fontSet?.status !== 'loaded' ||
        !sixDestinationsFit() || Array.from(document.images).some(
          (image) => !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0,
        )
      ) return null
      const stageBounds = stage.getBoundingClientRect()
      const lineBounds = designLine.getBoundingClientRect()
      const lineStyle = getComputedStyle(designLine)
      if (
        stageBounds.width <= 0 ||
        stageBounds.height <= 0 ||
        lineBounds.width <= 0 ||
        lineBounds.height <= 0 ||
        !lineStyle.fontFamily ||
        !lineStyle.fontSize
      ) return null
      return {
        fontFamily: lineStyle.fontFamily,
        fontSize: lineStyle.fontSize,
        fontStatus: fontSet.status,
        height: document.documentElement.clientHeight,
        href: window.location.href,
        readyState: document.readyState,
        resourcesReady: true,
        stageHeight: stageBounds.height,
        stageWidth: stageBounds.width,
        typeface: typeface.value,
        width: document.documentElement.clientWidth,
      }
    }

    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      fitFixture.remove()
      document.removeEventListener('load', schedule, true)
      document.removeEventListener('error', schedule, true)
      fontSet?.removeEventListener?.('loadingdone', schedule)
      fontSet?.removeEventListener?.('loadingerror', schedule)
    }
    const finish = (value) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(value)
    }
    async function check() {
      if (finished) return
      if (checking) {
        rerun = true
        return
      }
      checking = true
      try {
        await fontSet?.ready
        await Promise.all(
          Array.from(document.images, (image) => image.decode?.() ?? Promise.resolve()),
        )
        await frame()
        await frame()
        const first = sample()
        await frame()
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      } catch {
        // Resource failures remain non-ready and are surfaced by the outer deadline.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() {
      void check()
    }

    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    resizeObserver.observe(document.documentElement)
    document.addEventListener('load', schedule, true)
    document.addEventListener('error', schedule, true)
    fontSet?.addEventListener?.('loadingdone', schedule)
    fontSet?.addEventListener?.('loadingerror', schedule)
    schedule()
  }))()`
}

function styleSessionActionScript(action) {
  return `(() => {
    const action = ${JSON.stringify(action)}
    const workspace = document.querySelector('.style-workspace[role="dialog"]')
    const projectTab = document.querySelector('[role="tab"][data-style-destination="lyrics"]')
    const backgroundTab = document.querySelector('[role="tab"][data-style-destination="background"]')
    const titleTab = document.querySelector('[role="tab"][data-style-destination="title-card"]')
    const stageTab = document.querySelector('[role="tab"][data-style-destination="stage-frame"]')
    const templatesTab = document.querySelector('[role="tab"][data-style-destination="templates"]')
    const gradient = document.querySelector('input[type="radio"][value="gradient"]')
    const solid = document.querySelector('input[type="radio"][value="solid"]')
    const eyebrow = document.querySelector('input[type="radio"][value="eyebrow"]')
    const artist = document.querySelector('input[type="radio"][value="artist"]')
    const eyebrowVisibility = document.querySelector('[aria-label="Show Eyebrow in output"]')
    const artistVisibility = document.querySelector('[aria-label="Show Artist in output"]')
    const stageMaster = document.querySelector('[aria-label="Show Stage frame in output"]')
    const brand = document.querySelector('input[type="radio"][value="brand"]')
    const clock = document.querySelector('input[type="radio"][value="clock"]')
    const footer = document.querySelector('input[type="radio"][value="footer"]')
    const clockFace = document.querySelector('[aria-label="Clock face Bold"]')
    const footerVisibility = document.querySelector('[aria-label="Show Footer in output"]')
    const syncAid = document.querySelector('[aria-label="Enable Lead Vocal Sync Aid"]')
    const openingTiming = workspace?.querySelector('[aria-label="Opening lead-in seconds"]')
    const cancel = workspace?.querySelector('[data-style-action="cancel"]')
    const templateName = document.querySelector('input[aria-label="New template name"]')
    const saveTemplate = [...(workspace?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Save as new',
    )
    const selectedDisplayObject = document.querySelector('[data-display-object-selected="true"]')
    const apply = workspace?.querySelector('[data-style-action="apply"]')
    const targets = { background: backgroundTab, cancel, lead: projectTab, lyrics: projectTab, solid, apply,
      title: titleTab, 'eyebrow-visibility': eyebrowVisibility, artist,
      'artist-visibility': artistVisibility, 'apply-title': apply, stage: stageTab,
      'stage-off': stageMaster, 'stage-on': stageMaster, clock, 'clock-face': clockFace,
      footer, 'footer-visibility': footerVisibility, 'apply-stage': apply, 'sync-aid': syncAid,
      'opening-timing': openingTiming,
      templates: templatesTab, 'template-name': templateName, 'save-template': saveTemplate }
    targets['move-selected'] = selectedDisplayObject
    const target = targets[action]
    if (
      ['opening-timing', 'sync-aid', 'template-name', 'save-template'].includes(action) &&
      target instanceof HTMLElement
    ) {
      target.scrollIntoView({ block: 'center' })
    }
    const openingPanel = openingTiming instanceof HTMLElement
      ? openingTiming.closest('.style-destination-panel')
      : null
    const styleEditorActions = workspace?.querySelector('.style-editor__actions')
    const footerTop = styleEditorActions?.getBoundingClientRect()?.top
    const footerBoundary = Number.isFinite(footerTop) ? Math.round(footerTop) : null
    const openingPanelRect = openingPanel?.getBoundingClientRect()
    const roundRect = (rect) =>
      rect
        ? {
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
          }
        : null
    const roundBounds = (bounds) =>
      bounds
        ? {
            bottom: Math.round(bounds.bottom),
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            top: Math.round(bounds.top),
          }
        : null
    const contains = (rectA, rectB) =>
      rectA && rectB &&
      rectA.left >= rectB.left &&
      rectA.top >= rectB.top &&
      rectA.right <= rectB.right &&
      rectA.bottom <= rectB.bottom
    const semantic = ({
      background: workspace instanceof HTMLElement && backgroundTab?.getAttribute('aria-selected') === 'false',
      cancel: workspace instanceof HTMLElement && cancel instanceof HTMLButtonElement && !cancel.disabled,
      lead: projectTab?.getAttribute('aria-selected') === 'true',
      lyrics: projectTab instanceof HTMLButtonElement && !projectTab.disabled,
      'sync-aid': projectTab?.getAttribute('aria-selected') === 'true' && !syncAid?.checked,
      solid: backgroundTab?.getAttribute('aria-selected') === 'true' && gradient?.checked && !solid?.checked,
      apply: backgroundTab?.getAttribute('aria-selected') === 'true' && solid?.checked,
      title: workspace instanceof HTMLElement && titleTab?.getAttribute('aria-selected') === 'false',
      'eyebrow-visibility': titleTab?.getAttribute('aria-selected') === 'true' && eyebrow?.checked && eyebrowVisibility?.checked,
      artist: eyebrow?.checked && !eyebrowVisibility?.checked && !artist?.checked,
      'artist-visibility': artist?.checked && artistVisibility?.checked,
      'apply-title': artist?.checked && !eyebrowVisibility?.checked && !artistVisibility?.checked,
      stage: workspace instanceof HTMLElement && stageTab?.getAttribute('aria-selected') === 'false',
      'stage-off': stageTab?.getAttribute('aria-selected') === 'true' && brand?.checked && stageMaster?.checked,
      'stage-on': brand?.checked && !stageMaster?.checked,
      clock: stageMaster?.checked && brand?.checked && !clock?.checked,
      'clock-face': clock?.checked && clockFace?.getAttribute('aria-pressed') === 'false',
      footer: clock?.checked && clockFace?.getAttribute('aria-pressed') === 'true' && !footer?.checked,
      'footer-visibility': footer?.checked && footerVisibility?.checked,
      'apply-stage': stageTab?.getAttribute('aria-selected') === 'true' &&
        stageMaster?.checked && footer?.checked && !footerVisibility?.checked,
      'opening-timing':
        titleTab?.getAttribute('aria-selected') === 'true' &&
        openingTiming instanceof HTMLInputElement,
      templates: workspace instanceof HTMLElement &&
        templatesTab?.getAttribute('aria-selected') === 'false',
      'template-name': templatesTab?.getAttribute('aria-selected') === 'true' &&
        templateName instanceof HTMLInputElement && !templateName.disabled && !templateName.value &&
        Boolean(workspace?.querySelector('.style-template-list[aria-busy="false"]')),
      'save-template': templatesTab?.getAttribute('aria-selected') === 'true' &&
        templateName instanceof HTMLInputElement && templateName.value === ${JSON.stringify(STYLE_TEMPLATE_NAME)} &&
        saveTemplate instanceof HTMLButtonElement && !saveTemplate.disabled,
      'move-selected': titleTab?.getAttribute('aria-selected') === 'true' && artist?.checked &&
        selectedDisplayObject?.getAttribute('data-title-card-role') === 'artist',
    })[action] === true
    if (!(target instanceof HTMLElement) || !semantic || target.disabled) return null
    const bounds = target.getBoundingClientRect()
    const style = getComputedStyle(target)
    if (bounds.width <= 0 || bounds.height <= 0 || style.display === 'none' ||
      style.pointerEvents === 'none' || style.visibility !== 'visible') return null
    const centerX = Math.round(bounds.left + bounds.width / 2)
    const centerY = Math.round(bounds.top + bounds.height / 2)
    const openingTimingPanelBounds = roundRect(openingPanelRect)
    const openingTimingBounds = roundBounds(bounds)
    const openingTimingMeta = action === 'opening-timing'
      ? {
          openingTimingBelowFooterBoundary:
            Number.isFinite(footerTop) &&
            Number.isFinite(openingTimingBounds?.bottom) &&
            Number.isFinite(footerBoundary) &&
            openingTimingBounds.bottom <= footerBoundary,
          openingTimingCenterInViewport:
            Number.isFinite(openingTimingBounds?.left) &&
            Number.isFinite(openingTimingBounds?.right) &&
            Number.isFinite(openingTimingBounds?.top) &&
            Number.isFinite(openingTimingBounds?.bottom) &&
            openingTimingBounds.left >= 0 &&
            openingTimingBounds.right <= document.documentElement.clientWidth &&
            openingTimingBounds.top >= 0 &&
            openingTimingBounds.bottom <= document.documentElement.clientHeight,
          openingTimingInDestinationPanel:
            openingTimingPanelBounds &&
            contains(openingTimingBounds, openingTimingPanelBounds),
          openingTimingPanelId: openingPanel?.getAttribute('id') ?? '',
          openingTimingCenterX: centerX,
          openingTimingCenterY: centerY,
          openingTimingTitleTabSelected: titleTab?.getAttribute('aria-selected') === 'true',
          openingTimingPanelTopBoundary:
            Number.isFinite(openingTimingPanelBounds?.top) ? openingTimingPanelBounds.top : NaN,
          openingTimingPanelTop:
            Number.isFinite(openingTimingPanelBounds?.top) ? openingTimingPanelBounds.top : NaN,
          openingTimingPanelLeft:
            Number.isFinite(openingTimingPanelBounds?.left) ? openingTimingPanelBounds.left : NaN,
          openingTimingPanelRight:
            Number.isFinite(openingTimingPanelBounds?.right) ? openingTimingPanelBounds.right : NaN,
          openingTimingPanelBottom:
            Number.isFinite(openingTimingPanelBounds?.bottom) ? openingTimingPanelBounds.bottom : NaN,
        }
      : {}
    if (openingTimingMeta.openingTimingBelowFooterBoundary === false ||
      openingTimingMeta.openingTimingCenterInViewport === false ||
      openingTimingMeta.openingTimingInDestinationPanel === false) return null
    return { action, boundsHeight: bounds.height, boundsWidth: bounds.width,
      ...openingTimingMeta,
      height: document.documentElement.clientHeight, href: window.location.href,
      readyState: document.readyState, width: document.documentElement.clientWidth,
      x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) }
  })()`
}

function styleTemplateReadinessScript(viewport, name = STYLE_TEMPLATE_NAME) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const expectedName = ${JSON.stringify(name)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    const mutationObserver = new MutationObserver(() => schedule())
    const resizeObserver = new ResizeObserver(() => schedule())
    const fontSet = document.fonts
    let checking = false
    let finished = false
    let rerun = false
    const sample = () => {
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-templates-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="templates"]')
      const list = panel?.querySelector('.style-template-list')
      const selected = list?.querySelector('button[aria-pressed="true"]')
      const status = panel?.querySelector('[role="status"]')
      const newName = panel?.querySelector('input[aria-label="New template name"]')
      const renameName = panel?.querySelector('input[aria-label="Rename selected template"]')
      const save = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Save as new',
      )
      const load = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Load into Style',
      )
      const remove = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Delete',
      )
      const preview = document.querySelector('[aria-label="Lyrics design preview"]')
      const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
      const line = stage?.querySelector('[data-design-preview="lead-vocal"] .stage-line')
      const bounds = stage?.getBoundingClientRect()
      selected?.scrollIntoView({ block: 'nearest' })
      const body = workspace?.querySelector('.style-editor__body')
      const bodyBounds = body?.getBoundingClientRect()
      const selectedBounds = selected?.getBoundingClientRect()
      const controls = [newName, renameName, save, load, remove]
      if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
        !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
        !(list instanceof HTMLElement) || list.getAttribute('aria-busy') !== 'false' ||
        !(selected instanceof HTMLButtonElement) || selected.textContent?.trim() !== expectedName ||
        !bodyBounds || !selectedBounds || selectedBounds.left < bodyBounds.left ||
        selectedBounds.right > bodyBounds.right || selectedBounds.top < bodyBounds.top ||
        selectedBounds.bottom > bodyBounds.bottom ||
        !(status instanceof HTMLElement) || status.textContent?.trim() !== 'Saved “' + expectedName + '”.' ||
        !(newName instanceof HTMLInputElement) || newName.value ||
        !(renameName instanceof HTMLInputElement) || renameName.value !== expectedName ||
        !(save instanceof HTMLButtonElement) || !save.disabled ||
        controls.some((control) => !(control instanceof HTMLElement) ||
          (control !== save && control instanceof HTMLButtonElement && control.disabled) ||
          getComputedStyle(control).visibility !== 'visible') ||
        !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(line instanceof HTMLElement) ||
        !bounds || bounds.width <= 0 || bounds.height <= 0 ||
        Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        Array.from(document.images).some((image) => !image.complete ||
          image.naturalWidth <= 0 || image.naturalHeight <= 0)) return null
      return { controls: controls.length, height: expected.height, name: expectedName,
        resourcesReady: true, stageHeight: bounds.height, stageWidth: bounds.width,
        status: status.textContent.trim(), width: expected.width }
    }
    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      fontSet?.removeEventListener?.('loadingdone', schedule)
      fontSet?.removeEventListener?.('loadingerror', schedule)
    }
    const finish = (value) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(value)
    }
    async function check() {
      if (finished) return
      if (checking) {
        rerun = true
        return
      }
      checking = true
      try {
        await fontSet?.ready
        await Promise.all(Array.from(document.images, (image) => image.decode?.() ?? Promise.resolve()))
        await frame()
        await frame()
        const first = sample()
        await frame()
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      } catch {
        // Resource and persistence failures remain non-ready until the outer deadline expires.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() { void check() }
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    resizeObserver.observe(document.documentElement)
    document.addEventListener('load', schedule, true)
    document.addEventListener('error', schedule, true)
    fontSet?.addEventListener?.('loadingdone', schedule)
    fontSet?.addEventListener?.('loadingerror', schedule)
    schedule()
  }))()`
}

function styleTemplateFormReadinessScript(viewport) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    const mutationObserver = new MutationObserver(() => schedule())
    const resizeObserver = new ResizeObserver(() => schedule())
    const fontSet = document.fonts
    let checking = false
    let finished = false
    let rerun = false
    const sample = () => {
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const body = workspace?.querySelector('.style-editor__body')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-templates-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="templates"]')
      const list = panel?.querySelector('.style-template-list')
      const newName = panel?.querySelector('input[aria-label="New template name"]')
      const save = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Save as new',
      )
      const preview = document.querySelector('[aria-label="Lyrics design preview"]')
      const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
      const line = stage?.querySelector('[data-design-preview="lead-vocal"] .stage-line')
      newName?.scrollIntoView({ block: 'center' })
      const bodyBounds = body?.getBoundingClientRect()
      const nameBounds = newName?.getBoundingClientRect()
      const stageBounds = stage?.getBoundingClientRect()
      if (!(workspace instanceof HTMLElement) || !(body instanceof HTMLElement) ||
        !(panel instanceof HTMLElement) || panel.hidden ||
        !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
        !(list instanceof HTMLElement) || list.getAttribute('aria-busy') !== 'false' ||
        !(newName instanceof HTMLInputElement) || newName.disabled || newName.value ||
        !(save instanceof HTMLButtonElement) || !save.disabled ||
        !bodyBounds || !nameBounds || nameBounds.left < bodyBounds.left ||
        nameBounds.right > bodyBounds.right || nameBounds.top < bodyBounds.top ||
        nameBounds.bottom > bodyBounds.bottom ||
        !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(line instanceof HTMLElement) ||
        !stageBounds || stageBounds.width <= 0 || stageBounds.height <= 0 ||
        Math.abs(stageBounds.width / stageBounds.height - 16 / 9) > .01 ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        Array.from(document.images).some((image) => !image.complete ||
          image.naturalWidth <= 0 || image.naturalHeight <= 0)) return null
      return { controls: 2, height: expected.height, nameReady: true, resourcesReady: true,
        stageHeight: stageBounds.height, stageWidth: stageBounds.width, width: expected.width }
    }
    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      fontSet?.removeEventListener?.('loadingdone', schedule)
      fontSet?.removeEventListener?.('loadingerror', schedule)
    }
    const finish = (value) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(value)
    }
    async function check() {
      if (finished) return
      if (checking) {
        rerun = true
        return
      }
      checking = true
      try {
        await fontSet?.ready
        await Promise.all(Array.from(document.images, (image) => image.decode?.() ?? Promise.resolve()))
        await frame()
        await frame()
        const first = sample()
        await frame()
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      } catch {
        // Loading and layout failures remain non-ready until the outer deadline expires.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() { void check() }
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    resizeObserver.observe(document.documentElement)
    document.addEventListener('load', schedule, true)
    document.addEventListener('error', schedule, true)
    fontSet?.addEventListener?.('loadingdone', schedule)
    fontSet?.addEventListener?.('loadingerror', schedule)
    schedule()
  }))()`
}

function validRendererState(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.bridgeFrozen === true &&
    value.bridgeFunctions === true &&
    JSON.stringify(value.bridgeKeys) === JSON.stringify(STUDIO_BRIDGE_KEYS) &&
    value.devicePixelRatio === 1 &&
    value.height === VIEWPORT.height &&
    value.width === VIEWPORT.width &&
    value.href === PACKAGED_APP_URL &&
    value.ipcReady === true &&
    value.nodeAccess === false &&
    value.readyState === 'complete' &&
    Number.isSafeInteger(value.rootChildren) &&
    value.rootChildren > 0 &&
    value.stable === true,
  )
}

function validStyleTarget(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isFinite(value.boundsHeight) &&
    value.boundsHeight > 0 &&
    Number.isFinite(value.boundsWidth) &&
    value.boundsWidth > 0 &&
    value.height === VIEWPORT.height &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    value.width === VIEWPORT.width &&
    Number.isSafeInteger(value.x) &&
    value.x >= 0 &&
    value.x < VIEWPORT.width &&
    Number.isSafeInteger(value.y) &&
    value.y >= 0 &&
    value.y < VIEWPORT.height,
  )
}

function validStyleActionTarget(value, action) {
  if (!validStyleTarget(value) || value.action !== action) return false
  if (action !== 'opening-timing') return true
  const {
    openingTimingBelowFooterBoundary,
    openingTimingCenterInViewport,
    openingTimingInDestinationPanel,
    openingTimingPanelId,
    openingTimingPanelBottom,
    openingTimingPanelLeft,
    openingTimingPanelRight,
    openingTimingPanelTop,
    openingTimingPanelTopBoundary,
    openingTimingCenterX,
    openingTimingCenterY,
    openingTimingTitleTabSelected,
  } = value
  return Boolean(
    openingTimingBelowFooterBoundary === true &&
    openingTimingCenterInViewport === true &&
    openingTimingInDestinationPanel === true &&
    typeof openingTimingPanelId === 'string' &&
    openingTimingPanelId.endsWith('title-card-panel') &&
    openingTimingTitleTabSelected === true &&
    Number.isFinite(openingTimingCenterX) &&
    Number.isFinite(openingTimingCenterY) &&
    Number.isFinite(openingTimingPanelLeft) &&
    Number.isFinite(openingTimingPanelTop) &&
    Number.isFinite(openingTimingPanelRight) &&
    Number.isFinite(openingTimingPanelBottom) &&
    Number.isFinite(openingTimingPanelTopBoundary),
  )
}

function validBackgroundState(value, viewport, mode, colors = null, applied = false) {
  const colorKeys = ['gradientEndColor', 'gradientStartColor', 'solidColor']
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.applied === applied &&
    value.mode === mode &&
    value.height === viewport.height &&
    value.width === viewport.width &&
    value.resourcesReady === true &&
    typeof value.css === 'string' &&
    value.css.length > 0 &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    colorKeys.every((key) => /^#[0-9a-f]{6}$/iu.test(value[key])) &&
    (!colors || colorKeys.every((key) => value[key] === colors[key])),
  )
}

function validProjectLyricsState(value, viewport) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.fontFamily === 'string' &&
    value.fontFamily.length > 0 &&
    typeof value.fontSize === 'string' &&
    value.fontSize.length > 0 &&
    value.fontStatus === 'loaded' &&
    value.height === viewport.height &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    typeof value.typeface === 'string' &&
    value.typeface.trim().length > 0 &&
    value.width === viewport.width,
  )
}

function validLeadVocalState(value, viewport) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([
        'controls',
        'height',
        'resourcesReady',
        'stageHeight',
        'stageWidth',
        'width',
        'wordProgress',
      ]) &&
    value.controls === 4 &&
    JSON.stringify(value.wordProgress) ===
      JSON.stringify(['100%', '50%', '0%', '0%', '0%', '0%', '0%', '0%']) &&
    value.height === viewport.height &&
    value.width === viewport.width &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    Math.abs(value.stageWidth / value.stageHeight - 16 / 9) <= 0.01,
  )
}

function validStyleTemplateState(value, viewport, name = STYLE_TEMPLATE_NAME) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.controls === 5 &&
    value.height === viewport.height &&
    value.name === name &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    value.status === `Saved “${name}”.` &&
    value.width === viewport.width,
  )
}

function validStyleTemplateFormState(value, viewport) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.controls === 2 &&
    value.height === viewport.height &&
    value.nameReady === true &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    value.width === viewport.width,
  )
}

function validStageFrameState(value, viewport, contract) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.applied === (contract.applied === true) &&
    value.role === contract.role &&
    value.height === viewport.height &&
    value.width === viewport.width &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    typeof value.brandStyle === 'string' &&
    typeof value.clockStyle === 'string' &&
    typeof value.clockWeight === 'string' &&
    /^#[0-9a-f]{6}$/iu.test(value.lineColor) &&
    typeof value.lineWidth === 'string' &&
    value.lineWidth.length > 0,
  )
}

function validStyleKeyboardState(value) {
  return Boolean(
    value &&
    value.closed === false &&
    value.clean === true &&
    value.undoDisabled === true &&
    value.redoDisabled === true &&
    JSON.stringify(value.focus) === JSON.stringify(STYLE_KEY_FOCUS) &&
    Array.isArray(value.changes) &&
    value.changes.length === STYLE_KEY_CHANGES.length &&
    value.changes.every((change, index) =>
      Boolean(
        change &&
        change.active === true &&
        change.checked === true &&
        change.checkedCount === 1 &&
        change.role === STYLE_KEY_CHANGES[index],
      ),
    ),
  )
}

function validStyleDestinationLayout(value, destination, expectedScrollTop) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Object.hasOwn(STYLE_DESTINATION_SCROLL_TOPS, destination) &&
    Number.isSafeInteger(expectedScrollTop) &&
    expectedScrollTop >= 0 &&
    value.activePanel?.endsWith(`-${destination}-panel`) &&
    value.activeTab === destination &&
    value.clientHeight > 0 &&
    value.contentBounded === true &&
    value.focusOwnsDestination === true &&
    value.headingBounded === true &&
    value.hiddenPanelFocus === false &&
    value.panelBounded === true &&
    value.scrollHeight >= value.clientHeight &&
    value.scrollTop === expectedScrollTop &&
    value.selected === true,
  )
}

function timelineLeadInGeometryScript() {
  return `(() => {
    const readGeometry = () => {
      const lead = document.querySelector('.timeline-lead-in')
      const ruler = document.querySelector('.timeline-ruler')
      const waveform = document.querySelector('.timeline-waveform')
      const rect = (node) => node instanceof HTMLElement ? node.getBoundingClientRect() : null
      const leadBounds = rect(lead)
      const rulerBounds = rect(ruler)
      const waveformBounds = rect(waveform)
      return {
        leadHeight: leadBounds ? Math.round(leadBounds.height) : null,
        leadTop: leadBounds ? Math.round(leadBounds.top) : null,
        rulerBottom: rulerBounds ? Math.round(rulerBounds.bottom) : null,
        valid: true,
        waveformBottom: waveformBounds ? Math.round(waveformBounds.bottom) : null,
        waveformTop: waveformBounds ? Math.round(waveformBounds.top) : null,
      }
    }
    const settleGeometry = () => new Promise((resolve) => requestAnimationFrame(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve(readGeometry())
      }))
    }))
    if (document.querySelector('.timeline-lead-in') instanceof HTMLElement) return settleGeometry()
    const input = document.querySelector('aside[aria-label="Project inspector"] [aria-label="Opening lead-in seconds"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!(input instanceof HTMLInputElement) || typeof setter !== 'function') return { valid: false }
    setter.call(input, '1')
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '1' }))
    return new Promise((resolve) => requestAnimationFrame(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
      settleGeometry().then(resolve)
    }))
  })()`
}

function validTimelineLeadInGeometryState(value) {
  return Boolean(
    value &&
    value.valid === true &&
    Number.isSafeInteger(value.leadHeight) &&
    value.leadHeight > 0 &&
    Number.isSafeInteger(value.leadTop) &&
    Number.isSafeInteger(value.rulerBottom) &&
    Number.isSafeInteger(value.waveformTop) &&
    Number.isSafeInteger(value.waveformBottom) &&
    Math.abs(value.leadTop - value.waveformTop) <= 1 &&
    value.leadTop >= value.rulerBottom &&
    Math.abs(value.leadTop + value.leadHeight - value.waveformBottom) <= 1,
  )
}

const TIMELINE_DENSITY_OPEN_TARGET_SCRIPT = `(() => {
  const marker = ${JSON.stringify(TIMELINE_DENSITY_OPEN_MARKER)}
  const target = document.querySelector('button[aria-label="Open project"]')
  const styleButton = document.querySelector(
    'button.style-button[aria-label="Edit project Style"]',
  )
  if (
    !(target instanceof HTMLButtonElement) ||
    target.disabled ||
    !(styleButton instanceof HTMLButtonElement) ||
    styleButton.getAttribute('aria-disabled') === 'true' ||
    document.querySelector('[role="dialog"], [role="alert"]')
  ) return null
  const bounds = target.getBoundingClientRect()
  const style = getComputedStyle(target)
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > document.documentElement.clientWidth ||
    bounds.bottom > document.documentElement.clientHeight ||
    style.display === 'none' ||
    style.visibility !== 'visible' ||
    style.pointerEvents === 'none'
  ) return null
  delete document.documentElement.dataset[marker]
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.isTrusted &&
        event.key === 'Enter' &&
        !event.repeat &&
        document.activeElement === target
      ) document.documentElement.dataset[marker] = 'trusted-enter'
    },
    { capture: true, once: true },
  )
  target.focus({ preventScroll: true })
  return {
    active: document.activeElement === target,
    boundsHeight: bounds.height,
    boundsWidth: bounds.width,
    devicePixelRatio: window.devicePixelRatio,
    height: document.documentElement.clientHeight,
    href: window.location.href,
    readyState: document.readyState,
    trustedMarkerArmed: !document.documentElement.dataset[marker],
    width: document.documentElement.clientWidth,
  }
})()`

const TIMELINE_DENSITY_DIALOG_ACTIVATION_SCRIPT = `(() => {
  const marker = ${JSON.stringify(TIMELINE_DENSITY_OPEN_MARKER)}
  const target = document.querySelector('button[aria-label="Open project"]')
  const trusted =
    document.documentElement.dataset[marker] === 'trusted-enter' &&
    target instanceof HTMLButtonElement &&
    document.activeElement === target
  delete document.documentElement.dataset[marker]
  return trusted
})()`

const TIMELINE_DENSITY_TIMING_TARGET_SCRIPT = `(() => {
  const target = document.querySelector(
    '[role="separator"][aria-label="Stage Monitor and Lyric Timing height"]',
  )
  if (
    !(target instanceof HTMLElement) ||
    target.getAttribute('aria-disabled') === 'true' ||
    target.getAttribute('aria-orientation') !== 'horizontal'
  ) return null
  const minimum = Number(target.getAttribute('aria-valuemin'))
  const maximum = Number(target.getAttribute('aria-valuemax'))
  const value = Number(target.getAttribute('aria-valuenow'))
  const bounds = target.getBoundingClientRect()
  const style = getComputedStyle(target)
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    !Number.isFinite(value) ||
    minimum > value ||
    value > maximum ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.right > document.documentElement.clientWidth ||
    bounds.bottom > document.documentElement.clientHeight ||
    style.display === 'none' ||
    style.visibility !== 'visible'
  ) return null
  target.focus({ preventScroll: true })
  return {
    active: document.activeElement === target,
    boundsHeight: bounds.height,
    boundsWidth: bounds.width,
    devicePixelRatio: window.devicePixelRatio,
    height: document.documentElement.clientHeight,
    href: window.location.href,
    maximum,
    minimum,
    readyState: document.readyState,
    value,
    width: document.documentElement.clientWidth,
  }
})()`

function validTimelineDensityOpenTarget(value, viewport, devicePixelRatio) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.active === true &&
    Number.isFinite(value.boundsHeight) &&
    value.boundsHeight > 0 &&
    Number.isFinite(value.boundsWidth) &&
    value.boundsWidth > 0 &&
    value.devicePixelRatio === devicePixelRatio &&
    value.height === viewport.height &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    value.trustedMarkerArmed === true &&
    value.width === viewport.width,
  )
}

function validTimelineDensityTimingTarget(value, viewport, devicePixelRatio) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.active === true &&
    Number.isFinite(value.boundsHeight) &&
    value.boundsHeight > 0 &&
    Number.isFinite(value.boundsWidth) &&
    value.boundsWidth > 0 &&
    value.devicePixelRatio === devicePixelRatio &&
    value.height === viewport.height &&
    value.href === PACKAGED_APP_URL &&
    Number.isFinite(value.maximum) &&
    Number.isFinite(value.minimum) &&
    value.minimum <= value.value &&
    value.value <= value.maximum &&
    value.readyState === 'complete' &&
    value.width === viewport.width,
  )
}

function timelineDensityReadinessScript(viewport, profile) {
  const expected = {
    devicePixelRatio: profile.devicePixelRatio,
    height: viewport.height,
    profileName: profile.name,
    title: TIMELINE_DENSITY_TITLE,
    trackCount: TIMELINE_DENSITY_TRACK_COUNT,
    width: viewport.width,
    wordsPerTrack: TIMELINE_DENSITY_WORDS_PER_TRACK,
  }
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(expected)}
    const expectedBridgeKeys = ${JSON.stringify(STUDIO_BRIDGE_KEYS)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    const mutationObserver = new MutationObserver(() => schedule())
    const resizeObserver = new ResizeObserver(() => schedule())
    const fontSet = document.fonts
    let checking = false
    let finished = false
    let rerun = false
    const geometry = (viewport) => ({
      clientHeight: viewport.clientHeight,
      clientWidth: viewport.clientWidth,
      scrollHeight: viewport.scrollHeight,
      scrollWidth: viewport.scrollWidth,
    })
    const sameGeometry = (left, right) =>
      left.clientHeight === right.clientHeight &&
      left.clientWidth === right.clientWidth &&
      left.scrollHeight === right.scrollHeight &&
      left.scrollWidth === right.scrollWidth
    const positions = (maximum, span, minimumStep = 0) => {
      const values = new Set([0, maximum])
      const step = Math.max(1, minimumStep, Math.floor(span * 0.85))
      for (let value = step; value < maximum; value += step) values.add(value)
      return [...values].sort((left, right) => left - right)
    }
    const visible = (element, viewportBounds) => {
      if (!(element instanceof HTMLElement)) return false
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left < viewportBounds.right &&
        bounds.right > viewportBounds.left &&
        bounds.top < viewportBounds.bottom &&
        bounds.bottom > viewportBounds.top &&
        style.display !== 'none' &&
        style.visibility === 'visible'
      )
    }
    const unsafeUi = () =>
      Boolean(
        document.querySelector(
          '[role="dialog"], [role="alert"], .toast--warning, .toast--error',
        ),
      )
    const collect = async () => {
      const title = document.querySelector('.topbar__document > span')
      const dirty = document.querySelector('.topbar__document > i')
      const styleButton = document.querySelector(
        'button.style-button[aria-label="Edit project Style"]',
      )
      const divider = document.querySelector(
        '[role="separator"][aria-label="Stage Monitor and Lyric Timing height"]',
      )
      const timeline = document.querySelector('.timeline-viewport')
      const lanes = [...document.querySelectorAll('.timeline-lane[data-track-id]')]
      const labels = [...document.querySelectorAll('.timeline-track-label strong')]
      if (
        !(title instanceof HTMLElement) ||
        title.textContent?.trim() !== expected.title ||
        dirty ||
        !(styleButton instanceof HTMLButtonElement) ||
        styleButton.getAttribute('aria-disabled') === 'true' ||
        !(divider instanceof HTMLElement) ||
        divider.getAttribute('aria-disabled') === 'true' ||
        Number(divider.getAttribute('aria-valuenow')) !==
          Number(divider.getAttribute('aria-valuemin')) ||
        !(timeline instanceof HTMLElement) ||
        lanes.length !== expected.trackCount ||
        labels.length !== expected.trackCount ||
        unsafeUi() ||
        document.readyState !== 'complete' ||
        fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        window.devicePixelRatio !== expected.devicePixelRatio ||
        window.location.href !== '${PACKAGED_APP_URL}' ||
        Array.from(document.images).some(
          (image) => !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0,
        )
      ) return null
      const expectedIds = Array.from(
        { length: expected.trackCount },
        (_, index) => 'timeline-density-track-' + String(index + 1).padStart(2, '0'),
      )
      const expectedNames = Array.from(
        { length: expected.trackCount },
        (_, index) => 'Density Vocal ' + (index + 1),
      )
      if (
        lanes.some((lane, index) => lane.getAttribute('data-track-id') !== expectedIds[index]) ||
        labels.some((label, index) => label.textContent?.trim() !== expectedNames[index])
      ) return null
      const initialGeometry = geometry(timeline)
      const maxLeft = initialGeometry.scrollWidth - initialGeometry.clientWidth
      const maxTop = initialGeometry.scrollHeight - initialGeometry.clientHeight
      if (maxLeft <= 0 || maxTop <= 0) return null
      const tracks = expectedIds.map((id, index) => ({
        id,
        name: expectedNames[index],
        labels: new Set(),
        logicalWords: new Set(),
        maxMountedLabels: 0,
        maxMountedWords: 0,
      }))
      let aggregateVisible = false
      let aggregatePosition = null
      const xPositions = positions(maxLeft, initialGeometry.clientWidth, 300)
      const yPositions = positions(maxTop, initialGeometry.clientHeight)
      for (const top of yPositions) {
        for (const left of xPositions) {
          timeline.scrollTo({ behavior: 'auto', left, top })
          await frame()
          await frame()
          const currentLanes = [...document.querySelectorAll('.timeline-lane[data-track-id]')]
          if (
            currentLanes.length !== expected.trackCount ||
            currentLanes.some(
              (lane, index) => lane.getAttribute('data-track-id') !== expectedIds[index],
            )
          ) return null
          const viewportBounds = timeline.getBoundingClientRect()
          let sliceAggregateVisible = false
          currentLanes.forEach((lane, index) => {
            const track = tracks[index]
            const mountedWords = [...lane.querySelectorAll('.timeline-word')]
            const mountedLabels = [...lane.querySelectorAll('.timeline-line-label__word')]
            track.maxMountedWords = Math.max(track.maxMountedWords, mountedWords.length)
            track.maxMountedLabels = Math.max(track.maxMountedLabels, mountedLabels.length)
            if (
              mountedWords.length > ${TIMELINE_DENSITY_DOM_CAP_PER_TRACK} ||
              mountedLabels.length > ${TIMELINE_DENSITY_DOM_CAP_PER_TRACK}
            ) return
            for (const word of mountedWords) {
              const token = word
                .getAttribute('aria-label')
                ?.match(/^[0-9a-z]{2}\\b/u)?.[0]
              if (!token) {
                track.invalid = true
                continue
              }
              track.logicalWords.add(token)
            }
            for (const label of mountedLabels) {
              const token = label.textContent?.trim()
              if (!/^[0-9a-z]{2}$/u.test(token ?? '')) {
                track.invalid = true
                continue
              }
              track.labels.add(token)
              // Word labels retain the same unique current-project word identity even
              // when vertical virtualization mounts no timing button for a lane slice.
              track.logicalWords.add(token)
            }
            const aggregates = [...lane.querySelectorAll('.timeline-density-aggregate')]
            sliceAggregateVisible ||= aggregates.some((aggregate) =>
              visible(aggregate, viewportBounds),
            )
          })
          aggregateVisible ||= sliceAggregateVisible
          if (
            sliceAggregateVisible &&
            !aggregatePosition &&
            timeline.scrollLeft > 0 &&
            timeline.scrollTop > 0
          ) {
            aggregatePosition = {
              left: timeline.scrollLeft,
              top: timeline.scrollTop,
            }
          }
          if (
            tracks.some(
              (track) =>
                track.invalid ||
                track.maxMountedWords > ${TIMELINE_DENSITY_DOM_CAP_PER_TRACK} ||
                track.maxMountedLabels > ${TIMELINE_DENSITY_DOM_CAP_PER_TRACK},
            )
          ) return null
        }
      }
      for (let trackIndex = 0; trackIndex < expected.trackCount; trackIndex += 1) {
        const track = tracks[trackIndex]
        for (let ordinal = 0; ordinal < expected.wordsPerTrack; ordinal += 1) {
          const token = ordinal.toString(36).padStart(2, '0')
          if (!track.logicalWords.has(token) || !track.labels.has(token)) return null
        }
        if (
          track.logicalWords.size !== expected.wordsPerTrack ||
          track.labels.size !== expected.wordsPerTrack
        ) return null
      }
      if (!aggregatePosition) return null
      const finalLeft = aggregatePosition.left
      const finalTop = aggregatePosition.top
      timeline.scrollTo({ behavior: 'auto', left: finalLeft, top: finalTop })
      await frame()
      await frame()
      const finalGeometry = geometry(timeline)
      const bridge = window.studio
      const bridgeKeys =
        bridge && typeof bridge === 'object' ? Object.keys(bridge).sort() : []
      let ipcReady = false
      try {
        ipcReady = (await bridge?.getPendingWindowClose?.()) === null
      } catch {}
      const resultTracks = tracks.map((track) => ({
        id: track.id,
        labelCount: track.labels.size,
        maxMountedLabels: track.maxMountedLabels,
        maxMountedWords: track.maxMountedWords,
        name: track.name,
        wordCount: track.logicalWords.size,
      }))
      return {
        aggregateVisible,
        bridgeFrozen: Object.isFrozen(bridge),
        bridgeFunctions:
          bridgeKeys.length === expectedBridgeKeys.length &&
          bridgeKeys.every((key) => typeof bridge[key] === 'function'),
        bridgeKeys,
        devicePixelRatio: window.devicePixelRatio,
        dividerAtMinimum: true,
        finalScrollLeft: timeline.scrollLeft,
        finalScrollTop: timeline.scrollTop,
        geometryStable: sameGeometry(initialGeometry, finalGeometry),
        height: document.documentElement.clientHeight,
        href: window.location.href,
        ipcReady,
        labelCount: resultTracks.reduce((total, track) => total + track.labelCount, 0),
        maxScrollLeft: maxLeft,
        maxScrollTop: maxTop,
        nodeAccess:
          typeof window.process !== 'undefined' || typeof window.require !== 'undefined',
        profileName: expected.profileName,
        readyState: document.readyState,
        timelineClientHeight: finalGeometry.clientHeight,
        timelineClientWidth: finalGeometry.clientWidth,
        timelineScrollHeight: finalGeometry.scrollHeight,
        timelineScrollWidth: finalGeometry.scrollWidth,
        title: title.textContent.trim(),
        tracks: resultTracks,
        width: document.documentElement.clientWidth,
        wordCount: resultTracks.reduce((total, track) => total + track.wordCount, 0),
      }
    }
    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      fontSet?.removeEventListener?.('loadingdone', schedule)
      fontSet?.removeEventListener?.('loadingerror', schedule)
    }
    const finish = (value) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(value)
    }
    async function check() {
      if (finished) return
      if (checking) {
        rerun = true
        return
      }
      checking = true
      try {
        await fontSet?.ready
        await frame()
        await frame()
        const value = await collect()
        if (value) finish(value)
      } catch {
        // A renderer, resource, scrolling, or IPC failure remains non-ready.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() { void check() }
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    resizeObserver.observe(document.documentElement)
    fontSet?.addEventListener?.('loadingdone', schedule)
    fontSet?.addEventListener?.('loadingerror', schedule)
    schedule()
  }))()`
}

function validTimelineDensityState(value, viewport, profile) {
  const tracks = Array.isArray(value?.tracks) ? value.tracks : []
  const trackContract = tracks.every((track, index) => {
    const ordinal = index + 1
    return Boolean(
      track &&
      track.id === `timeline-density-track-${String(ordinal).padStart(2, '0')}` &&
      track.name === `Density Vocal ${ordinal}` &&
      track.wordCount === TIMELINE_DENSITY_WORDS_PER_TRACK &&
      track.labelCount === TIMELINE_DENSITY_WORDS_PER_TRACK &&
      Number.isSafeInteger(track.maxMountedWords) &&
      track.maxMountedWords >= 0 &&
      track.maxMountedWords <= TIMELINE_DENSITY_DOM_CAP_PER_TRACK &&
      Number.isSafeInteger(track.maxMountedLabels) &&
      track.maxMountedLabels > 0 &&
      track.maxMountedLabels <= TIMELINE_DENSITY_DOM_CAP_PER_TRACK,
    )
  })
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.aggregateVisible === true &&
    value.bridgeFrozen === true &&
    value.bridgeFunctions === true &&
    JSON.stringify(value.bridgeKeys) === JSON.stringify(STUDIO_BRIDGE_KEYS) &&
    value.devicePixelRatio === profile.devicePixelRatio &&
    value.dividerAtMinimum === true &&
    Number.isFinite(value.finalScrollLeft) &&
    value.finalScrollLeft > 0 &&
    value.finalScrollLeft <= value.maxScrollLeft &&
    Number.isFinite(value.finalScrollTop) &&
    value.finalScrollTop > 0 &&
    value.finalScrollTop <= value.maxScrollTop &&
    value.geometryStable === true &&
    value.height === viewport.height &&
    value.href === PACKAGED_APP_URL &&
    value.ipcReady === true &&
    value.labelCount === TIMELINE_DENSITY_WORD_COUNT &&
    Number.isFinite(value.maxScrollLeft) &&
    value.maxScrollLeft > 0 &&
    Number.isFinite(value.maxScrollTop) &&
    value.maxScrollTop > 0 &&
    value.nodeAccess === false &&
    value.profileName === profile.name &&
    value.readyState === 'complete' &&
    Number.isSafeInteger(value.timelineClientHeight) &&
    value.timelineClientHeight > 0 &&
    Number.isSafeInteger(value.timelineClientWidth) &&
    value.timelineClientWidth > 0 &&
    value.timelineScrollHeight > value.timelineClientHeight &&
    value.timelineScrollWidth > value.timelineClientWidth &&
    value.title === TIMELINE_DENSITY_TITLE &&
    tracks.length === TIMELINE_DENSITY_TRACK_COUNT &&
    trackContract &&
    tracks.some((track) => track.maxMountedWords > 0) &&
    value.width === viewport.width &&
    value.wordCount === TIMELINE_DENSITY_WORD_COUNT,
  )
}

function timelineDensityCaptureStateScript(viewport, profile, readiness) {
  const expected = {
    devicePixelRatio: profile.devicePixelRatio,
    finalScrollLeft: readiness.finalScrollLeft,
    finalScrollTop: readiness.finalScrollTop,
    height: viewport.height,
    profileName: profile.name,
    timelineClientHeight: readiness.timelineClientHeight,
    timelineClientWidth: readiness.timelineClientWidth,
    timelineScrollHeight: readiness.timelineScrollHeight,
    timelineScrollWidth: readiness.timelineScrollWidth,
    title: TIMELINE_DENSITY_TITLE,
    width: viewport.width,
  }
  return `(() => {
    const expected = ${JSON.stringify(expected)}
    const expectedBridgeKeys = ${JSON.stringify(STUDIO_BRIDGE_KEYS)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    const visible = (element, viewportBounds) => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left < viewportBounds.right &&
        bounds.right > viewportBounds.left &&
        bounds.top < viewportBounds.bottom &&
        bounds.bottom > viewportBounds.top &&
        style.display !== 'none' &&
        style.visibility === 'visible'
      )
    }
    const sample = async () => {
      const title = document.querySelector('.topbar__document > span')
      const styleButton = document.querySelector(
        'button.style-button[aria-label="Edit project Style"]',
      )
      const divider = document.querySelector(
        '[role="separator"][aria-label="Stage Monitor and Lyric Timing height"]',
      )
      const timeline = document.querySelector('.timeline-viewport')
      const lanes = [...document.querySelectorAll('.timeline-lane[data-track-id]')]
      const labels = [...document.querySelectorAll('.timeline-track-label strong')]
      const bridge = window.studio
      const bridgeKeys =
        bridge && typeof bridge === 'object' ? Object.keys(bridge).sort() : []
      let ipcReady = false
      try {
        ipcReady = (await bridge?.getPendingWindowClose?.()) === null
      } catch {}
      const viewportBounds = timeline?.getBoundingClientRect()
      return {
        aggregateVisible:
          viewportBounds &&
          lanes.some((lane) =>
            [...lane.querySelectorAll('.timeline-density-aggregate')].some((aggregate) =>
              visible(aggregate, viewportBounds),
            ),
          ),
        bridgeFrozen: Object.isFrozen(bridge),
        bridgeFunctions:
          bridgeKeys.length === expectedBridgeKeys.length &&
          bridgeKeys.every((key) => typeof bridge[key] === 'function'),
        bridgeKeys,
        devicePixelRatio: window.devicePixelRatio,
        dividerAtMinimum:
          divider instanceof HTMLElement &&
          divider.getAttribute('aria-disabled') !== 'true' &&
          Number(divider.getAttribute('aria-valuenow')) ===
            Number(divider.getAttribute('aria-valuemin')),
        dirty: Boolean(document.querySelector('.topbar__document > i')),
        finalScrollLeft: timeline?.scrollLeft ?? -1,
        finalScrollTop: timeline?.scrollTop ?? -1,
        height: document.documentElement.clientHeight,
        href: window.location.href,
        ipcReady,
        issue:
          Boolean(
            document.querySelector(
              '[role="dialog"], [role="alert"], .toast--warning, .toast--error',
            ),
          ) ||
          !(styleButton instanceof HTMLButtonElement) ||
          styleButton.getAttribute('aria-disabled') === 'true',
        labels: labels.map((label) => label.textContent?.trim() ?? ''),
        lanes: lanes.map((lane) => ({
          id: lane.getAttribute('data-track-id') ?? '',
          mountedLabels: lane.querySelectorAll('.timeline-line-label__word').length,
          mountedWords: lane.querySelectorAll('.timeline-word').length,
        })),
        nodeAccess:
          typeof window.process !== 'undefined' || typeof window.require !== 'undefined',
        profileName: expected.profileName,
        readyState: document.readyState,
        timelineClientHeight: timeline?.clientHeight ?? -1,
        timelineClientWidth: timeline?.clientWidth ?? -1,
        timelineScrollHeight: timeline?.scrollHeight ?? -1,
        timelineScrollWidth: timeline?.scrollWidth ?? -1,
        title: title?.textContent?.trim() ?? '',
        width: document.documentElement.clientWidth,
      }
    }
    return (async () => {
      await document.fonts?.ready
      await frame()
      await frame()
      const first = await sample()
      await frame()
      const second = await sample()
      return { ...second, stable: JSON.stringify(first) === JSON.stringify(second) }
    })()
  })()`
}

function validTimelineDensityCaptureState(value, viewport, profile, readiness) {
  const lanes = Array.isArray(value?.lanes) ? value.lanes : []
  const labels = Array.isArray(value?.labels) ? value.labels : []
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.aggregateVisible === true &&
    value.bridgeFrozen === true &&
    value.bridgeFunctions === true &&
    JSON.stringify(value.bridgeKeys) === JSON.stringify(STUDIO_BRIDGE_KEYS) &&
    value.devicePixelRatio === profile.devicePixelRatio &&
    value.dividerAtMinimum === true &&
    value.dirty === false &&
    value.finalScrollLeft === readiness.finalScrollLeft &&
    value.finalScrollTop === readiness.finalScrollTop &&
    value.height === viewport.height &&
    value.href === PACKAGED_APP_URL &&
    value.ipcReady === true &&
    value.issue === false &&
    labels.length === TIMELINE_DENSITY_TRACK_COUNT &&
    labels.every((label, index) => label === `Density Vocal ${index + 1}`) &&
    lanes.length === TIMELINE_DENSITY_TRACK_COUNT &&
    lanes.every(
      (lane, index) =>
        lane.id === `timeline-density-track-${String(index + 1).padStart(2, '0')}` &&
        Number.isSafeInteger(lane.mountedLabels) &&
        lane.mountedLabels >= 0 &&
        lane.mountedLabels <= TIMELINE_DENSITY_DOM_CAP_PER_TRACK &&
        Number.isSafeInteger(lane.mountedWords) &&
        lane.mountedWords >= 0 &&
        lane.mountedWords <= TIMELINE_DENSITY_DOM_CAP_PER_TRACK,
    ) &&
    value.nodeAccess === false &&
    value.profileName === profile.name &&
    value.readyState === 'complete' &&
    value.stable === true &&
    value.timelineClientHeight === readiness.timelineClientHeight &&
    value.timelineClientWidth === readiness.timelineClientWidth &&
    value.timelineScrollHeight === readiness.timelineScrollHeight &&
    value.timelineScrollWidth === readiness.timelineScrollWidth &&
    value.title === TIMELINE_DENSITY_TITLE &&
    value.width === viewport.width,
  )
}

function executeBeforeDeadline(operation, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw readinessError()
  }
  let timer
  const pending = Promise.resolve().then(operation)
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(readinessError()), timeoutMs)
  })
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer))
}

function readinessError() {
  const error = new Error('VISUAL_SMOKE_READINESS_INVALID')
  error.code = 'VISUAL_SMOKE_READINESS_INVALID'
  return error
}

module.exports = {
  PACKAGED_APP_URL,
  STABLE_RENDERER_SCRIPT,
  LAYOUT_REACHABILITY_SELECTORS,
  layoutReachabilityScript,
  STUDIO_BRIDGE_KEYS,
  STYLE_KEY_CHANGES,
  STYLE_KEY_FOCUS,
  STYLE_KEY_RECORDER_SCRIPT,
  STYLE_KEY_RESULT_SCRIPT,
  STYLE_KEY_SEQUENCE,
  STYLE_DESTINATION_STATE_SCRIPT,
  STYLE_DESTINATION_SCROLL_TOPS,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_TEMPLATE_NAME,
  STYLE_TARGET_SCRIPT,
  TIMELINE_DENSITY_DIALOG_ACTIVATION_SCRIPT,
  TIMELINE_DENSITY_DOM_CAP_PER_TRACK,
  TIMELINE_DENSITY_OPEN_TARGET_SCRIPT,
  TIMELINE_DENSITY_TIMING_TARGET_SCRIPT,
  TIMELINE_DENSITY_TITLE,
  TIMELINE_DENSITY_TRACK_COUNT,
  TIMELINE_DENSITY_WORD_COUNT,
  TIMELINE_DENSITY_WORDS_PER_TRACK,
  executeBeforeDeadline,
  projectLyricsReadinessScript,
  styleDestinationLayoutScript,
  styleSessionActionScript,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  timelineLeadInGeometryScript,
  timelineDensityCaptureStateScript,
  timelineDensityReadinessScript,
  validBackgroundState,
  validLeadVocalState,
  validProjectLyricsState,
  validLayoutReachabilityState,
  validRendererState,
  validStageFrameState,
  validStyleActionTarget,
  validStyleKeyboardState,
  validStyleDestinationLayout,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
  validTimelineDensityCaptureState,
  validTimelineDensityOpenTarget,
  validTimelineDensityState,
  validTimelineDensityTimingTarget,
  validTimelineLeadInGeometryState,
}
