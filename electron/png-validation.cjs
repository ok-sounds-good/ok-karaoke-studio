'use strict'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function pngError() {
  const error = new Error('VISUAL_PNG_INVALID')
  error.code = 'VISUAL_PNG_INVALID'
  return error
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function validateIhdr(data) {
  if (data.length !== 13) throw pngError()
  const width = data.readUInt32BE(0)
  const height = data.readUInt32BE(4)
  const bitDepth = data[8]
  const colorType = data[9]
  const allowedDepths = {
    0: new Set([1, 2, 4, 8, 16]),
    2: new Set([8, 16]),
    3: new Set([1, 2, 4, 8]),
    4: new Set([8, 16]),
    6: new Set([8, 16]),
  }
  if (
    width <= 0 || height <= 0 ||
    !allowedDepths[colorType]?.has(bitDepth) ||
    data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])
  ) throw pngError()
  return { width, height }
}

function parseStrictPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57) throw pngError()
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw pngError()
  let offset = 8
  let dimensions = null
  let sawIdat = false
  let sawIend = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw pngError()
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw pngError()
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const type = typeBytes.toString('ascii')
    if (!/^[A-Za-z]{4}$/u.test(type)) throw pngError()
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length)
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) throw pngError()
    if (!dimensions) {
      if (type !== 'IHDR') throw pngError()
      dimensions = validateIhdr(data)
    } else if (type === 'IHDR') {
      throw pngError()
    }
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      if (length !== 0 || !sawIdat || end !== bytes.length) throw pngError()
      sawIend = true
    }
    offset = end
  }
  if (!dimensions || !sawIdat || !sawIend) throw pngError()
  return dimensions
}

module.exports = { crc32, parseStrictPng }
