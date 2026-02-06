import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useStacking } from '../context/StackingContext'
import { useBackgroundRemover } from '../context/BackgroundRemoverContext'
import {
  hexToRgb,
  processChromaKey,
  samplePixel,
  cropImageFromDataUrl,
} from '../utils/imageUtils'
import ZoomLens from '../components/ZoomLens'
import './BackgroundRemover.css'

const LIVE_UPDATE_DEBOUNCE_MS = 120
const ACCEPTED_FORMATS = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp']

export default function BackgroundRemover() {
  const { addSpectrum } = useStacking()
  const {
    files,
    setFiles,
    currentIndex,
    setCurrentIndex,
    image,
    setImage,
    imageUrl,
    setImageUrl,
    processedUrl,
    setProcessedUrl,
    targetColor,
    setTargetColor,
    tolerance,
    setTolerance,
    smoothness,
    setSmoothness,
    liveUpdate,
    setLiveUpdate,
    checkerboardOn,
    setCheckerboardOn,
    previewBgColor,
    setPreviewBgColor,
    error,
    setError,
    handleClear,
  } = useBackgroundRemover()
  const [eyedropperMode, setEyedropperMode] = useState(false)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState(null)
  const [cropStart, setCropStart] = useState(null)
  const [zoomPos, setZoomPos] = useState(null)
  const [zoomPixel, setZoomPixel] = useState(null)
  const canvasRef = useRef(null)
  const originalCanvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const imgRef = useRef(null)

  const currentFile = files[currentIndex]
  const uploadedFileName = currentFile?.name ?? null

  const loadFileAtIndex = useCallback((idx) => {
    if (idx < 0 || idx >= files.length) return
    const file = files[idx]
    setError('')
    if (!ACCEPTED_FORMATS.includes(file.type)) {
      setError('Please upload PNG, JPG, GIF, WebP, or BMP images.')
      return
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    setProcessedUrl(null)
    setCropRect(null)
    setCropMode(false)
    const img = new Image()
    img.onload = () => setImage(img)
    img.onerror = () => setError('Failed to load image.')
    img.src = url
  }, [files, imageUrl])

  useEffect(() => {
    if (files.length === 0) {
      setImage(null)
      setImageUrl(null)
      setProcessedUrl(null)
      setCurrentIndex(0)
      return
    }
    const idx = Math.min(currentIndex, files.length - 1)
    setCurrentIndex(idx)
    loadFileAtIndex(idx)
  }, [files])

  useEffect(() => {
    if (files.length > 0 && currentIndex >= 0 && currentIndex < files.length) {
      loadFileAtIndex(currentIndex)
    }
  }, [currentIndex])

  useEffect(() => {
    if (!image || !originalCanvasRef.current) return
    const orig = originalCanvasRef.current
    orig.width = image.width
    orig.height = image.height
    orig.getContext('2d').drawImage(image, 0, 0)
  }, [image])

  const handleFiles = useCallback((fileList) => {
    const arr = Array.from(fileList || []).filter((f) => ACCEPTED_FORMATS.includes(f.type))
    if (arr.length === 0) {
      setError('No valid images. Use PNG, JPG, GIF, WebP, or BMP.')
      return
    }
    setFiles(arr)
    setCurrentIndex(0)
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      handleFiles(e.dataTransfer?.files)
    },
    [handleFiles]
  )

  const handleFileSelect = (e) => {
    handleFiles(e.target?.files)
  }

  const handleImageClick = useCallback(
    (e) => {
      if (eyedropperMode && originalCanvasRef.current) {
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
      } else if (cropMode && processedUrl) {
        const el = imgRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        let x = (e.clientX - rect.left) / rect.width * el.naturalWidth
        let y = (e.clientY - rect.top) / rect.height * el.naturalHeight
        const pad = 6
        if (x >= el.naturalWidth - pad) x = el.naturalWidth
        else if (x < pad) x = 0
        else x = Math.max(0, Math.min(el.naturalWidth, x))
        if (y >= el.naturalHeight - pad) y = el.naturalHeight
        else if (y < pad) y = 0
        else y = Math.max(0, Math.min(el.naturalHeight, y))
        if (!cropStart) {
          setCropStart({ x, y })
          setCropRect(null)
        } else {
          const x1 = Math.min(cropStart.x, x)
          const y1 = Math.min(cropStart.y, y)
          const w = Math.abs(x - cropStart.x)
          const h = Math.abs(y - cropStart.y)
          if (w > 2 && h > 2) {
            setCropRect({ x: x1, y: y1, width: w, height: h })
          }
          setCropStart(null)
        }
      }
    },
    [eyedropperMode, cropMode, processedUrl, cropStart]
  )

  const handleImageMouseMove = useCallback(
    (e) => {
      const img = e.currentTarget
      imgRef.current = img
      const rect = img.getBoundingClientRect()
      const scaleX = img.naturalWidth / rect.width
      const scaleY = img.naturalHeight / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      setZoomPos({ x: e.clientX, y: e.clientY })
      setZoomPixel({ x, y, img })
      if (cropMode && cropStart) {
        const x1 = Math.min(cropStart.x, x)
        const y1 = Math.min(cropStart.y, y)
        setCropRect({
          x: x1,
          y: y1,
          width: Math.abs(x - cropStart.x),
          height: Math.abs(y - cropStart.y),
        })
      }
    },
    [cropMode, cropStart]
  )

  const handleImageMouseLeave = useCallback(() => {
    setZoomPos(null)
    setZoomPixel(null)
  }, [])

  useEffect(() => {
    if (!cropStart || !imgRef.current) return
    const img = imgRef.current

    const clientToImage = (clientX, clientY) => {
      const rect = img.getBoundingClientRect()
      const pad = 6
      const inBounds =
        clientX >= rect.left - pad &&
        clientX <= rect.right + pad &&
        clientY >= rect.top - pad &&
        clientY <= rect.bottom + pad
      if (!inBounds) return null
      let xx = (clientX - rect.left) / rect.width * img.naturalWidth
      let yy = (clientY - rect.top) / rect.height * img.naturalHeight
      if (xx >= img.naturalWidth - pad) xx = img.naturalWidth
      else if (xx < pad) xx = 0
      else xx = Math.max(0, Math.min(img.naturalWidth, xx))
      if (yy >= img.naturalHeight - pad) yy = img.naturalHeight
      else if (yy < pad) yy = 0
      else yy = Math.max(0, Math.min(img.naturalHeight, yy))
      return { x: xx, y: yy }
    }

    const handleDocMouseMove = (e) => {
      const pt = clientToImage(e.clientX, e.clientY)
      if (!pt) return
      const { x, y } = pt
      setCropRect({
        x: Math.min(cropStart.x, x),
        y: Math.min(cropStart.y, y),
        width: Math.abs(x - cropStart.x),
        height: Math.abs(y - cropStart.y),
      })
    }

    const handleDocClick = (e) => {
      const pt = clientToImage(e.clientX, e.clientY)
      if (pt) {
        e.stopPropagation()
        const { x, y } = pt
        const x1 = Math.min(cropStart.x, x)
        const y1 = Math.min(cropStart.y, y)
        const w = Math.abs(x - cropStart.x)
        const h = Math.abs(y - cropStart.y)
        if (w > 2 && h > 2) {
          setCropRect({ x: x1, y: y1, width: w, height: h })
        }
      }
      setCropStart(null)
      document.removeEventListener('mousemove', handleDocMouseMove)
      document.removeEventListener('click', handleDocClick, true)
    }

    document.addEventListener('mousemove', handleDocMouseMove)
    document.addEventListener('click', handleDocClick, true)
    return () => {
      document.removeEventListener('mousemove', handleDocMouseMove)
      document.removeEventListener('click', handleDocClick, true)
    }
  }, [cropStart])

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
    const processed = processChromaKey(imageData, rgb.r, rgb.g, rgb.b, tolerance, smoothness)
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

  const applyCrop = useCallback(async () => {
    if (!cropRect || !processedUrl) return
    const url = await cropImageFromDataUrl(
      processedUrl,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height
    )
    setProcessedUrl(url)
    setCropRect(null)
    setCropMode(false)
  }, [cropRect, processedUrl])

  const cancelCrop = useCallback(() => {
    setCropMode(false)
    setCropRect(null)
    setCropStart(null)
  }, [])

  const downloadImage = useCallback(() => {
    const url = processedUrl || imageUrl
    if (!url) return
    const base = uploadedFileName ? uploadedFileName.replace(/\.[^.]+$/, '') : 'background-removed'
    const downloadName = `${base} bkg rmvd.png`
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName
    a.click()
  }, [processedUrl, imageUrl, uploadedFileName])

  const sendToStacking = useCallback(() => {
    const url = processedUrl || imageUrl
    if (!url) return
    const base = uploadedFileName ? uploadedFileName.replace(/\.[^.]+$/, '') : 'spectrum'
    addSpectrum({ dataUrl: url, fileName: base })
  }, [processedUrl, imageUrl, uploadedFileName, addSpectrum])

  const onClear = () => {
    setCropRect(null)
    setCropMode(false)
    setCropStart(null)
    handleClear()
  }

  const effectivePreviewBg = checkerboardOn ? 'checkerboard' : previewBgColor
  const previewImgSrc = processedUrl || imageUrl

  return (
    <div className="app">
      <header className="header">
        <nav className="nav-links">
          <Link to="/" className="nav-link active">Background Remover</Link>
          <Link to="/stacking" className="nav-link">Spectra Stacking</Link>
        </nav>
        <h1>Chroma Key Background Remover</h1>
        <p className="subtitle">
          Upload images, remove backgrounds, crop, then download or send to stacking.
        </p>
      </header>

      <div className="upload-zone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FORMATS.join(',')}
          multiple
          onChange={handleFileSelect}
          className="file-input"
        />
        {files.length === 0 ? (
          <div className="drop-area" onClick={() => fileInputRef.current?.click()}>
            <span>Drop images here or click to browse (multiple files)</span>
            <span className="formats">PNG, JPG, GIF, WebP, BMP</span>
          </div>
        ) : (
          <div className="file-bar">
            <span className="file-count">{files.length} image(s)</span>
            <div className="file-nav">
              <button
                type="button"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                disabled={currentIndex === 0}
              >
                ← Prev
              </button>
              <span>{currentIndex + 1} / {files.length}</span>
              <button
                type="button"
                onClick={() => setCurrentIndex((i) => Math.min(files.length - 1, i + 1))}
                disabled={currentIndex === files.length - 1}
              >
                Next →
              </button>
            </div>
            <button type="button" onClick={onClear} className="ghost">Clear all</button>
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
                  onChange={(e) => {
                    const v = e.target.value
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === '') setTargetColor(v || '#')
                  }}
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
                  title="Click on image to pick color"
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
            </div>

            <div className="control-group">
              <label>Preview background</label>
              <div className="color-row">
                <button
                  type="button"
                  className={`preview-bg-btn ${checkerboardOn ? 'active' : ''}`}
                  onClick={() => setCheckerboardOn((on) => !on)}
                  title="Toggle checkerboard"
                >
                  ◫
                </button>
                <input
                  type="color"
                  value={previewBgColor}
                  onChange={(e) => setPreviewBgColor(e.target.value)}
                  className="color-picker"
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
              {liveUpdate && <span className="live-warning">May cause lag with larger images.</span>}
            </div>

            <div className="control-group">
              <label>Crop</label>
              {processedUrl ? (
                cropMode ? (
                  <div className="crop-actions">
                    <button type="button" onClick={applyCrop} className="primary" disabled={!cropRect}>
                      Apply crop
                    </button>
                    <button type="button" onClick={cancelCrop} className="ghost">Cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setCropMode(true)} className="secondary">
                    Crop image
                  </button>
                )
              ) : (
                <span className="hint">Remove background first</span>
              )}
              {cropMode && <span className="hint">Click two corners to define crop area</span>}
            </div>

            <div className="actions">
              <button type="button" onClick={processImage} className="primary">
                Remove background
              </button>
              {(processedUrl || imageUrl) && (
                <>
                  <button type="button" onClick={downloadImage} className="secondary">
                    Download
                  </button>
                  <button type="button" onClick={sendToStacking} className="secondary">
                    Send to stacking
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="preview-area">
            {eyedropperMode && <div className="eyedropper-hint">Click on image to pick color</div>}
            {cropMode && <div className="eyedropper-hint">Click two corners to define crop</div>}
            <div
              className="preview-wrapper"
              style={
                checkerboardOn
                  ? { background: 'repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 50% / 16px 16px' }
                  : { background: previewBgColor }
              }
            >
              {previewImgSrc && (
                <div className="preview-img-wrap">
                  <img
                    ref={imgRef}
                    src={previewImgSrc}
                    alt={processedUrl ? 'Processed' : 'Original'}
                    className="preview-img"
                    onClick={handleImageClick}
                    onMouseMove={handleImageMouseMove}
                    onMouseLeave={handleImageMouseLeave}
                    style={{
                      cursor: eyedropperMode ? 'crosshair' : cropMode ? 'crosshair' : 'default',
                    }}
                  />
                  {cropRect && imgRef.current && (
                    <div
                      className="crop-overlay"
                      style={{
                        left: (cropRect.x / imgRef.current.naturalWidth) * 100 + '%',
                        top: (cropRect.y / imgRef.current.naturalHeight) * 100 + '%',
                        width: (cropRect.width / imgRef.current.naturalWidth) * 100 + '%',
                        height: (cropRect.height / imgRef.current.naturalHeight) * 100 + '%',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
            {zoomPos && zoomPixel?.img && !cropMode && (
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
