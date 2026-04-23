/**
 * Render parsed spectrum data (x, y arrays) to a canvas image.
 * Produces a transparent PNG with the spectrum line in black, suitable for stacking.
 */
export function renderSpectrumToDataUrl(data, options = {}) {
  const { x, y } = data
  if (!x?.length || !y?.length || x.length !== y.length) {
    return null
  }

  const width = options.width ?? 800
  const height = options.height ?? 120
  const lineWidth = options.lineWidth ?? 1.5
  const invertY = options.invertY ?? true // IR transmittance: low = peak, invert so peaks point up
  // Optional stroke-dasharray style (accepts an SVG-style string "6 4" or an
  // array of numbers). Empty / missing means solid line.
  const lineDash = (() => {
    const d = options.lineDash
    if (Array.isArray(d)) return d.filter((n) => Number.isFinite(n) && n >= 0)
    if (typeof d === 'string' && d.trim()) {
      return d.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n) && n >= 0)
    }
    return []
  })()

  const minX = Math.min(...x)
  const maxX = Math.max(...x)
  const minY = Math.min(...y)
  const maxY = Math.max(...y)
  const rangeY = maxY - minY || 1

  const irPiecewise = options.irPiecewise === true
  const irBreak = options.irBreak ?? 2000

  const wavenumberToNormX = (w) => {
    if (!irPiecewise || minX >= irBreak || maxX <= irBreak) {
      const rangeX = maxX - minX || 1
      return (w - minX) / rangeX
    }
    if (w <= irBreak) {
      const span = irBreak - minX
      return 0.5 * (span ? (w - minX) / span : 0)
    }
    const span = maxX - irBreak
    return 0.5 + 0.5 * (span ? (w - irBreak) / span : 0)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'transparent'
  ctx.clearRect(0, 0, width, height)

  ctx.strokeStyle = '#000000'
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (lineDash.length > 0 && typeof ctx.setLineDash === 'function') {
    ctx.setLineDash(lineDash)
  }
  ctx.beginPath()

  const padX = 2
  const padY = 4
  const plotW = width - 2 * padX
  const plotH = height - 2 * padY

  for (let i = 0; i < x.length; i++) {
    const normX = irPiecewise ? 1 - wavenumberToNormX(x[i]) : wavenumberToNormX(x[i])
    const px = padX + normX * plotW
    const normY = (y[i] - minY) / rangeY
    const py = invertY
      ? padY + (1 - normY) * plotH
      : padY + normY * plotH

    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }

  ctx.stroke()

  return canvas.toDataURL('image/png')
}
