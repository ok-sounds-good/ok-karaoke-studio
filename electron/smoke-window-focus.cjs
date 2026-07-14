'use strict'

function focusError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function focusSmokeWindow({
  app,
  window,
  timeoutMs = 5_000,
  intervalMs = 50,
  errorCode = 'FONT_ACCESS_SMOKE_FOCUS_FAILED',
  now = Date.now,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const started = now()
  while (now() - started <= timeoutMs) {
    if (window.isDestroyed()) throw focusError(errorCode)
    app.focus({ steal: true })
    window.show()
    window.focus()
    window.webContents.focus()
    const rendererFocused = await window.webContents.executeJavaScript(
      'document.hasFocus() === true',
      true,
    )
    if (window.isFocused() && rendererFocused === true) return true
    await delay(intervalMs)
  }
  throw focusError(errorCode)
}

module.exports = { focusSmokeWindow }
