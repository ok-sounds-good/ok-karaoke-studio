import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const { crc32 } = require('../../electron/png-validation.cjs') as {
  crc32(bytes: Buffer): number
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function chunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, 'ascii')
  const value = Buffer.alloc(12 + data.length)
  value.writeUInt32BE(data.length, 0)
  typeBytes.copy(value, 4)
  data.copy(value, 8)
  value.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return value
}

export function validPng(width: number, height: number) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const row = Buffer.alloc(1 + width * 4)
  const pixels = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
