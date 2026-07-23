import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lookupLatestInstaller, releasePresentation } from '../site/script.js'

const root = path.resolve(import.meta.dirname, '..')
const releasesUrl = 'https://github.com/ok-sounds-good/ok-karaoke-studio/releases'

function response({ body, ok = true, status = 200 }) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

describe('GitHub Pages site', () => {
  it('keeps every local HTML asset reference present', async () => {
    const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8')
    const references = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/gu)].map((match) => match[1])

    expect(references.length).toBeGreaterThan(0)
    await expect(
      Promise.all(
        [...new Set(references)].map((reference) =>
          readFile(path.join(root, 'site', reference.slice(2))),
        ),
      ),
    ).resolves.toHaveLength(new Set(references).size)
  })

  it('provides a useful release link without JavaScript', async () => {
    const html = await readFile(path.join(root, 'site', 'index.html'), 'utf8')

    expect(html).toContain('Check GitHub Releases')
    expect(html).toContain(`href="${releasesUrl}"`)
    expect(html).toMatch(/When a public download is\s+available/iu)
    expect(html).not.toMatch(/no public\s+installers/iu)
    expect(html).not.toContain('There is not a public one-click installer yet')
  })

  it('offers a confirmed Windows installer without contradictory source copy', async () => {
    const result = await lookupLatestInstaller(async () =>
      response({
        body: {
          assets: [
            {
              browser_download_url: 'https://example.test/Okay-Karaoke-Studio.exe',
              name: 'Okay-Karaoke-Studio.exe',
            },
          ],
          name: 'v0.1.0',
        },
      }),
    )

    expect(result.state).toBe('available')
    expect(releasePresentation(result)).toMatchObject({
      copy: expect.not.stringContaining('No public'),
      linkText: 'Download for Windows',
      linkUrl: 'https://example.test/Okay-Karaoke-Studio.exe',
      state: 'available',
      title: 'Download v0.1.0',
    })
  })

  it.each([
    ['a confirmed 404', async () => response({ ok: false, status: 404 }), 'none'],
    [
      'a release without a Windows installer',
      async () => response({ body: { assets: [], name: 'v0.1.0' } }),
      'none',
    ],
    ['an API rate limit', async () => response({ ok: false, status: 403 }), 'unavailable'],
    [
      'a malformed response',
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json')
        },
      }),
      'unavailable',
    ],
    [
      'an aborted request',
      async () => {
        throw new DOMException('aborted', 'AbortError')
      },
      'unavailable',
    ],
  ])('distinguishes %s', async (_label, fetchLatest, expectedState) => {
    const result = await lookupLatestInstaller(fetchLatest)
    const presentation = releasePresentation(result)

    expect(result.state).toBe(expectedState)
    expect(presentation.linkUrl).toBe(releasesUrl)
    if (expectedState === 'none') {
      expect(presentation.title).toBe('No public installers yet')
      expect(presentation.copy).toContain('Windows, macOS, or Linux')
    }
    if (expectedState === 'unavailable') {
      expect(presentation.title).toBe('Check GitHub Releases')
      expect(presentation.copy).not.toContain('no Windows installer')
    }
  })
})
