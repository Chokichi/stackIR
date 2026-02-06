import { useRef, useEffect } from 'react'

export default function ZoomLens({ zoomPixel, zoomPos, zoomSize = 120, zoomLevel = 3, previewBg }) {
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
    <div className="zoom-lens" style={{ left, top }}>
      <canvas ref={canvasRef} width={zoomSize} height={zoomSize} />
    </div>
  )
}
