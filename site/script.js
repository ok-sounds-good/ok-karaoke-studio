const RELEASES_URL = 'https://github.com/ok-sounds-good/ok-karaoke-studio/releases'
const LATEST_RELEASE_API =
  'https://api.github.com/repos/ok-sounds-good/ok-karaoke-studio/releases/latest'

export async function lookupLatestInstaller(fetchLatest, signal) {
  try {
    const response = await fetchLatest(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    })

    if (response.status === 404) return { state: 'none' }
    if (!response.ok) return { state: 'unavailable' }

    const release = await response.json()
    const installer = release.assets?.find(
      (asset) => typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.exe'),
    )

    if (!installer?.browser_download_url) return { state: 'none' }

    return {
      state: 'available',
      downloadUrl: installer.browser_download_url,
      releaseName: release.name || release.tag_name || 'the latest release',
    }
  } catch {
    return { state: 'unavailable' }
  }
}

export function releasePresentation(result) {
  if (result.state === 'available') {
    return {
      state: 'available',
      status: 'Public installer available',
      title: `Download ${result.releaseName}`,
      copy: 'Windows x64 · unsigned installer. Windows may ask you to confirm before it opens.',
      linkText: 'Download for Windows',
      linkClass: 'button button--primary',
      linkUrl: result.downloadUrl,
    }
  }

  if (result.state === 'none') {
    return {
      state: 'source',
      status: 'Source setup for now',
      title: 'No public installers yet',
      copy: 'There is no public app download for Windows, macOS, or Linux yet. Use the four short steps below.',
      linkText: 'View all releases',
      linkClass: 'button button--secondary',
      linkUrl: RELEASES_URL,
    }
  }

  return {
    state: 'unknown',
    status: 'Automatic check unavailable',
    title: 'Check GitHub Releases',
    copy: 'The automatic check did not finish. GitHub Releases has the current answer. If nothing is listed, use the steps below.',
    linkText: 'View releases',
    linkClass: 'button button--secondary',
    linkUrl: RELEASES_URL,
  }
}

export function renderReleasePresentation(presentation, elements) {
  elements.card.dataset.releaseState = presentation.state
  elements.status.textContent = presentation.status
  elements.title.textContent = presentation.title
  elements.copy.textContent = presentation.copy
  elements.link.textContent = presentation.linkText
  elements.link.className = presentation.linkClass
  elements.link.href = presentation.linkUrl
}

async function showLatestRelease(elements) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 3000)

  try {
    const result = await lookupLatestInstaller(globalThis.fetch, controller.signal)
    renderReleasePresentation(releasePresentation(result), elements)
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

if (typeof document !== 'undefined') {
  const elements = {
    card: document.querySelector('#release-card'),
    status: document.querySelector('#release-status'),
    title: document.querySelector('#release-title'),
    copy: document.querySelector('#release-copy'),
    link: document.querySelector('#release-link'),
  }

  if (Object.values(elements).every(Boolean)) showLatestRelease(elements)

  const copyButton = document.querySelector('[data-copy-command]')

  copyButton?.addEventListener('click', async () => {
    const command = 'bun install --frozen-lockfile\nbun run dev'
    try {
      await navigator.clipboard.writeText(command)
      copyButton.textContent = 'Copied'
      globalThis.setTimeout(() => {
        copyButton.textContent = 'Copy'
      }, 1800)
    } catch {
      copyButton.textContent = 'Select the text'
    }
  })
}
