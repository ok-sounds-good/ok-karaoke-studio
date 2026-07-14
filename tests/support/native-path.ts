import { resolve } from 'node:path'

export function nativeFixturePath(...segments: string[]) {
  return resolve('tests', 'fixtures', 'virtual', ...segments)
}
