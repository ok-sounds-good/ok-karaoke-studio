import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createStudioProtocolHandlers,
  installStudioProtocolHandlers,
  parseByteRange,
  registerStudioSchemes,
} = require('../electron/studio-protocols.cjs') as {
  createStudioProtocolHandlers(options: Record<string, unknown>): {
    appFilePathFromUrl(url: string): string | null
    handleApplicationRequest(request: Request): Promise<Response>
    handleMediaRequest(request: Request): Promise<Response>
  }
  parseByteRange(value: string | null, size: number): { start: number; end: number } | false | null
  installStudioProtocolHandlers(options: Record<string, unknown>): void
  registerStudioSchemes(options: Record<string, unknown>): void
}
const {
  createExternalUrlOpener,
  createMainWindowOptions,
  isAllowedAppNavigation,
  secureWebContents,
} = require('../electron/window-security.cjs') as {
  createExternalUrlOpener(options: Record<string, unknown>): (url: string) => Promise<void>
  createMainWindowOptions(options: Record<string, unknown>): Record<string, unknown>
  isAllowedAppNavigation(url: string, options: Record<string, unknown>): boolean
  secureWebContents(contents: FakeContents, options: Record<string, unknown>): void
}
const { prepareVisualSmokeStartup } = require('../electron/visual-smoke-startup.cjs') as {
  prepareVisualSmokeStartup(options: Record<string, unknown>): {
    config: unknown
    fatalObserver: unknown
    startupFailed: boolean
  }
}

function request(url: string, method = 'GET', range?: string) {
  return { headers: new Headers(range ? { range } : undefined), method, url } as Request
}

function protocolFixture(
  mediaFile: Record<string, unknown> | null = null,
  dependencies: Record<string, unknown> = {},
) {
  const revokeToken = vi.fn()
  const owner = {
    isDestroyed: () => false,
    webContents: { id: 17, isDestroyed: () => false },
  }
  const handlers = createStudioProtocolHandlers({
    appHost: 'app',
    appMimeTypes: new Map([['.html', 'text/html']]),
    appScheme: 'studio-app',
    audioMimeTypes: new Map([['.mp3', 'audio/mpeg']]),
    distRoot: '/dist',
    fs: {
      realpath: vi.fn(async (candidate: string) => candidate),
      stat: vi.fn(async () => ({ isFile: () => true, size: 12 })),
    },
    getMainWindow: () => owner,
    getRendererOrigin: () => 'studio-app://app',
    mediaCapabilities: { get: () => mediaFile, revokeToken },
    mediaScheme: 'studio-media',
    mediaTokenFromUrl: () => 'token',
    ...dependencies,
  })
  return { handlers, revokeToken }
}

describe('Electron protocol boundary extraction', () => {
  it('loads extracted helpers without cycling back through the Electron entry point', () => {
    expect(require.cache[require.resolve('../electron/main.cjs')]).toBeUndefined()
  })

  it('registers exactly the privileged application and media schemes', () => {
    const registerSchemesAsPrivileged = vi.fn()
    registerStudioSchemes({
      appScheme: 'studio-app',
      mediaScheme: 'studio-media',
      protocol: { registerSchemesAsPrivileged },
    })
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({ scheme: 'studio-app' }),
      expect.objectContaining({ scheme: 'studio-media' }),
    ])
  })

  it('denies malformed and escaping application paths before filesystem access', async () => {
    const { handlers } = protocolFixture()
    expect(handlers.appFilePathFromUrl('studio-app://other/index.html')).toBeNull()
    expect(handlers.appFilePathFromUrl('studio-app://app/%2e%2e%2fprivate.txt')).toBeNull()
    await expect(
      handlers.handleApplicationRequest(request('studio-app://app/private.txt', 'POST')),
    ).resolves.toMatchObject({ status: 405 })
  })

  it('serves a contained packaged asset through the dependency-injected stream', async () => {
    const createReadStream = vi.fn(() => Readable.from([Buffer.from('trusted asset')]))
    const { handlers } = protocolFixture(null, { createReadStream })
    const response = await handlers.handleApplicationRequest(request('studio-app://app/index.html'))
    expect(response).toMatchObject({ status: 200 })
    expect(response.headers.get('content-type')).toBe('text/html')
    await expect(response.text()).resolves.toBe('trusted asset')
    expect(createReadStream).toHaveBeenCalledWith('/dist/index.html')
  })

  it('installs only the requested application handler and always installs media', () => {
    const handle = vi.fn()
    const protocol = { handle }
    const handlers = {
      handleApplicationRequest: vi.fn(),
      handleMediaRequest: vi.fn(),
    }
    installStudioProtocolHandlers({
      appScheme: 'studio-app',
      handlers,
      installApplication: false,
      mediaScheme: 'studio-media',
      protocol,
    })
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle).toHaveBeenCalledWith('studio-media', handlers.handleMediaRequest)
  })

  it('keeps byte ranges bounded and rejects unsatisfiable media requests', async () => {
    expect(parseByteRange('bytes=2-99', 5)).toEqual({ start: 2, end: 4 })
    expect(parseByteRange('bytes=-2', 5)).toEqual({ start: 3, end: 4 })
    expect(parseByteRange('bytes=5-6', 5)).toBe(false)
    expect(parseByteRange('bytes=0-0', 0)).toBe(false)

    const { handlers } = protocolFixture({
      bytes: Buffer.from('hello'),
      kind: 'background',
      mime: 'image/png',
      ownerId: 17,
    })
    const partial = await handlers.handleMediaRequest(
      request('studio-media://asset/token', 'GET', 'bytes=1-3'),
    )
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 1-3/5')
    await expect(partial.text()).resolves.toBe('ell')
    const invalid = await handlers.handleMediaRequest(
      request('studio-media://asset/token', 'HEAD', 'bytes=9-'),
    )
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */5')
  })

  it('revokes media tokens whose owner or kind cannot be trusted', async () => {
    const { handlers, revokeToken } = protocolFixture({ kind: 'script', ownerId: 17 })
    const response = await handlers.handleMediaRequest(request('studio-media://asset/token'))
    expect(response.status).toBe(404)
    expect(revokeToken).toHaveBeenCalledWith('token')
  })
})

