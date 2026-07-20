'use strict'

const path = require('node:path')

const ADAPTER_PATH = path.join(__dirname, 'windows-package-smoke-launcher.ps1')
const POWERSHELL_PATH = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
const HASH = /^[0-9a-f]{64}$/u

function invalid() {
  const error = new Error('WINDOWS_LOCKED_JOB_INVALID')
  error.code = 'WINDOWS_LOCKED_JOB_INVALID'
  return error
}

function lockedDirectories(root, candidates) {
  for (const candidate of candidates) {
    const relative = path.relative(root, candidate)
    if (
      relative &&
      (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))
    )
      throw invalid()
  }
  const directories = []
  for (const candidate of [root, ...candidates]) {
    const chain = []
    for (let current = candidate; ; current = path.dirname(current)) {
      chain.unshift(current)
      if (current === path.dirname(current)) break
    }
    for (const directory of chain) if (!directories.includes(directory)) directories.push(directory)
  }
  return directories
}

function lockedJobChildOptions(options, locks) {
  const resource = locks?.resource
  const root = locks?.root
  if (
    !options ||
    typeof options.executable !== 'string' ||
    !path.isAbsolute(options.executable) ||
    !Array.isArray(options.args) ||
    options.args.some((value) => typeof value !== 'string') ||
    !options.spawnOptions ||
    typeof options.spawnOptions !== 'object' ||
    Array.isArray(options.spawnOptions) ||
    typeof options.spawnOptions.cwd !== 'string' ||
    !path.isAbsolute(options.spawnOptions.cwd) ||
    typeof root !== 'string' ||
    !path.isAbsolute(root) ||
    typeof resource !== 'string' ||
    !path.isAbsolute(resource) ||
    !HASH.test(locks?.executableSha256) ||
    !HASH.test(locks?.resourceSha256)
  )
    throw invalid()
  const directories = lockedDirectories(root, [
    path.dirname(options.executable),
    path.dirname(resource),
    options.spawnOptions.cwd,
  ])
  const request = Buffer.from(
    JSON.stringify({
      arguments: options.args,
      cwd: options.spawnOptions.cwd,
      directories,
      executable: options.executable,
      executableSha256: locks.executableSha256,
      resource,
      resourceSha256: locks.resourceSha256,
    }),
  ).toString('base64')
  return {
    ...options,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ADAPTER_PATH,
      '-Request',
      request,
    ],
    executable: POWERSHELL_PATH,
    spawnOptions: {
      ...options.spawnOptions,
      cwd: path.resolve(__dirname, '..'),
      windowsHide: true,
    },
  }
}

module.exports = { ADAPTER_PATH, POWERSHELL_PATH, lockedJobChildOptions }
