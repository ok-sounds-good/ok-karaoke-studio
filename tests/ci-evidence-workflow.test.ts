import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function repositoryFile(name: string) {
  return readFile(join(process.cwd(), name), 'utf8')
}

describe('CI visual evidence contract', () => {
  it('preserves both events and protected macOS and Windows job names', async () => {
    const workflow = await repositoryFile('.github/workflows/ci.yml')
    expect(workflow).toMatch(/on:\n  push:\n  pull_request:/u)
    expect(workflow).toContain('name: ${{ matrix.os-name }}')
    expect(workflow).toContain('- os-name: macOS\n            runner: macos-latest')
    expect(workflow).toContain('- os-name: Windows\n            runner: windows-latest')
    expect(workflow).not.toContain('paths:')
  })

  it('pins Node 24 before Bun and captures the built renderer', async () => {
    const workflow = await repositoryFile('.github/workflows/ci.yml')
    const node = workflow.indexOf('uses: actions/setup-node@v6')
    const bun = workflow.indexOf('uses: oven-sh/setup-bun@v2')
    const build = workflow.indexOf('run: bun run build')
    const path = workflow.indexOf('id: video-style-visual-path')
    const capture = workflow.indexOf('run: bun run test:visual')
    expect(node).toBeGreaterThan(0)
    expect(workflow.slice(node, bun)).toContain('node-version: 24')
    expect(node).toBeLessThan(bun)
    expect(build).toBeLessThan(capture)
    expect(build).toBeLessThan(path)
    expect(path).toBeLessThan(capture)
    expect(workflow.slice(path, capture)).toContain(
      'run: node scripts/visual-result-validation.cjs --emit-workflow-evidence-path',
    )
    const packageJson = JSON.parse(await repositoryFile('package.json'))
    expect(packageJson.scripts['test:visual']).toBe('node scripts/video-style-visual-smoke.cjs')
  })

  it('always uploads only the attempted evidence leaf with short unique retention', async () => {
    const workflow = await repositoryFile('.github/workflows/ci.yml')
    expect(workflow).toContain(
      "if: ${{ always() && steps.video-style-visual.outcome != 'skipped' }}",
    )
    expect(workflow).toContain('uses: actions/upload-artifact@v7')
    expect(workflow).toContain(
      'name: video-style-visual-${{ matrix.os-name }}-${{ github.run_id }}-${{ github.run_attempt }}',
    )
    const leaf = '${{ steps.video-style-visual-path.outputs.path }}'
    expect(workflow.split(leaf)).toHaveLength(3)
    expect(workflow).not.toContain('${{ runner.temp }}/okay-karaoke-studio-video-style-visual')
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).toContain('retention-days: 14')
  })
})
