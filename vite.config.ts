import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export const TEST_EXCLUDE = [...configDefaults.exclude, '**/.worktrees/**']

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: TEST_EXCLUDE,
  },
})
