import { useRef, useState, useCallback, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

function computeHomography(from: { x: number; y: number }[], to: { x: number; y: number }[]): number[] {
  const n = 8
  const A: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  const b: number[] = Array(n).fill(0)

  for (let i = 0; i < 4; i++) {
    const fx = from[i].x
    const fy = from[i].y
    const tx = to[i].x
    const ty = to[i].y

    const r1 = i * 2
    A[r1][0] = fx; A[r1][1] = fy; A[r1][2] = 1
    A[r1][3] = 0; A[r1][4] = 0; A[r1][5] = 0
    A[r1][6] = -fx * tx; A[r1][7] = -fy * tx
    b[r1] = tx

    const r2 = r1 + 1
    A[r2][0] = 0; A[r2][1] = 0; A[r2][2] = 0
    A[r2][3] = fx; A[r2][4] = fy; A[r2][5] = 1
    A[r2][6] = -fx * ty; A[r2][7] = -fy * ty
    b[r2] = ty
  }

  for (let col = 0; col < n; col++) {
    let maxRow = col
    let maxVal = Math.abs(A[col][col])
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row][col])
      if (val > maxVal) { maxVal = val; maxRow = row }
    }
    if (maxVal < 1e-12) continue
    ;[A[col], A[maxRow]] = [A[maxRow], A[col]]
    ;[b[col], b[maxRow]] = [b[maxRow], b[col]]

    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col]
      for (let j = col; j < n; j++) A[row][j] -= factor * A[col][j]
      b[row] -= factor * b[col]
    }
  }

  const h: number[] = Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i]
    for (let j = i + 1; j < n; j++) sum -= A[i][j] * h[j]
    h[i] = sum / A[i][i]
  }
  h.push(1)
  return h
}

function applyHomography(h: number[], x: number, y: number): { x: number; y: number } {
  const d = h[6] * x + h[7] * y + h[8]
  if (Math.abs(d) < 1e-12) return { x: 0, y: 0 }
  return {
    x: (h[0] * x + h[1] * y + h[2]) / d,
    y: (h[3] * x + h[4] * y + h[5]) / d,
  }
}

function sampleBilinear(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  offset: number,
): void {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const fx = x - x0
  const fy = y - y0

  const idx00 = (y0 * w + x0) * 4
  const idx01 = (y0 * w + x1) * 4
  const idx10 = (y1 * w + x0) * 4
  const idx11 = (y1 * w + x1) * 4

  for (let c = 0; c < 4; c++) {
    const v00 = pixels[idx00 + c]
    const v01 = pixels[idx01 + c]
    const v10 = pixels[idx10 + c]
    const v11 = pixels[idx11 + c]
    out[offset + c] = Math.round(v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy)
  }
}

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imgSize, setImgSize] = useState({ w: 400, h: 300 })
  const setBackgroundImage = useGameStore((s) => s.setBackgroundImage)

  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 1920, height: 1080 },
        })
        streamRef.current = s
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
      const s = streamRef.current
      if (s) s.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
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
    setCorners([
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ])
    const s = streamRef.current
    if (s) s.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        const canvas = captureCanvasRef.current
        if (canvas) {
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (ctx) ctx.drawImage(img, 0, 0)
        }
        setPhoto(dataUrl)
        setCorners([
          { x: 0.05, y: 0.05 },
          { x: 0.95, y: 0.05 },
          { x: 0.95, y: 0.95 },
          { x: 0.05, y: 0.95 },
        ])
        const s = streamRef.current
        if (s) s.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setStream(null)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const retake = useCallback(() => {
    const old = streamRef.current
    if (old) old.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    setPhoto(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: 1920, height: 1080 } })
      .then((s) => {
        streamRef.current = s
        setStream(s)
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => {})
  }, [])

  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (!img) return
    if (img.naturalWidth) {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    } else {
      const onLoad = () => {
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
        img.removeEventListener('load', onLoad)
      }
      img.addEventListener('load', onLoad)
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

    const srcCtx = srcCanvas.getContext('2d')
    const dstCtx = dstCanvas.getContext('2d')
    if (!srcCtx || !dstCtx) return

    const srcW = srcCanvas.width
    const srcH = srcCanvas.height

    const srcCorners = corners.map((c) => ({
      x: c.x * srcW,
      y: c.y * srcH,
    }))

    const dstCorners = [
      { x: 0, y: 0 },
      { x: destW, y: 0 },
      { x: destW, y: destH },
      { x: 0, y: destH },
    ]

    const H = computeHomography(dstCorners, srcCorners)

    const srcData = srcCtx.getImageData(0, 0, srcW, srcH)
    const dstData = dstCtx.createImageData(destW, destH)

    for (let oy = 0; oy < destH; oy++) {
      for (let ox = 0; ox < destW; ox++) {
        const sp = applyHomography(H, ox, oy)
        sampleBilinear(srcData.data, srcW, srcH, sp.x, sp.y, dstData.data, (oy * destW + ox) * 4)
      }
    }

    dstCtx.putImageData(dstData, 0, 0)

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
      if (dragCorner === null || imgSize.w < 100) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const divX = (e.clientX - rect.left) / rect.width
      const divY = (e.clientY - rect.top) / rect.height
      const scale = Math.min(rect.width / imgSize.w, rect.height / imgSize.h)
      const ox = (rect.width - imgSize.w * scale) / 2
      const oy = (rect.height - imgSize.h * scale) / 2
      const imgX = ((divX * rect.width - ox) / scale) / imgSize.w
      const imgY = ((divY * rect.height - oy) / scale) / imgSize.h
      setCorners((prev) => {
        const next = [...prev]
        next[dragCorner] = {
          x: Math.max(0, Math.min(1, imgX)),
          y: Math.max(0, Math.min(1, imgY)),
        }
        return next
      })
    },
    [dragCorner, imgSize]
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
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={capture}
                  disabled={!stream}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Capture Photo
                </button>
                <label className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                  Upload Image
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
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
                {imgSize.w >= 100 && (
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
                )}
              </div>
              <p className="text-xs text-gray-500 text-center">
                Drag corners to align with table edges, then Apply.
              </p>
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
          <canvas ref={captureCanvasRef} className="hidden" />
        </div>
      </div>
    </div>
  )
}


