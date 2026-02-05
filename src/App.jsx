import { useState, useRef, useCallback, useEffect } from 'react'
import './App.css'

const LIVE_UPDATE_DEBOUNCE_MS = 120

const ACCEPTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp']

function hexToRgb(hex) {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function processChromaKey(imageData, targetR, targetG, targetB, tolerance, smoothness) {
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

function ZoomLens({ zoomPixel, zoomPos, zoomSize = 120, zoomLevel = 3, previewBg }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const img = zoomPixel?.img
    if (!canvas || !img || !img.complete) return

    const ctx = canvas.getContext('2d')
    const srcSize = zoomSize / zoomLevel
    const half = srcSize / 2
    const cx = Math.max(half, Math.min(img.naturalWidth - half - 1, zoomPixel.x))
    const cy = Math.max(half, Math.min(img.naturalHeight - half - 1, zoomPixel.y))
    const sx = cx - half
    const sy = cy - half

    ctx.clearRect(0, 0, zoomSize, zoomSize)
    if (previewBg && previewBg !== 'checkerboard') {
      ctx.fillStyle = previewBg
      ctx.fillRect(0, 0, zoomSize, zoomSize)
    } else {
      const size = 8
      for (let y = 0; y < zoomSize; y += size) {
        for (let x = 0; x < zoomSize; x += size) {
          ctx.fillStyle = (x / size + y / size) % 2 === 0 ? '#808080' : '#c0c0c0'
          ctx.fillRect(x, y, size, size)
        }
      }
    }
    ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, zoomSize, zoomSize)
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, zoomSize, zoomSize)
  }, [zoomPixel, zoomSize, zoomLevel, previewBg])

  if (!zoomPos) return null

  const offset = 16
  let left = zoomPos.x + offset
  let top = zoomPos.y + offset
  if (left + zoomSize > window.innerWidth - 8) left = zoomPos.x - zoomSize - offset
  if (top + zoomSize > window.innerHeight - 8) top = zoomPos.y - zoomSize - offset
  left = Math.max(8, Math.min(left, window.innerWidth - zoomSize - 8))
  top = Math.max(8, Math.min(top, window.innerHeight - zoomSize - 8))

  return (
    <div
      className="zoom-lens"
      style={{ left, top }}
    >
      <canvas ref={canvasRef} width={zoomSize} height={zoomSize} />
    </div>
  )
}

