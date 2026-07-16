import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

describe('linked-background Electron boundary', () => {
  const main = source('electron/main.cjs')
  const preload = source('electron/preload.cjs')
  const types = source('src/electron.d.ts')

  it('keeps selection native, trusted, and pathless from the renderer', () => {
    const start = main.indexOf('ipcMain.handle(CHANNELS.chooseBackgroundImage')
    const end = main.indexOf('ipcMain.handle(CHANNELS.resolveProjectBackground', start)
    const handler = main.slice(start, end)
    expect(start).toBeGreaterThan(0)
    expect(handler.indexOf('assertTrustedSender(event)')).toBeLessThan(
      handler.indexOf('dialog.showOpenDialog(owner'),
    )
    expect(handler).toContain('filters: BACKGROUND_IMAGE_FILTERS')
    expect(handler).toContain('readLinkedImage(filePath')
    expect(handler).not.toContain('value.path')
    expect(preload).toContain(
      'chooseBackgroundImage: () => ipcRenderer.invoke(CHANNELS.chooseBackgroundImage)',
    )
  })

  it('serves background snapshot bytes and decoder MIME instead of reopening its path', () => {
    const start = main.indexOf("if (mediaFile.kind === 'background')")
    const end = main.indexOf('const filePath = mediaFile.filePath', start)
    const branch = main.slice(start, end)
    expect(branch).toContain("'Content-Type': mediaFile.mime")
    expect(branch).toContain('Buffer.from(mediaFile.bytes.subarray')
    expect(branch).not.toContain('createReadStream')
    expect(main).toContain("mime: image.format === 'png' ? 'image/png' : 'image/jpeg'")
  })

  it('exposes only opaque settlement and exact-project restore operations', () => {
    for (const name of [
      'resolveProjectBackground',
      'settleBackgroundImage',
      'retainBackground',
      'releaseBackground',
      'releaseBackgroundSnapshot',
      'getBackgroundState',
    ]) {
      expect(preload).toContain(`${name}:`)
      expect(types).toContain(`${name}(`)
    }
    expect(main).toContain('prepareProjectMedia(scope.path, scope.project, AUDIO_EXTENSIONS)')
    expect(main).toContain('mediaCapabilities.replaceProjectScope(ownerId, scope.projectPath')
    expect(main).toContain("normalizeBackgroundMutationRequest(value, 'nullable', MEDIA_SCHEME)")
    expect(main).toContain("status: 'missing'")
    expect(main).toContain("return { status: 'stale' }")
    const retainHandler = main.slice(main.indexOf('ipcMain.handle(CHANNELS.retainBackground'))
    expect(retainHandler.indexOf('assertTrustedSender(event)')).toBeLessThan(
      retainHandler.indexOf('normalizeBackgroundMutationRequest'),
    )
  })

  it('cleans capability ownership on navigation, renderer loss, and destruction', () => {
    const secureContents = main.slice(main.indexOf('function secureWebContents'))
    expect(secureContents).toContain('mediaCapabilities.releaseOwner(ownerId)')
    expect(secureContents).toContain("contents.on('did-start-navigation'")
    expect(secureContents).toContain("contents.once('render-process-gone', releaseTerminalScope)")
    expect(secureContents).toContain("contents.once('destroyed'")
  })
})