class FakeContents extends EventEmitter {
  id = 9
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
    this.windowOpenHandler = handler
  }
}

describe('Electron window trust boundary extraction', () => {
  it('preserves isolated BrowserWindow preferences', () => {
    const options = createMainWindowOptions({
      appName: 'Okay Karaoke Studio',
      preloadPath: '/app/preload.cjs',
      visualSmokeConfig: null,
    }) as { webPreferences: Record<string, unknown> }
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    })
  })

  it('allows only expected navigation and external protocols', async () => {
    const openExternal = vi.fn(async () => undefined)
    const open = createExternalUrlOpener({ logger: vi.fn(), openExternal })
    expect(
      isAllowedAppNavigation('studio-app://app/index.html', {
        appHost: 'app',
        appScheme: 'studio-app',
        developmentUrl: 'http://127.0.0.1:5173',
        useBuiltRenderer: () => true,
      }),
    ).toBe(true)
    expect(
      isAllowedAppNavigation('studio-app://app/assets/app.js', {
        appHost: 'app',
        appScheme: 'studio-app',
        developmentUrl: 'http://127.0.0.1:5173',
        useBuiltRenderer: () => true,
      }),
    ).toBe(false)
    expect(
      isAllowedAppNavigation('studio-app://app:443/index.html', {
        appHost: 'app',
        appScheme: 'studio-app',
        developmentUrl: 'http://127.0.0.1:5173',
        useBuiltRenderer: () => true,
      }),
    ).toBe(false)
    expect(
      isAllowedAppNavigation('studio-app://other/index.html', {
        appHost: 'app',
        appScheme: 'studio-app',
        developmentUrl: 'http://127.0.0.1:5173',
        useBuiltRenderer: () => true,
      }),
    ).toBe(false)
    await open('https://example.test/path')
    await open('file:///private/secret')
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('contains external-launch failures in the main process', async () => {
    const logger = vi.fn()
    const open = createExternalUrlOpener({
      logger,
      openExternal: vi.fn(async () => {
        throw new Error('unavailable')
      }),
    })
    await expect(open('https://example.test')).resolves.toBeUndefined()
    expect(logger).toHaveBeenCalledWith('Unable to open external URL:', expect.any(Error))
  })

  it('denies popups and navigation while releasing an owner once on terminal loss', async () => {
    const contents = new FakeContents()
    const openExternalUrl = vi.fn(async () => undefined)
    const releaseOwner = vi.fn()
    const clearNativeCloseOwnership = vi.fn()
    secureWebContents(contents, {
      BrowserWindow: { fromWebContents: () => null },
      clearNativeCloseOwnership,
      dialog: { showMessageBoxSync: () => 1 },
      isAllowedNavigation: () => false,
      openExternalUrl,
      releaseOwner,
    })
    expect(contents.windowOpenHandler?.({ url: 'https://example.test' })).toEqual({
      action: 'deny',
    })
    const preventDefault = vi.fn()
    contents.emit('will-navigate', { preventDefault }, 'https://example.test')
    expect(preventDefault).toHaveBeenCalledOnce()
    contents.emit('render-process-gone')
    contents.emit('destroyed')
    expect(releaseOwner).toHaveBeenCalledTimes(1)
    expect(clearNativeCloseOwnership).toHaveBeenCalledWith(9)
    await Promise.resolve()
    expect(openExternalUrl).toHaveBeenCalledTimes(2)
  })
})

describe('visual smoke startup gate', () => {
  it('does not resolve the visual-smoke validator graph for ordinary argv', () => {
    const loadVisualSmoke = vi.fn()
    const startup = prepareVisualSmokeStartup({
      app: {},
      argv: ['electron', '.'],
      loadVisualSmoke,
      processHandle: {},
    })
    expect(startup).toMatchObject({ config: null, startupFailed: false })
    expect(loadVisualSmoke).not.toHaveBeenCalled()
  })

  it('fails closed for smoke options without a trigger and preserves parse-configure-observe order', () => {
    const invalidLoader = vi.fn(() => ({
      parseVisualSmokeArguments: () => {
        throw new Error('bad')
      },
    }))
    expect(
      prepareVisualSmokeStartup({
        app: {},
        argv: ['--oks-video-style-visual-output=/tmp/out'],
        loadVisualSmoke: invalidLoader,
        processHandle: {},
      }).startupFailed,
    ).toBe(true)
    expect(invalidLoader).toHaveBeenCalledOnce()

    const order: string[] = []
    const startup = prepareVisualSmokeStartup({
      app: {},
      argv: ['--oks-video-style-visual-smoke'],
      loadVisualSmoke: () => ({
        configureVisualSmokeBeforeReady: () => {
          order.push('configure')
          return { ready: true }
        },
        installVisualSmokeFatalObserver: () => {
          order.push('observe')
          return { observeRenderer: vi.fn() }
        },
        parseVisualSmokeArguments: () => {
          order.push('parse')
          return { output: '/tmp/out' }
        },
      }),
      processHandle: {},
    })
    expect(startup.startupFailed).toBe(false)
    expect(order).toEqual(['parse', 'configure', 'observe'])
  })
})
