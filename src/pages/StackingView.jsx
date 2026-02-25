import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { useStacking } from '../context/StackingContext'
import {
  recolorImageData,
  makeWhiteTransparent,
  resampleImageToWavenumberSpace,
} from '../utils/imageUtils'
import { parseJDX } from '../utils/jdxParser'
import { parseJcampForEditing } from '../utils/jcampEditorUtils'
import { normXToWavenumber, findLocalMinima, findLocalMaxima } from '../utils/spectrumPath'
import { isAbsorbance, getDisplayY } from '../utils/spectrumUnits'
import { SpectrumDataDisplay } from '../components/SpectrumDataDisplay'
import { HelpModal, HelpIcon } from '../components/HelpModal'
import { SAMPLE_SPECTRA } from '../data/sampleSpectra'
import './StackingView.css'

// Export: 8.5x11" landscape at 300 DPI
const EXPORT_DPI = 300
const EXPORT_WIDTH_IN = 11
const EXPORT_HEIGHT_IN = 8.5
const EXPORT_WIDTH_PX = Math.round(EXPORT_WIDTH_IN * EXPORT_DPI)
const EXPORT_HEIGHT_PX = Math.round(EXPORT_HEIGHT_IN * EXPORT_DPI)

const WAVENUMBER_MARKERS = [1000, 2000, 3000]
const TARGET_WAVENUMBER_MIN = 500
const TARGET_WAVENUMBER_MAX = 4000
const TARGET_WIDTH = 800
const BASE_DISPLAY_HEIGHT = 475

const EyeIcon = ({ visible = true, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {visible ? (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2" />
      </>
    )}
  </svg>
)

const XIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ZoomIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const PeakIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20l-3-6-4 8h14l-4-8-3 6z" />
  </svg>
)

const RegionIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
  </svg>
)

const DownloadIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const SettingsIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
)

// Darker, saturated colors for good contrast on white background
const SPECTRUM_COLORS = [
  '#b71c1c', '#1b5e20', '#0d47a1', '#4a148c', '#e65100',
  '#006064', '#bf360c', '#311b92', '#33691e', '#4e342e',
]

const LEGEND_ROW_HEIGHT = 18
const LEGEND_SWATCH_SIZE = 12
const LEGEND_PADDING = 16
const LEGEND_RIGHT_PAD = 16

/** Create SVG legend group (color swatch + name per spectrum), positioned bottom-right. Returns { g, height }. */
function createExportLegend(visibleDataSpectra, spectra, baseY, svgWidth = 800) {
  const ns = 'http://www.w3.org/2000/svg'
  const g = document.createElementNS(ns, 'g')
  g.setAttribute('class', 'export-legend')
  if (visibleDataSpectra.length === 0) return { g, height: 0 }
  const legendWidth = LEGEND_SWATCH_SIZE + 6 + 180
  const legendX = svgWidth - LEGEND_RIGHT_PAD - legendWidth
  const legendTop = baseY + LEGEND_PADDING
  const height = visibleDataSpectra.length * LEGEND_ROW_HEIGHT + LEGEND_PADDING * 2
  visibleDataSpectra.forEach((spec, i) => {
    const color = SPECTRUM_COLORS[spectra.findIndex((s) => s.id === spec.id) % SPECTRUM_COLORS.length]
    const rowY = legendTop + i * LEGEND_ROW_HEIGHT + LEGEND_ROW_HEIGHT / 2
    const rect = document.createElementNS(ns, 'rect')
    rect.setAttribute('x', legendX)
    rect.setAttribute('y', rowY - LEGEND_SWATCH_SIZE / 2)
    rect.setAttribute('width', LEGEND_SWATCH_SIZE)
    rect.setAttribute('height', LEGEND_SWATCH_SIZE)
    rect.setAttribute('fill', color)
    rect.setAttribute('stroke', '#555')
    rect.setAttribute('stroke-width', '1')
    const t = document.createElementNS(ns, 'text')
    t.setAttribute('x', legendX + LEGEND_SWATCH_SIZE + 6)
    t.setAttribute('y', rowY + 4)
    t.setAttribute('font-size', '12')
    t.setAttribute('font-family', 'system-ui, sans-serif')
    t.setAttribute('fill', '#333')
    t.textContent = spec.fileName || `Spectrum ${i + 1}`
    g.appendChild(rect)
    g.appendChild(t)
  })
  return { g, height }
}

