import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useStacking } from '../context/StackingContext'
import {
  recolorImageData,
  makeWhiteTransparent,
  scaleImageToMatchDistance,
} from '../utils/imageUtils'
import './StackingView.css'

// Darker, saturated colors for good contrast on white background
const SPECTRUM_COLORS = [
  '#b71c1c', '#1b5e20', '#0d47a1', '#4a148c', '#e65100',
  '#006064', '#bf360c', '#311b92', '#33691e', '#4e342e',
]

function pixelDistance(p1, p2) {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
}

export default function StackingView() {
  const {
    spectra,
    visibleIds,
    toggleVisible,
    updateSpectrum,
    clearSpectra,
    overlayMode,
    setOverlayMode,
    distributedGap,
    setDistributedGap,
    calibrationBgColor,
    setCalibrationBgColor,
  } = useStacking()
  const [refDistance, setRefDistance] = useState(null)
  const [refPoints, setRefPoints] = useState([])
  const [calibrationMode, setCalibrationMode] = useState(null)
  const [expandedAdjustId, setExpandedAdjustId] = useState(null)
  const [scaledImages, setScaledImages] = useState({})
  const [zoomRange, setZoomRange] = useState(null)
  const [dragSelect, setDragSelect] = useState(null)
  const canvasRef = useRef(null)
  const fullBufferRef = useRef(null)

  const hasReference = refDistance != null && refDistance > 0 && refPoints.length >= 2
  const refScaleVal = spectra[0] ? (() => {
    const ud = spectra[0].userDistance ?? (spectra[0].calPoints?.length === 2 ? pixelDistance(spectra[0].calPoints[0], spectra[0].calPoints[1]) : null)
    return ud && refDistance ? refDistance / ud : 1
  })() : 1
  const refAnchor = refPoints[0] && spectra[0] ? {
    x: (spectra[0]?.nudgeX ?? 0) + refPoints[0].x * refScaleVal * (spectra[0]?.scaleX ?? 1),
    y: (spectra[0]?.nudgeY ?? 0) + refPoints[0].y * refScaleVal * (spectra[0]?.scaleY ?? 1),
  } : null

  const startRefCalibration = () => {
    setCalibrationMode('ref')
    setRefPoints([])
    setRefDistance(null)
  }

  const startSpectrumCalibration = (id) => {
    setCalibrationMode(id)
    updateSpectrum(id, { calPoints: [], userDistance: null })
  }

  useEffect(() => {
    if (spectra.length === 0) {
      setRefDistance(null)
      setRefPoints([])
      return
    }
    if (calibrationMode !== null) return
    const first = spectra[0]
    if (first?.calPoints?.length >= 2 && first?.userDistance != null) {
      setRefPoints(first.calPoints)
      setRefDistance(first.userDistance)
    }
  }, [spectra, calibrationMode])

  const handleCalibrationClick = useCallback(
    (e) => {
      const el = e.currentTarget
      const rect = el.getBoundingClientRect()
      const scaleX = el.naturalWidth / rect.width
      const scaleY = el.naturalHeight / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      const point = { x, y }

      if (calibrationMode === 'ref') {
        const next = [...refPoints, point]
        setRefPoints(next)
        if (next.length === 2) {
          const dist = pixelDistance(next[0], next[1])
          setRefDistance(dist)
          if (spectra[0]) {
            updateSpectrum(spectra[0].id, { userDistance: dist, calPoints: next })
          }
          setCalibrationMode(null)
        }
      } else if (calibrationMode && spectra.some((s) => s.id === calibrationMode)) {
        const spec = spectra.find((s) => s.id === calibrationMode)
        const calPoints = [...(spec.calPoints || []), point]
        updateSpectrum(calibrationMode, { calPoints })
        if (calPoints.length === 2) {
          const dist = pixelDistance(calPoints[0], calPoints[1])
          updateSpectrum(calibrationMode, { userDistance: dist })
          setCalibrationMode(null)
        }
      }
    },
    [calibrationMode, refPoints, spectra, updateSpectrum]
  )

  useEffect(() => {
    async function scaleAll() {
      if (!hasReference) return
      const results = {}
      for (const s of spectra) {
        const ud = s.userDistance ?? (s.calPoints?.length === 2 ? pixelDistance(s.calPoints[0], s.calPoints[1]) : null)
        const scaleY = s.scaleY ?? 1
        const scaleX = s.scaleX ?? 1
        if (ud && ud > 0) {
          const scaled = await scaleImageToMatchDistance(s.dataUrl, refDistance, ud, scaleY, scaleX)
          results[s.id] = scaled
        } else {
          results[s.id] = s.dataUrl
        }
      }
      setScaledImages(results)
    }
    scaleAll()
  }, [spectra, refDistance, hasReference])

  const getScaleForSpectrum = (s) => {
    const ud = s.userDistance ?? (s.calPoints?.length === 2 ? pixelDistance(s.calPoints[0], s.calPoints[1]) : null)
    if (!ud || !refDistance) return 1
    return refDistance / ud
  }

  const copyBufferToDisplay = useCallback((buffer, zoom, dragSel) => {
    const canvas = canvasRef.current
    if (!canvas || !buffer) return
    const bufW = buffer.width
    const bufH = buffer.height
    const ctx = canvas.getContext('2d')

    if (zoom) {
      const { xMin, xMax } = zoom
      const zoomW = Math.max(1, xMax - xMin)
      canvas.width = bufW
      canvas.height = bufH
      ctx.drawImage(buffer, xMin, 0, zoomW, bufH, 0, 0, bufW, bufH)
    } else {
      canvas.width = bufW
      canvas.height = bufH
      ctx.drawImage(buffer, 0, 0)
    }

    if (dragSel) {
      const { x1, x2 } = dragSel
      const left = Math.min(x1, x2)
      const width = Math.abs(x2 - x1)
      const displayLeft = zoom ? (left - zoom.xMin) / (zoom.xMax - zoom.xMin) * bufW : left
      const displayWidth = zoom ? width / (zoom.xMax - zoom.xMin) * bufW : width
      ctx.strokeStyle = 'rgba(0, 100, 255, 0.8)'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.strokeRect(displayLeft, 0, displayWidth, bufH)
      ctx.setLineDash([])
    }
  }, [])

  const renderStackedCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const visible = spectra.filter((s) => visibleIds.has(s.id))
    if (visible.length === 0) return

    const loadAndDraw = async () => {
      const colorForSpec = (spec) =>
        SPECTRUM_COLORS[spectra.findIndex((s) => s.id === spec.id) % SPECTRUM_COLORS.length]

      const refScale = spectra[0] ? getScaleForSpectrum(spectra[0]) : 1
      const refCalPoints = spectra[0]?.calPoints || refPoints

      const processed = await Promise.all(
        visible.map((s) => {
          const url = scaledImages[s.id] ?? s.dataUrl
          return new Promise((res) => {
            const i = new Image()
            i.onload = () => res({ spec: s, img: i })
            i.src = url
          })
        })
      )

      const nudge = (s) => ({ x: s.nudgeX ?? 0, y: s.nudgeY ?? 0 })
      const scaleYVal = (s) => s.scaleY ?? 1

      const buffer = document.createElement('canvas')
      const ctx = buffer.getContext('2d')
      if (overlayMode === 'distributed') {
        let maxW = 0
        let y = 0
        for (const { spec, img } of processed) {
          maxW = Math.max(maxW, img.width)
          y += img.height + distributedGap
        }
        buffer.width = maxW
        buffer.height = y - distributedGap
        ctx.clearRect(0, 0, buffer.width, buffer.height)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, buffer.width, buffer.height)
        let drawY = 0
        for (let i = 0; i < processed.length; i++) {
          const { spec, img } = processed[i]
          const offscreen = document.createElement('canvas')
          offscreen.width = img.width
          offscreen.height = img.height
          const octx = offscreen.getContext('2d')
          octx.drawImage(img, 0, 0)
          const idata = octx.getImageData(0, 0, img.width, img.height)
          makeWhiteTransparent(idata)
          recolorImageData(idata, colorForSpec(spec))
          octx.putImageData(idata, 0, 0)
          const nd = nudge(spec)
          ctx.drawImage(offscreen, nd.x, drawY + nd.y)
          drawY += img.height + distributedGap
        }
      } else {
        let minX = 0, minY = 0, maxX = 0, maxY = 0

        const scaleXVal = (s) => s.scaleX ?? 1
        const positions = processed.map(({ spec, img }, vi) => {
          const scale = getScaleForSpectrum(spec)
          const calPts = spec.calPoints
          const nd = nudge(spec)
          const sy = scaleYVal(spec)
          const sx = scaleXVal(spec)

          let dx = 0, dy = 0
          if (spec.id === spectra[0]?.id) {
            dx = nd.x
            dy = nd.y
          } else if (refAnchor && calPts && calPts.length >= 1) {
            const anchorInScaled = {
              x: calPts[0].x * scale * sx,
              y: calPts[0].y * scale * sy,
            }
            dx = refAnchor.x - anchorInScaled.x + nd.x
            dy = refAnchor.y - anchorInScaled.y + nd.y
          } else {
            dx = nd.x
            dy = nd.y
          }

          minX = Math.min(minX, dx)
          minY = Math.min(minY, dy)
          maxX = Math.max(maxX, dx + img.width)
          maxY = Math.max(maxY, dy + img.height)
          return { spec, img, dx, dy }
        })

        const offX = -minX
        const offY = -minY
        buffer.width = Math.ceil(maxX - minX)
        buffer.height = Math.ceil(maxY - minY)
        ctx.clearRect(0, 0, buffer.width, buffer.height)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, buffer.width, buffer.height)

        for (let i = 0; i < positions.length; i++) {
          const { spec, img, dx, dy } = positions[i]
          const offscreen = document.createElement('canvas')
          offscreen.width = img.width
          offscreen.height = img.height
          const octx = offscreen.getContext('2d')
          octx.drawImage(img, 0, 0)
          const idata = octx.getImageData(0, 0, img.width, img.height)
          makeWhiteTransparent(idata)
          recolorImageData(idata, colorForSpec(spec))
          octx.putImageData(idata, 0, 0)
          ctx.globalCompositeOperation = 'source-over'
          ctx.drawImage(offscreen, dx + offX, dy + offY)
        }
      }

      fullBufferRef.current = buffer
      copyBufferToDisplay(buffer, zoomRange, dragSelect)
    }

    loadAndDraw()
  }, [spectra, visibleIds, scaledImages, overlayMode, distributedGap, refAnchor, hasReference, zoomRange, dragSelect, copyBufferToDisplay])

  useEffect(() => {
    renderStackedCanvas()
  }, [renderStackedCanvas])


  const clientToBufferCoords = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    const buf = fullBufferRef.current
    if (!canvas || !buf) return null
    const rect = canvas.getBoundingClientRect()
    const displayX = ((clientX - rect.left) / rect.width) * canvas.width
    const displayY = ((clientY - rect.top) / rect.height) * canvas.height
    if (zoomRange) {
      const { xMin, xMax } = zoomRange
      const bufX = xMin + (xMax - xMin) * (displayX / canvas.width)
      return { x: bufX, y: displayY }
    }
    return { x: displayX, y: displayY }
  }, [zoomRange])

  const handleCanvasMouseDown = useCallback((e) => {
    if (calibrationMode) return
    const coords = clientToBufferCoords(e.clientX, e.clientY)
    if (coords) setDragSelect({ x1: coords.x, x2: coords.x })
  }, [calibrationMode, clientToBufferCoords])

  const handleCanvasMouseMove = useCallback((e) => {
    if (!dragSelect) return
    const coords = clientToBufferCoords(e.clientX, e.clientY)
    if (coords) setDragSelect((prev) => ({ ...prev, x2: coords.x }))
  }, [dragSelect, clientToBufferCoords])

  const handleCanvasMouseUp = useCallback(() => {
    if (!dragSelect) return
    const { x1, x2 } = dragSelect
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const width = right - left
    if (width >= 5) {
      const buf = fullBufferRef.current
      if (buf) {
        setZoomRange({
          xMin: Math.max(0, left),
          xMax: Math.min(buf.width, right),
        })
      }
    }
    setDragSelect(null)
  }, [dragSelect])

  const handleCanvasMouseLeave = useCallback(() => {
    if (dragSelect) setDragSelect(null)
  }, [dragSelect])

  const resetZoom = useCallback(() => {
    setZoomRange(null)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'f' || e.key === 'F') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault()
          resetZoom()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [resetZoom])

  useEffect(() => {
    if (!dragSelect) return
    const handleGlobalMouseUp = () => {
      handleCanvasMouseUp()
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [dragSelect, handleCanvasMouseUp])

  const downloadStacked = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = 'spectra-stacked.png'
    a.click()
  }, [])

  if (spectra.length === 0) {
    return (
      <div className="app stacking-empty">
        <header className="header">
          <nav className="nav-links">
            <Link to="/" className="nav-link">Background Remover</Link>
            <Link to="/stacking" className="nav-link active">Spectra Stacking</Link>
          </nav>
          <h1>Spectra Stacking</h1>
          <p className="subtitle">
            No spectra yet. Use Background Remover to process images, then send them to stacking.
          </p>
          <Link to="/" className="primary">Go to Background Remover</Link>
        </header>
      </div>
    )
  }

  return (
    <div className="app stacking-view">
      <header className="header">
        <nav className="nav-links">
          <Link to="/" className="nav-link">Background Remover</Link>
          <Link to="/stacking" className="nav-link active">Spectra Stacking</Link>
        </nav>
        <h1>Spectra Stacking</h1>
        <p className="subtitle">
          Match scales, overlay spectra. Select 2 points on reference, then 2 matching points on each spectrum. Use Adjust for fine-tuning.
        </p>
      </header>

      <div className="stacking-layout">
        <div className="stacking-main">
          <div className="stacking-controls">
            <div className="control-group">
              <label>Reference scale</label>
              {!hasReference ? (
                <button type="button" onClick={startRefCalibration} className="secondary">
                  Select 2 points on first spectrum
                </button>
              ) : (
                <div className="ref-calibrated">
                  <span className="hint">Reference distance: {Math.round(refDistance)} px</span>
                  <button type="button" onClick={startRefCalibration} className="ghost small">
                    Recalibrate
                  </button>
                </div>
              )}
              {calibrationMode === 'ref' && (
                <span className="hint">Click 2 matching tick marks ({refPoints.length}/2)</span>
              )}
            </div>

            <div className="control-group">
              <label>Overlay mode</label>
              <select
                value={overlayMode}
                onChange={(e) => setOverlayMode(e.target.value)}
              >
                <option value="stacked">Stacked</option>
                <option value="distributed">Distributed vertically</option>
              </select>
              {overlayMode === 'distributed' && (
                <>
                  <label>Gap: {distributedGap}px</label>
                  <input
                    type="range"
                    min="0"
                    max="120"
                    value={distributedGap}
                    onChange={(e) => setDistributedGap(Number(e.target.value))}
                  />
                </>
              )}
            </div>

            {zoomRange && (
              <button type="button" onClick={resetZoom} className="secondary">
                Reset zoom (F)
              </button>
            )}
            <button type="button" onClick={downloadStacked} className="primary">
              Download stacked
            </button>
          </div>

          <div
            className="stacking-canvas-wrap"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
            style={{ cursor: dragSelect ? 'crosshair' : 'default' }}
          >
            <canvas
              ref={canvasRef}
              className="stacking-canvas"
              style={{
                background: '#ffffff',
              }}
            />
          </div>
        </div>

        <div className="stacking-sidebar">
          <div className="sidebar-header">Spectra</div>
          {spectra.map((s, i) => (
            <div key={s.id} className={`spectrum-item ${visibleIds.has(s.id) ? 'visible' : ''}`}>
              <label className="spectrum-toggle">
                <input
                  type="checkbox"
                  checked={visibleIds.has(s.id)}
                  onChange={() => toggleVisible(s.id)}
                />
                <span className="spectrum-color" style={{ background: SPECTRUM_COLORS[i % SPECTRUM_COLORS.length] }} />
                <span className="spectrum-name">{s.fileName || `Spectrum ${i + 1}`}</span>
              </label>
              <div className="spectrum-meta">
                {hasReference && (
                  s.userDistance != null ? (
                    <>
                      <span className="hint">Calibrated</span>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => setExpandedAdjustId(expandedAdjustId === s.id ? null : s.id)}
                      >
                        {expandedAdjustId === s.id ? 'Hide adjust' : 'Adjust'}
                      </button>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => startSpectrumCalibration(s.id)}
                      >
                        Recalibrate
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => startSpectrumCalibration(s.id)}
                    >
                      Calibrate
                    </button>
                  )
                )}
              </div>
              {expandedAdjustId === s.id && (
                <div className="spectrum-adjust">
                  <label>Nudge X</label>
                  <div className="nudge-row">
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeX: (s.nudgeX ?? 0) - 1 })}>−</button>
                    <span>{(s.nudgeX ?? 0)} px</span>
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeX: (s.nudgeX ?? 0) + 1 })}>+</button>
                  </div>
                  <label>Nudge Y</label>
                  <div className="nudge-row">
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeY: (s.nudgeY ?? 0) - 1 })}>−</button>
                    <span>{(s.nudgeY ?? 0)} px</span>
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeY: (s.nudgeY ?? 0) + 1 })}>+</button>
                  </div>
                  <label>X scale: {((s.scaleX ?? 1) * 100).toFixed(0)}%</label>
                  <div className="nudge-row">
                    <button type="button" onClick={() => updateSpectrum(s.id, { scaleX: Math.max(0.5, (s.scaleX ?? 1) - 0.005) })}>−</button>
                    <span>{((s.scaleX ?? 1) * 100).toFixed(0)}%</span>
                    <button type="button" onClick={() => updateSpectrum(s.id, { scaleX: Math.min(1.5, (s.scaleX ?? 1) + 0.005) })}>+</button>
                  </div>
                  <label>Y scale: {((s.scaleY ?? 1) * 100).toFixed(0)}%</label>
                  <input
                    type="range"
                    min="50"
                    max="150"
                    value={((s.scaleY ?? 1) * 100)}
                    onChange={(e) => updateSpectrum(s.id, { scaleY: Number(e.target.value) / 100 })}
                  />
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={clearSpectra} className="ghost full">
            Clear all
          </button>
        </div>
      </div>

      {calibrationMode && (
        <div className="calibration-modal">
          <div className="calibration-modal-content">
            <div className="calibration-bg-row">
              <label>Background:</label>
              <input
                type="color"
                value={calibrationBgColor}
                onChange={(e) => setCalibrationBgColor(e.target.value)}
                className="color-picker"
              />
                <input
                type="text"
                value={calibrationBgColor}
                onChange={(e) => {
                  const v = e.target.value
                  if (/^#?[0-9a-fA-F]{1,6}$/i.test(v)) setCalibrationBgColor(v.startsWith('#') ? v : '#' + v)
                }}
                className="hex-input"
                style={{ width: '80px' }}
              />
            </div>
            <p>
              {calibrationMode === 'ref'
                ? 'Click 2 points on the reference spectrum (e.g. axis tick marks)'
                : 'Click 2 matching points on this spectrum'}
            </p>
            <div className="calibration-img-wrap" style={{ background: calibrationBgColor }}>
              {calibrationMode === 'ref' ? (
                spectra.length > 0 && (
                  <img
                    src={spectra[0].dataUrl}
                    alt="Reference"
                    className="calibration-img"
                    onClick={handleCalibrationClick}
                  />
                )
              ) : (
                (() => {
                  const spec = spectra.find((s) => s.id === calibrationMode)
                  return spec ? (
                    <img
                      src={spec.dataUrl}
                      alt="Calibrate"
                      className="calibration-img"
                      onClick={handleCalibrationClick}
                    />
                  ) : null
                })()
              )}
            </div>
            {(calibrationMode === 'ref' ? refPoints : spectra.find((s) => s.id === calibrationMode)?.calPoints || []).length > 0 && (
              <span className="hint">1 point selected, click for 2nd</span>
            )}
            <button type="button" onClick={() => setCalibrationMode(null)} className="ghost">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
