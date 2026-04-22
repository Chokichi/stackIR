import { useCallback, useRef } from 'react'
import './MoleculeOverlay.css'

const MIN_FRAC = 0.05

export default function MoleculeOverlay({ overlay, wrapRef, onUpdate, onDelete, onEdit }) {
  const dragStateRef = useRef(null)

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
      e.stopPropagation()
      beginDrag('move', e)
    },
    [beginDrag]
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

  const style = {
    left: `${overlay.xFrac * 100}%`,
    top: `${overlay.yFrac * 100}%`,
    width: `${overlay.widthFrac * 100}%`,
    height: `${overlay.heightFrac * 100}%`,
  }

  return (
    <div
      className="molecule-overlay-card"
      style={style}
      onPointerDown={handlePointerDownCard}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={(e) => { e.stopPropagation(); onEdit(overlay.id) }}
      role="group"
      aria-label="Structure overlay"
    >
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
