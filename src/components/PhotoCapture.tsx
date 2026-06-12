import { useRef, useState, useCallback, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

interface PhotoCaptureProps {
  onClose: () => void
}

export function PhotoCapture({ onClose }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [corners, setCorners] = useState([
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 },
    { x: 0.05, y: 0.95 },
  ])
  const [dragCorner, setDragCorner] = useState<number | null>(null)
  const [imgSize, setImgSize] = useState({ w: 400, h: 300 })
  const setBackgroundImage = useGameStore((s) => s.setBackgroundImage)

  useEffect(() => {
    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 1920, height: 1080 },
        })
        setStream(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      } catch {
        // Camera not available
      }
    }
    startCamera()
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = captureCanvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    setPhoto(dataUrl)
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
  }, [stream])

  const retake = useCallback(() => {
    setPhoto(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: 1920, height: 1080 } })
      .then((s) => {
        setStream(s)
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => {})
  }, [])

  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img) {
      setImgSize({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 })
    }
  }, [])

  const applyTransform = useCallback(() => {
    const srcCanvas = captureCanvasRef.current
    const dstCanvas = previewRef.current
    if (!srcCanvas || !dstCanvas) return

    const game = useGameStore.getState().currentGame
    if (!game) return

    const destW = game.tableWidth
    const destH = game.tableHeight
    dstCanvas.width = destW
    dstCanvas.height = destH

    const ctx = dstCanvas.getContext('2d')
    if (!ctx) return

    const srcW = srcCanvas.width
    const srcH = srcCanvas.height

    const src = corners.map((c) => ({
      x: c.x * srcW,
      y: c.y * srcH,
    }))
    const dst = [
      { x: 0, y: 0 },
      { x: destW, y: 0 },
      { x: destW, y: destH },
      { x: 0, y: destH },
    ]

    const H = computeHomography(src, dst)
    if (!H) {
      ctx.drawImage(srcCanvas, 0, 0, destW, destH)
    } else {
      const imgData = ctx.createImageData(destW, destH)
      const { data } = imgData
      const srcData = getImageData(srcCanvas)

      for (let y = 0; y < destH; y++) {
        for (let x = 0; x < destW; x++) {
          const denominator = H[6] * x + H[7] * y + H[8]
          const sx = (H[0] * x + H[1] * y + H[2]) / denominator
          const sy = (H[3] * x + H[4] * y + H[5]) / denominator
          const idx = (y * destW + x) * 4
          if (sx >= 0 && sx < srcW - 1 && sy >= 0 && sy < srcH - 1) {
            const ix = Math.floor(sx)
            const iy = Math.floor(sy)
            const fx = sx - ix
            const fy = sy - iy
            const si = (iy * srcW + ix) * 4
            for (let c = 0; c < 4; c++) {
              const p00 = srcData[si + c]
              const p10 = srcData[si + 4 + c]
              const p01 = srcData[si + srcW * 4 + c]
              const p11 = srcData[si + srcW * 4 + 4 + c]
              data[idx + c] =
                (1 - fx) * (1 - fy) * p00 +
                fx * (1 - fy) * p10 +
                (1 - fx) * fy * p01 +
                fx * fy * p11
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0)
    }

    const result = dstCanvas.toDataURL('image/jpeg', 0.85)
    setBackgroundImage(result)
    onClose()
  }, [corners, onClose, setBackgroundImage])

  const handlePointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    setDragCorner(index)
  }

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragCorner === null) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setCorners((prev) => {
        const next = [...prev]
        next[dragCorner] = {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        }
        return next
      })
    },
    [dragCorner]
  )

  const handlePointerUp = useCallback(() => {
    setDragCorner(null)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Table Photo</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-sm cursor-pointer">Skip</button>
        </div>

        <div className="p-4 space-y-4">
          {!photo ? (
            <div className="space-y-3">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full rounded-lg bg-gray-800"
                style={{ maxHeight: 400, objectFit: 'contain' }}
              />
              <div className="flex gap-2">
                <button
                  onClick={capture}
                  disabled={!stream}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Capture Photo
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="relative select-none"
                style={{ maxHeight: 400 }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <img
                  ref={imgRef}
                  src={photo}
                  alt="Captured table"
                  className="w-full rounded-lg"
                  style={{ maxHeight: 350, objectFit: 'contain' }}
                  draggable={false}
                />
                <canvas ref={previewRef} className="hidden" />
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <polygon
                    points={corners
                      .map((c) => `${(c.x * imgSize.w).toFixed(1)},${(c.y * imgSize.h).toFixed(1)}`)
                      .join(' ')}
                    fill="rgba(59,130,246,0.15)"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                  />
                  {corners.map((c, i) => (
                    <circle
                      key={i}
                      cx={c.x * imgSize.w}
                      cy={c.y * imgSize.h}
                      r={10}
                      fill="#3b82f6"
                      stroke="#fff"
                      strokeWidth={2}
                      className="pointer-events-auto"
                      style={{ cursor: 'grab' }}
                      onPointerDown={handlePointerDown(i)}
                    />
                  ))}
                </svg>
              </div>
              <p className="text-xs text-gray-500 text-center">
                Drag corners to align with table edges, then Apply.
              </p>
              <canvas ref={captureCanvasRef} className="hidden" />
              <div className="flex gap-2">
                <button onClick={retake} className="text-gray-400 hover:text-gray-200 px-3 py-2 text-sm transition-colors cursor-pointer">
                  Retake
                </button>
                <button
                  onClick={applyTransform}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Apply as Background
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getImageData(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d')
  return ctx?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray()
}

function computeHomography(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[]
): number[] | null {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i]
    const { x: dx, y: dy } = dst[i]
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy])
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy])
    b.push(dx, dy)
  }
  const flat = A.flat()
  const n = 8
  const L = new Array(n * n).fill(0)
  const R = new Array(n).fill(0)
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        L[j * n + k] += flat[i * n + j] * flat[i * n + k]
      }
      R[j] += flat[i * n + j] * b[i]
    }
  }
  for (let i = 0; i < n; i++) {
    const maxRow = L.slice(i * n, i * n + n).reduce(
      (m, v, idx) => (Math.abs(v) > Math.abs(m.val) ? { val: v, idx } : m),
      { val: 0, idx: i }
    ).idx
    if (maxRow !== i) {
      for (let k = 0; k < n; k++) [L[i * n + k], L[maxRow * n + k]] = [L[maxRow * n + k], L[i * n + k]]
      ;[R[i], R[maxRow]] = [R[maxRow], R[i]]
    }
    const pivot = L[i * n + i]
    if (Math.abs(pivot) < 1e-10) return null
    for (let k = i + 1; k < n; k++) {
      const factor = L[k * n + i] / pivot
      for (let j = i; j < n; j++) L[k * n + j] -= factor * L[i * n + j]
      R[k] -= factor * R[i]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = R[i]
    for (let j = i + 1; j < n; j++) sum -= L[i * n + j] * x[j]
    x[i] = sum / L[i * n + i]
  }
  return [...x, 1]
}
