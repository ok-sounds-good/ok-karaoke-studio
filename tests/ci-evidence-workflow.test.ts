import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')

describe('CI evidence workflow', () => {
  it('pins Node 24 before Bun and repository scripts on both protected jobs', () => {
    const nodeSetup = workflow.indexOf('uses: actions/setup-node@v6')
    const bunSetup = workflow.indexOf('uses: oven-sh/setup-bun@v2')
    const install = workflow.indexOf('run: bun install --frozen-lockfile')

    expect(workflow).toContain('node-version: 24')
    expect(nodeSetup).toBeGreaterThan(0)
    expect(bunSetup).toBeGreaterThan(nodeSetup)
    expect(install).toBeGreaterThan(bunSetup)
    expect(workflow).toContain('os-name: macOS')
    expect(workflow).toContain('os-name: Windows')
  })

  it('runs and retains the font, visual, and representative video evidence gates', () => {
    expect(workflow).toContain('run: bun run test:fonts')
    expect(workflow).toContain('run: bun run test:visual')
    expect(workflow).toContain('run: bun run test:video')
    expect(workflow).toContain('uses: actions/upload-artifact@v4')
    expect(workflow).toContain('retention-days: 14')
  })
})
