import { configDefaults } from 'vitest/config'
import { describe, expect, it } from 'vitest'
import viteConfig, { TEST_EXCLUDE } from '../vite.config'

describe('Vitest repository isolation', () => {
  it('preserves defaults and excludes repository-owned worktrees', () => {
    expect(TEST_EXCLUDE).toEqual([...configDefaults.exclude, '**/.worktrees/**'])
    expect(viteConfig.test?.exclude).toBe(TEST_EXCLUDE)
  })
})
