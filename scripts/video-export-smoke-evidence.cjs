function countSungPixels(decoded, dominance = 30) {
  let lyricPixels = 0
  for (let pixel = 0; pixel < decoded.length; pixel += 3) {
    const [red, green, blue] = decoded.subarray(pixel, pixel + 3)
    if (red >= 100 && blue >= 100 && red - green >= dominance && blue - green >= dominance)
      lyricPixels += 1
  }
  return lyricPixels
}
module.exports = { countSungPixels }
