/**
 * Map (x, y) spectrum data to SVG coordinates and generate smooth paths.
 * IR convention: high wavenumber on left, piecewise scale at 2000 cm⁻¹.
 */

const IR_BREAK = 2000

/** Map wavenumber to normalized x (0..1), high wavenumber = 0 (left) */
export function wavenumberToNormX(w, minX, maxX, piecewise = true) {
  if (!piecewise || minX >= IR_BREAK || maxX <= IR_BREAK) {
    const rangeX = maxX - minX || 1
    return 1 - (w - minX) / rangeX
  }
  if (w >= IR_BREAK) {
    const span = maxX - IR_BREAK
    return span ? 0.5 * (maxX - w) / span : 0
  }
  const span = IR_BREAK - minX
  return span ? 0.5 + 0.5 * (IR_BREAK - w) / span : 1
}

/** Inverse of wavenumberToNormX: map normX (0..1) to wavenumber */
export function normXToWavenumber(normX, minX, maxX, piecewise = true) {
  if (!piecewise || minX >= IR_BREAK || maxX <= IR_BREAK) {
    const rangeX = maxX - minX || 1
    return minX + (1 - normX) * rangeX
  }
  if (normX <= 0.5) {
    const span = maxX - IR_BREAK
    return span ? maxX - 2 * normX * span : maxX
  }
  const span = IR_BREAK - minX
  return span ? IR_BREAK - (normX - 0.5) * 2 * span : minX
}

/** Map data point (wx, wy) to SVG coords (px, py) within plot area */
export function dataToSvgCoords(wx, wy, plotRect, dataRange, piecewise) {
  const { minX, maxX, minY, maxY } = dataRange
  const { x: px, y: py, width: w, height: h } = plotRect
  const normX = wavenumberToNormX(wx, minX, maxX, piecewise)
  const rangeY = maxY - minY || 1
  const normY = (wy - minY) / rangeY
  return {
    x: px + normX * w,
    y: py + (1 - normY) * h, // invert Y so peaks point up
  }
}

/**
 * Generate a smooth SVG path through points using Catmull-Rom spline.
 * Returns path d string for use in <path d="..." />.
 */
export function smoothPathD(points) {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`

  const d = []
  d.push(`M ${points[0].x} ${points[0].y}`)

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[0]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? points[points.length - 1]

    const tension = 1 / 6
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension

    d.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`)
  }

  return d.join(' ')
}

/**
 * Find local minima in (x, y) data within wavenumber range [wMin, wMax].
 * In transmittance IR spectra, absorption peaks appear as dips (minima).
 * Returns array of { wavenumber, value } sorted by wavenumber.
 */
export function findLocalMinima(xArr, yArr, wMin, wMax) {
  const n = xArr.length
  if (n < 3) return []
  const results = []
  for (let i = 1; i < n - 1; i++) {
    const w = xArr[i]
    if (w < wMin || w > wMax) continue
    const y = yArr[i]
    if (y <= yArr[i - 1] && y <= yArr[i + 1]) {
      results.push({ wavenumber: w, value: y })
    }
  }
  return results
}

/**
 * Find local maxima in (x, y) data within wavenumber range [wMin, wMax].
 * In absorbance IR spectra, absorption peaks appear as maxima.
 * Returns array of { wavenumber, value } sorted by wavenumber.
 */
export function findLocalMaxima(xArr, yArr, wMin, wMax) {
  const n = xArr.length
  if (n < 3) return []
  const results = []
  for (let i = 1; i < n - 1; i++) {
    const w = xArr[i]
    if (w < wMin || w > wMax) continue
    const y = yArr[i]
    if (y >= yArr[i - 1] && y >= yArr[i + 1]) {
      results.push({ wavenumber: w, value: y })
    }
  }
  return results
}

/**
 * Interpolate y value at target x from (xArr, yArr) using linear interpolation.
 */
export function interpolateAt(xArr, yArr, targetX) {
  const n = xArr.length
  if (n === 0) return NaN
  if (targetX <= xArr[0]) return yArr[0]
  if (targetX >= xArr[n - 1]) return yArr[n - 1]

  let i = 0
  while (i < n - 1 && xArr[i + 1] < targetX) i++

  const x0 = xArr[i]
  const x1 = xArr[i + 1]
  const y0 = yArr[i]
  const y1 = yArr[i + 1]
  const t = (targetX - x0) / (x1 - x0)

  return y0 + t * (y1 - y0)
}

/**
 * Build SVG path for a spectrum resampled to a target wavenumber grid.
 */
export function spectrumToPath(data, gridX, plotRect, dataRange, piecewise = true) {
  const { x: srcX, y: srcY } = data
  const points = gridX.map((wx) => {
    const wy = interpolateAt(srcX, srcY, wx)
    return dataToSvgCoords(wx, wy, plotRect, dataRange, piecewise)
  })
  return smoothPathD(points)
}
