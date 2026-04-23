import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  spectrumLineColor as resolveSpectrumColor,
  spectrumLineDash,
} from '../utils/spectrumStyle'
import './MoleculeOverlay.css'

const MIN_FRAC = 0.05

function LinkIcon({ linked }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path
        d={
          linked
            ? 'M6.8 9.2a2.5 2.5 0 0 1 0-3.5L8.6 3.9a2.5 2.5 0 1 1 3.5 3.5l-.9.9M9.2 6.8a2.5 2.5 0 0 1 0 3.5l-1.8 1.8a2.5 2.5 0 1 1-3.5-3.5l.9-.9'
            : 'M6.5 9.5 9.5 6.5 M7.5 4.5 8.6 3.4a2.5 2.5 0 0 1 3.5 3.5l-1.1 1.1 M8.5 11.5 7.4 12.6a2.5 2.5 0 0 1-3.5-3.5l1.1-1.1'
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function MoleculeOverlay({
  overlay,
  wrapRef,
  spectra = [],
  onUpdate,
  onDelete,
  onEdit,
}) {
  const dragStateRef = useRef(null)
  const cardRef = useRef(null)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(overlay.label ?? '')
  const labelInputRef = useRef(null)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const colorPickerRef = useRef(null)
  const linkButtonRef = useRef(null)
  // Track the card's pixel size so the SVG border (dashed / dotted / etc.)
  // can be drawn with exact geometry regardless of the card's current size.
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const r = el.getBoundingClientRect()
      setCardSize((prev) =>
        prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }
      )
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!isEditingLabel) setLabelDraft(overlay.label ?? '')
  }, [overlay.label, isEditingLabel])

  useEffect(() => {
    if (isEditingLabel) {
      const el = labelInputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [isEditingLabel])

  // Close the color picker when clicking outside it / pressing Escape.
  useEffect(() => {
    if (!colorPickerOpen) return
    const onPointerDown = (e) => {
      const pop = colorPickerRef.current
      const btn = linkButtonRef.current
      if (pop && pop.contains(e.target)) return
      if (btn && btn.contains(e.target)) return
      setColorPickerOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setColorPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [colorPickerOpen])

  const linkedSpectrum = useMemo(
    () => (overlay.linkedSpectrumId ? spectra.find((s) => s.id === overlay.linkedSpectrumId) : null),
    [overlay.linkedSpectrumId, spectra]
  )
  const linkedIndex = useMemo(
    () => (linkedSpectrum ? spectra.findIndex((s) => s.id === linkedSpectrum.id) : -1),
    [linkedSpectrum, spectra]
  )
  const linkedColor = linkedSpectrum ? resolveSpectrumColor(linkedSpectrum, linkedIndex) : null
  const linkedDash = linkedSpectrum ? spectrumLineDash(linkedSpectrum) : ''

  const beginDrag = useCallback(
    (mode, e) => {
      const wrap = wrapRef?.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      dragStateRef.current = {
        mode,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        rect,
        original: {
          xFrac: overlay.xFrac,
          yFrac: overlay.yFrac,
          widthFrac: overlay.widthFrac,
          heightFrac: overlay.heightFrac,
        },
      }
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {
        // ignore
      }
    },
    [overlay.xFrac, overlay.yFrac, overlay.widthFrac, overlay.heightFrac, wrapRef]
  )

  const handlePointerDownCard = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) return
      if (isEditingLabel || colorPickerOpen) return
      e.stopPropagation()
      beginDrag('move', e)
    },
    [beginDrag, isEditingLabel, colorPickerOpen]
  )

  const handlePointerDownResize = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      beginDrag('resize', e)
    },
    [beginDrag]
  )

  const handlePointerMove = useCallback(
    (e) => {
      const s = dragStateRef.current
      if (!s || s.pointerId !== e.pointerId) return
      e.stopPropagation()
      const dx = (e.clientX - s.startX) / s.rect.width
      const dy = (e.clientY - s.startY) / s.rect.height
      if (s.mode === 'move') {
        const xFrac = Math.max(0, Math.min(1 - overlay.widthFrac, s.original.xFrac + dx))
        const yFrac = Math.max(0, Math.min(1 - overlay.heightFrac, s.original.yFrac + dy))
        onUpdate(overlay.id, { xFrac, yFrac })
      } else {
        const widthFrac = Math.max(MIN_FRAC, Math.min(1 - overlay.xFrac, s.original.widthFrac + dx))
        const heightFrac = Math.max(MIN_FRAC, Math.min(1 - overlay.yFrac, s.original.heightFrac + dy))
        onUpdate(overlay.id, { widthFrac, heightFrac })
      }
    },
    [overlay.id, overlay.xFrac, overlay.yFrac, overlay.widthFrac, overlay.heightFrac, onUpdate]
  )

  const handlePointerEnd = useCallback((e) => {
    const s = dragStateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    e.stopPropagation()
    dragStateRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {
      // ignore
    }
  }, [])

  const beginEditLabel = useCallback(
    (e) => {
      if (e) e.stopPropagation()
      setLabelDraft(overlay.label ?? '')
      setIsEditingLabel(true)
    },
    [overlay.label]
  )

  const commitLabel = useCallback(() => {
    const next = labelDraft.trim()
    if (next !== (overlay.label ?? '')) {
      onUpdate(overlay.id, { label: next })
    }
    setIsEditingLabel(false)
  }, [labelDraft, overlay.id, overlay.label, onUpdate])

  const cancelLabel = useCallback(() => {
    setLabelDraft(overlay.label ?? '')
    setIsEditingLabel(false)
  }, [overlay.label])

  const toggleColorPicker = useCallback(
    (e) => {
      e.stopPropagation()
      setColorPickerOpen((v) => !v)
    },
    []
  )

  const selectLinkedSpectrum = useCallback(
    (id, e) => {
      if (e) e.stopPropagation()
      onUpdate(overlay.id, { linkedSpectrumId: id ?? null })
      setColorPickerOpen(false)
    },
    [overlay.id, onUpdate]
  )

  const style = {
    left: `${overlay.xFrac * 100}%`,
    top: `${overlay.yFrac * 100}%`,
    width: `${overlay.widthFrac * 100}%`,
    height: `${overlay.heightFrac * 100}%`,
    // When linked, the visible border is drawn by the overlay SVG below so
    // we can honor the spectrum's dash pattern exactly; hide the default
    // rounded-rect border to avoid a double outline.
    borderColor: linkedColor ? 'transparent' : undefined,
  }

  const hasLabel = Boolean(overlay.label && overlay.label.trim())
  const pickerOptions = useMemo(
    () =>
      spectra.map((s, i) => ({
        id: s.id,
        name: s.fileName || s.id.slice(0, 8),
        color: resolveSpectrumColor(s, i),
      })),
    [spectra]
  )

  return (
    <div
      ref={cardRef}
      className="molecule-overlay-card"
      style={style}
      onPointerDown={handlePointerDownCard}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={(e) => {
        if (isEditingLabel || colorPickerOpen) return
        e.stopPropagation()
        onEdit(overlay.id)
      }}
      role="group"
      aria-label={hasLabel ? `Structure overlay: ${overlay.label}` : 'Structure overlay'}
    >
      {linkedColor && cardSize.w > 0 && cardSize.h > 0 && (
        <svg
          className="molecule-overlay-border-svg"
          width={cardSize.w}
          height={cardSize.h}
          viewBox={`0 0 ${cardSize.w} ${cardSize.h}`}
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x={1}
            y={1}
            width={Math.max(0, cardSize.w - 2)}
            height={Math.max(0, cardSize.h - 2)}
            rx={5}
            ry={5}
            fill="none"
            stroke={linkedColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={linkedDash || undefined}
          />
        </svg>
      )}
      <div className="molecule-overlay-label-row">
        {isEditingLabel ? (
          <form
            className="molecule-overlay-label-edit"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); commitLabel() }}
          >
            <input
              ref={labelInputRef}
              type="text"
              value={labelDraft}
              maxLength={120}
              placeholder="Label"
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitLabel() }
                else if (e.key === 'Escape') { e.preventDefault(); cancelLabel() }
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className={`molecule-overlay-label ${hasLabel ? '' : 'molecule-overlay-label-empty'}`}
            title={hasLabel ? 'Click to edit label' : 'Add label'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={beginEditLabel}
          >
            {hasLabel ? overlay.label : 'Add label'}
          </button>
        )}
        <button
          type="button"
          ref={linkButtonRef}
          className={`molecule-overlay-link ${linkedColor ? 'is-linked' : ''}`}
          style={linkedColor ? { color: linkedColor } : undefined}
          title={linkedSpectrum ? `Border linked to ${linkedSpectrum.fileName || 'spectrum'}` : 'Link border color to a spectrum'}
          aria-label="Link border color to spectrum"
          aria-haspopup="menu"
          aria-expanded={colorPickerOpen}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleColorPicker}
        >
          <LinkIcon linked={Boolean(linkedColor)} />
        </button>
        {colorPickerOpen && (
          <div
            className="molecule-overlay-color-picker"
            ref={colorPickerRef}
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="molecule-overlay-color-picker-header">Link border to spectrum</div>
            {pickerOptions.length === 0 && (
              <div className="molecule-overlay-color-picker-empty">No spectra available.</div>
            )}
            {pickerOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={overlay.linkedSpectrumId === opt.id}
                className={`molecule-overlay-color-option ${overlay.linkedSpectrumId === opt.id ? 'is-selected' : ''}`}
                onClick={(e) => selectLinkedSpectrum(opt.id, e)}
              >
                <span className="molecule-overlay-color-swatch" style={{ background: opt.color }} />
                <span className="molecule-overlay-color-name" title={opt.name}>{opt.name}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="molecule-overlay-color-option molecule-overlay-color-none"
              onClick={(e) => selectLinkedSpectrum(null, e)}
            >
              <span className="molecule-overlay-color-swatch molecule-overlay-color-swatch-none" />
              <span className="molecule-overlay-color-name">None (default)</span>
            </button>
          </div>
        )}
      </div>
      <div
        className="molecule-overlay-svg"
        dangerouslySetInnerHTML={{ __html: overlay.svg }}
      />
      <button
        type="button"
        className="molecule-overlay-close"
        aria-label="Remove structure"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(overlay.id) }}
      >
        ×
      </button>
      <div
        className="molecule-overlay-resize"
        onPointerDown={handlePointerDownResize}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        role="button"
        aria-label="Resize structure"
      />
    </div>
  )
}
