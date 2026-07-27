'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const fs = require('node:fs/promises')
const {
  PACKAGED_APP_URL,
  installVisualSmokeFatalObserver,
  runVisualSmoke,
} = require('../../electron/video-style-visual-smoke.cjs')

const APP_SCHEME = 'studio-app'
const CLOSE_CHANNEL = 'studio:get-pending-window-close'
const PROBE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body, #root { height: 100%; margin: 0; width: 100%; }
      .topbar__actions { display: flex; gap: 8px; overflow-x: auto; width: 100%; }
      .unified-workspace > .play-button,
      .unified-workspace > select,
      .unified-workspace > input { position: fixed; top: 30px; }
      .unified-workspace {
        --workspace-divider-size: 7px;
        --workspace-timing-min: 235px;
        --workspace-top-min: 245px;
        box-sizing: border-box;
        display: grid;
        grid-template-rows:
          minmax(var(--workspace-top-min), var(--workspace-top-height, 43%))
          var(--workspace-divider-size)
          minmax(var(--workspace-timing-min), 1fr);
        height: calc(100% - 21px);
        min-height: 0;
        overflow: hidden;
        padding: 7px;
      }
      #workspace-timing-region,
      .timeline-panel,
      .timeline-viewport { height: 100%; min-height: 0; }
      .timeline-ruler,
      .timeline-lead-in,
      .timeline-waveform { box-sizing: border-box; }
      .timeline-canvas { position: relative; }
      .timeline-ruler { height: 28px; }
      .timeline-waveform { height: 76px; margin-left: 96px; }
      .timeline-lead-in { height: 76px; left: 0; position: absolute; top: 28px; width: 96px; }
    </style>
  </head>
  <body>
    <div id="root">
      <aside aria-label="Project inspector" style="
        background: #fff;
        border: 1px solid #000;
        left: 8px;
        padding: 6px;
        position: fixed;
        top: 8px;
        width: 260px;
        z-index: 10;
      ">
        <label>
          Opening lead-in seconds
          <input aria-label="Opening lead-in seconds" type="number" value="0" />
        </label>
      </aside>
      <nav class="topbar__actions" aria-label="Project actions">
        <button class="style-button" aria-label="Edit project Style">Style</button>
        <button aria-label="New project">New</button>
        <button aria-label="Open project">Open</button>
        <button aria-label="Save project">Save</button>
        <button class="workflow-button">Workflow</button>
        <button class="validation-button">Validate</button>
        <button>Export</button>
      </nav>
      <main class="unified-workspace">
        <button class="play-button">Play</button>
        <select aria-label="Playback speed"><option>1×</option></select>
        <input aria-label="Volume" type="range" />
        <input aria-label="Timeline zoom" type="range" />
        <section id="workspace-stage-region" aria-label="Karaoke preview">Renderer fatal smoke probe</section>
        <div
          aria-label="Stage Monitor and Lyric Timing height"
          aria-orientation="horizontal"
          aria-valuemax="100"
          aria-valuemin="0"
          aria-valuenow="44"
          role="separator"
          tabindex="0"
        ></div>
        <div id="workspace-timing-region" style="overflow:hidden">
          <section class="timeline-panel" aria-label="Lyric Timing">
            <div class="timeline-viewport" style="overflow:auto">
              <div class="timeline-canvas">
                <div class="timeline-lead-in" aria-hidden="true"></div>
                <div class="timeline-ruler" aria-hidden="true"></div>
                <div class="timeline-waveform">
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
    <script>
      const workspace = document.querySelector('.unified-workspace')
      const stage = document.querySelector('#workspace-stage-region')
      const divider = document.querySelector('[role="separator"]')
      const cssNumber = (style, property) => {
        const value = Number.parseFloat(style.getPropertyValue(property))
        return Number.isFinite(value) ? value : 0
      }
      const ratioForHeight = (height, availableHeight) =>
        availableHeight <= 0 ? 0 : Math.min(1, Math.max(0, height / availableHeight))
      const updateDividerAria = () => {
        const style = getComputedStyle(workspace)
        const contentHeight =
          workspace.clientHeight - cssNumber(style, 'padding-top') - cssNumber(style, 'padding-bottom')
        const availableHeight = Math.max(0, contentHeight - cssNumber(style, '--workspace-divider-size'))
        const maximumHeight = Math.max(0, availableHeight - cssNumber(style, '--workspace-timing-min'))
        const minimumHeight = Math.min(cssNumber(style, '--workspace-top-min'), maximumHeight)
        const minimum = Math.round(ratioForHeight(minimumHeight, availableHeight) * 100)
        const maximum = Math.round(ratioForHeight(maximumHeight, availableHeight) * 100)
        const current = Math.round(
          ratioForHeight(stage.getBoundingClientRect().height, availableHeight) * 100,
        )
        divider.setAttribute('aria-valuemin', String(minimum))
        divider.setAttribute('aria-valuemax', String(maximum))
        divider.setAttribute('aria-valuenow', String(current))
        divider.setAttribute(
          'aria-valuetext',
          current + '% Stage Monitor height; ' + (100 - current) + '% Lyric Timing height',
        )
      }
      updateDividerAria()
      window.addEventListener('oks-captured', () => {
        setTimeout(() => {
          throw new TypeError('renderer-fatal-probe')
        }, 50)
      }, { once: true })
    </script>
  </body>
