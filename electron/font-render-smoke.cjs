'use strict'

const {
  assetInvocation,
  frameInvocation,
  renderDocument,
} = require('./video-style-document.cjs')
const STAGE_LAYOUT = require('./stage-layout.json')
const SYNC_AID_GEOMETRY = require('./sync-aid-geometry.json')

function localTextStyle(font, sizePx, color, visible) {
  return {
    typeface: {
      kind: 'local',
      family: font.family,
      faces: [{ ...font.face }],
    },
    fontStyle: { ...font.face },
    sizePx,
    color,
    ...(visible === undefined ? {} : { visible }),
  }
}

function smokeFrame(font) {
  const lyrics = localTextStyle(font, 64, '#F4F5EB')
  return {
    title: 'Font render check',
    artist: 'Okay Karaoke Studio',
    playbackMs: 0,
    showTitle: false,
    stageStyle: {
      background: {
        mode: 'solid',
        solidColor: '#21182D',
        gradientStartColor: '#322242',
        gradientEndColor: '#1E1629',
        imagePath: null,
      },
      lyrics: {
        ...lyrics,
        unsungColor: '#F4F5EB',
        sungColor: '#FF8A2B',
      },
      titleCard: {
        eyebrow: localTextStyle(font, 24, '#F4F5EB', true),
        title: localTextStyle(font, 72, '#F4F5EB', true),
        artist: localTextStyle(font, 36, '#F4F5EB', true),
      },
      stageFrame: {
        enabled: false,
        lineColor: '#473C54',
        lineWidthPx: 2,
        brand: localTextStyle(font, 24, '#F4F5EB', false),
        clock: localTextStyle(font, 24, '#F4F5EB', false),
        footer: localTextStyle(font, 24, '#F4F5EB', false),
      },
    },
    lines: [{
      id: 'font-smoke-line',
      trackId: 'font-smoke-track',
      text: 'Font render check',
      style: {
        ...lyrics,
        alignment: 'center',
        unsungColor: '#F4F5EB',
        sungColor: '#FF8A2B',
      },
      words: [{ text: 'Font', progress: 0.5 }, { text: 'render', progress: 0 }],
    }],
    syncAids: [],
  }
}

async function runFontRenderSmoke(BrowserWindow, font) {
  if (!font?.family || !font?.face?.postscriptName) {
    throw new Error('FONT_RENDER_INPUT_INVALID')
  }
  const window = new BrowserWindow({
    show: false,
    width: 426,
    height: 240,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  try {
    const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(renderDocument({
      width: 426,
      height: 240,
    }))}`
    await window.loadURL(documentUrl)
    const devicePixelRatio = await window.webContents.executeJavaScript(
      'window.devicePixelRatio',
    )
    if (devicePixelRatio !== 1) throw new Error('FONT_RENDER_CAPTURE_INVALID')
    const runtime = {
      fonts: [{
        typeface: { kind: 'local', family: font.family, faces: [{ ...font.face }] },
        fontStyle: { ...font.face },
      }],
      backgroundDataUrl: '',
      stageLayout: STAGE_LAYOUT,
      syncAidGeometry: SYNC_AID_GEOMETRY,
    }
    const assets = await window.webContents.executeJavaScript(assetInvocation(runtime))
    if (assets?.fontFallbacks?.length) throw new Error('FONT_RENDER_FALLBACK')
    await window.webContents.executeJavaScript(frameInvocation(smokeFrame(font), 0))
    await window.webContents.executeJavaScript(
      'new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    )
    const image = await window.webContents.capturePage()
    const size = image.getSize()
    if (image.isEmpty() || size.width !== 426 || size.height !== 240) {
      throw new Error('FONT_RENDER_CAPTURE_INVALID')
    }
    const preferences = window.webContents.getLastWebPreferences()
    if (
      preferences.sandbox !== true ||
      preferences.contextIsolation !== true ||
      preferences.nodeIntegration !== false
    ) throw new Error('FONT_RENDER_SANDBOX_INVALID')
    return {
      devicePixelRatio,
      frameCaptured: true,
      localFontLoaded: true,
      sandboxed: true,
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

module.exports = { runFontRenderSmoke }