function CalibrationModal({
  calibrationMode,
  spectra,
  calibrationBgColor,
  setCalibrationBgColor,
  refWavenumberCal,
  calibrationStep,
  onCalibrationClick,
  onClose,
}) {
  const [zoom, setZoom] = useState(null)
  const [drag, setDrag] = useState(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const justDidZoomDragRef = useRef(false)
  const canvasRef = useRef(null)
  const imgRef = useRef(null)

  const currentSpec = calibrationMode === 'ref' ? spectra[0] : spectra.find((s) => s.id === calibrationMode)
  const calPoints = calibrationMode === 'ref' ? refWavenumberCal : (currentSpec?.wavenumberCal || [])
  const imgSrc = calibrationMode === 'ref' ? spectra[0]?.dataUrl : currentSpec?.dataUrl

  useEffect(() => { setImgLoaded(false) }, [imgSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete || !imgSrc || !imgLoaded) return

    const ctx = canvas.getContext('2d')
    const z = zoom
    if (z) {
      const sw = z.xMax - z.xMin
      const sh = z.yMax - z.yMin
      canvas.width = 600
      canvas.height = 300
      ctx.drawImage(img, z.xMin, z.yMin, sw, sh, 0, 0, canvas.width, canvas.height)
    } else {
      const scale = Math.min(600 / img.naturalWidth, 300 / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      canvas.width = w
      canvas.height = h
      ctx.drawImage(img, 0, 0, w, h)
    }
  }, [imgSrc, zoom, imgLoaded])

  const clientToImgCoords = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return null
    const rect = canvas.getBoundingClientRect()
    const cx = (clientX - rect.left) / rect.width * canvas.width
    const cy = (clientY - rect.top) / rect.height * canvas.height
    if (zoom) {
      const sw = zoom.xMax - zoom.xMin
      const sh = zoom.yMax - zoom.yMin
      return {
        x: zoom.xMin + (cx / canvas.width) * sw,
        y: zoom.yMin + (cy / canvas.height) * sh,
      }
    }
    const scale = Math.min(600 / img.naturalWidth, 300 / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    return { x: (cx / w) * img.naturalWidth, y: (cy / h) * img.naturalHeight }
  }, [zoom])

  const handleCanvasClick = useCallback((e) => {
    if (drag) return
    const coords = clientToImgCoords(e.clientX, e.clientY)
    if (!coords) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const syntheticEvent = {
      currentTarget: Object.assign(document.createElement('img'), {
        naturalWidth: 1,
        naturalHeight: 1,
        getBoundingClientRect: () => rect,
      }),
      clientX: e.clientX,
      clientY: e.clientY,
    }
    Object.defineProperty(syntheticEvent.currentTarget, 'naturalWidth', { value: zoom ? (zoom.xMax - zoom.xMin) : 1 })
    Object.defineProperty(syntheticEvent.currentTarget, 'naturalHeight', { value: zoom ? (zoom.yMax - zoom.yMin) : 1 })
    const fakeImg = {
      getBoundingClientRect: () => rect,
      naturalWidth: zoom ? (zoom.xMax - zoom.xMin) : canvas.width,
      naturalHeight: zoom ? (zoom.yMax - zoom.yMin) : canvas.height,
    }
    const scaleX = (zoom ? zoom.xMax - zoom.xMin : fakeImg.naturalWidth) / rect.width
    const scaleY = (zoom ? zoom.yMax - zoom.yMin : fakeImg.naturalHeight) / rect.height
    const evt = {
      currentTarget: fakeImg,
      clientX: rect.left + coords.x / scaleX,
      clientY: rect.top + coords.y / scaleY,
    }
    Object.defineProperty(evt.currentTarget, 'naturalWidth', { value: zoom ? zoom.xMax - zoom.xMin : imgRef.current?.naturalWidth ?? 1 })
    Object.defineProperty(evt.currentTarget, 'naturalHeight', { value: zoom ? zoom.yMax - zoom.yMin : imgRef.current?.naturalHeight ?? 1 })
    const finalEvt = {
      currentTarget: {
        getBoundingClientRect: () => rect,
        naturalWidth: imgRef.current?.naturalWidth ?? 1,
        naturalHeight: imgRef.current?.naturalHeight ?? 1,
      },
      clientX: rect.left + (coords.x / (imgRef.current?.naturalWidth ?? 1)) * rect.width,
      clientY: rect.top + (coords.y / (imgRef.current?.naturalHeight ?? 1)) * rect.height,
    }
    onCalibrationClick({ ...e, currentTarget: { getBoundingClientRect: () => rect, naturalWidth: imgRef.current?.naturalWidth, naturalHeight: imgRef.current?.naturalHeight }, clientX: rect.left + coords.x / (imgRef.current?.naturalWidth / rect.width), clientY: rect.top + coords.y / (imgRef.current?.naturalHeight / rect.height) })
  }, [drag, clientToImgCoords, onCalibrationClick, zoom])

  const handleMouseDown = useCallback((e) => {
    const coords = clientToImgCoords(e.clientX, e.clientY)
    if (coords) setDrag({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y })
  }, [clientToImgCoords])

  const handleMouseMove = useCallback((e) => {
    if (!drag) return
    const coords = clientToImgCoords(e.clientX, e.clientY)
    if (coords) setDrag((d) => ({ ...d, x2: coords.x, y2: coords.y }))
  }, [drag, clientToImgCoords])

  const handleMouseUp = useCallback(() => {
    if (!drag) return
    const { x1, y1, x2, y2 } = drag
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    if (right - left >= 5 && bottom - top >= 5) {
      setZoom({ xMin: left, xMax: right, yMin: top, yMax: bottom })
      justDidZoomDragRef.current = true
    }
    setDrag(null)
  }, [drag])

  const resetZoom = useCallback(() => setZoom(null), [])

  useEffect(() => {
    const h = (e) => {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        resetZoom()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [resetZoom])

  useEffect(() => {
    if (!drag) return
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [drag, handleMouseUp])

  const handleCanvasClickSimple = useCallback((e) => {
    if (drag) return
    if (justDidZoomDragRef.current) {
      justDidZoomDragRef.current = false
      return
    }
    const coords = clientToImgCoords(e.clientX, e.clientY)
    if (!coords) return
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const clientX = rect.left + (coords.x / img.naturalWidth) * rect.width
    const clientY = rect.top + (coords.y / img.naturalHeight) * rect.height
    const evt = {
      currentTarget: {
        getBoundingClientRect: () => rect,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      },
      clientX,
      clientY,
    }
    onCalibrationClick(evt)
  }, [drag, clientToImgCoords, onCalibrationClick])

  return (
    <div className="modal-overlay calibration-modal">
      <div className="calibration-modal-content">
        <div className="calibration-bg-row">
          <label>Background:</label>
          <input type="color" value={calibrationBgColor} onChange={(e) => setCalibrationBgColor(e.target.value)} className="color-picker" />
          <input type="text" value={calibrationBgColor} onChange={(e) => { const v = e.target.value; if (/^#?[0-9a-fA-F]{1,6}$/i.test(v)) setCalibrationBgColor(v.startsWith('#') ? v : '#' + v) }} className="hex-input" style={{ width: '80px' }} />
        </div>
        <p>
          {calibrationMode === 'ref'
            ? `Click on ${WAVENUMBER_MARKERS[refWavenumberCal.length]} cm⁻¹ tick mark (${refWavenumberCal.length}/3)`
            : `Click on ${WAVENUMBER_MARKERS[calibrationStep]} cm⁻¹ tick mark (${calPoints.length}/3)`}
        </p>
        <p className="hint">Drag to zoom, F to reset zoom</p>
        <div className="calibration-img-wrap calibration-canvas-wrap" style={{ background: calibrationBgColor }}>
          {imgSrc && (
            <>
              <img ref={imgRef} src={imgSrc} alt="" style={{ display: 'none' }} onLoad={() => setImgLoaded(true)} />
              <canvas
                ref={canvasRef}
                className="calibration-img"
                style={{ cursor: 'crosshair', display: 'block' }}
                onClick={handleCanvasClickSimple}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              />
              {drag && canvasRef.current && imgRef.current && (
                (() => {
                  const img = imgRef.current
                  const canv = canvasRef.current
                  const z = zoom
                  let left = Math.min(drag.x1, drag.x2)
                  let top = Math.min(drag.y1, drag.y2)
                  let w = Math.abs(drag.x2 - drag.x1)
                  let h = Math.abs(drag.y2 - drag.y1)
                  if (z) {
                    const sw = z.xMax - z.xMin
                    const sh = z.yMax - z.yMin
                    left = ((left - z.xMin) / sw) * canv.width
                    top = ((top - z.yMin) / sh) * canv.height
                    w = (w / sw) * canv.width
                    h = (h / sh) * canv.height
                  } else {
                    const scale = Math.min(600 / img.naturalWidth, 300 / img.naturalHeight)
                    const cw = img.naturalWidth * scale
                    const ch = img.naturalHeight * scale
                    left = (left / img.naturalWidth) * cw
                    top = (top / img.naturalHeight) * ch
                    w = (w / img.naturalWidth) * cw
                    h = (h / img.naturalHeight) * ch
                  }
                  return (
                    <div
                      className="calibration-zoom-box"
                      style={{
                        left: (12 + left) + 'px',
                        top: (12 + top) + 'px',
                        width: w + 'px',
                        height: h + 'px',
                      }}
                    />
                  )
                })()
              )}
            </>
          )}
        </div>
        {zoom && (
          <button type="button" onClick={resetZoom} className="ghost small">Reset zoom (F)</button>
        )}
        <button type="button" onClick={onClose} className="ghost">Cancel</button>
      </div>
    </div>
  )
}

/** Build export SVG (chart + legend + optional list), return blob URL for preview. Returns null if not data-only or SVG not found. */
function buildExportSvgBlobUrl(displayWrapRef, spectra, visibleIds, displayHeight, includeList) {
  const wrap = displayWrapRef?.current
  const svg = wrap?.querySelector('.spectrum-data-display')
  if (!svg) return null
  const visibleDataSpectra = spectra.filter((s) => visibleIds.has(s.id) && s.data)
  if (visibleDataSpectra.length === 0) return null
  const listText = buildPeakRegionList(spectra, visibleIds)
  const origHeight = parseInt(svg.getAttribute('height') || displayHeight, 10)
  const { g: legendG, height: legendHeight } = createExportLegend(visibleDataSpectra, spectra, origHeight, 800)
  const listHeight = includeList && listText.trim() ? Math.min(listText.split('\n').length * 18 + 60, 400) : 0
  const extraHeight = Math.max(listHeight, legendHeight)
  const totalHeight = displayHeight + extraHeight

  const svgClone = svg.cloneNode(true)
  svgClone.setAttribute('width', '800')
  svgClone.setAttribute('height', String(totalHeight))
  svgClone.setAttribute('viewBox', `0 0 800 ${totalHeight}`)
  svgClone.setAttribute('style', 'background:#fff;display:block')
  if (includeList && listText.trim()) {
    const listG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    listG.setAttribute('transform', `translate(52, ${displayHeight + 24})`)
    listText.split('\n').forEach((line, i) => {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('x', '0')
      t.setAttribute('y', String(i * 18))
      t.setAttribute('font-size', '12')
      t.setAttribute('font-family', 'system-ui, sans-serif')
      t.setAttribute('fill', '#333')
      t.textContent = line
      listG.appendChild(t)
    })
    svgClone.appendChild(listG)
  }
  const { g: legendG2 } = createExportLegend(visibleDataSpectra, spectra, displayHeight, 800)
  svgClone.appendChild(legendG2)
  const svgStr = new XMLSerializer().serializeToString(svgClone)
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  return URL.createObjectURL(blob)
}

function buildPeakRegionList(spectra, visibleIds) {
  const lines = []
  for (const s of spectra) {
    if (!visibleIds.has(s.id) || !s.data) continue
    const name = s.fileName || s.id.slice(0, 8)
    lines.push(`${name}:`)
    const peaks = s.peaks ?? []
    const peakGroups = s.peakGroups ?? {}
    const regions = s.regions ?? []
    const peaksByGroup = {}
    const ungrouped = []
    peaks.forEach((p) => {
      if (p.groupId && peakGroups[p.groupId]) {
        if (!peaksByGroup[p.groupId]) peaksByGroup[p.groupId] = []
        peaksByGroup[p.groupId].push(p)
      } else ungrouped.push(p)
    })
    for (const p of ungrouped) {
      const label = p.label ? `${p.label} ` : ''
      lines.push(`  • ${label}(${p.wavenumber.toFixed(0)} cm⁻¹)`)
    }
    for (const [gid, items] of Object.entries(peaksByGroup)) {
      const g = peakGroups[gid] ?? {}
      const wavenumbers = items.map((x) => x.wavenumber)
      const wMin = Math.min(...wavenumbers)
      const wMax = Math.max(...wavenumbers)
      const range = wMin === wMax ? `${wMin.toFixed(0)}` : `${Math.round(wMin)}–${Math.round(wMax)}`
      const label = g.label ? `${g.label} ` : ''
      lines.push(`  • ${label}(${range} cm⁻¹)`)
    }
    for (const r of regions) {
      const label = r.label ? `${r.label} ` : ''
      lines.push(`  • Region: ${label}(${Math.round(r.wavenumberMin)}–${Math.round(r.wavenumberMax)} cm⁻¹)`)
    }
    if (ungrouped.length === 0 && Object.keys(peaksByGroup).length === 0 && regions.length === 0) {
      lines.push('  (no peaks or regions)')
    }
    lines.push('')
  }
  return lines.join('\n')
}

function ExportModal({
  open,
  onClose,
  hasDataOnly,
  format,
  setFormat,
  includeList,
  setIncludeList,
  onExport,
  previewUrl,
  downloadName,
  setDownloadName,
}) {
  if (!open) return null
  return (
    <div className="modal-overlay export-modal-overlay" onClick={onClose}>
      <div className="export-modal export-modal-with-preview" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3>Export spectra</h3>
          <button type="button" onClick={onClose} className="ghost small export-modal-close" aria-label="Close">×</button>
        </div>
        <div className="export-modal-body">
          <div className="export-modal-row">
            <div className="export-modal-option export-modal-filename">
              <label htmlFor="export-filename">File name</label>
              <input
                id="export-filename"
                type="text"
                value={downloadName}
                onChange={(e) => setDownloadName(e.target.value)}
                placeholder="spectra-stacked"
                className="export-filename-input"
              />
            </div>
            <div className="export-modal-option export-modal-format">
              <label htmlFor="export-format">Format</label>
              <select
                id="export-format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="export-format-select"
              >
                {hasDataOnly && <option value="svg">SVG</option>}
                <option value="png">PNG</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
          </div>
          {hasDataOnly && (
            <label className="export-modal-checkbox">
              <input
                type="checkbox"
                checked={includeList}
                onChange={(e) => setIncludeList(e.target.checked)}
              />
              Include peak/region list (labels and wavenumbers)
            </label>
          )}
          {hasDataOnly && previewUrl && (
            <div className="export-modal-preview-wrap">
              <label className="export-modal-preview-label">Preview</label>
              <div className="export-modal-preview">
                <img src={previewUrl} alt="Export preview" className="export-modal-preview-img" />
              </div>
            </div>
          )}
        </div>
        <div className="export-modal-footer">
          <button type="button" onClick={onClose} className="secondary">Cancel</button>
          <button type="button" onClick={onExport} className="primary btn-with-icon">
            <DownloadIcon size={14} />
            <span>Download</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsModal({
  open,
  onClose,
  hasDataOnly,
  normalizeY,
  setNormalizeY,
  showWavenumberBox,
  setShowWavenumberBox,
  showWavenumbersInLabels,
  setShowWavenumbersInLabels,
  displayYUnits,
  setDisplayYUnits,
}) {
  if (!open) return null
  return (
    <div className="modal-overlay settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h3>Settings</h3>
          <button type="button" onClick={onClose} className="ghost small settings-modal-close" aria-label="Close">×</button>
        </div>
        <div className="settings-modal-body">
          {hasDataOnly && (
            <>
              <div className="settings-modal-option">
                <label htmlFor="display-y-units">Y-axis display</label>
                <select
                  id="display-y-units"
                  value={displayYUnits}
                  onChange={(e) => setDisplayYUnits(e.target.value)}
                  style={{ padding: '0.5rem 0.75rem', borderRadius: 6, width: '100%' }}
                >
                  <option value="transmittance">Transmittance</option>
                  <option value="absorbance">Absorbance</option>
                </select>
              </div>
              <span className="settings-modal-hint">Convert absorbance data to transmittance by default; switch to view as absorbance</span>
              <label className="settings-modal-checkbox">
                <input
                  type="checkbox"
                  checked={normalizeY}
                  onChange={(e) => setNormalizeY(e.target.checked)}
                />
                <span>Normalize Y per spectrum</span>
              </label>
              <span className="settings-modal-hint">Scale each spectrum to 0–1 for overlay comparison</span>
              <label className="settings-modal-checkbox">
                <input
                  type="checkbox"
                  checked={showWavenumberBox}
                  onChange={(e) => setShowWavenumberBox(e.target.checked)}
                />
                <span>Show wavenumber at cursor</span>
              </label>
              <label className="settings-modal-checkbox">
                <input
                  type="checkbox"
                  checked={showWavenumbersInLabels}
                  onChange={(e) => setShowWavenumbersInLabels(e.target.checked)}
                />
                <span>Show wavenumbers in labels</span>
              </label>
              <span className="settings-modal-hint">Append wavenumber range to peak/region labels</span>
            </>
          )}
          {!hasDataOnly && (
            <span className="settings-modal-hint">These settings apply when viewing JCAMP-DX spectra.</span>
          )}
          <div className="settings-modal-footer-link">
            <Link to="/jcamp-editor" onClick={onClose} className="settings-footer-link">
              JCAMP-DX file editor
            </Link>
          </div>
        </div>
        <div className="settings-modal-footer" style={{ borderTop: 'none' }}>
          <button type="button" onClick={onClose} className="primary small">Done</button>
        </div>
      </div>
    </div>
  )
}

function SpectrumMetadataModal({ open, onClose, spectrum }) {
  if (!open || !spectrum) return null
  const meta = spectrum.jdxMetadata ?? []
  return (
    <div className="modal-overlay settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal spectrum-info-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="settings-modal-header">
          <h3>{spectrum.fileName || 'Spectrum'} — JCAMP-DX metadata</h3>
          <button type="button" onClick={onClose} className="ghost small settings-modal-close" aria-label="Close">×</button>
        </div>
        <div className="settings-modal-body spectrum-info-modal-body">
          {meta.length === 0 ? (
            <p className="settings-modal-hint">No metadata available for this spectrum.</p>
          ) : (
            <dl className="spectrum-info-metadata-list">
              {meta.map(({ key, value }) => (
                <div key={key} className="spectrum-info-metadata-row">
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="settings-modal-footer">
          <button type="button" onClick={onClose} className="primary small">Done</button>
        </div>
      </div>
    </div>
  )
}

function InfoIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

function SampleLibraryModal({ onAddSpectrum, onClose }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [infoOpenId, setInfoOpenId] = useState(null)
  const [popoverPosition, setPopoverPosition] = useState('below')
  const [popoverAnchorRect, setPopoverAnchorRect] = useState(null)
  const listRef = useRef(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    if (!infoOpenId) return
    const onDocClick = () => {
      setInfoOpenId(null)
      setPopoverAnchorRect(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [infoOpenId])

  const handleAdd = useCallback((sample) => {
    try {
      const parsed = parseJDX(sample.jdxContent)
      if (!parsed.x?.length || !parsed.y?.length) return
      const { headerEntries } = parseJcampForEditing(sample.jdxContent)
      const jdxMetadata = headerEntries.filter((e) => e.type === 'metadata').map((e) => ({ key: e.key, value: e.value }))
      onAddSpectrum({
        data: { x: parsed.x, y: parsed.y, yUnits: parsed.yUnits },
        fileName: sample.name,
        metadata: {
          minWavenumber: parsed.minWavenumber,
          maxWavenumber: parsed.maxWavenumber,
          piecewiseAt: 2000,
        },
        jdxMetadata,
      })
      onClose()
    } catch (err) {
      console.error('Failed to load sample:', err)
    }
  }, [onAddSpectrum, onClose])

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let list = SAMPLE_SPECTRA
    if (q) {
      list = list.filter((s) => {
        const nameMatch = s.name?.toLowerCase().includes(q)
        const namesMatch = s.names?.toLowerCase().includes(q)
        const casMatch = s.casNumber?.toLowerCase().includes(q)
        const fgMatch = (s.functionalGroups ?? []).some((g) => g.toLowerCase().includes(q))
        return nameMatch || namesMatch || casMatch || fgMatch
      })
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
      if (sortBy === 'cas') return (a.casNumber ?? '').localeCompare(b.casNumber ?? '')
      if (sortBy === 'functionalGroups') {
        const aFg = (a.functionalGroups ?? []).join(', ')
        const bFg = (b.functionalGroups ?? []).join(', ')
        return aFg.localeCompare(bFg)
      }
      return 0
    })
  }, [searchQuery, sortBy])

  const infoOpenSample = useMemo(
    () => (infoOpenId ? filteredAndSorted.find((s) => s.id === infoOpenId) : null),
    [infoOpenId, filteredAndSorted]
  )

  const popoverStyle = infoOpenSample && popoverAnchorRect
    ? {
        position: 'fixed',
        right: window.innerWidth - popoverAnchorRect.right,
        ...(popoverPosition === 'below'
          ? { top: popoverAnchorRect.bottom + 4 }
          : { bottom: window.innerHeight - popoverAnchorRect.top + 4 }),
        zIndex: 1000,
      }
    : null

  return (
    <>
      {infoOpenSample && popoverAnchorRect &&
        createPortal(
          <div
            className="sample-library-info-popover sample-library-info-popover--portal"
            style={popoverStyle}
            role="tooltip"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sample-library-info-content">
              {infoOpenSample.owner && (
                <p><strong>OWNER</strong><br />{infoOpenSample.owner}</p>
              )}
              {infoOpenSample.origin && (
                <p><strong>ORIGIN</strong><br />{infoOpenSample.origin}</p>
              )}
              {infoOpenSample.citation && (
                <p><strong>CITATION</strong><br />{infoOpenSample.citation}</p>
              )}
              {!infoOpenSample.owner && !infoOpenSample.origin && !infoOpenSample.citation && (
                <p className="sample-library-info-empty">No reference information available.</p>
              )}
            </div>
            <button
              type="button"
              className="ghost small sample-library-info-close"
              onClick={(e) => {
                e.stopPropagation()
                setInfoOpenId(null)
                setPopoverAnchorRect(null)
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>,
          document.body
        )}
    <div className="modal-overlay sample-library-modal-overlay" onClick={onClose}>
      <div className="sample-library-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sample-library-header">
          <h3>Sample spectra library</h3>
          <button type="button" onClick={onClose} className="ghost small sample-library-close" aria-label="Close">×</button>
        </div>
        <div className="sample-library-toolbar">
          <input
            type="search"
            placeholder="Search by name, CAS No, or functional group..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sample-library-search"
            aria-label="Search spectra"
          />
          <label className="sample-library-sort">
            <span>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort by">
              <option value="name">Name</option>
              <option value="cas">CAS Registry No</option>
              <option value="functionalGroups">Functional groups</option>
            </select>
          </label>
        </div>
        <div ref={listRef} className="sample-library-list">
          <div className="sample-library-list-header">
            <span className="sample-library-col-name">Name</span>
            <span className="sample-library-col-fg">Functional groups</span>
            <span className="sample-library-col-cas">CAS No</span>
            <span className="sample-library-col-action" />
          </div>
          {filteredAndSorted.map((sample) => (
            <div
              key={sample.id}
              className="sample-library-row"
              onDoubleClick={() => handleAdd(sample)}
            >
              <span className="sample-library-col-name">
                <span className="sample-library-icon" aria-hidden>📄</span>
                {sample.name}
              </span>
              <span className="sample-library-col-fg">{(sample.functionalGroups ?? []).join(', ') || '—'}</span>
              <span className="sample-library-col-cas">{sample.casNumber}</span>
              <span className="sample-library-col-action">
                <div className="sample-library-row-actions">
                  <button
                    type="button"
                    className="ghost small sample-library-info-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      const nextId = infoOpenId === sample.id ? null : sample.id
                      if (nextId && listRef.current) {
                        const btnRect = e.currentTarget.getBoundingClientRect()
                        const listRect = listRef.current.getBoundingClientRect()
                        const spaceAbove = btnRect.top - listRect.top
                        const spaceBelow = listRect.bottom - btnRect.bottom
                        setPopoverPosition(spaceAbove >= spaceBelow ? 'above' : 'below')
                        setPopoverAnchorRect(btnRect)
                      } else {
                        setPopoverAnchorRect(null)
                      }
                      setInfoOpenId(nextId)
                    }}
                    title="Reference information"
                    aria-label="Reference information"
                  >
                    <InfoIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className="primary small"
                    onClick={(e) => { e.stopPropagation(); handleAdd(sample) }}
                  >
                    Add
                  </button>
                </div>
              </span>
            </div>
          ))}
        </div>
        <div className="sample-library-footer">
          <span className="sample-library-hint">
            {filteredAndSorted.length} spectrum{filteredAndSorted.length !== 1 ? 's' : ''}. Double-click or click Add to load.
          </span>
          <button type="button" onClick={onClose} className="secondary">Close</button>
        </div>
      </div>
    </div>
    </>
  )
}

export default function StackingView() {
  const {
    spectra,
    visibleIds,
    archivedSpectra,
    addSpectrum,
    toggleVisible,
    updateSpectrum,
    clearSpectra,
    archiveSpectrum,
    restoreSpectrum,
    overlayMode,
    setOverlayMode,
    distributedGap,
    setDistributedGap,
    calibrationBgColor,
    setCalibrationBgColor,
  } = useStacking()
  const [calibrationMode, setCalibrationMode] = useState(null)
  const [expandedAdjustId, setExpandedAdjustId] = useState(null)
  const [spectrumInfoId, setSpectrumInfoId] = useState(null)
  const [scaledImages, setScaledImages] = useState({})
  const [zoomRange, setZoomRange] = useState(null)
  const [dragSelect, setDragSelect] = useState(null)
  const displayWrapRef = useRef(null)
  const [jdxError, setJdxError] = useState(null)
  const [calModalZoom, setCalModalZoom] = useState(null)
  const [calModalDrag, setCalModalDrag] = useState(null)
  const [normalizeY, setNormalizeY] = useState(true)
  const [showWavenumberBox, setShowWavenumberBox] = useState(true)
  const [showWavenumbersInLabels, setShowWavenumbersInLabels] = useState(true)
  const [displayYUnits, setDisplayYUnits] = useState('transmittance')
  const [debugCursor, setDebugCursor] = useState(null)
  const [tool, setTool] = useState('zoom')
  const [activeSpectrumId, setActiveSpectrumId] = useState(null)
  const touchPoint1Ref = useRef(null)
  const [touchPoint1Wavenumber, setTouchPoint1Wavenumber] = useState(null)
  const [touchFirstPointPlaced, setTouchFirstPointPlaced] = useState(false)
  const [touchDraft, setTouchDraft] = useState(null)
  const [touchRegionAdjustMode, setTouchRegionAdjustMode] = useState(false)
  const REGION_ADJUST_STEP = 5
  const [expandedPeakListId, setExpandedPeakListId] = useState(null)
  const [selectedPeakIndices, setSelectedPeakIndices] = useState({}) // { [spectrumId]: Set<number> }
  const [collapsedPeakGroups, setCollapsedPeakGroups] = useState(new Set()) // Set of 'spectrumId-groupId'
  const [displayHeight, setDisplayHeight] = useState(BASE_DISPLAY_HEIGHT)
  const [sidebarWidth, setSidebarWidth] = useState(200)
  const [sidebarTab, setSidebarTab] = useState('spectra')
  const [sampleLibraryOpen, setSampleLibraryOpen] = useState(false)
  const resizeStartRef = useRef(null)
  const canvasRef = useRef(null)
  const fullBufferRef = useRef(null)
  const jdxInputRef = useRef(null)

  const [refWavenumberCal, setRefWavenumberCal] = useState([])
  const [calibrationStep, setCalibrationStep] = useState(0)

  const hasReference = (() => {
    const first = spectra[0]
    if (!first) return false
    if (first.data) return true
    if (first.jdxWavenumberRange) return true
    return (first.wavenumberCal?.length ?? 0) >= 3
  })()

  const visibleDataSpectra = spectra.filter((s) => visibleIds.has(s.id) && s.data)
  const hasDataOnly = visibleDataSpectra.length > 0 && visibleDataSpectra.length === spectra.filter((s) => visibleIds.has(s.id)).length

  useEffect(() => {
    if (hasDataOnly && visibleDataSpectra.length > 0) {
      const valid = visibleDataSpectra.some((s) => s.id === activeSpectrumId)
      if (!valid) setActiveSpectrumId(visibleDataSpectra[0].id)
    } else {
      setActiveSpectrumId(null)
    }
  }, [hasDataOnly, visibleDataSpectra, activeSpectrumId])

  useEffect(() => {
    if (spectra.length === 0 && archivedSpectra.length > 0) {
      setSidebarTab('archive')
    }
  }, [spectra.length, archivedSpectra.length])

  const startRefCalibration = () => {
    setCalibrationMode('ref')
    setRefWavenumberCal([])
    setCalibrationStep(0)
  }

  const startSpectrumCalibration = (id) => {
    const spec = spectra.find((s) => s.id === id)
    if (spec?.jdxWavenumberRange) return
    setCalibrationMode(id)
    setCalibrationStep(0)
    updateSpectrum(id, { wavenumberCal: [] })
  }

  useEffect(() => {
    if (spectra.length === 0) {
      setRefWavenumberCal([])
      return
    }
    if (calibrationMode !== null) return
    const first = spectra[0]
    if (first?.wavenumberCal?.length >= 3) {
      setRefWavenumberCal(first.wavenumberCal)
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
      const wavenumber = WAVENUMBER_MARKERS[calibrationStep]

      if (calibrationMode === 'ref') {
        const next = [...refWavenumberCal, { x, y, wavenumber }]
        setRefWavenumberCal(next)
        if (next.length >= 3) {
          if (spectra[0]) {
            updateSpectrum(spectra[0].id, { wavenumberCal: next })
          }
          setCalibrationMode(null)
        } else {
          setCalibrationStep(calibrationStep + 1)
        }
      } else if (calibrationMode && spectra.some((s) => s.id === calibrationMode)) {
        const spec = spectra.find((s) => s.id === calibrationMode)
        const cal = [...(spec.wavenumberCal || []), { x, y, wavenumber }]
        updateSpectrum(calibrationMode, { wavenumberCal: cal })
        if (cal.length >= 3) {
          setCalibrationMode(null)
        } else {
          setCalibrationStep(calibrationStep + 1)
        }
      }
    },
    [calibrationMode, calibrationStep, refWavenumberCal, spectra, updateSpectrum]
  )

  useEffect(() => {
    if (hasDataOnly) return
    async function resampleAll() {
      if (!hasReference) return
      const results = {}
      for (const s of spectra) {
        if (s.data) continue
        const scaleY = s.scaleY ?? 1
        let calOrRange
        if (s.jdxWavenumberRange) {
          calOrRange = s.jdxWavenumberRange
        } else if (s.wavenumberCal?.length >= 3) {
          calOrRange = s.wavenumberCal
        } else {
          results[s.id] = s.dataUrl
          continue
        }
        const resampled = await resampleImageToWavenumberSpace(
          s.dataUrl,
          calOrRange,
          TARGET_WAVENUMBER_MIN,
          TARGET_WAVENUMBER_MAX,
          TARGET_WIDTH,
          scaleY
        )
        results[s.id] = resampled
      }
      setScaledImages(results)
    }
    resampleAll()
  }, [spectra, hasReference, hasDataOnly])


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
    if (hasDataOnly) return
    const canvas = canvasRef.current
    if (!canvas) return
    const visible = spectra.filter((s) => visibleIds.has(s.id) && !s.data)
    if (visible.length === 0) return

    const loadAndDraw = async () => {
      const colorForSpec = (spec) =>
        SPECTRUM_COLORS[spectra.findIndex((s) => s.id === spec.id) % SPECTRUM_COLORS.length]

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
        const nudgeFn = (s) => ({ x: s.nudgeX ?? 0, y: s.nudgeY ?? 0 })
        let minX = 0, minY = 0, maxX = 0, maxY = 0

        const positions = processed.map(({ spec, img }) => {
          const nd = nudgeFn(spec)
          const dx = nd.x
          const dy = nd.y
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
  }, [spectra, visibleIds, scaledImages, overlayMode, distributedGap, hasReference, hasDataOnly, zoomRange, dragSelect, copyBufferToDisplay])

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

  const clientToWavenumber = useCallback((clientX) => {
    const info = clientToWavenumberDebug(clientX)
    return info?.wavenumber ?? null
  }, [zoomRange])

  const clientToWavenumberDebug = useCallback((clientX) => {
    const wrap = displayWrapRef.current
    if (!wrap) return null
    const rect = wrap.getBoundingClientRect()
    const svgW = 800
    const svgH = displayHeight
    const padLeft = 52
    const padRight = 16
    const plotW = svgW - padLeft - padRight
    const scale = Math.min(rect.width / svgW, rect.height / svgH)
    const contentWidth = svgW * scale
    const offsetX = (rect.width - contentWidth) / 2
    const svgX = (clientX - rect.left - offsetX) / scale
    const plotFrac = Math.max(0, Math.min(1, (svgX - padLeft) / plotW))
    const wMin = zoomRange?.xMin ?? TARGET_WAVENUMBER_MIN
    const wMax = zoomRange?.xMax ?? TARGET_WAVENUMBER_MAX
    const wavenumber = normXToWavenumber(plotFrac, wMin, wMax)
    const computedScreenX = rect.left + offsetX + (padLeft + plotFrac * plotW) * scale
    return {
      wavenumber,
      clientX,
      computedScreenX,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      offsetX,
      scale,
      svgX,
      plotFrac,
      wMin,
      wMax,
    }
  }, [zoomRange, displayHeight])

  const getXFromClient = useCallback(
    (clientX, clientY) => {
      if (hasDataOnly) return clientToWavenumber(clientX)
      const coords = clientToBufferCoords(clientX, clientY)
      return coords?.x ?? null
    },
    [hasDataOnly, clientToWavenumber, clientToBufferCoords]
  )

  const commitSelection = useCallback(
    (left, right, clearDrag = true) => {
      const width = right - left
      if (width >= 5) {
        if (hasDataOnly) {
          if (tool === 'zoom') {
            setZoomRange({
              xMin: Math.max(TARGET_WAVENUMBER_MIN, left),
              xMax: Math.min(TARGET_WAVENUMBER_MAX, right),
            })
          } else if (tool === 'peak' && activeSpectrumId) {
            const spec = spectra.find((s) => s.id === activeSpectrumId)
            if (spec?.data?.x?.length) {
              const yArr = spec.data.y
              const peaks = isAbsorbance(spec.data.yUnits)
                ? findLocalMaxima(spec.data.x, yArr, left, right)
                : findLocalMinima(spec.data.x, yArr, left, right)
              if (peaks.length > 0) {
                const existing = spec.peaks ?? []
                const newPeaks = peaks.map((m) => ({ wavenumber: m.wavenumber, groupId: null, label: '' }))
                updateSpectrum(activeSpectrumId, { peaks: [...existing, ...newPeaks] })
              }
            }
          } else if (tool === 'region' && activeSpectrumId) {
            const existing = spectra.find((s) => s.id === activeSpectrumId)?.regions ?? []
            const newRegion = {
              id: crypto.randomUUID(),
              wavenumberMin: left,
              wavenumberMax: right,
              label: '',
            }
            updateSpectrum(activeSpectrumId, { regions: [...existing, newRegion] })
          }
        } else if (tool === 'zoom') {
          const buf = fullBufferRef.current
          if (buf) {
            setZoomRange({
              xMin: Math.max(0, left),
              xMax: Math.min(buf.width, right),
            })
          }
        }
      }
      if (clearDrag) {
        setDragSelect(null)
        setTouchRegionAdjustMode(false)
      }
    },
    [hasDataOnly, tool, activeSpectrumId, spectra, updateSpectrum]
  )

  const handleCanvasPointerDown = useCallback(
    (e) => {
      if (calibrationMode) return
      const isTouch = e.pointerType === 'touch'
      if (isTouch) e.preventDefault()

      const x = getXFromClient(e.clientX, e.clientY)
      if (x == null) return

      if (isTouch) {
        if (touchRegionAdjustMode) return
        if (touchPoint1Ref.current === null) {
          setTouchDraft({ x, isFirst: true })
        } else {
          setTouchDraft({ x, isFirst: false })
        }
      } else {
        if (hasDataOnly && (tool === 'zoom' || ((tool === 'peak' || tool === 'region') && activeSpectrumId))) {
          setDragSelect({ x1: x, x2: x })
        } else if (!hasDataOnly && tool === 'zoom') {
          setDragSelect({ x1: x, x2: x })
        }
      }
    },
    [
      calibrationMode,
      getXFromClient,
      touchRegionAdjustMode,
      tool,
      hasDataOnly,
      activeSpectrumId,
    ]
  )

  const handleCanvasPointerMove = useCallback(
    (e) => {
      if (e.pointerType === 'touch') {
        if (touchDraft) {
          const x = getXFromClient(e.clientX, e.clientY)
          if (x != null) setTouchDraft((prev) => prev ? { ...prev, x } : null)
        }
        return
      }
      if (!dragSelect) return
      const x = getXFromClient(e.clientX, e.clientY)
      if (x != null) setDragSelect((prev) => ({ ...prev, x2: x }))
    },
    [dragSelect, touchDraft, getXFromClient]
  )

  const handleCanvasPointerUp = useCallback(
    (e) => {
      if (e.pointerType === 'touch') {
        if (touchRegionAdjustMode) return
        if (touchDraft) {
          const { x, isFirst } = touchDraft
          setTouchDraft(null)
          if (isFirst) {
            touchPoint1Ref.current = x
            setTouchPoint1Wavenumber(x)
            setTouchFirstPointPlaced(true)
          } else {
            const x1 = touchPoint1Ref.current
            if (x1 != null) {
              touchPoint1Ref.current = null
              setTouchPoint1Wavenumber(null)
              setTouchFirstPointPlaced(false)
              const left = Math.min(x1, x)
              const right = Math.max(x1, x)
              if (tool === 'region' && hasDataOnly && activeSpectrumId) {
                setDragSelect({ x1: left, x2: right })
                setTouchRegionAdjustMode(true)
              } else {
                commitSelection(left, right)
              }
            }
          }
        }
        return
      }
      if (!dragSelect) return
      const { x1, x2 } = dragSelect
      commitSelection(Math.min(x1, x2), Math.max(x1, x2))
    },
    [dragSelect, touchDraft, touchRegionAdjustMode, tool, hasDataOnly, activeSpectrumId, commitSelection]
  )

  const handleCanvasPointerLeave = useCallback((e) => {
    if (e?.pointerType === 'touch' && (touchDraft || touchPoint1Ref.current !== null)) {
      return
    }
    if (!touchRegionAdjustMode) {
      if (dragSelect) setDragSelect(null)
      if (touchPoint1Ref.current !== null) {
        touchPoint1Ref.current = null
        setTouchPoint1Wavenumber(null)
        setTouchFirstPointPlaced(false)
      }
    }
    setDebugCursor(null)
  }, [dragSelect, touchDraft, touchRegionAdjustMode])

  const handleCanvasPointerCancel = useCallback(() => {
    setTouchDraft(null)
  }, [])

  const handleCanvasMouseMoveDebug = useCallback((e) => {
    if (!hasDataOnly) return
    const info = clientToWavenumberDebug(e.clientX)
    if (info) {
      const rect = displayWrapRef.current?.getBoundingClientRect()
      const inBounds = rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
      setDebugCursor(inBounds ? info : null)
    }
  }, [hasDataOnly, clientToWavenumberDebug])

  const resetZoom = useCallback(() => {
    setZoomRange(null)
    setYMinOffset(0)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        resetZoom()
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        setTool('zoom')
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setTool('region')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [resetZoom])

  useEffect(() => {
    touchPoint1Ref.current = null
    setTouchPoint1Wavenumber(null)
    setTouchFirstPointPlaced(false)
    setTouchDraft(null)
  }, [tool])

  useEffect(() => {
    if (!dragSelect) return
    const handleGlobalPointerUp = (e) => {
      if (e.pointerType === 'touch') return
      const { x1, x2 } = dragSelect
      commitSelection(Math.min(x1, x2), Math.max(x1, x2))
    }
    window.addEventListener('pointerup', handleGlobalPointerUp)
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp)
  }, [dragSelect, commitSelection])

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    resizeStartRef.current = { x: e.clientX, width: sidebarWidth }
  }, [sidebarWidth])

  useEffect(() => {
    const handleResizeMove = (e) => {
      const start = resizeStartRef.current
      if (!start) return
      const deltaX = start.x - e.clientX
      const newWidth = Math.min(500, Math.max(150, start.width + deltaX))
      setSidebarWidth(newWidth)
    }
    const handleResizeEnd = () => {
      resizeStartRef.current = null
    }
    window.addEventListener('mousemove', handleResizeMove)
    window.addEventListener('mouseup', handleResizeEnd)
    return () => {
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [])

  const [downloadFormat, setDownloadFormat] = useState('png')
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportIncludeList, setExportIncludeList] = useState(false)
  const [exportDownloadName, setExportDownloadName] = useState('spectra-stacked')
  const [exportPreviewUrl, setExportPreviewUrl] = useState(null)

  useEffect(() => {
    let lastUrl = null
    if (!exportModalOpen || !hasDataOnly) {
      setExportPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }
    const url = buildExportSvgBlobUrl(
      displayWrapRef,
      spectra,
      visibleIds,
      displayHeight,
      exportIncludeList
    )
    lastUrl = url
    if (url) setExportPreviewUrl(url)
    return () => {
      if (lastUrl) URL.revokeObjectURL(lastUrl)
    }
  }, [exportModalOpen, hasDataOnly, spectra, visibleIds, displayHeight, exportIncludeList])
  const [helpModalOpen, setHelpModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [yMinOffset, setYMinOffset] = useState(0)
  useEffect(() => {
    if (!hasDataOnly && downloadFormat === 'svg') setDownloadFormat('png')
  }, [hasDataOnly, downloadFormat])

  const downloadStacked = useCallback((format = downloadFormat, includeList = false, downloadName = exportDownloadName) => {
    const effectiveFormat = !hasDataOnly && format === 'svg' ? 'png' : format
    const baseName = (downloadName || 'spectra-stacked').trim().replace(/[/\\:*?"<>|]/g, '-') || 'spectra-stacked'
    const listText = hasDataOnly && includeList ? buildPeakRegionList(spectra, visibleIds) : ''
    const addImageToPdf = (pdf, imgData) => {
      pdf.addImage(imgData, 'PNG', 0, 0, EXPORT_WIDTH_IN, EXPORT_HEIGHT_IN)
    }
    const addListToPdf = (pdf) => {
      if (!listText.trim()) return
      pdf.addPage([8.5, 11], 'p')
      pdf.setFontSize(10)
      pdf.setFont('helvetica', 'normal')
      const lines = listText.split('\n')
      const margin = 0.75
      const lineHeight = 0.2
      let y = margin
      for (const line of lines) {
        if (y > 10.5) break
        pdf.text(line, margin, y, { maxWidth: 10 })
        y += lineHeight
      }
    }

    const exportFromCanvas = (canvas) => {
      const out = document.createElement('canvas')
      out.width = EXPORT_WIDTH_PX
      out.height = EXPORT_HEIGHT_PX
      const ctx = out.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
      const scale = Math.min(out.width / canvas.width, out.height / canvas.height)
      const dw = canvas.width * scale
      const dh = canvas.height * scale
      const dx = (out.width - dw) / 2
      const dy = (out.height - dh) / 2
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, dx, dy, dw, dh)
      return out
    }

    if (hasDataOnly) {
      const wrap = displayWrapRef.current
      const svg = wrap?.querySelector('.spectrum-data-display')
      if (!svg) return

      const visibleDataSpectra = spectra.filter((s) => visibleIds.has(s.id) && s.data)
      const origHeight = parseInt(svg.getAttribute('height') || displayHeight, 10)
      const { g: legendG, height: legendHeight } = createExportLegend(visibleDataSpectra, spectra, origHeight, 800)

      if (effectiveFormat === 'svg') {
        const svgClone = svg.cloneNode(true)
        const listHeight = includeList && listText.trim() ? listText.split('\n').length * 16 + 40 : 0
        const extraHeight = Math.max(listHeight, legendHeight)
        const newHeight = origHeight + extraHeight
        svgClone.setAttribute('height', String(newHeight))
        svgClone.setAttribute('viewBox', `0 0 800 ${newHeight}`)
        if (includeList && listText.trim()) {
          const listG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          listG.setAttribute('transform', `translate(52, ${origHeight + 24})`)
          listText.split('\n').forEach((line, i) => {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
            t.setAttribute('x', '0')
            t.setAttribute('y', String(i * 16))
            t.setAttribute('font-size', '12')
            t.setAttribute('font-family', 'system-ui, sans-serif')
            t.setAttribute('fill', '#333')
            t.textContent = line
            listG.appendChild(t)
          })
          svgClone.appendChild(listG)
        }
        svgClone.appendChild(legendG)
        const svgStr = new XMLSerializer().serializeToString(svgClone)
        const blob = new Blob([svgStr], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${baseName}.svg`
        a.click()
        URL.revokeObjectURL(url)
        return
      }

      const svgClone = svg.cloneNode(true)
      svgClone.setAttribute('width', '800')
      const baseHeight = displayHeight
      const listHeight = includeList && listText.trim() ? Math.min(listText.split('\n').length * 18 + 60, 400) : 0
      const extraHeight = Math.max(listHeight, legendHeight)
      const totalHeight = baseHeight + extraHeight
      svgClone.setAttribute('height', String(totalHeight))
      svgClone.setAttribute('viewBox', `0 0 800 ${totalHeight}`)
      svgClone.setAttribute('style', 'background:#fff;display:block')
      if (includeList && listText.trim()) {
        const listG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        listG.setAttribute('transform', `translate(52, ${baseHeight + 24})`)
        listText.split('\n').forEach((line, i) => {
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
          t.setAttribute('x', '0')
          t.setAttribute('y', String(i * 18))
          t.setAttribute('font-size', '12')
          t.setAttribute('font-family', 'system-ui, sans-serif')
          t.setAttribute('fill', '#333')
          t.textContent = line
          listG.appendChild(t)
        })
        svgClone.appendChild(listG)
      }
      const { g: legendG2 } = createExportLegend(visibleDataSpectra, spectra, baseHeight, 800)
      svgClone.appendChild(legendG2)
      const svgStr = new XMLSerializer().serializeToString(svgClone)
      const blob = new Blob([svgStr], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        const out = document.createElement('canvas')
        out.width = EXPORT_WIDTH_PX
        out.height = EXPORT_HEIGHT_PX
        const ctx = out.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, out.width, out.height)
        const scale = Math.min(out.width / 800, out.height / totalHeight)
        const dw = 800 * scale
        const dh = totalHeight * scale
        const dx = (out.width - dw) / 2
        const dy = (out.height - dh) / 2
        ctx.drawImage(img, 0, 0, 800, totalHeight, dx, dy, dw, dh)
        URL.revokeObjectURL(url)
        if (effectiveFormat === 'png') {
          const a = document.createElement('a')
          a.href = out.toDataURL('image/png')
          a.download = `${baseName}.png`
          a.click()
        } else if (effectiveFormat === 'pdf') {
          const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [8.5, 11] })
          addImageToPdf(pdf, out.toDataURL('image/png'))
          addListToPdf(pdf)
          pdf.save(`${baseName}.pdf`)
        }
      }
      img.src = url
    } else {
      const canvas = fullBufferRef.current || canvasRef.current
      if (!canvas) return
      const out = exportFromCanvas(canvas)
      if (effectiveFormat === 'png') {
        const a = document.createElement('a')
        a.href = out.toDataURL('image/png')
        a.download = `${baseName}.png`
        a.click()
      } else if (effectiveFormat === 'pdf') {
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [8.5, 11] })
        addImageToPdf(pdf, out.toDataURL('image/png'))
        pdf.save(`${baseName}.pdf`)
      }
    }
  }, [hasDataOnly, downloadFormat, spectra, visibleIds, displayHeight, exportDownloadName])

  const handleAddFromSampleLibrary = useCallback((spectrumData) => {
    setJdxError(null)
    addSpectrum(spectrumData)
  }, [addSpectrum])

  const handleJdxFileSelect = useCallback((e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    setJdxError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = reader.result
        const parsed = parseJDX(text)
        if (!parsed.x?.length || !parsed.y?.length) {
          setJdxError('No spectral data found in file')
          return
        }
        const { headerEntries } = parseJcampForEditing(text)
        const jdxMetadata = headerEntries.filter((e) => e.type === 'metadata').map((e) => ({ key: e.key, value: e.value }))
        const baseName = file.name.replace(/\.(jdx|jcamp|dx)$/i, '')
        const fileName = parsed.title || baseName || file.name
        addSpectrum({
          data: { x: parsed.x, y: parsed.y, yUnits: parsed.yUnits },
          fileName,
          metadata: {
            minWavenumber: parsed.minWavenumber,
            maxWavenumber: parsed.maxWavenumber,
            piecewiseAt: 2000,
          },
          jdxMetadata,
        })
      } catch (err) {
        setJdxError(err.message || 'Failed to parse JCAMP-DX file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [addSpectrum])

  if (spectra.length === 0 && archivedSpectra.length === 0) {
    return (
      <div className="app stacking-empty">
        <header className="header">
          <div className="header-with-help">
            <h1>Stack<span className="header-ir">IR</span></h1>
            <button
              type="button"
              onClick={() => setHelpModalOpen(true)}
              className="help-btn-header"
              title="Help"
              aria-label="Help"
            >
              <HelpIcon size={18} />
            </button>
          </div>
          <p className="subtitle">
            Choose a spectrum from the sample library or load your own JCAMP-DX files (.jdx, .dx).
          </p>
          <div className="empty-actions">
            <button
              type="button"
              onClick={() => setSampleLibraryOpen(true)}
              className="secondary empty-action-btn"
            >
              Sample library
            </button>
            <input
              ref={jdxInputRef}
              type="file"
              accept=".jdx,.jcamp,.dx"
              onChange={handleJdxFileSelect}
              className="file-input-hidden"
            />
            <button
              type="button"
              onClick={() => jdxInputRef.current?.click()}
              className="primary empty-action-btn"
            >
              Add JCAMP-DX file
            </button>
          </div>
          {jdxError && <div className="error" style={{ marginTop: '1rem' }}>{jdxError}</div>}
        </header>
        {helpModalOpen && (
          <HelpModal open={helpModalOpen} onClose={() => setHelpModalOpen(false)} page="stacking" />
        )}
        {sampleLibraryOpen && (
          <SampleLibraryModal
            onAddSpectrum={handleAddFromSampleLibrary}
            onClose={() => setSampleLibraryOpen(false)}
          />
        )}
      </div>
    )
  }

  const toolbarButtons = (
    <>
      <button
        type="button"
        onClick={() => setTool('zoom')}
        className={`tool-btn ${tool === 'zoom' ? 'primary' : 'secondary'}`}
        title="Zoom — Drag to zoom into a region (Z)"
      >
        <ZoomIcon size={14} />
        <span>Zoom</span>
      </button>
      <button
        type="button"
        onClick={resetZoom}
        disabled={!zoomRange && yMinOffset === 0}
        className="tool-btn secondary"
        title="Reset zoom and Y axis (F)"
      >
        <span>Reset zoom</span>
      </button>
      {hasDataOnly && (
        <>
          {/* Peak pick temporarily removed - code preserved in commitSelection, findLocalMinima/Maxima */}
          <button
            type="button"
            onClick={() => setTool('region')}
            className={`tool-btn ${tool === 'region' ? 'primary' : 'secondary'}`}
            title="Region — Drag to add shaded regions (R)"
          >
            <RegionIcon size={14} />
            <span>Region</span>
          </button>
        </>
      )}
      <button type="button" onClick={() => setHelpModalOpen(true)} className="tool-btn secondary btn-with-icon" title="Help">
        <HelpIcon size={14} />
        <span>Help</span>
      </button>
      <button type="button" onClick={() => setSettingsModalOpen(true)} className="tool-btn secondary btn-with-icon" title="Settings">
        <SettingsIcon size={14} />
        <span>Settings</span>
      </button>
      <button type="button" onClick={() => setExportModalOpen(true)} className="tool-btn primary btn-with-icon" title="Export stacked spectra">
        <DownloadIcon size={14} />
        <span>Export</span>
      </button>
    </>
  )

  return (
    <div className="app stacking-view">
      <header className="header header-desktop">
        <h1>Stack<span className="header-ir">IR</span></h1>
        <p className="subtitle">
          Overlay and add annotations to your IR spectra.
        </p>
      </header>

      <div className="mobile-tools-bar" aria-label="Tools">
        <div className="toolbar-row">{toolbarButtons}</div>
        <h1 className="mobile-tools-title">Stack<span className="header-ir">IR</span></h1>
      </div>

      <div className="stacking-layout">
        <div className="stacking-main">
          <div className="stacking-controls stacking-controls-desktop">
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

            <div className="toolbar-row">{toolbarButtons}</div>
          </div>

          <div
            ref={displayWrapRef}
            className="stacking-canvas-wrap"
            style={{
              ...(hasDataOnly ? { aspectRatio: `800 / ${displayHeight}` } : {}),
              cursor: dragSelect ? 'crosshair' : 'default',
              position: 'relative',
              touchAction: tool === 'zoom' || tool === 'peak' || tool === 'region' ? 'none' : 'auto',
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={(e) => { handleCanvasPointerMove(e); handleCanvasMouseMoveDebug(e) }}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerLeave}
            onPointerCancel={handleCanvasPointerCancel}
          >
            {hasDataOnly && touchFirstPointPlaced && !touchRegionAdjustMode && (tool === 'zoom' || tool === 'peak' || tool === 'region') && (
              <div className="touch-hint-overlay" aria-live="polite">
                {tool === 'region' ? 'Touch for right boundary' : 'Touch for second point'}
              </div>
            )}
            {hasDataOnly && showWavenumberBox && debugCursor && (
              <>
                <div
                  className="wavenumber-cursor-line"
                  style={{
                    position: 'fixed',
                    left: debugCursor.computedScreenX,
                    top: debugCursor.rect.top,
                    width: 2,
                    height: debugCursor.rect.height,
                    background: 'rgba(0, 100, 255, 0.7)',
                    pointerEvents: 'none',
                    zIndex: 50,
                  }}
                />
                <div
                  className="wavenumber-cursor-box"
                style={{
                  position: 'fixed',
                  left: Math.min(debugCursor.clientX + 12, window.innerWidth - 120),
                  top: debugCursor.rect.top + 8,
                  background: 'rgba(0,0,0,0.85)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: 'monospace',
                  pointerEvents: 'none',
                  zIndex: 51,
                }}
              >
                {debugCursor.wavenumber.toFixed(1)} cm⁻¹
              </div>
              </>
            )}
            {hasDataOnly ? (
              <SpectrumDataDisplay
                spectra={visibleDataSpectra.map((s) => ({
                  ...s,
                  color: SPECTRUM_COLORS[spectra.findIndex((sp) => sp.id === s.id) % SPECTRUM_COLORS.length],
                }))}
                width={800}
                height={displayHeight}
                zoomRange={zoomRange}
                dragSelect={dragSelect}
                touchBoundaryWavenumbers={
                  (tool === 'zoom' || tool === 'peak' || tool === 'region') && (touchDraft || touchPoint1Wavenumber != null)
                    ? touchDraft?.isFirst
                      ? [touchDraft.x]
                      : touchPoint1Wavenumber != null && touchDraft
                        ? [touchPoint1Wavenumber, touchDraft.x]
                        : touchPoint1Wavenumber != null
                          ? [touchPoint1Wavenumber]
                          : undefined
                    : undefined
                }
                overlayMode={overlayMode}
                distributedGap={distributedGap}
                normalizeY={normalizeY}
                displayYUnits={displayYUnits}
                tool={tool}
                activeSpectrumId={activeSpectrumId}
                showWavenumbersInLabels={showWavenumbersInLabels}
                yMinOffset={yMinOffset}
                onHeightChange={setDisplayHeight}
              />
            ) : (
              <canvas
                ref={canvasRef}
                className="stacking-canvas"
                style={{ background: '#ffffff' }}
              />
            )}
            {touchRegionAdjustMode && dragSelect && hasDataOnly && (
              <div className="touch-region-adjust" role="region" aria-label="Adjust region boundaries">
                <div className="touch-region-adjust-row">
                  <span className="touch-region-adjust-label">Left</span>
                  <button
                    type="button"
                    className="touch-region-adjust-btn"
                    onClick={() => setDragSelect((prev) => {
                      if (!prev) return prev
                      const left = Math.min(prev.x1, prev.x2)
                      const right = Math.max(prev.x1, prev.x2)
                      const newLeft = Math.max(TARGET_WAVENUMBER_MIN, left - REGION_ADJUST_STEP)
                      return { x1: newLeft, x2: right }
                    })}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="touch-region-adjust-btn"
                    onClick={() => setDragSelect((prev) => {
                      if (!prev) return prev
                      const left = Math.min(prev.x1, prev.x2)
                      const right = Math.max(prev.x1, prev.x2)
                      const newLeft = Math.min(right - REGION_ADJUST_STEP, left + REGION_ADJUST_STEP)
                      return { x1: newLeft, x2: right }
                    })}
                  >
                    +
                  </button>
                </div>
                <div className="touch-region-adjust-row">
                  <span className="touch-region-adjust-label">Right</span>
                  <button
                    type="button"
                    className="touch-region-adjust-btn"
                    onClick={() => setDragSelect((prev) => {
                      if (!prev) return prev
                      const left = Math.min(prev.x1, prev.x2)
                      const right = Math.max(prev.x1, prev.x2)
                      const newRight = Math.max(left + REGION_ADJUST_STEP, right - REGION_ADJUST_STEP)
                      return { x1: left, x2: newRight }
                    })}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="touch-region-adjust-btn"
                    onClick={() => setDragSelect((prev) => {
                      if (!prev) return prev
                      const left = Math.min(prev.x1, prev.x2)
                      const right = Math.max(prev.x1, prev.x2)
                      const newRight = Math.min(TARGET_WAVENUMBER_MAX, right + REGION_ADJUST_STEP)
                      return { x1: left, x2: newRight }
                    })}
                  >
                    +
                  </button>
                </div>
                <div className="touch-region-adjust-actions">
                  <button
                    type="button"
                    className="touch-region-adjust-confirm primary"
                    onClick={() => {
                      if (dragSelect) {
                        const left = Math.min(dragSelect.x1, dragSelect.x2)
                        const right = Math.max(dragSelect.x1, dragSelect.x2)
                        commitSelection(left, right)
                      }
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="touch-region-adjust-cancel secondary"
                    onClick={() => {
                      setDragSelect(null)
                      setTouchRegionAdjustMode(false)
                      setTouchFirstPointPlaced(false)
                      setTouchPoint1Wavenumber(null)
                      touchPoint1Ref.current = null
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="reference-scale-bar">
            {!hasReference ? (
              <button type="button" onClick={startRefCalibration} className="secondary small">
                Calibrate scale: Select 3 points (1000, 2000, 3000 cm⁻¹)
              </button>
            ) : hasDataOnly ? (
              <span className="reference-scale-hint">Data scale (500–4000 cm⁻¹)</span>
            ) : (
              <>
                <span className="reference-scale-hint">Calibrated (1000, 2000, 3000 cm⁻¹)</span>
                <button type="button" onClick={startRefCalibration} className="ghost small">
                  Recalibrate
                </button>
              </>
            )}
            {calibrationMode === 'ref' && (
              <span className="reference-scale-cal-hint">
                Click on {WAVENUMBER_MARKERS[refWavenumberCal.length]} cm⁻¹ ({refWavenumberCal.length}/3)
              </span>
            )}
            {hasDataOnly && (
              <div className="y-min-adjust">
                <span className="y-min-label">Y min:</span>
                <button
                  type="button"
                  onClick={() => setYMinOffset((v) => Math.max(-0.5, v - 0.05))}
                  className="ghost small y-min-btn"
                  title="Decrease Y minimum (flatten peaks)"
                >
                  −
                </button>
                <span className="y-min-value">{yMinOffset >= 0 ? '+' : ''}{yMinOffset.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setYMinOffset((v) => v + 0.05)}
                  className="ghost small y-min-btn"
                  title="Increase Y minimum (sharpen peaks)"
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        <div
          className="stacking-resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        />
        <div className="stacking-sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-tabs">
            <button
              type="button"
              className={sidebarTab === 'spectra' ? 'secondary small' : 'ghost small'}
              onClick={() => setSidebarTab('spectra')}
            >
              Spectra ({spectra.length})
            </button>
            <button
              type="button"
              className={sidebarTab === 'archive' ? 'secondary small' : 'ghost small'}
              onClick={() => setSidebarTab('archive')}
            >
              Archive ({archivedSpectra.length})
            </button>
          </div>
          {sidebarTab === 'spectra' && (
            <>
              <button
                type="button"
                onClick={() => setSampleLibraryOpen(true)}
                className="secondary full"
              >
                Sample library
              </button>
              <input
                ref={jdxInputRef}
                type="file"
                accept=".jdx,.jcamp,.dx"
                onChange={handleJdxFileSelect}
                className="file-input-hidden"
              />
              <button
                type="button"
                onClick={() => jdxInputRef.current?.click()}
                className="secondary full"
              >
                Add JCAMP-DX file
              </button>
              {jdxError && <div className="error" style={{ fontSize: '0.75rem' }}>{jdxError}</div>}
              <div className="spectra-list">
                {spectra.map((s, i) => (
            <div key={s.id} className={`spectrum-item ${visibleIds.has(s.id) ? 'visible' : ''} ${activeSpectrumId === s.id ? 'active-spectrum' : ''}`}>
              <div className="spectrum-toggle-row">
                <button
                  type="button"
                  className={`spectrum-icon-btn ${visibleIds.has(s.id) ? '' : 'muted'}`}
                  onClick={() => toggleVisible(s.id)}
                  title={visibleIds.has(s.id) ? 'Hide from plot' : 'Show in plot'}
                  aria-label={visibleIds.has(s.id) ? 'Hide spectrum' : 'Show spectrum'}
                >
                  <EyeIcon visible={visibleIds.has(s.id)} />
                </button>
                {hasDataOnly && (
                  <label className="spectrum-active-check">
                    <input
                      type="radio"
                      name="active-spectrum"
                      checked={activeSpectrumId === s.id}
                      onChange={() => setActiveSpectrumId(s.id)}
                    />
                    <span className="spectrum-active-dot" title="Active for region selection" />
                  </label>
                )}
                <span className="spectrum-color" style={{ background: SPECTRUM_COLORS[i % SPECTRUM_COLORS.length] }} />
                <span className="spectrum-name">{s.fileName || `Spectrum ${i + 1}`}</span>
                <button
                  type="button"
                  className="spectrum-icon-btn spectrum-remove-btn"
                  onClick={() => archiveSpectrum(s.id)}
                  title="Move to archive"
                  aria-label="Remove spectrum"
                >
                  <XIcon />
                </button>
              </div>
              <div className="spectrum-meta">
                {s.data || s.jdxWavenumberRange ? (
                  <>
                    {s.jdxWavenumberRange && !s.data && <span className="hint">JDX (auto-calibrated)</span>}
                    <button
                      type="button"
                      className="ghost small spectrum-icon-btn"
                      onClick={() => setSpectrumInfoId(s.id)}
                      title="View JCAMP-DX metadata"
                      aria-label="View metadata"
                    >
                      <InfoIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => setExpandedAdjustId(expandedAdjustId === s.id ? null : s.id)}
                    >
                      {expandedAdjustId === s.id ? 'Hide adjust' : 'Adjust'}
                    </button>
                  </>
                ) : hasReference ? (
                  (s.wavenumberCal?.length ?? 0) >= 3 ? (
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
                    <>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => startSpectrumCalibration(s.id)}
                      >
                        Calibrate (1000, 2000, 3000 cm⁻¹)
                      </button>
                    </>
                  )
                ) : null}
              </div>
              {expandedAdjustId === s.id && (
                <div className="spectrum-adjust">
                  <label>Nudge X</label>
                  <div className="nudge-row">
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeX: (s.nudgeX ?? 0) - 1 })}>−</button>
                    <input
                      type="number"
                      key={`nudgeX-${s.id}-${s.nudgeX ?? 0}`}
                      defaultValue={s.nudgeX ?? 0}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10)
                        if (!isNaN(v)) updateSpectrum(s.id, { nudgeX: v })
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                      style={{ width: 52, textAlign: 'center' }}
                    />
                    <span style={{ marginLeft: 4 }}>px</span>
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeX: (s.nudgeX ?? 0) + 1 })}>+</button>
                  </div>
                  <label>Nudge Y</label>
                  <div className="nudge-row">
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeY: (s.nudgeY ?? 0) - 1 })}>−</button>
                    <input
                      type="number"
                      key={`nudgeY-${s.id}-${s.nudgeY ?? 0}`}
                      defaultValue={s.nudgeY ?? 0}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10)
                        if (!isNaN(v)) updateSpectrum(s.id, { nudgeY: v })
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                      style={{ width: 52, textAlign: 'center' }}
                    />
                    <span style={{ marginLeft: 4 }}>px</span>
                    <button type="button" onClick={() => updateSpectrum(s.id, { nudgeY: (s.nudgeY ?? 0) + 1 })}>+</button>
                  </div>
                  <label>Y scale</label>
                  <div className="nudge-row">
                    <button type="button" onClick={() => updateSpectrum(s.id, { scaleY: Math.max(0.1, (s.scaleY ?? 1) - 0.1) })}>−</button>
                    <span>{((s.scaleY ?? 1) * 100).toFixed(0)}%</span>
                    <button type="button" onClick={() => updateSpectrum(s.id, { scaleY: Math.min(3, (s.scaleY ?? 1) + 0.1) })}>+</button>
                  </div>
                </div>
              )}
              {hasDataOnly && s.data && (
                <div className="spectrum-peaks-section">
                  <button
                    type="button"
                    className="ghost small"
                    style={{ width: '100%', textAlign: 'left', marginTop: '0.25rem' }}
                    onClick={() => setExpandedPeakListId(expandedPeakListId === s.id ? null : s.id)}
                  >
                    {expandedPeakListId === s.id ? '▾' : '▸'} Peaks & Regions ({(s.peaks ?? []).length}, {(s.regions ?? []).length})
                  </button>
                  {expandedPeakListId === s.id && (
                    <div className="peak-list">
                      {(s.peaks ?? []).length === 0 && (s.regions ?? []).length === 0 ? (
                        <div className="peak-list-empty">No peaks or regions. Use Region (R) and drag on the plot.</div>
                      ) : (
                        <>
                          {(() => {
                            const peaks = s.peaks ?? []
                            const peakGroups = s.peakGroups ?? {}
                            const sel = selectedPeakIndices[s.id] ?? new Set()
                            const selectedCount = sel.size
                            const toggleSelect = (idx) => {
                              setSelectedPeakIndices((prev) => {
                                const next = new Set(prev[s.id] ?? [])
                                if (next.has(idx)) next.delete(idx)
                                else next.add(idx)
                                return { ...prev, [s.id]: next }
                              })
                            }
                            const groupSelected = () => {
                              if (selectedCount < 2) return
                              const gid = crypto.randomUUID()
                              const newPeaks = peaks.map((p, i) =>
                                sel.has(i) ? { ...p, groupId: gid } : p
                              )
                              const newGroups = { ...peakGroups, [gid]: { label: '' } }
                              updateSpectrum(s.id, { peaks: newPeaks, peakGroups: newGroups })
                              setSelectedPeakIndices((prev) => ({ ...prev, [s.id]: new Set() }))
                            }
                            const ungroupPeaks = (gid) => {
                              const newPeaks = peaks.map((p) =>
                                p.groupId === gid ? { ...p, groupId: null } : p
                              )
                              const { [gid]: _, ...rest } = peakGroups
                              updateSpectrum(s.id, { peaks: newPeaks, peakGroups: rest })
                            }
                            const updateGroup = (gid, updates) => {
                              updateSpectrum(s.id, {
                                peakGroups: {
                                  ...peakGroups,
                                  [gid]: { ...(peakGroups[gid] ?? {}), ...updates },
                                },
                              })
                            }
                            const peaksByGroup = {}
                            const ungrouped = []
                            peaks.forEach((p, idx) => {
                              if (p.groupId && peakGroups[p.groupId]) {
                                if (!peaksByGroup[p.groupId]) peaksByGroup[p.groupId] = []
                                peaksByGroup[p.groupId].push({ peak: p, idx })
                              } else ungrouped.push({ peak: p, idx })
                            })
                            return (
                              <>
                                {selectedCount >= 2 && (
                                  <div className="peak-list-actions">
                                    <button type="button" className="secondary small" onClick={groupSelected}>
                                      Group selected ({selectedCount})
                                    </button>
                                  </div>
                                )}
                                {ungrouped.map(({ peak: p, idx }) => (
                                  <div key={`ungrouped-${p.wavenumber}-${idx}`} className="peak-list-item">
                                    <input
                                      type="checkbox"
                                      checked={sel.has(idx)}
                                      onChange={() => toggleSelect(idx)}
                                      className="peak-checkbox"
                                      title="Select to group"
                                    />
                                    <span className="peak-wavenumber">{p.wavenumber.toFixed(1)}</span>
                                    <input
                                      type="text"
                                      placeholder="Label"
                                      value={p.label ?? ''}
                                      onChange={(e) => {
                                        const next = [...peaks]
                                        next[idx] = { ...next[idx], label: e.target.value }
                                        updateSpectrum(s.id, { peaks: next })
                                      }}
                                      className="peak-label-input"
                                    />
                                    <button
                                      type="button"
                                      className="ghost small"
                                      onClick={() => {
                                        const next = peaks.filter((_, i) => i !== idx)
                                        updateSpectrum(s.id, { peaks: next })
                                      }}
                                      title="Remove peak"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                {Object.entries(peaksByGroup).map(([gid, items]) => {
                                  const g = peakGroups[gid] ?? {}
                                  const sorted = [...items].sort((a, b) => a.peak.wavenumber - b.peak.wavenumber)
                                  const groupKey = `${s.id}-${gid}`
                                  const isCollapsed = collapsedPeakGroups.has(groupKey)
                                  const toggleCollapsed = () => {
                                    setCollapsedPeakGroups((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(groupKey)) next.delete(groupKey)
                                      else next.add(groupKey)
                                      return next
                                    })
                                  }
                                  return (
                                    <div key={gid} className={`peak-group-block ${isCollapsed ? 'collapsed' : ''}`}>
                                      <div className="peak-group-header">
                                        <button
                                          type="button"
                                          className="ghost small peak-group-toggle"
                                          onClick={toggleCollapsed}
                                          title={isCollapsed ? 'Expand' : 'Collapse'}
                                        >
                                          {isCollapsed ? '▸' : '▾'}
                                        </button>
                                        <input
                                          type="text"
                                          placeholder="Group label"
                                          value={g.label ?? ''}
                                          onChange={(e) => updateGroup(gid, { label: e.target.value })}
                                          className="peak-label-input"
                                        />
                                        {isCollapsed && (
                                          <span className="peak-group-count">{sorted.length} peak{sorted.length !== 1 ? 's' : ''}</span>
                                        )}
                                        {!isCollapsed && (
                                          <>
                                            <button
                                              type="button"
                                              className="ghost small"
                                              onClick={() => ungroupPeaks(gid)}
                                              title="Ungroup peaks"
                                            >
                                              Ungroup
                                            </button>
                                          </>
                                        )}
                                      </div>
                                      {!isCollapsed && sorted.map(({ peak: p, idx }) => (
                                        <div key={`${gid}-${idx}`} className="peak-list-item peak-in-group">
                                          <input
                                            type="checkbox"
                                            checked={sel.has(idx)}
                                            onChange={() => toggleSelect(idx)}
                                            className="peak-checkbox"
                                          />
                                          <span className="peak-wavenumber">{p.wavenumber.toFixed(1)}</span>
                                          <button
                                            type="button"
                                            className="ghost small"
                                            onClick={() => {
                                              const next = peaks.map((x, i) =>
                                                i === idx ? { ...x, groupId: null } : x
                                              )
                                              const stillInGroup = next.filter((x) => x.groupId === gid).length
                                              const newGroups = stillInGroup > 0
                                                ? peakGroups
                                                : Object.fromEntries(Object.entries(peakGroups).filter(([k]) => k !== gid))
                                              updateSpectrum(s.id, { peaks: next, peakGroups: newGroups })
                                            }}
                                            title="Remove from group"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )
                                })}
                                {(s.regions ?? []).length > 0 && (
                                  <div className="peak-list-regions">
                                    <div className="peak-list-regions-label">Regions</div>
                                    {(s.regions ?? []).map((r) => (
                                      <div key={r.id} className="peak-list-item region-item">
                                        <input
                                          type="text"
                                          placeholder="Region label"
                                          value={r.label ?? ''}
                                          onChange={(e) => {
                                            const regions = (s.regions ?? []).map((x) =>
                                              x.id === r.id ? { ...x, label: e.target.value } : x
                                            )
                                            updateSpectrum(s.id, { regions })
                                          }}
                                          className="peak-label-input"
                                        />
                                        <span className="peak-wavenumber">
                                          {r.wavenumberMin.toFixed(0)}–{r.wavenumberMax.toFixed(0)}
                                        </span>
                                        <button
                                          type="button"
                                          className="ghost small"
                                          onClick={() => {
                                            const regions = (s.regions ?? []).filter((x) => x.id !== r.id)
                                            updateSpectrum(s.id, { regions })
                                          }}
                                          title="Remove region"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
              </div>
            </>
          )}
          {sidebarTab === 'archive' && (
            <div className="archive-list">
              {archivedSpectra.length === 0 ? (
                <div className="archive-empty">Archive is empty. Removed spectra appear here until you refresh.</div>
              ) : (
                archivedSpectra.map((s, i) => (
                  <div key={s.id} className="spectrum-item archive-item">
                    <div className="spectrum-toggle">
                      <span className="spectrum-color" style={{ background: SPECTRUM_COLORS[i % SPECTRUM_COLORS.length] }} />
                      <span className="spectrum-name">{s.fileName || `Spectrum ${i + 1}`}</span>
                    </div>
                    <button
                      type="button"
                      className="primary small"
                      onClick={() => restoreSpectrum(s)}
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
          {sidebarTab === 'spectra' && (
            <button type="button" onClick={clearSpectra} className="ghost full">
              Clear all
            </button>
          )}
        </div>
      </div>

      {calibrationMode && (
        <CalibrationModal
          calibrationMode={calibrationMode}
          spectra={spectra}
          calibrationBgColor={calibrationBgColor}
          setCalibrationBgColor={setCalibrationBgColor}
          refWavenumberCal={refWavenumberCal}
          calibrationStep={calibrationStep}
          onCalibrationClick={handleCalibrationClick}
          onClose={() => {
            setCalibrationMode(null)
            setCalModalZoom(null)
            setCalModalDrag(null)
          }}
        />
      )}
      {sampleLibraryOpen && (
        <SampleLibraryModal
          onAddSpectrum={handleAddFromSampleLibrary}
          onClose={() => setSampleLibraryOpen(false)}
        />
      )}
      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        hasDataOnly={hasDataOnly}
        normalizeY={normalizeY}
        setNormalizeY={setNormalizeY}
        showWavenumberBox={showWavenumberBox}
        setShowWavenumberBox={setShowWavenumberBox}
        showWavenumbersInLabels={showWavenumbersInLabels}
        setShowWavenumbersInLabels={setShowWavenumbersInLabels}
        displayYUnits={displayYUnits}
        setDisplayYUnits={setDisplayYUnits}
      />
      <SpectrumMetadataModal
        open={spectrumInfoId != null}
        onClose={() => setSpectrumInfoId(null)}
        spectrum={spectra.find((s) => s.id === spectrumInfoId) ?? null}
      />
      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        hasDataOnly={hasDataOnly}
        format={downloadFormat}
        setFormat={setDownloadFormat}
        includeList={exportIncludeList}
        setIncludeList={setExportIncludeList}
        onExport={() => {
          downloadStacked(downloadFormat, exportIncludeList, exportDownloadName)
          setExportModalOpen(false)
        }}
        previewUrl={exportPreviewUrl}
        downloadName={exportDownloadName}
        setDownloadName={setExportDownloadName}
      />
      <HelpModal open={helpModalOpen} onClose={() => setHelpModalOpen(false)} page="stacking" />
    </div>
  )
}
