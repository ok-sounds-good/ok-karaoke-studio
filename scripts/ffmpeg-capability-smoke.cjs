'use strict'

const { detectFfmpeg } = require('../electron/ffmpeg-setup.cjs')

detectFfmpeg().then((status) => {
  const result = {
    available: status.available,
    exportCapable: status.exportCapable,
    missingEncoders: status.missingEncoders,
    version: status.version,
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!status.exportCapable) process.exitCode = 1
}).catch(() => {
  process.stderr.write('{"available":false,"exportCapable":false}\n')
  process.exitCode = 1
})
