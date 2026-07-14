import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeInstalledFonts } from '../src/components/FontSelector'

const require = createRequire(import.meta.url)
const smokeProfiles = require('../electron/smoke-profile.cjs') as {
  createOwnedSmokeProfile(prefix: string): Promise<{
    path: string
    serializedIdentity: string
  }>
}
const fontAccess = require('../electron/font-access.cjs') as {
  createLocalFontPermissionPolicy(options: {
    getMainWindow: () => unknown
    trustedOrigin: string
  }): {
    audit: Array<{ allowed: boolean; handler: string; permission: string }>
    check(
      webContents: unknown,
      permission: string,
      requestingOrigin: string | undefined,
      details: unknown,
    ): boolean
    request(webContents: unknown, permission: string, details: unknown): boolean
  }
  fontAccessProbeScript(): string
  isUsableLocalFont(font: unknown): boolean
  isolatedFontSmokeProfile(rawPath: unknown, defaultPath: string, identity: unknown): string
  publicFontPermissionAudit(audit: unknown): Record<string, unknown>
  publicFontSmokeEvidence(evidence: unknown): Record<string, unknown>
  publicFontSmokeFailure(error: unknown): string
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('installed font access', () => {
  it('limits permission to the trusted packaged main frame and records decisions', () => {
    const webContents = { getURL: () => 'studio-app://app/index.html' }
    const mainWindow = { isDestroyed: () => false, webContents }
    const policy = fontAccess.createLocalFontPermissionPolicy({
      getMainWindow: () => mainWindow,
      trustedOrigin: 'studio-app://app',
    })

    expect(policy.check(
      webContents,
      'local-fonts',
      'studio-app://app',
      { isMainFrame: true },
    )).toBe(true)
    expect(policy.request(webContents, 'local-fonts', {
      isMainFrame: true,
      requestingUrl: 'studio-app://app/index.html',
    })).toBe(true)
    expect(policy.request(webContents, 'local-fonts', { isMainFrame: true })).toBe(false)
    expect(policy.check(webContents, 'camera', 'studio-app://app', {
      isMainFrame: true,
    })).toBe(false)
    expect(policy.check(webContents, 'local-fonts', 'null', {
      isMainFrame: true,
    })).toBe(false)
    expect(policy.check(webContents, 'local-fonts', 'studio-app://app', {
      isMainFrame: false,
    })).toBe(false)
    expect(policy.audit.filter((entry) => entry.allowed)).toEqual([
      expect.objectContaining({ handler: 'check', permission: 'local-fonts' }),
      expect.objectContaining({ handler: 'request', permission: 'local-fonts' }),
    ])
  })

  it('uses the same usable-font predicate as the UI normalizer', () => {
    const cases = [
      {
        family: 'Avenir Next',
        fullName: 'Avenir Next Bold',
        postscriptName: 'AvenirNext-Bold',
        style: 'Bold',
      },
      {
        family: 'Avenir Next',
        fullName: '',
        postscriptName: 'AvenirNext-Bold',
        style: 'Bold',
      },
      {
        family: 'Avenir Next',
        fullName: 'Avenir Next Bold',
        postscriptName: 'invalid font name',
        style: 'Bold',
      },
    ]

    cases.forEach((font) => {
      expect(fontAccess.isUsableLocalFont(font)).toBe(
        normalizeInstalledFonts([font]).length === 1,
      )
    })
  })

  it('keeps the renderer probe aggregate-only', () => {
    const source = fontAccess.fontAccessProbeScript()
    expect(source).not.toContain('sampleFamilies')
    expect(source).not.toContain('.map((font) => font.family)')
    expect(source).toContain('usableCount')
  })

  it('strips private font descriptors and arbitrary error text from smoke output', () => {
    const secret = 'CodexSecretTypeface-DoNotLeak'
    const evidence = fontAccess.publicFontSmokeEvidence({
      focused: true,
      href: 'studio-app://app/index.html',
      localFontLoaded: true,
      origin: 'studio-app://app',
      privateFont: {
        family: secret,
        face: { fullName: secret, postscriptName: secret },
      },
      rawCount: 10,
      secure: true,
      topLevel: true,
      usableCount: 8,
      visibility: 'visible',
    })

    expect(JSON.stringify(evidence)).not.toContain(secret)
    expect(evidence).not.toHaveProperty('privateFont')
    expect(Object.values(evidence).every((value) => (
      typeof value === 'boolean' || typeof value === 'number'
    ))).toBe(true)
    const audit = fontAccess.publicFontPermissionAudit([{
      allowed: true,
      isMainFrame: true,
      permission: 'local-fonts',
      requestingUrl: `file:///private/${secret}`,
    }])
    expect(JSON.stringify(audit)).not.toContain(secret)
    expect(Object.values(audit).every((value) => (
      typeof value === 'boolean' || typeof value === 'number'
    ))).toBe(true)
    expect(fontAccess.publicFontSmokeFailure(new Error(secret))).toBe(
      'FONT_ACCESS_SMOKE_FAILED',
    )
  })

  it('requires the exact owned profile identity isolated from default user data', async () => {
    const defaultProfile = await mkdtemp(join(tmpdir(), 'oks-default-profile-'))
    const smokeProfile = await smokeProfiles.createOwnedSmokeProfile('oks-font-profile-')
    temporaryDirectories.push(defaultProfile, smokeProfile.path)

    expect(fontAccess.isolatedFontSmokeProfile(
      smokeProfile.path,
      defaultProfile,
      smokeProfile.serializedIdentity,
    )).toBe(smokeProfile.path)
    expect(() => fontAccess.isolatedFontSmokeProfile(
      undefined,
      defaultProfile,
      smokeProfile.serializedIdentity,
    )).toThrow(
      'FONT_PROFILE_INVALID',
    )
    expect(() => fontAccess.isolatedFontSmokeProfile(
      smokeProfile.path,
      defaultProfile,
      'not-an-identity',
    )).toThrow(
      'FONT_PROFILE_INVALID',
    )
  })
})
