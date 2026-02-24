import { useMemo, useEffect } from 'react'
import { spectrumToPath, wavenumberToNormX, dataToSvgCoords, interpolateAt } from '../utils/spectrumPath'
import { getDisplayY } from '../utils/spectrumUnits'

const PAD_LEFT = 52
const PAD_RIGHT = 16
const PAD_BOTTOM = 36
const BASE_LABELS_TOP = 40
const MIN_PLOT_HEIGHT = 350
const ROW_HEIGHT = 30
/** Gap between bottom of lowest label row and top of spectrum plot. */
const GAP_LABELS_TO_PLOT = 8
/** Padding around label text for the white background rect. */
const LABEL_BG_PADDING = 4
/** Gap between bottom of label rect and top of bracket (horizontal line). */
const BRACKET_BELOW_LABEL_GAP = 8
const LABEL_CHAR_WIDTH = 5.5
const WAVENUMBER_MIN = 500
const WAVENUMBER_MAX = 4000
const GRID_POINTS = 800

function niceTicks(min, max, maxTicks = 6) {
  const range = max - min || 1
  const rawStep = range / (maxTicks - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const start = Math.ceil(min / step) * step
  const ticks = []
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(v)
  return ticks
}

/** Apply per-spectrum Y scale. In transmittance mode, pin baseline at 1 so only deviation from 1 is scaled (keeps alignment when stacking). */
function applyScaleY(y, scaleY, displayYUnits) {
  const s = scaleY ?? 1
  if (s === 1) return y
  if (displayYUnits === 'transmittance') {
    return y.map((v) => 1 + (v - 1) * s)
  }
  return y.map((v) => v * s)
}

/**
 * Renders one or more spectra as SVG paths with smooth interpolation.
 * Data-file-first: no quality loss on zoom.
 */
export function SpectrumDataDisplay({
  spectra,
  width = 800,
  height = 400,
  zoomRange = null,
  dragSelect = null,
  touchBoundaryWavenumbers = null,
  overlayMode = 'stacked',
  distributedGap = 40,
  normalizeY = false,
  displayYUnits = 'transmittance',
  tool = 'zoom',
  activeSpectrumId = null,
  showWavenumbersInLabels = true,
  yMinOffset = 0,
  onHeightChange,
}) {
  const visible = spectra.filter(Boolean)
  if (visible.length === 0) return null

  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT)

  const wavenumberMin = zoomRange ? zoomRange.xMin : WAVENUMBER_MIN
  const wavenumberMax = zoomRange ? zoomRange.xMax : WAVENUMBER_MAX

  const gridX = useMemo(() => {
    const out = []
    for (let i = 0; i < GRID_POINTS; i++) {
      out.push(wavenumberMin + (wavenumberMax - wavenumberMin) * (i / (GRID_POINTS - 1)))
    }
    return out
  }, [wavenumberMin, wavenumberMax])

  const layoutResult = useMemo(() => {
    const prepareData = (s) => {
      const rawY = getDisplayY(s.data.y, s.data.yUnits, displayYUnits)
      let y = rawY.slice()
      if (normalizeY) {
        const minY = Math.min(...y)
        const maxY = Math.max(...y)
        const range = maxY - minY || 1
        y = y.map((v) => (v - minY) / range)
      }
      return { x: s.data.x, y: applyScaleY(y, s.scaleY, displayYUnits) }
    }

    const labelWidth = (labelLen, wavenumberLen, isBracket) => {
      const maxLen = Math.max(labelLen, wavenumberLen)
      return Math.max(isBracket ? 36 : 32, maxLen * LABEL_CHAR_WIDTH) + LABEL_BG_PADDING * 2
    }
    const allLabelRanges = []
    const bracketIndices = []
    const regionIndices = []
    const individualIndices = []

    for (const spec of visible) {
      const peaks = spec.peaks ?? []
      const peakGroups = spec.peakGroups ?? {}
      for (const r of spec.regions ?? []) {
        const normLeft = wavenumberToNormX(r.wavenumberMin, wavenumberMin, wavenumberMax)
        const normRight = wavenumberToNormX(r.wavenumberMax, wavenumberMin, wavenumberMax)
        const xLeft = PAD_LEFT + normLeft * plotW
        const xRight = PAD_LEFT + normRight * plotW
        const centerX = (xLeft + xRight) / 2
        const labelText = r.label ?? ''
        const wavenumberStr = showWavenumbersInLabels ? `${Math.round(r.wavenumberMin)}–${Math.round(r.wavenumberMax)}` : ''
        const wavenumberDisplay = wavenumberStr ? `(${wavenumberStr})` : ''
        const w = labelWidth(labelText.length, wavenumberDisplay.length, true)
        regionIndices.push(allLabelRanges.length)
        allLabelRanges.push({
          xLeft: centerX - w / 2,
          xRight: centerX + w / 2,
        })
      }
      for (const [gid, g] of Object.entries(peakGroups ?? {})) {
        const groupPeaks = peaks.filter((p) => p.groupId === gid)
        if (groupPeaks.length === 0) continue
        const wavenumbers = groupPeaks.map((p) => p.wavenumber)
        const wMin = Math.min(...wavenumbers)
        const wMax = Math.max(...wavenumbers)
        const normLeft = wavenumberToNormX(wMin, wavenumberMin, wavenumberMax)
        const normRight = wavenumberToNormX(wMax, wavenumberMin, wavenumberMax)
        const xLeft = PAD_LEFT + normLeft * plotW
        const xRight = PAD_LEFT + normRight * plotW
        const centerX = (xLeft + xRight) / 2
        const labelText = g.label ?? ''
        const wavenumberStr = showWavenumbersInLabels
          ? (wavenumbers.length === 1 ? wavenumbers[0].toFixed(0) : `${Math.round(wMin)}–${Math.round(wMax)}`)
          : ''
        const wavenumberDisplay = wavenumberStr ? `(${wavenumberStr})` : ''
        const w = labelWidth(labelText.length, wavenumberDisplay.length, true)
        bracketIndices.push(allLabelRanges.length)
        allLabelRanges.push({
          xLeft: centerX - w / 2,
          xRight: centerX + w / 2,
        })
      }
      for (const peak of peaks) {
        if (peak.groupId && peakGroups[peak.groupId]) continue
        const norm = wavenumberToNormX(peak.wavenumber, wavenumberMin, wavenumberMax)
        const px = PAD_LEFT + norm * plotW
        const labelText = peak.label ?? ''
        const wavenumberDisplay = showWavenumbersInLabels ? `(${peak.wavenumber.toFixed(0)})` : ''
        const w = labelWidth(labelText.length, wavenumberDisplay.length, false)
        individualIndices.push(allLabelRanges.length)
        allLabelRanges.push({
          xLeft: px - w / 2,
          xRight: px + w / 2,
        })
      }
    }

    const overlaps = (a, b) => a.xLeft < b.xRight && b.xLeft < a.xRight
    const allSlots = allLabelRanges.map(() => 0)
    for (let i = 0; i < allLabelRanges.length; i++) {
      const used = new Set()
      for (let j = 0; j < i; j++) {
        if (overlaps(allLabelRanges[i], allLabelRanges[j])) used.add(allSlots[j])
      }
      let slot = 0
      while (used.has(slot)) slot++
      allSlots[i] = slot
    }

    const bracketSlots = bracketIndices.map((i) => allSlots[i])
    const regionSlots = regionIndices.map((i) => allSlots[i])
    const indSlots = individualIndices.map((i) => allSlots[i])
    const maxSlot = allLabelRanges.length > 0 ? Math.max(...allSlots) : -1

    const hasLabels = allLabelRanges.length > 0
    const requiredLabelsTop = hasLabels
      ? Math.max(BASE_LABELS_TOP, 34 + GAP_LABELS_TO_PLOT + (maxSlot + 1) * ROW_HEIGHT)
      : BASE_LABELS_TOP
    const totalHeight = Math.max(height, requiredLabelsTop + MIN_PLOT_HEIGHT + PAD_BOTTOM)
    const labelsTop = requiredLabelsTop
    const plotH = Math.max(MIN_PLOT_HEIGHT, totalHeight - labelsTop - PAD_BOTTOM)
    const plotRect = { x: PAD_LEFT, y: labelsTop, width: plotW, height: plotH }

    let globalDataRange = null
    const specRects = {}
    const applyYMinOffset = (minY, maxY) => Math.min(maxY - 0.01, minY + yMinOffset)
    if (overlayMode === 'stacked') {
      const allY = visible.flatMap((s) => prepareData(s).y)
      const baseMinY = normalizeY ? 0 : Math.min(...allY)
      let baseMaxY = Math.max(...allY, 1)
      // Add headroom when transmittance exceeds 1 so spectrum lines aren't clipped at top
      if (!normalizeY && baseMaxY > 1) {
        baseMaxY = baseMaxY + Math.max(0.02, (baseMaxY - 1) * 0.05)
      }
      globalDataRange = {
        minX: wavenumberMin,
        maxX: wavenumberMax,
        minY: applyYMinOffset(baseMinY, baseMaxY),
        maxY: baseMaxY,
      }
    } else {
      const gap = distributedGap
      const specHeight = (plotH - gap * (visible.length - 1)) / visible.length
      let yOffset = labelsTop
      for (const s of visible) {
        const scaled = prepareData(s)
        const baseMinY = Math.min(...scaled.y)
        let baseMaxY = Math.max(...scaled.y, 1)
        if (!normalizeY && baseMaxY > 1) {
          baseMaxY = baseMaxY + Math.max(0.02, (baseMaxY - 1) * 0.05)
        }
        specRects[s.id] = {
          rect: { x: PAD_LEFT, y: yOffset, width: plotW, height: specHeight },
          dataRange: {
            minX: wavenumberMin,
            maxX: wavenumberMax,
            minY: applyYMinOffset(baseMinY, baseMaxY),
            maxY: baseMaxY,
          },
        }
        yOffset += specHeight + gap
      }
    }

    const bracketsRaw = []
    let bi = 0
    for (const spec of visible) {
      const peaks = spec.peaks ?? []
      const peakGroups = spec.peakGroups ?? {}
      const scaledData = prepareData(spec)
      const piecewise = spec.metadata?.piecewiseAt != null
      const { rect, dataRange } = overlayMode === 'stacked'
        ? { rect: plotRect, dataRange: globalDataRange }
        : specRects[spec.id] ?? { rect: plotRect, dataRange: globalDataRange }

      for (const [gid, g] of Object.entries(peakGroups ?? {})) {
        const groupPeaks = peaks.filter((p) => p.groupId === gid)
        if (groupPeaks.length === 0) continue
        const wavenumbers = groupPeaks.map((p) => p.wavenumber)
        const wMin = Math.min(...wavenumbers)
        const wMax = Math.max(...wavenumbers)
        const peakTips = groupPeaks.map((p) => {
          const yVal = interpolateAt(scaledData.x, scaledData.y, p.wavenumber)
          const svg = dataToSvgCoords(p.wavenumber, yVal, rect, dataRange, piecewise)
          return { px: svg.x, py: svg.y, wavenumber: p.wavenumber }
        })
        const sortedByX = [...peakTips].sort((a, b) => a.px - b.px)
        const pxLeft = sortedByX[0].px
        const pxRight = sortedByX[sortedByX.length - 1].px
        const labelText = g.label ?? ''
        const wavenumberStr = showWavenumbersInLabels
          ? (wavenumbers.length === 1 ? wavenumbers[0].toFixed(0) : `${Math.round(wMin)}–${Math.round(wMax)}`)
          : ''
        const wavenumberDisplay = wavenumberStr ? `(${wavenumberStr})` : ''
        const slot = bracketSlots[bi++]
        const labelY = labelsTop - 11 - GAP_LABELS_TO_PLOT - slot * ROW_HEIGHT
        const hasTwoLines = Boolean(labelText && wavenumberDisplay)
        const labelBottomY = labelY + (hasTwoLines ? 11 : 0)
        const bracketY = labelBottomY + BRACKET_BELOW_LABEL_GAP
        bracketsRaw.push({
          xLeft: pxLeft,
          xRight: pxRight,
          peakTips,
          labelText,
          wavenumberDisplay,
          color: spec.color ?? '#000',
          specId: spec.id,
          labelY,
          bracketY,
        })
      }
    }

    const regionsRaw = []
    let ri = 0
    for (const spec of visible) {
      const { rect } = overlayMode === 'stacked'
        ? { rect: plotRect }
        : specRects[spec.id] ?? { rect: plotRect }
      for (const r of spec.regions ?? []) {
        const normLeft = wavenumberToNormX(r.wavenumberMin, wavenumberMin, wavenumberMax)
        const normRight = wavenumberToNormX(r.wavenumberMax, wavenumberMin, wavenumberMax)
        const xLeft = PAD_LEFT + normLeft * plotW
        const xRight = PAD_LEFT + normRight * plotW
        const labelText = r.label ?? ''
        const wavenumberStr = showWavenumbersInLabels ? `${Math.round(r.wavenumberMin)}–${Math.round(r.wavenumberMax)}` : ''
        const wavenumberDisplay = wavenumberStr ? `(${wavenumberStr})` : ''
        const slot = regionSlots[ri++]
        const labelY = labelsTop - 11 - GAP_LABELS_TO_PLOT - slot * ROW_HEIGHT
        regionsRaw.push({
          xLeft,
          xRight,
          rectY: rect.y,
          rectH: rect.height,
          labelText,
          wavenumberDisplay,
          color: spec.color ?? '#000',
          specId: spec.id,
          labelY,
        })
      }
    }

    const individualRaw = []
    let ii = 0
    for (const spec of visible) {
      const peaks = spec.peaks ?? []
      const peakGroups = spec.peakGroups ?? {}
      for (const peak of peaks) {
        if (peak.groupId && peakGroups[peak.groupId]) continue
        const norm = wavenumberToNormX(peak.wavenumber, wavenumberMin, wavenumberMax)
        const px = PAD_LEFT + norm * plotW
        const labelText = peak.label ?? ''
        const wStr = showWavenumbersInLabels ? peak.wavenumber.toFixed(0) : ''
        const slot = indSlots[ii++]
        const labelY = labelsTop - 11 - GAP_LABELS_TO_PLOT - slot * ROW_HEIGHT
        individualRaw.push({
          x: px,
          wavenumber: peak.wavenumber,
          labelText,
          wavenumberDisplay: wStr ? `(${wStr})` : '',
          color: spec.color ?? '#000',
          specId: spec.id,
          labelY,
        })
      }
    }

    return {
      labelsTop,
      totalHeight,
      plotRect,
      plotH,
      peakGroupBrackets: bracketsRaw,
      regions: regionsRaw,
      peakMarkers: individualRaw,
    }
  }, [visible, width, height, wavenumberMin, wavenumberMax, plotW, overlayMode, distributedGap, normalizeY, displayYUnits, showWavenumbersInLabels, yMinOffset])

  const { labelsTop, totalHeight, plotRect, plotH, peakMarkers, peakGroupBrackets, regions } = layoutResult

  useEffect(() => {
    onHeightChange?.(totalHeight)
  }, [totalHeight, onHeightChange])

  const { paths } = useMemo(() => {
    const result = []
    const prepareData = (spec) => {
      const rawY = getDisplayY(spec.data.y, spec.data.yUnits, displayYUnits)
      let y = rawY.slice()
      if (normalizeY) {
        const minY = Math.min(...y)
        const maxY = Math.max(...y)
        const range = maxY - minY || 1
        y = y.map((v) => (v - minY) / range)
      }
      y = applyScaleY(y, spec.scaleY, displayYUnits)
      return { x: spec.data.x, y }
    }
    const applyYMinOffset = (minY, maxY) => Math.min(maxY - 0.01, minY + yMinOffset)
    if (overlayMode === 'stacked') {
      const allY = visible.flatMap((s) => prepareData(s).y)
      const globalMinY = normalizeY ? 0 : Math.min(...allY)
      let globalMaxY = Math.max(...allY, 1)
      if (!normalizeY && globalMaxY > 1) {
        globalMaxY = globalMaxY + Math.max(0.02, (globalMaxY - 1) * 0.05)
      }
      const dataRange = {
        minX: wavenumberMin,
        maxX: wavenumberMax,
        minY: applyYMinOffset(globalMinY, globalMaxY),
        maxY: globalMaxY,
      }
      for (let i = 0; i < visible.length; i++) {
        const spec = visible[i]
        const scaledData = prepareData(spec)
        const pathD = spectrumToPath(
          scaledData,
          gridX,
          plotRect,
          dataRange,
          spec.metadata?.piecewiseAt != null
        )
        result.push({
          pathD,
          color: spec.color ?? '#000',
          nudgeX: spec.nudgeX ?? 0,
          nudgeY: spec.nudgeY ?? 0,
        })
      }
      return { paths: result }
    }

    const gap = distributedGap
    const specHeight = (plotH - gap * (visible.length - 1)) / visible.length
    let yOffset = labelsTop

    for (let i = 0; i < visible.length; i++) {
      const spec = visible[i]
      const scaledData = prepareData(spec)
      const baseMinY = Math.min(...scaledData.y)
      let maxY = Math.max(...scaledData.y) || 1
      if (!normalizeY && maxY > 1) {
        maxY = maxY + Math.max(0.02, (maxY - 1) * 0.05)
      }
      const rect = { x: PAD_LEFT, y: yOffset, width: plotW, height: specHeight }
      const dataRange = {
        minX: wavenumberMin,
        maxX: wavenumberMax,
        minY: applyYMinOffset(baseMinY, maxY),
        maxY,
      }
      const pathD = spectrumToPath(
        scaledData,
        gridX,
        rect,
        dataRange,
        spec.metadata?.piecewiseAt != null
      )
      result.push({
        pathD,
        color: spec.color ?? '#000',
        nudgeX: spec.nudgeX ?? 0,
        nudgeY: spec.nudgeY ?? 0,
      })
      yOffset += specHeight + gap
    }

    return { paths: result }
  }, [visible, gridX, plotRect, wavenumberMin, wavenumberMax, overlayMode, distributedGap, normalizeY, labelsTop, plotH, yMinOffset])

  const viewBox = `0 0 ${width} ${totalHeight}`

  const touchBoundaryLines = useMemo(() => {
    if (!touchBoundaryWavenumbers?.length) return []
    return touchBoundaryWavenumbers.map((w) => {
      const clamped = Math.max(wavenumberMin, Math.min(wavenumberMax, w))
      const norm = wavenumberToNormX(clamped, wavenumberMin, wavenumberMax)
      const px = PAD_LEFT + norm * plotW
      return { x: px }
    })
  }, [touchBoundaryWavenumbers, wavenumberMin, wavenumberMax, plotW])

  const dragOverlay = useMemo(() => {
    if (!dragSelect) return null
    const { x1, x2 } = dragSelect
    const wLeft = Math.min(x1, x2)
    const wRight = Math.max(x1, x2)
    const normLeft = wavenumberToNormX(wRight, wavenumberMin, wavenumberMax)
    const normRight = wavenumberToNormX(wLeft, wavenumberMin, wavenumberMax)
    const pxLeft = PAD_LEFT + normLeft * plotW
    const pxRight = PAD_LEFT + normRight * plotW
    const x = Math.min(pxLeft, pxRight)
    const w = Math.abs(pxRight - pxLeft)
    return { x, y: labelsTop, width: w, height: plotH, isPeak: tool === 'peak', isRegion: tool === 'region' }
  }, [dragSelect, wavenumberMin, wavenumberMax, plotW, plotH, tool, labelsTop])

  const axes = useMemo(() => {
    const MAJOR_STEP = 500
    const MINOR_STEP = 100
    const majorTicks = []
    for (let w = Math.ceil(wavenumberMin / MAJOR_STEP) * MAJOR_STEP; w <= wavenumberMax + 0.001; w += MAJOR_STEP) {
      if (w >= wavenumberMin - 0.001) majorTicks.push(w)
    }
    const minorTicks = []
    for (let w = Math.ceil(wavenumberMin / MINOR_STEP) * MINOR_STEP; w <= wavenumberMax + 0.001; w += MINOR_STEP) {
      if (w >= wavenumberMin - 0.001 && w % MAJOR_STEP !== 0) minorTicks.push(w)
    }
    const xTickEls = majorTicks.map((w) => {
      const norm = wavenumberToNormX(w, wavenumberMin, wavenumberMax)
      const x = PAD_LEFT + norm * plotW
      return { w, x }
    })
    const xMinorTickEls = minorTicks.map((w) => {
      const norm = wavenumberToNormX(w, wavenumberMin, wavenumberMax)
      return PAD_LEFT + norm * plotW
    })
    let yMin = 0
    let yMax = 1
    if (overlayMode === 'stacked' && visible.length > 0) {
      const prepareData = (spec) => {
        const rawY = getDisplayY(spec.data.y, spec.data.yUnits, displayYUnits)
        let y = rawY.slice()
        if (normalizeY) {
          const mn = Math.min(...y)
          const mx = Math.max(...y)
          const r = mx - mn || 1
          y = y.map((v) => (v - mn) / r)
        }
        return applyScaleY(y, spec.scaleY, displayYUnits)
      }
      const allY = visible.flatMap(prepareData)
      const baseMinY = normalizeY ? 0 : Math.min(...allY)
      let baseMaxY = Math.max(...allY, 1)
      if (!normalizeY && baseMaxY > 1) {
        baseMaxY = baseMaxY + Math.max(0.02, (baseMaxY - 1) * 0.05)
      }
      yMin = Math.min(baseMaxY - 0.01, baseMinY + yMinOffset)
      yMax = baseMaxY
    }
    const yTicks = niceTicks(yMin, yMax)
    const yTickEls = yTicks.map((v) => {
      const range = yMax - yMin || 1
      const norm = (v - yMin) / range
      const y = labelsTop + (1 - norm) * plotH
      return { v, y }
    })
    return { xTickEls, xMinorTickEls, yTickEls, yMin, yMax }
  }, [wavenumberMin, wavenumberMax, plotW, plotH, overlayMode, visible, normalizeY, displayYUnits, labelsTop, yMinOffset])

  const axisY = labelsTop + plotH

  return (
    <svg
      className="spectrum-data-display"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block', background: '#fff' }}
    >
      <defs>
        <clipPath id="plot-clip">
          <rect x={PAD_LEFT} y={labelsTop} width={plotW} height={plotH} />
        </clipPath>
        <style>{`
          .spectrum-axis { stroke: #555; stroke-width: 1; fill: none; }
          .spectrum-axis-tick { stroke: #555; stroke-width: 1; }
          .spectrum-axis-tick-minor { stroke: #888; stroke-width: 1; }
          .spectrum-axis-label { fill: #333; font: 12px system-ui, sans-serif; user-select: none; }
          .spectrum-axis-title { fill: #444; font: 11px system-ui, sans-serif; font-weight: 500; user-select: none; }
        `}</style>
      </defs>
      <g className="axes">
        <line x1={PAD_LEFT} y1={labelsTop} x2={PAD_LEFT} y2={axisY} className="spectrum-axis" />
        <line x1={PAD_LEFT} y1={axisY} x2={PAD_LEFT + plotW} y2={axisY} className="spectrum-axis" />
        {axes.xMinorTickEls.map((x, i) => (
          <line key={`minor-${i}`} x1={x} y1={axisY} x2={x} y2={axisY + 3} className="spectrum-axis-tick-minor" />
        ))}
        {axes.xTickEls.map(({ w, x }) => (
          <g key={w}>
            <line x1={x} y1={axisY} x2={x} y2={axisY + 6} className="spectrum-axis-tick" />
            <text x={x} y={axisY + 20} textAnchor="middle" className="spectrum-axis-label">{Math.round(w)}</text>
          </g>
        ))}
        {axes.yTickEls.map(({ v, y }) => (
          <g key={v}>
            <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT - 6} y2={y} className="spectrum-axis-tick" />
            <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" className="spectrum-axis-label">
              {Math.abs(v) < 10 && v !== Math.round(v) ? v.toFixed(2) : Math.round(v)}
            </text>
          </g>
        ))}
        <text x={PAD_LEFT + plotW / 2} y={height - 4} textAnchor="middle" className="spectrum-axis-title">Wavenumber (cm⁻¹)</text>
        <text x={12} y={labelsTop + plotH / 2} textAnchor="middle" className="spectrum-axis-title" transform={`rotate(-90, 12, ${labelsTop + plotH / 2})`}>{displayYUnits === 'absorbance' ? 'Absorbance' : 'Transmittance'}</text>
      </g>
      <g clipPath="url(#plot-clip)">
      <g className="region-shading-layer">
        {regions.map((r, i) => {
          const pxLeft = Math.min(r.xLeft, r.xRight)
          const pxRight = Math.max(r.xLeft, r.xRight)
          return (
            <g key={`region-${r.specId}-${i}`}>
              <rect
                x={pxLeft}
                y={r.rectY}
                width={pxRight - pxLeft}
                height={r.rectH}
                fill="#999"
                fillOpacity={0.2}
                stroke="none"
              />
              <line
                x1={pxLeft}
                y1={r.rectY}
                x2={pxLeft}
                y2={r.rectY + r.rectH}
                stroke="#555"
                strokeWidth={1.5}
                opacity={0.9}
              />
              <line
                x1={pxRight}
                y1={r.rectY}
                x2={pxRight}
                y2={r.rectY + r.rectH}
                stroke="#555"
                strokeWidth={1.5}
                opacity={0.9}
              />
            </g>
          )
        })}
      </g>
      {paths.map(({ pathD, color, nudgeX = 0, nudgeY = 0 }, i) => (
        <g key={i} transform={`translate(${nudgeX}, ${nudgeY})`}>
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ))}
      {dragOverlay && (
        <rect
          x={dragOverlay.x}
          y={dragOverlay.y}
          width={dragOverlay.width}
          height={dragOverlay.height}
          fill={dragOverlay.isPeak ? 'rgba(34, 139, 34, 0.15)' : dragOverlay.isRegion ? 'rgba(13, 71, 161, 0.15)' : 'none'}
          stroke={dragOverlay.isPeak ? 'rgba(34, 139, 34, 0.8)' : dragOverlay.isRegion ? 'rgba(13, 71, 161, 0.8)' : 'rgba(0, 100, 255, 0.8)'}
          strokeWidth={2}
          strokeDasharray="4 4"
          pointerEvents="none"
        />
      )}
      {touchBoundaryLines.map((line, i) => (
        <line
          key={`touch-boundary-${i}`}
          x1={line.x}
          y1={labelsTop}
          x2={line.x}
          y2={labelsTop + plotH}
          stroke="rgba(0, 100, 255, 0.9)"
          strokeWidth={2}
          pointerEvents="none"
        />
      ))}
      <g className="peak-lines-layer">
        {peakGroupBrackets.map((b, i) => (
          <g key={`bracket-lines-${b.specId}-${i}`}>
            {b.peakTips.map((tip, ti) => (
              <line
                key={ti}
                x1={tip.px}
                y1={b.bracketY}
                x2={tip.px}
                y2={labelsTop + plotH}
                stroke={b.color}
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.8}
              />
            ))}
            <line x1={b.xLeft} y1={b.bracketY} x2={b.xRight} y2={b.bracketY} stroke={b.color} strokeWidth={1} opacity={0.8} />
          </g>
        ))}
        {peakMarkers.map((m, i) => {
          const hasLabel = Boolean(m.labelText || m.wavenumberDisplay)
          const hasTwoLines = Boolean(m.labelText && m.wavenumberDisplay)
          const lineTopY = hasLabel ? m.labelY + (hasTwoLines ? 11 : 0) : labelsTop
          return (
          <g key={`marker-lines-${m.specId}-${m.wavenumber}-${i}`}>
            <line x1={m.x} y1={lineTopY} x2={m.x} y2={labelsTop + plotH} stroke={m.color} strokeWidth={1} strokeDasharray="2 2" opacity={0.8} />
          </g>
          )
        })}
      </g>
      </g>
      <g className="peak-labels-layer">
        {peakGroupBrackets.map((b, i) => {
          if (!b.labelText && !b.wavenumberDisplay) return null
          const centerX = (b.xLeft + b.xRight) / 2
          const labelLen = b.labelText?.length ?? 0
          const wavenumberLen = b.wavenumberDisplay?.length ?? 0
          const hasTwo = Boolean(b.labelText && b.wavenumberDisplay)
          const w = Math.max(36, Math.max(labelLen, wavenumberLen) * LABEL_CHAR_WIDTH) + LABEL_BG_PADDING * 2
          const h = (hasTwo ? 22 : 11) + LABEL_BG_PADDING * 2
          const rx = centerX - w / 2
          const ry = b.labelY - 11 - LABEL_BG_PADDING
          return (
            <g key={`bracket-label-${b.specId}-${i}`}>
              <rect x={rx} y={ry} width={w} height={h} fill="white" stroke="none" rx={2} ry={2} />
              {b.labelText && (
                <text x={centerX} y={b.labelY} textAnchor="middle" fontSize={10} fill={b.color} fontFamily="system-ui, sans-serif">
                  {b.labelText}
                </text>
              )}
              {b.wavenumberDisplay && (
                <text x={centerX} y={b.labelY + (b.labelText ? 11 : 0)} textAnchor="middle" fontSize={9} fill={b.color} fontFamily="system-ui, sans-serif" opacity={0.9}>
                  {b.wavenumberDisplay}
                </text>
              )}
            </g>
          )
        })}
        {regions.map((r, i) => {
          if (!r.labelText && !r.wavenumberDisplay) return null
          const centerX = (r.xLeft + r.xRight) / 2
          const labelLen = r.labelText?.length ?? 0
          const wavenumberLen = r.wavenumberDisplay?.length ?? 0
          const hasTwo = Boolean(r.labelText && r.wavenumberDisplay)
          const w = Math.max(36, Math.max(labelLen, wavenumberLen) * LABEL_CHAR_WIDTH) + LABEL_BG_PADDING * 2
          const h = (hasTwo ? 22 : 11) + LABEL_BG_PADDING * 2
          const rx = centerX - w / 2
          const ry = r.labelY - 11 - LABEL_BG_PADDING
          return (
            <g key={`region-label-${r.specId}-${i}`}>
              <rect x={rx} y={ry} width={w} height={h} fill="white" stroke="none" rx={2} ry={2} />
              {r.labelText && (
                <text x={centerX} y={r.labelY} textAnchor="middle" fontSize={10} fill={r.color} fontFamily="system-ui, sans-serif">
                  {r.labelText}
                </text>
              )}
              {r.wavenumberDisplay && (
                <text x={centerX} y={r.labelY + (r.labelText ? 11 : 0)} textAnchor="middle" fontSize={9} fill={r.color} fontFamily="system-ui, sans-serif" opacity={0.9}>
                  {r.wavenumberDisplay}
                </text>
              )}
            </g>
          )
        })}
        {peakMarkers.map((m, i) => {
          if (!m.labelText && !m.wavenumberDisplay) return null
          const labelLen = m.labelText?.length ?? 0
          const wavenumberLen = m.wavenumberDisplay?.length ?? 0
          const hasTwo = Boolean(m.labelText && m.wavenumberDisplay)
          const w = Math.max(32, Math.max(labelLen, wavenumberLen) * LABEL_CHAR_WIDTH) + LABEL_BG_PADDING * 2
          const h = (hasTwo ? 22 : 11) + LABEL_BG_PADDING * 2
          const rx = m.x - w / 2
          const ry = m.labelY - 11 - LABEL_BG_PADDING
          return (
            <g key={`marker-label-${m.specId}-${m.wavenumber}-${i}`}>
              <rect x={rx} y={ry} width={w} height={h} fill="white" stroke="none" rx={2} ry={2} />
              {m.labelText && (
                <text x={m.x} y={m.labelY} textAnchor="middle" fontSize={10} fill="#333" fontFamily="system-ui, sans-serif">{m.labelText}</text>
              )}
              {m.wavenumberDisplay && (
                <text x={m.x} y={m.labelY + (m.labelText ? 11 : 0)} textAnchor="middle" fontSize={9} fill="#333" fontFamily="system-ui, sans-serif" opacity={0.9}>{m.wavenumberDisplay}</text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
