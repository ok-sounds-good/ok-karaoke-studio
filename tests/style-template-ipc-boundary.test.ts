import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

describe('style template Electron boundary', () => {
  const main = source('electron/main.cjs')
  const preload = source('electron/preload.cjs')
  const types = source('src/electron.d.ts')

  it('keeps the fixed store path exclusively in the main process', () => {
    expect(main).toContain("path.join(app.getPath('userData'), 'style-templates.json')")
    expect(preload).not.toContain('userData')
    expect(preload).not.toContain('style-templates.json')
    expect(types).not.toContain('style-templates.json')
  })

  it('trust-checks every handler before forwarding request values', () => {
    for (const channel of [
      'listStyleTemplates',
      'createStyleTemplate',
      'renameStyleTemplate',
      'deleteStyleTemplate',
    ]) {
      const start = main.indexOf(`ipcMain.handle(CHANNELS.${channel}`)
      const end = main.indexOf('\n  })', start)
      const handler = main.slice(start, end)
      expect(start).toBeGreaterThan(0)
      expect(handler).toContain('assertTrustedSender(event)')
      if (channel !== 'listStyleTemplates') {
        expect(handler.indexOf('assertTrustedSender(event)')).toBeLessThan(
          handler.indexOf(`styleTemplateStore.${channel.replace('StyleTemplate', '')}(value)`),
        )
      }
    }
  })

  it('exposes only pathless CRUD requests and validates main-process results', () => {
    expect(preload).toContain(
      'listStyleTemplates: async () =>\n    requireStyleTemplateList(await ipcRenderer.invoke(CHANNELS.listStyleTemplates))',
    )
    expect(preload).toContain('requireStyleTemplateCreateRequest(options)')
    expect(preload).toContain("requireStyleTemplateId(id, 'renameStyleTemplate')")
    expect(preload).toContain("requireStyleTemplateId(id, 'deleteStyleTemplate')")
    expect(preload).toContain('requireStyleTemplate(')
    expect(preload).toContain('deleted !== true')
    for (const method of [
      'listStyleTemplates()',
      'createStyleTemplate(options:',
      'renameStyleTemplate(id:',
      'deleteStyleTemplate(id:',
    ]) {
      expect(types).toContain(method)
    }
  })
})