function samplePixel(canvas, x, y, sampleRadius = 2) {
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

function App() {
  const [image, setImage] = useState(null)
  const [imageUrl, setImageUrl] = useState(null)
  const [targetColor, setTargetColor] = useState('#ffffff')
  const [tolerance, setTolerance] = useState(15)
  const [smoothness, setSmoothness] = useState(0)
  const [eyedropperMode, setEyedropperMode] = useState(false)
  const [processedUrl, setProcessedUrl] = useState(null)
  const [error, setError] = useState('')
  const [liveUpdate, setLiveUpdate] = useState(false)
  const [checkerboardOn, setCheckerboardOn] = useState(true)
  const [previewBgColor, setPreviewBgColor] = useState('#ffffff')
  const [uploadedFileName, setUploadedFileName] = useState(null)
  const [zoomPos, setZoomPos] = useState(null)
  const [zoomPixel, setZoomPixel] = useState(null)
  const canvasRef = useRef(null)
  const originalCanvasRef = useRef(null)
  const fileInputRef = useRef(null)

  const loadImage = useCallback((file) => {
    setError('')
    if (!ACCEPTED_FORMATS.includes(file.type)) {
      setError('Please upload a PNG, JPG, GIF, WebP, or BMP image.')
      return
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    setProcessedUrl(null)
    setUploadedFileName(file.name)
    const img = new Image()
    img.onload = () => setImage(img)
    img.onerror = () => setError('Failed to load image.')
    img.src = url
  }, [imageUrl])

  useEffect(() => {
    if (!image || !originalCanvasRef.current) return
    const orig = originalCanvasRef.current
    orig.width = image.width
    orig.height = image.height
    orig.getContext('2d').drawImage(image, 0, 0)
  }, [image])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (file) loadImage(file)
    },
    [loadImage]
  )

  const handleFileSelect = (e) => {
    const file = e.target?.files?.[0]
    if (file) loadImage(file)
  }

  const handleImageClick = useCallback(
    (e) => {
      if (!eyedropperMode || !originalCanvasRef.current) return
      const el = e.currentTarget
      const rect = el.getBoundingClientRect()
      const scaleX = el.naturalWidth / rect.width
      const scaleY = el.naturalHeight / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      const hex = samplePixel(originalCanvasRef.current, x, y)
      if (hex) {
        setTargetColor(hex)
        setEyedropperMode(false)
      }
    },
    [eyedropperMode]
  )

  const runProcessing = useCallback(() => {
    if (!image || !canvasRef.current) return
    const rgb = hexToRgb(targetColor)
    if (!rgb) return

    const canvas = canvasRef.current
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const processed = processChromaKey(
      imageData,
      rgb.r,
      rgb.g,
      rgb.b,
      tolerance,
      smoothness
    )
    ctx.putImageData(processed, 0, 0)
    return canvas.toDataURL('image/png')
  }, [image, targetColor, tolerance, smoothness])

  const processImage = useCallback(() => {
    const url = runProcessing()
    if (url) setProcessedUrl(url)
  }, [runProcessing])

  useEffect(() => {
    if (!liveUpdate || !image) return
    const id = setTimeout(() => {
      const url = runProcessing()
      if (url) setProcessedUrl(url)
    }, LIVE_UPDATE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [liveUpdate, image, targetColor, tolerance, smoothness, runProcessing])

  const downloadImage = useCallback(() => {
    if (!processedUrl) return
    const base = uploadedFileName
      ? uploadedFileName.replace(/\.[^.]+$/, '')
      : 'background-removed'
    const downloadName = `${base} bkg rmvd.png`
    const a = document.createElement('a')
    a.href = processedUrl
    a.download = downloadName
    a.click()
  }, [processedUrl, uploadedFileName])

  const handleHexChange = (e) => {
    const v = e.target.value
    if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') setTargetColor(v || '#')
  }

  const handleClear = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImage(null)
    setImageUrl(null)
    setProcessedUrl(null)
    setUploadedFileName(null)
    setTargetColor('#ffffff')
  }

  const effectivePreviewBg = checkerboardOn ? 'checkerboard' : previewBgColor

  const previewImgSrc = processedUrl || imageUrl

  const handleImageMouseMove = useCallback(
    (e) => {
      const img = e.currentTarget
      const rect = img.getBoundingClientRect()
      const scaleX = img.naturalWidth / rect.width
      const scaleY = img.naturalHeight / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      setZoomPos({ x: e.clientX, y: e.clientY })
      setZoomPixel({ x, y, img })
    },
    []
  )

  const handleImageMouseLeave = useCallback(() => {
    setZoomPos(null)
    setZoomPixel(null)
  }, [])

  const displayElement = previewImgSrc ? (
    <img
      src={previewImgSrc}
      alt={processedUrl ? 'Processed' : 'Original'}
      className="preview-img"
      onClick={handleImageClick}
      onMouseMove={handleImageMouseMove}
      onMouseLeave={handleImageMouseLeave}
      style={{ cursor: eyedropperMode ? 'crosshair' : 'default' }}
    />
  ) : null

  return (
    <div className="app">
      <header className="header">
        <h1>Chroma Key Background Remover</h1>
        <p className="subtitle">
          Remove backgrounds from line art and spectra. Upload an image, pick a color, and download a
          transparent PNG.
        </p>
      </header>

      <div className="upload-zone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FORMATS.join(',')}
          onChange={handleFileSelect}
          className="file-input"
        />
        {!image && (
          <div className="drop-area" onClick={() => fileInputRef.current?.click()}>
            <span>Drop an image here or click to browse</span>
            <span className="formats">PNG, JPG, GIF, WebP, BMP</span>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {image && (
        <div className="workspace">
          <div className="controls">
            <div className="control-group">
              <label>Target color</label>
              <div className="color-row">
                <input
                  type="text"
                  value={targetColor}
                  onChange={handleHexChange}
                  placeholder="#ffffff"
                  className="hex-input"
                />
                <input
                  type="color"
                  value={targetColor}
                  onChange={(e) => setTargetColor(e.target.value)}
                  className="color-picker"
                />
                <button
                  type="button"
                  className={`eyedropper-btn ${eyedropperMode ? 'active' : ''}`}
                  onClick={() => setEyedropperMode((m) => !m)}
                  title="Click on the image to pick a color"
                >
                  Eyedropper
                </button>
              </div>
            </div>

            <div className="control-group">
              <label>Tolerance: {tolerance}%</label>
              <input
                type="range"
                min="1"
                max="100"
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
              <span className="hint">Higher values remove more similar colors</span>
            </div>

            <div className="control-group">
              <label>Edge smoothness: {smoothness}%</label>
              <input
                type="range"
                min="0"
                max="50"
                value={smoothness}
                onChange={(e) => setSmoothness(Number(e.target.value))}
              />
              <span className="hint">Soften transition at edges</span>
            </div>

            <div className="control-group">
              <label>Preview background</label>
              <div className="color-row">
                <button
                  type="button"
                  className={`preview-bg-btn ${checkerboardOn ? 'active' : ''}`}
                  onClick={() => setCheckerboardOn((on) => !on)}
                  title="Toggle checkerboard (transparency)"
                >
                  ◫
                </button>
                <input
                  type="color"
                  value={previewBgColor}
                  onChange={(e) => setPreviewBgColor(e.target.value)}
                  className="color-picker"
                  title="Solid color"
                />
                <input
                  type="text"
                  value={previewBgColor}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v || v === '#') setPreviewBgColor('#ffffff')
                    else if (/^#?[0-9a-fA-F]{1,6}$/i.test(v)) setPreviewBgColor(v.startsWith('#') ? v : '#' + v)
                  }}
                  placeholder="#ffffff"
                  className="hex-input"
                  style={{ flex: '1 1 80px' }}
                />
              </div>
              <span className="hint">For inspection only — export stays transparent</span>
            </div>

            <div className="control-group live-toggle-group">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={liveUpdate}
                  onChange={(e) => setLiveUpdate(e.target.checked)}
                />
                <span>Live preview</span>
              </label>
              {liveUpdate && (
                <span className="live-warning">
                  May cause lag with larger or more complex images.
                </span>
              )}
            </div>

            <div className="actions">
              <button type="button" onClick={processImage} className="primary">
                Remove background
              </button>
              {processedUrl && (
                <button type="button" onClick={downloadImage} className="secondary">
                  Download PNG
                </button>
              )}
              <button type="button" onClick={handleClear} className="ghost">
                Clear
              </button>
            </div>
          </div>

          <div className="preview-area">
            {eyedropperMode && (
              <div className="eyedropper-hint">Click on the image to pick a color</div>
            )}
            <div
              className="preview-wrapper"
              style={
                checkerboardOn
                  ? { background: 'repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 50% / 16px 16px' }
                  : { background: previewBgColor }
              }
            >
              {displayElement}
            </div>
            {zoomPos && zoomPixel?.img && (
              <ZoomLens
                zoomPixel={zoomPixel}
                zoomPos={zoomPos}
                zoomSize={120}
                zoomLevel={3}
                previewBg={effectivePreviewBg}
              />
            )}
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="offscreen" aria-hidden="true" />
      <canvas ref={originalCanvasRef} className="offscreen" aria-hidden="true" />
    </div>
  )
}

export default App
