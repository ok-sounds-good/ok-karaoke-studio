'use strict'

const { VIEWPORT } = require('../scripts/visual-result-validation.cjs')

function expectedCssViewport({ browserZoom, contentHeight, contentWidth }) {
  const width = Math.floor(contentWidth / browserZoom)
  const height = Math.floor(contentHeight / browserZoom)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error('VISUAL_SMOKE_PROFILE_INVALID')
  return Object.freeze({ height, width })
}

function layoutProfile(values) {
  return Object.freeze({ ...values, cssViewport: expectedCssViewport(values) })
}

// Browser zoom changes CSS layout units; device scale changes backing-pixel
// density. Keep both inputs explicit so compact-layout coverage never treats
// a page zoom as a display-DPR substitute.
const LAYOUT_SMOKE_PROFILES = Object.freeze([
  layoutProfile({
    browserZoom: 1,
    contentHeight: VIEWPORT.height,
    contentWidth: VIEWPORT.width,
    deviceScale: 1,
    name: '100',
    requireInitialViewport: true,
  }),
  layoutProfile({
    browserZoom: 1.25,
    contentHeight: VIEWPORT.height,
    contentWidth: VIEWPORT.width,
    deviceScale: 1,
    name: '125',
    requireInitialViewport: false,
  }),
  layoutProfile({
    browserZoom: 1.5,
    contentHeight: VIEWPORT.height,
    contentWidth: VIEWPORT.width,
    deviceScale: 1,
    name: '150',
    requireInitialViewport: false,
  }),
  // capturePage returns backing pixels. At a device scale of two, a 640x360
  // content box with 50% browser zoom yields the contract's 1280x720 image
  // while preserving a 1280x720 CSS layout viewport. This is intentionally
  // represented as two independent profile dimensions.
  layoutProfile({
    browserZoom: 0.5,
    contentHeight: VIEWPORT.height / 2,
    contentWidth: VIEWPORT.width / 2,
    deviceScale: 2,
    name: 'dpr2',
    requireInitialViewport: true,
  }),
])

function layoutSmokeProfile(name) {
  return LAYOUT_SMOKE_PROFILES.find((profile) => profile.name === name) ?? null
}

module.exports = { LAYOUT_SMOKE_PROFILES, expectedCssViewport, layoutSmokeProfile }
