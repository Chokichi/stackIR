export function hexToRgb(hex) {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

export function processChromaKey(imageData, targetR, targetG, targetB, tolerance, smoothness) {
  const data = imageData.data
  const maxDist = Math.sqrt(3 * 255 * 255)
  const threshold = (tolerance / 100) * maxDist
  const feather = Math.max(1, threshold * (smoothness / 100))

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    const dist = colorDistance(r, g, b, targetR, targetG, targetB)

    if (dist <= threshold) {
      data[i + 3] = 0
    } else if (smoothness > 0 && dist < threshold + feather) {
      const t = (dist - threshold) / feather
      data[i + 3] = Math.round(a * t)
    } else {
      data[i + 3] = a
    }
  }
  return imageData
}

export function samplePixel(canvas, x, y, sampleRadius = 2) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height
  const r = Math.min(sampleRadius, Math.floor(w / 4), Math.floor(h / 4))
  let rSum = 0,
    gSum = 0,
    bSum = 0,
    count = 0

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.floor(x) + dx
      const py = Math.floor(y) + dy
      if (px >= 0 && px < w && py >= 0 && py < h) {
        const pixel = ctx.getImageData(px, py, 1, 1).data
        rSum += pixel[0]
        gSum += pixel[1]
        bSum += pixel[2]
        count++
      }
    }
  }
  return count > 0
    ? rgbToHex(Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count))
    : null
}

/** Set alpha to 0 for near-white pixels so transparent backgrounds layer correctly */
export function makeWhiteTransparent(imageData, threshold = 250) {
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r >= threshold && g >= threshold && b >= threshold) {
      data[i + 3] = 0
    }
  }
  return imageData
}

export function recolorImageData(imageData, targetHex) {
  const { r: tr, g: tg, b: tb } = hexToRgb(targetHex) || { r: 0, g: 0, b: 0 }
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a > 0) {
      data[i] = tr
      data[i + 1] = tg
      data[i + 2] = tb
    }
  }
  return imageData
}

export function cropImageFromDataUrl(dataUrl, x, y, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ix = Math.floor(Math.max(0, Math.min(x, img.width - 1)))
      const iy = Math.floor(Math.max(0, Math.min(y, img.height - 1)))
      const iw = Math.floor(Math.max(1, Math.min(width, img.width - ix)))
      const ih = Math.floor(Math.max(1, Math.min(height, img.height - iy)))
      if (iw <= 0 || ih <= 0) return reject(new Error('Invalid crop dimensions'))
      const canvas = document.createElement('canvas')
      canvas.width = iw
      canvas.height = ih
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, ix, iy, iw, ih, 0, 0, iw, ih)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

export function scaleImageToMatchDistance(dataUrl, refDistance, userDistance, scaleY = 1, scaleX = 1) {
  if (userDistance <= 0 || refDistance <= 0) return dataUrl
  const scale = refDistance / userDistance
  const sy = scaleY ?? 1
  const sx = scaleX ?? 1
  if (Math.abs(scale - 1) < 0.005 && Math.abs(sy - 1) < 0.005 && Math.abs(sx - 1) < 0.005) return dataUrl
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.round(img.width * scale * sx)
      const h = Math.round(img.height * scale * sy)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

export function applyYScale(dataUrl, scaleY) {
  if (!scaleY || Math.abs(scaleY - 1) < 0.001) return Promise.resolve(dataUrl)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = img.width
      const h = Math.round(img.height * scaleY)
      if (h <= 0) return resolve(dataUrl)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, img.height, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
