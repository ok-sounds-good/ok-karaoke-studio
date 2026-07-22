import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const windowSecurity = readFileSync(
  new URL('../electron/window-security.cjs', import.meta.url),
  'utf8',
)

function cspDirectives() {
  const policy = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1]
  if (!policy) throw new Error('Production Content Security Policy was not found')
  return new Map(
    policy.split(';').map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/u)
      return [name, sources]
    }),
  )
}

describe('production linked-image Content Security Policy', () => {
  it('allows only the existing image sources plus the internal media capability scheme', () => {
    const directives = cspDirectives()

    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'studio-media:'])
    expect(directives.get('img-src')).not.toContain('*')
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('form-action')).toEqual(["'none'"])
  })

  it('keeps the packaged renderer isolated while permitting capability-backed images', () => {
    expect(main).toContain('createMainWindowOptions(')
    const webPreferences = windowSecurity.indexOf('webPreferences: {')
    const windowOptions = windowSecurity.slice(
      webPreferences,
      windowSecurity.indexOf('},', webPreferences),
    )

    expect(windowOptions).toContain('contextIsolation: true')
    expect(windowOptions).toContain('nodeIntegration: false')
    expect(windowOptions).toContain('sandbox: true')
    expect(windowOptions).toContain('webSecurity: true')
    expect(cspDirectives().get('default-src')).toEqual(["'self'"])
  })
})
