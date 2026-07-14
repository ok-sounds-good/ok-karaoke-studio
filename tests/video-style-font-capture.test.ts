// @vitest-environment happy-dom

import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PUBLIC_FONT_CAPTURE_EVENT,
  PublicFontSelector,
} from '../src/components/PublicFontSelector'

const require = createRequire(import.meta.url)
const capture = require('../electron/video-style-font-capture.cjs') as {
  fontCaptureInstallScript(): string
  fontCaptureVerifyScript(): string
  installPublicFontCapture(): Promise<{ installed: boolean }>
  verifyPublicFontCapture(): { safe: boolean }
}

function privateEditor(secret: string) {
  return `
    <section class="video-style-editor video-style-editor--font panel">
      <div class="font-selector">
        <label class="font-search"><input value="${secret} query"></label>
        <div class="font-selector__columns">
          <label><select><option value="system-ui:System UI:">System UI</option>
            <option value="local:${secret}">${secret}</option></select></label>
          <label><select><option value="Regular:400:normal">Regular</option></select></label>
        </div>
        <div class="font-selector__sample" style="font-family: oks-local-secret">
          This is ${secret}
        </div>
      </div>
    </section>`
}

function installReactBoundary(workspace: Element) {
  const section = document.createElement('section')
  section.id = 'oks-public-font-capture'
  section.dataset.oksPublicFontCapture = 'ready'
  section.className = 'video-style-editor video-style-editor--font panel'
  section.setAttribute('aria-label', 'Public font selector evidence')
  section.innerHTML = [
    renderToStaticMarkup(createElement(PublicFontSelector)),
    '<div class="video-style-editor__actions">',
    '<button>Cancel</button><button>Apply &amp; close</button></div>',
  ].join('')
  section.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 510, bottom: 620,
    width: 500, height: 600, toJSON: () => ({}),
  })
  workspace.append(section)
  return section
}

function prepare(secret: string) {
  document.body.innerHTML = `<main class="style-workspace">${privateEditor(secret)}</main>`
  const workspace = document.querySelector('.style-workspace')!
  const editor = workspace.querySelector<HTMLElement>('.video-style-editor')!
  editor.getBoundingClientRect = () => ({
    x: 10, y: 20, left: 10, top: 20, right: 510, bottom: 620,
    width: 500, height: 600, toJSON: () => ({}),
  })
  window.addEventListener(PUBLIC_FONT_CAPTURE_EVENT, () => installReactBoundary(workspace), {
    once: true,
  })
  return { editor, workspace }
}

async function flushMutations() {
  await new Promise((resolve) => window.setTimeout(resolve, 100))
}

afterEach(() => {
  const state = (window as unknown as Record<string, { observer?: MutationObserver }>)[
    '__oksVisualFontPrivacy'
  ]
  state?.observer?.disconnect()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).__oksVisualFontPrivacy
})

describe('public font screenshot boundary', () => {
  it('captures real FontSelector markup with fixed public-only React state', async () => {
    const secret = 'CodexSecretTypeface-DoNotLeak'
    const { editor } = prepare(secret)

    await expect(capture.installPublicFontCapture()).resolves.toMatchObject({ installed: true })
    expect(capture.verifyPublicFontCapture()).toEqual(expect.objectContaining({ safe: true }))
    const boundary = document.getElementById('oks-public-font-capture')!
    expect(boundary.querySelector('.font-selector')).not.toBeNull()
    expect(boundary.textContent).not.toContain(secret)
    expect(boundary.textContent).toContain('This is System UI')
    expect(boundary.querySelector<HTMLInputElement>('.font-search input')?.value).toBe('System')
    expect(editor.getAttribute('aria-hidden')).toBe('true')
    expect(editor.hasAttribute('inert')).toBe(true)
    expect(editor.style.getPropertyPriority('visibility')).toBe('important')
    expect(capture.fontCaptureInstallScript()).toContain('installPublicFontCapture')
    expect(capture.fontCaptureVerifyScript()).toContain('verifyPublicFontCapture')
  })

  it('fails closed after a transient secret-bearing React-style rerender', async () => {
    const { workspace } = prepare('InitialPrivateTypeface')
    await capture.installPublicFontCapture()
    const transient = document.createElement('div')
    transient.innerHTML = privateEditor('CodexTransientSecret-DoNotLeak')
    const privateSection = transient.firstElementChild!
    workspace.append(privateSection)
    await flushMutations()
    expect(capture.verifyPublicFontCapture()).toEqual(expect.objectContaining({ safe: false }))
    privateSection.remove()
    await flushMutations()

    expect(capture.verifyPublicFontCapture()).toEqual(expect.objectContaining({ safe: false }))
    expect(document.getElementById('oks-public-font-capture')?.textContent).not.toContain(
      'CodexTransientSecret-DoNotLeak',
    )
  })

  it('re-hides private attribute changes and permanently invalidates the capture', async () => {
    const { editor } = prepare('CodexPrivateTypeface')
    await capture.installPublicFontCapture()
    editor.removeAttribute('aria-hidden')
    editor.removeAttribute('inert')
    editor.style.setProperty('visibility', 'visible', 'important')
    editor.setAttribute('aria-label', 'CodexAttributeSecret-DoNotLeak')
    await flushMutations()

    const verification = capture.verifyPublicFontCapture()
    expect(editor.getAttribute('aria-hidden')).toBe('true')
    expect(editor.hasAttribute('inert')).toBe(true)
    expect(getComputedStyle(editor).visibility).toBe('hidden')
    expect(verification).toEqual(expect.objectContaining({ safe: false }))
  })

  it('rejects replacement of the stable public boundary element', async () => {
    prepare('CodexPrivateTypeface')
    await capture.installPublicFontCapture()
    const boundary = document.getElementById('oks-public-font-capture')!
    boundary.replaceWith(boundary.cloneNode(true))
    await flushMutations()

    expect(capture.verifyPublicFontCapture()).toEqual(expect.objectContaining({ safe: false }))
  })

  it('permanently rejects a transient text-node mutation inside the public boundary', async () => {
    prepare('CodexPrivateTypeface')
    await capture.installPublicFontCapture()
    const sample = document.querySelector<HTMLElement>(
      '#oks-public-font-capture .font-selector__sample',
    )!
    const original = sample.firstChild?.textContent ?? ''
    if (!sample.firstChild) throw new Error('Public font sample text node was not mounted')
    sample.firstChild.textContent = 'This is CodexTransientTextSecret'
    sample.firstChild.textContent = original

    expect(sample.textContent).toBe(original)
    expect(capture.verifyPublicFontCapture()).toEqual(expect.objectContaining({ safe: false }))
  })
})
