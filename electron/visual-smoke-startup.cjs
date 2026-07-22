'use strict'

const TRIGGER = '--oks-video-style-visual-smoke'
const OPTION_PREFIX = '--oks-video-style-visual-'

function hasVisualSmokeArgument(argv) {
  return (
    Array.isArray(argv) &&
    argv.some(
      (argument) =>
        typeof argument === 'string' &&
        (argument === TRIGGER || argument.startsWith(OPTION_PREFIX)),
    )
  )
}

function prepareVisualSmokeStartup({ argv, app, processHandle, loadVisualSmoke }) {
  if (!hasVisualSmokeArgument(argv)) {
    return Object.freeze({ config: null, fatalObserver: null, module: null, startupFailed: false })
  }
  try {
    const module = loadVisualSmoke()
    const config = module.configureVisualSmokeBeforeReady(
      app,
      module.parseVisualSmokeArguments(argv),
    )
    const fatalObserver = config ? module.installVisualSmokeFatalObserver(processHandle) : null
    return Object.freeze({ config, fatalObserver, module, startupFailed: false })
  } catch {
    return Object.freeze({ config: null, fatalObserver: null, module: null, startupFailed: true })
  }
}

module.exports = { hasVisualSmokeArgument, prepareVisualSmokeStartup }
