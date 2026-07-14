import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('video style renderer security and cascade', () => {
  it('allows capability-scoped linked images without broadening other CSP directives', () => {
    const html = source('../index.html')
    const policy = html.match(/content="([^"]*default-src[^\"]*)"/)?.[1]

    expect(policy).toContain("img-src 'self' data: blob: studio-media:")
    expect(policy).toContain("media-src 'self' blob: studio-media:")
    expect(policy).toContain("object-src 'none'")
  })

  it('loads product identity before persisted video styles and visually hides sr-only labels', () => {
    const entry = source('../src/main.tsx')
    const identityIndex = entry.indexOf("import './identity.css'")
    const stageIndex = entry.indexOf("import './stage-rendering.css'")
    const videoStyleIndex = entry.indexOf("import './video-style.css'")
    const fontStyleIndex = entry.indexOf("import './font-selector.css'")
    const fontCss = source('../src/font-selector.css')

    expect(identityIndex).toBeGreaterThan(-1)
    expect(stageIndex).toBeGreaterThan(identityIndex)
    expect(videoStyleIndex).toBeGreaterThan(stageIndex)
    expect(fontStyleIndex).toBeGreaterThan(videoStyleIndex)
    expect(fontCss).toMatch(/\.sr-only\s*\{[\s\S]*position:\s*absolute/)
    expect(fontCss).toMatch(/\.sr-only\s*\{[\s\S]*clip:\s*rect\(0, 0, 0, 0\)/)
    expect(fontCss).toMatch(
      /\.font-selector__sample\s*\{[\s\S]*height:\s*92px;[\s\S]*overflow:\s*auto;/u,
    )
  })

  it('acknowledges native-close cancellation only when main actually clears a latch', () => {
    const main = source('../electron/main.cjs')
    const preload = source('../electron/preload.cjs')

    expect(main).toMatch(
      /const action = rendererLifecycleRequest[\s\S]{0,160}?rendererLifecycleRequest = null[\s\S]{0,120}?if \(!action\) return false[\s\S]{0,80}?if \(!proceed\) return true/u,
    )
    expect(preload).toMatch(
      /resolveWindowClose: async \(proceed\) => \([\s\S]{0,120}?ipcRenderer\.invoke\(CHANNELS\.resolveWindowClose, proceed\)[\s\S]{0,40}?\) === true/u,
    )
  })

  it('settles an exact pending project open before renderer restore begins', () => {
    const preload = source('../electron/preload.cjs')
    const lifecycle = source('../src/hooks/useProjectLifecycle.ts')
    const coordinator = source('../electron/project-open.cjs')

    expect(preload).toContain("settleProjectOpen: 'studio:settle-project-open'")
    expect(preload).toMatch(
      /settleProjectOpen: async \(requestId, accepted\) => \([\s\S]{0,180}?\) === true/u,
    )
    expect(lifecycle.indexOf('settlePendingOpen(true)')).toBeLessThan(
      lifecycle.indexOf('resetProject(next, true)'),
    )
    expect(coordinator).toMatch(
      /mediaRequests\.invalidateOwner\(ownerId\)[\s\S]{0,120}?linkedAssets\.revokeOwner\(ownerId\)[\s\S]{0,180}?linkedAssets\.authorizeProject/u,
    )
  })

  it('grants a completed save path only through its captured owner write generation', () => {
    const main = source('../electron/main.cjs')
    const handler = main.slice(
      main.indexOf('ipcMain.handle(CHANNELS.saveProject'),
      main.indexOf('ipcMain.handle(CHANNELS.importAudio'),
    )
    const captureIndex = handler.indexOf('projectOpens.captureWriteGrant(ownerId)')
    const decodeIndex = handler.indexOf('parseCurrentProject(request.contents)')
    const dialogIndex = handler.indexOf('showCanonicalSaveDialog')
    const writeIndex = handler.indexOf('await queueProjectWrite(filePath, request.contents)')
    const grantIndex = handler.indexOf(
      'projectOpens.grantWrite(ownerId, filePath, writeGrant)',
    )

    expect(captureIndex).toBeGreaterThan(-1)
    expect(decodeIndex).toBeGreaterThan(captureIndex)
    expect(decodeIndex).toBeLessThan(dialogIndex)
    expect(decodeIndex).toBeLessThan(writeIndex)
    expect(captureIndex).toBeLessThan(dialogIndex)
    expect(captureIndex).toBeLessThan(writeIndex)
    expect(writeIndex).toBeLessThan(grantIndex)
  })

  it('requires a trusted main revocation acknowledgment before New resets the renderer', () => {
    const main = source('../electron/main.cjs')
    const preload = source('../electron/preload.cjs')
    const lifecycle = source('../src/hooks/useProjectLifecycle.ts')
    const handler = main.slice(
      main.indexOf('ipcMain.handle(CHANNELS.resetProjectScope'),
      main.indexOf('ipcMain.handle(CHANNELS.saveProject'),
    )

    expect(preload).toContain("resetProjectScope: 'studio:reset-project-scope'")
    expect(preload).toMatch(
      /resetProjectScope: async \(\) => \([\s\S]{0,140}?\) === true/u,
    )
    expect(handler).toMatch(
      /assertTrustedSender\(event\)[\s\S]{0,160}?projectOpens\.resetProjectScope\(ownerId\)[\s\S]{0,100}?mediaRequests\.invalidateOwner\(ownerId\)[\s\S]{0,100}?linkedAssets\.revokeOwner\(ownerId\)[\s\S]{0,50}?return true/u,
    )
    expect(lifecycle.indexOf("confirmDiscard('Discard the unsaved changes and start a new project?')"))
      .toBeLessThan(lifecycle.indexOf('await window.studio.resetProjectScope()'))
    expect(lifecycle.indexOf('await window.studio.resetProjectScope()')).toBeLessThan(
      lifecycle.indexOf("createProject({ title: 'Untitled Song'"),
    )
  })

  it('authorizes the strict project and owner media before the video destination dialog', () => {
    const main = source('../electron/main.cjs')
    const handler = main.slice(
      main.indexOf('ipcMain.handle(CHANNELS.exportVideo'),
      main.indexOf('ipcMain.handle(CHANNELS.cancelVideoExport'),
    )

    expect(handler.indexOf('authorizeVideoExportRequest(event.sender.id, value)')).toBeGreaterThan(-1)
    expect(handler.indexOf('authorizeVideoExportRequest(event.sender.id, value)')).toBeLessThan(
      handler.indexOf('showCanonicalSaveDialog'),
    )
    expect(handler.indexOf('await preflightVideoExportBackground')).toBeLessThan(
      handler.indexOf('showCanonicalSaveDialog'),
    )
    expect(handler.indexOf('showCanonicalSaveDialog')).toBeLessThan(
      handler.indexOf('exportKaraokeVideo'),
    )
    expect(handler).toContain('readLinkedImage: readStaticImage')
    expect(handler).toContain('resolveFfmpegPath: async () => ensureFfmpegForExport')
  })
})