</html>`

function argument(prefix) {
  const matches = process.argv.filter((value) => value.startsWith(prefix))
  if (matches.length !== 1) throw new Error('RENDERER_FATAL_PROBE_ARGUMENT_INVALID')
  const value = matches[0].slice(prefix.length)
  if (!value || value.includes('\0')) throw new Error('RENDERER_FATAL_PROBE_ARGUMENT_INVALID')
  return value
}

const output = argument('--output=')
const status = argument('--status=')
app.setPath('userData', argument('--user-data='))
app.setPath('sessionData', argument('--session-data='))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => undefined)

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

async function writeStatus(value) {
  await fs.writeFile(status, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' })
}

async function runProbe() {
  await app.whenReady()
  ipcMain.handle(CLOSE_CHANNEL, async () => null)
  protocol.handle(
    APP_SCHEME,
    () =>
      new Response(PROBE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      }),
  )

  const window = new BrowserWindow({
    height: 720,
    show: true,
    useContentSize: true,
    width: 1280,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: require.resolve('../../electron/preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  })
  const fatalObserver = installVisualSmokeFatalObserver(process)
  fatalObserver.observeRenderer(window.webContents)
  const capturePage = window.webContents.capturePage.bind(window.webContents)
  let capturedBeforeFatal = false
  window.webContents.capturePage = async (...args) => {
    const image = await capturePage(...args)
    capturedBeforeFatal ||= !fatalObserver.hasFatal()
    await window.webContents.executeJavaScript(
      "window.dispatchEvent(new Event('oks-captured'))",
      false,
    )
    return image
  }
  await window.loadURL(PACKAGED_APP_URL)

  const outcome = await runVisualSmoke(
    { app, config: { output }, fatalObserver, window },
    { focus: async () => true },
  )
  const observed = fatalObserver.hasFatal()
  const destroyed = window.isDestroyed()
  fatalObserver.dispose()
  ipcMain.removeHandler(CLOSE_CHANNEL)
  await writeStatus({
    destroyed,
    disposed: true,
    fatal: observed,
    capturedBeforeFatal: capturedBeforeFatal && observed,
    ok: outcome.ok,
  })
  app.exit(outcome.ok ? 0 : 1)
}

runProbe().catch(async () => {
  try {
    await writeStatus({ failed: true })
  } catch {
    // The parent test treats a missing exclusive status file as a failed probe.
  }
  app.exit(2)
})
